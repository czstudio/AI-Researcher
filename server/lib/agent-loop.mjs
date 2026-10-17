// 真实自治工具循环 agent —— 对齐线上 NovixWriterAgent 的运行形态。
//
// 线上证据（2026-10-10 实测，docs/10-红黑对抗-全功能实现对照.md §7）：
//   - 114 步轨迹为标准 OpenAI 消息流（assistant.tool_calls → tool 结果），
//     步进内容即 {type:'trajectory', content:"[{role,...}]"}
//   - 工具面：Skill / Read / Write / Bash / Glob / Grep / TaskCreate / TaskUpdate
//     + mcp__paper_search__{unified_paper_search,get_paper_fulltext,search_papers_by_source}
//     + mcp__web_search__{google_search,url2text}
//   - 单 agent 全程（NovixWriterAgent），TaskCreate/TaskUpdate 为 TODO 式清单
//   - Bash 真实执行（mkdir/xelatex/pdfinfo），工作区 /home/novix/workspace
//   - 技能目录 .claude_data/skills + bundled-skills；Skill 工具按名加载
//
// 本实现把「固定阶段脚本」升级为「自治循环」：LLM 自主决定工具调用顺序直至完成。
// 未配置 LLM 网关时调用方应回退到 kernels.mjs 的阶段脚本。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolveModel } from './llm.mjs';
import { searchAll, searchArxiv, searchCrossref, searchSemanticScholar, fetchPaperFulltext, webSearch, scholarSearch } from './literature.mjs';
import * as db from '../store/db.mjs';
import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';
import { OPEN_NOVA_TOOL_DESCRIPTORS, executeOpenNovaTool } from './open-nova-tools.mjs';

const MAX_ROUNDS = 60;
const ASK_TIMEOUT_MS = 10 * 60_000;
/** 线上 human-in-the-loop：toolCallId → {resolve, question, taskId, sessionId}（submit_user_question 回填） */
export const pendingQuestions = new Map();

function askUser(ctx, toolCallId, question) {
  return new Promise((resolve) => {
    const rec = { resolve, question, taskId: ctx.taskId, sessionId: ctx.sessionId, at: Date.now() };
    pendingQuestions.set(toolCallId, rec);
    const t = setTimeout(() => {
      if (pendingQuestions.delete(toolCallId)) resolve({ '(timeout)': '用户未在时限内回答，请基于已有信息继续或明确假设。' });
    }, ASK_TIMEOUT_MS);
    if (t.unref) t.unref();
  });
}
const TOOL_TIMEOUT_MS = 120_000;
const TOOL_OUTPUT_CAP = 8000;

/** 各模式的线上实测包装模板（逐字提取自 get_task steps[0]）。其余模式为同构重建。 */
export const LIVE_TEMPLATES = {
  deepsurvey: {
    agentName: 'NovixWriterAgent',
    wrapper: (q, c = {}) => `Treat this as a paper-style academic writing task.

Writeup requirements:
- Working format is LaTeX.
- Final deliverable must be exported as PDF.
- Structure the work as an academic paper.
- Include at least: Title, Abstract, Introduction, Related Work or Background when appropriate, Methods/Approach, Results/Evidence, Discussion, Conclusion, and References.
- Use formal academic tone.
- Make claims traceable to evidence and citations.
- Prioritize figures and tables during planning unless the user explicitly asks for text-only output or no visuals.
- Use \`publication-plots\` for evidence figures, \`scientific-schematics\` for explanatory figures, and \`generate-image\` sparingly for conceptual figures.
- Generate and embed planned figures directly in the final source during this run.
- If technical inputs are incomplete, write only what can be supported by verified material.
- Respond in the same language used in the user task.

Helpful skills may include, but are not limited to:
- 'awaken'
- 'scientific-writing'
- 'publication-plots'
- 'citation-management'
- 'literature-review'
- 'venue-templates'
- 'peer-review'
- 'scientific-schematics'
- 'generate-image'
- 'latex-posters'
- 'docx'
- 'pdf'

User task:
${q}

Requirements:
- Time range: ${c.years || '5 years'}`,
  },
  ideaspark: {
    agentName: 'Idea Agent',
    wrapper: (q, c = {}) => `Treat this as a multi-round, research-driven idea generation task.

- You must load and follow the \`novix-ideaspark\` skill.
- Respond in the same language used in the user task.
- Use \`treejson\` CLI for all idea-tree mutations. Never write or edit the JSON file directly.
- Keep the tree inside the workspace, and the filename must end with \`idea-tree.json\`.
- Before each major branch expansion, do fresh research first.
- In each round, persist only branches that pass novelty, gap, feasibility, and reference checks.
- After each expansion round, run validation exactly as required by the skill.

Helpful skills may include, but are not limited to:
- \`awaken\`
- \`novix-ideaspark\`
- \`literature-review\`
- \`hypothesis-generation\`
- \`scientific-brainstorming\`
- \`scientific-critical-thinking\`
- \`citation-management\`

User task:
${q}

Requirements:
- Seed type: ${c.seedType || 'Topic'}
- Exploration: Breadth ${c.breadth ?? 5}/10, Depth ${c.depth ?? 5}/10
- Style: Novel ${c.novel ?? 5}/10, Feasible ${c.feasible ?? 5}/10`,
  },
  autoexperiment: {
    agentName: 'NovixCodeAgent',
    wrapper: (q, c = {}) => `Treat this as an end-to-end ML implementation and auto-experiment task.

Requirements:
- Implement a complete, runnable ML workflow in the project workspace.
- Keep code self-contained and production-oriented; avoid brittle demo-only scripts.
- Use the default environment directly (no virtualenv creation unless explicitly required).
- Maintain phased task tracking (setup, implementation, testing/evaluation) with clear progress updates.
- Implement full pipeline: data preparation, model building, training, evaluation, and result reporting.
- Run real experiments, log key metrics, and preserve reproducibility metadata (configs, seeds, command history).
- For long-running jobs, monitor execution status and ensure jobs complete before finalizing.
- Adapt reference implementations into the project; do not rely on direct external codebase imports.
- Deliver a reproducible 'entrypoint.sh' that can run core experiments and regenerate the main outputs.
- Ensure final outputs are interpretable and mapped to the original task goals.
- Respond in the same language used in the user task.

Helpful skills may include, but are not limited to:
- 'pytorch-lightning'
- 'torch-geometric'
- 'transformers'
- 'scikit-learn'
- 'statistical-analysis'
- 'scientific-critical-thinking'
- 'publication-plots'

User task:
${q}
Compute: ${c.enableGpu ? 'GPU (cuda)' : 'CPU'}`,
  },
  notebook: {
    agentName: 'NovixCodeAgent',
    wrapper: (q, c = {}) => `Treat this as a notebook-first analysis task.

Requirements:
- Use the skill 'novix-notebook'.
- Use Novix notebook MCP tools as the primary notebook interface.
- Start with 'mcp__notebook__create_new_notebook', then add and execute cells with 'mcp__notebook__add_cell_and_execute' or 'mcp__notebook__insert_cell_and_execute'.
- Use 'mcp__notebook__get_number_of_cells', 'mcp__notebook__get_cell_type_and_source', and 'mcp__notebook__get_cell_output' to inspect notebook structure and outputs before finishing.
- Keep the main notebook under '/home/novix/workspace/project/notebook' (local: project/notebook).
- Use real data, real references, and real analysis unless the user explicitly asks for mock data.
- Review the notebook as a complete artifact before finishing.
- If useful, export whole-notebook review images before completion.
- Respond in the same language used in the user task.

Helpful skills may include, but are not limited to:
- 'novix-notebook'
- 'exploratory-data-analysis'
- 'open-notebook'
- 'matplotlib'
- 'seaborn'
- 'plotly'

User task:
${q}`,
  },
  // 逐字捕获（线上 Pro 任务 246271 轨迹首步，2026-10-11）：
  reproduce: { agentName: 'Reproduce Paper Agent', wrapper: (q, c = {}) => `Treat this as a research paper reproduction task.\n\nRequirements:\n- Start from the provided paper/materials and identify the paper's core contributions first.\n- Explicitly define reproduction scope (in-scope vs out-of-scope) and prioritize highest-impact main-paper claims.\n- Prioritize reproducing main-body experiments; appendix-only extras are optional unless needed to support main claims.\n- Build a traceable mapping from paper method components to your code modules, configs, and experiment scripts.\n- Reproduce key tables/figures/metrics as faithfully as possible; focus on matching trends when exact numbers are unattainable.\n- Record all deviations, missing details in the paper, and the assumptions used to bridge those gaps.\n- Keep reproducibility artifacts complete: fixed seeds, configs, run scripts, environment notes, and experiment logs.\n- If the user specifies reproduction constraints (e.g., from-scratch only, no official repo), follow them strictly.\n- Deliver a runnable 'entrypoint.sh' that reproduces the implemented results end-to-end.\n- Provide a final reproduction report covering scope, setup, reproduced results, gaps, and next-step recommendations.\n- Respond in the same language used in the user task.\n\nHelpful skills may include, but are not limited to:\n- 'literature-review'\n- 'research-lookup'\n- 'pytorch-lightning'\n- 'scikit-learn'\n- 'statistical-analysis'\n- 'scientific-critical-thinking'\n- 'scientific-writing'\n- 'citation-management'\n\nUser task:\n${q}` },
  // 同构重建（线上模板未逐字捕获，结构自 Idea/Deep Survey 实测推断）：
  methoddesign: { agentName: 'Proposal Agent', wrapper: (q, c = {}) => `Treat this as a research methodology proposal task.\n\n- Load and follow the \`novix-proposal\` skill.\n- Deliverable: a method/experiment proposal with falsifiable evaluation protocol.\n- Respond in the same language used in the user task.\n\nHelpful skills may include: awaken, novix-proposal, literature-review, hypothesis-generation, scientific-critical-thinking, citation-management.\n\nUser task:\n${q}` },
  auto: { agentName: 'NovixWriterAgent', wrapper: (q) => `${q}` },
};

/** 工具面 schema（对齐线上工具名）。 */
export const TOOLS = [
  { type: 'function', function: { name: 'Skill', description: '按名加载技能并获得其使用说明', parameters: { type: 'object', properties: { skill: { type: 'string' }, args: { type: 'string' } }, required: ['skill'] } } },
  { type: 'function', function: { name: 'Read', description: '读取工作区文本文件（≤400 行）', parameters: { type: 'object', properties: { file_path: { type: 'string' } }, required: ['file_path'] } } },
  { type: 'function', function: { name: 'Write', description: '写入工作区文件（覆盖）', parameters: { type: 'object', properties: { file_path: { type: 'string' }, content: { type: 'string' } }, required: ['file_path', 'content'] } } },
  { type: 'function', function: { name: 'Bash', description: '在工作区目录执行 shell 命令', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } } },
  { type: 'function', function: { name: 'Glob', description: '按 glob 模式列出工作区文件', parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'Grep', description: '工作区内正则检索', parameters: { type: 'object', properties: { pattern: { type: 'string' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'TaskCreate', description: '创建执行计划条目（subject）', parameters: { type: 'object', properties: { subject: { type: 'string' } }, required: ['subject'] } } },
  { type: 'function', function: { name: 'TaskUpdate', description: '更新计划条目状态', parameters: { type: 'object', properties: { taskId: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'done'] } }, required: ['taskId', 'status'] } } },
  { type: 'function', function: { name: 'AskUserQuestion', description: '向用户提问以澄清关键信息（返回 {问题文本: 用户回答}）', parameters: { type: 'object', properties: { question: { type: 'string', description: '要问用户的问题（一句）' }, options: { type: 'array', items: { type: 'string' }, description: '可选的候选项' } }, required: ['question'] } } },
  { type: 'function', function: { name: 'mcp__paper_search__unified_paper_search', description: '跨 arXiv/Crossref/SemanticScholar 检索论文', parameters: { type: 'object', properties: { query: { type: 'string' }, max: { type: 'integer' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'mcp__paper_search__search_papers_by_source', description: '按单一来源检索论文（arxiv|crossref|semanticscholar）', parameters: { type: 'object', properties: { query: { type: 'string' }, source: { type: 'string' } }, required: ['query', 'source'] } } },
  { type: 'function', function: { name: 'mcp__web_search__url2text', description: '抓取网页正文为文本', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
  // ---- notebook 域（线上 Data Analysis 实测 2026-10-10）：notebook 即执行环境 ----
  { type: 'function', function: { name: 'mcp__notebook__create_new_notebook', description: '新建 notebook（工作区 project/notebook/main.ipynb）', parameters: { type: 'object', properties: { path: { type: 'string' } } } } },
  { type: 'function', function: { name: 'mcp__notebook__add_cell_and_execute', description: '追加 cell 并真实执行（python3），返回 stdout/stderr', parameters: { type: 'object', properties: { cell_type: { type: 'string', enum: ['code', 'markdown'] }, source: { type: 'string' } }, required: ['source'] } } },
  { type: 'function', function: { name: 'mcp__notebook__get_cell_output', description: '读取某 cell 的既有输出', parameters: { type: 'object', properties: { index: { type: 'integer' } }, required: ['index'] } } },
  { type: 'function', function: { name: 'mcp__notebook__get_number_of_cells', description: 'notebook cell 数', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'mcp__notebook__get_cell_type_and_source', description: '读某 cell 类型与源码', parameters: { type: 'object', properties: { index: { type: 'integer' } }, required: ['index'] } } },
  { type: 'function', function: { name: 'mcp__notebook__delete_cell', description: '删除某 cell', parameters: { type: 'object', properties: { index: { type: 'integer' } }, required: ['index'] } } },
  // ---- files / delivery 域（线上实测）----
  { type: 'function', function: { name: 'mcp__paper_search__get_paper_fulltext', description: '获取 arXiv 论文全文（PDF→text）', parameters: { type: 'object', properties: { identifier: { type: 'string', description: 'arXiv ID 或 URL' } }, required: ['identifier'] } } },
  { type: 'function', function: { name: 'mcp__web_search__web_search', description: '真实网络搜索（DuckDuckGo）', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'mcp__web_search__google_scholar_search', description: '学术搜索（arXiv/S2/DOI 限定）', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'mcp__files__open_files', description: '在工作区文件面板打开文件（登记近期打开）', parameters: { type: 'object', properties: { paths: { type: 'array', items: { type: 'string' } } }, required: ['paths'] } } },
  { type: 'function', function: { name: 'mcp__delivery__deliver_to_user', description: '把文件登记为对用户的最终交付', parameters: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } }, note: { type: 'string' } }, required: ['files'] } } },
];
TOOLS.push(...OPEN_NOVA_TOOL_DESCRIPTORS);

function persistNotebook(ctx, ws) {
  try {
    const nb = {
      nbformat: 4, nbformat_minor: 5,
      metadata: { kernelspec: { name: 'python3' } },
      cells: (ctx.nb?.cells || []).map((c) => ({ ...c, outputs: c.outputs || [], execution_count: c.execution_count ?? null })),
    };
    const abs = inWorkspace(ws, ctx.nb.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, JSON.stringify(nb, null, 1));
  } catch { /* 持久化失败不阻塞 */ }
}

function inWorkspace(ws, rel) {
  const abs = path.resolve(ws, rel);
  if (abs !== ws && !abs.startsWith(ws + path.sep)) throw new Error('路径越界');
  return abs;
}

function sh(cmd, cwd, signal) {
  // 独立验收 04 追加负控 C1：signal 已 abort 时 EventTarget 不触发 listener——
  // 必须预检直接返回，否则 sleep 5 照跑到底（5044ms 实测）。
  if (signal?.aborted) {
    return Promise.resolve({ output: '(已取消，未执行)', code: null, aborted: true });
  }
  return new Promise((resolve) => {
    // 独立验收 04 发现：execFile SIGTERM 只杀 zsh 壳，孙进程（node/python 后台）存活。
    // 修：detached 进程组 + kill(-pid) 组杀；SIGTERM 后 2s 兜底 SIGKILL；未 abort 前不误杀。
    const child = spawn('/bin/zsh', ['-c', cmd], { cwd, timeout: TOOL_TIMEOUT_MS, maxBuffer: 4e6, detached: true });
    let out = '';
    let abortInitiated = false; // 纠偏（v3 独立验收）：SIGTERM-ignore 孙进程使 close 先到、
                                 // done() 清 killTimer → SIGKILL 被取消 → 孙进程存活
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    let settled = false;
    const done = (code) => {
      if (settled) return;
      settled = true;
      // abort 路径下不清 killTimer——SIGKILL 兜底必须仍执行（SIGTERM-ignore 进程场景）
      if (!abortInitiated) clearTimeout(killTimer);
      resolve({ output: (out || '').slice(0, TOOL_OUTPUT_CAP) || '(空)', code });
    };
    let killTimer = null;
    child.on('error', () => done(1));
    child.on('close', (code) => done(code ?? 0));
    if (signal) signal.addEventListener('abort', () => {
      if (settled) return;
      abortInitiated = true;
      try { process.kill(-child.pid, 'SIGTERM'); } catch { /* group gone */ }
      killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }, 2000);
      if (killTimer.unref) killTimer.unref();
    }, { once: true });
  });
}

async function url2text(url) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const client = u.protocol === 'https:' ? https : http;
    const req = client.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 (novix-open research agent)' }, timeout: 20000 }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { buf += d; if (buf.length > 200000) req.destroy(); });
      res.on('end', () => resolve(buf.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, TOOL_OUTPUT_CAP)));
      res.on('error', (e) => resolve(`抓取失败: ${e.message}`));
    });
    req.on('error', (e) => resolve(`抓取失败: ${e.message}`));
    req.on('timeout', () => { req.destroy(); resolve('抓取超时'); });
  });
}

/** 执行一个工具调用。workspace 内真实 fs / 真实 shell / 真实检索。 */
async function executeTool(ctx, name, input) {
  // ctx.currentToolCallId 由循环处注入（AskUserQuestion 用）
  const ws = ctx.workspaceDir;
  switch (name) {
    case 'Skill': {
      // 线上语义：返回使用说明 + 权限信封（allowedTools）+ 脚本绝对路径
      const skillRoot = path.resolve(import.meta.dirname, '..', '..', 'skills', input.skill);
      const f = path.join(skillRoot, 'SKILL.md');
      if (fs.existsSync(f)) {
        const guide = fs.readFileSync(f, 'utf8').slice(0, TOOL_OUTPUT_CAP - 500);
        // 权限信封（对齐线上 allowedTools 模型）
        const allowedTools = ['Read', 'Write', 'Bash', 'Glob', 'Grep'];
        // 脚本绝对路径（agent 不需要猜）
        let scripts = [];
        const scriptsDir = path.join(skillRoot, 'scripts');
        if (fs.existsSync(scriptsDir)) {
          scripts = fs.readdirSync(scriptsDir).filter(n => n.endsWith('.py') || n.endsWith('.js')).map(n => path.join(scriptsDir, n));
        }
        return JSON.stringify({ success: true, commandName: input.skill, allowedTools, guide, scriptPaths: scripts, skillRoot }) .slice(0, TOOL_OUTPUT_CAP);
      }
      // 别名归一（publication-plots ↔ plots 等）
      const aliases = { plots: 'publication-plots', schematics: 'scientific-schematics', quality: 'report-quality-gate', gate: 'report-quality-gate', export: 'pdf-export', pdf: 'pdf-export', dataviz: 'dataviz', palette: 'dataviz' };
      const canonical = aliases[input.skill];
      if (canonical) {
        input.skill = canonical;
        return executeTool(ctx, 'Skill', input);
      }
      const available = fs.readdirSync(path.resolve(import.meta.dirname, '..', '..', 'skills')).join(', ');
      return `技能 ${input.skill} 未安装（可用：${available}）。可用通用方法论继续；或用 ${available.split(',')[0]} 等已安装技能。`;
    }
    case 'Read':
      return fs.readFileSync(inWorkspace(ws, input.file_path), 'utf8').split('\n').slice(0, 400).join('\n');
    case 'Write': {
      const abs = inWorkspace(ws, input.file_path);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, input.content ?? '');
      return `已写入 ${input.file_path}`;
    }
    case 'Bash': {
      // P0-2（GAP-LIST v2）：enableGpu 不再是死参数——本地有 GPU 时注入 CUDA_VISIBLE_DEVICES
      let cmd = String(input.command);
      if (ctx.enableGpu && !cmd.includes('CUDA_VISIBLE_DEVICES')) {
        const hasGpu = await sh('command -v nvidia-smi >/dev/null 2>&1 && echo yes || echo no', ws, ctx.signal);
        if (hasGpu.output.trim() === 'yes') {
          cmd = `CUDA_VISIBLE_DEVICES=0 ${cmd}`;
        }
      }
      return (await sh(cmd, ws, ctx.signal)).output;
    }
    case 'Glob': {
      const out = await sh(`find . -path ./.git -prune -o -print | head -400`, ws, ctx.signal);
      const pat = input.pattern || '**/*';
      const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '::').replace(/\*/g, '[^/]*').replace(/::/g, '.*').replace(/\?/g, '.') + '$');
      return out.output.split('\n').filter((l) => re.test(l.replace(/^\.\//, ''))).join('\n') || '(空)';
    }
    case 'Grep': {
      const r = await sh(`grep -rn --include='*' -m 5 ${JSON.stringify(String(input.pattern))} . 2>/dev/null | head -40`, ws, ctx.signal);
      return r.output || '(无命中)';
    }
    case 'TaskCreate': {
      const id = String((ctx.plan?.length || 0) + 1);
      ctx.plan = ctx.plan || [];
      ctx.plan.push({ id, subject: input.subject, status: 'pending' });
      return JSON.stringify({ task: { id, subject: input.subject } });
    }
    case 'TaskUpdate': {
      const t = (ctx.plan || []).find((x) => x.id === String(input.taskId));
      if (t) t.status = input.status;
      return JSON.stringify({ success: !!t, taskId: input.taskId, updatedFields: ['status'] });
    }
    case 'AskUserQuestion':
      return JSON.stringify(await askUser(ctx, ctx.currentToolCallId, String(input.question || '请补充信息')));
    case 'mcp__paper_search__unified_paper_search':
      return JSON.stringify(await searchAll(String(input.query), { max: Math.min(input.max || 8, 20) }), null, 1).slice(0, TOOL_OUTPUT_CAP);
    case 'mcp__paper_search__search_papers_by_source': {
      const fn = { arxiv: searchArxiv, crossref: searchCrossref, semanticscholar: searchSemanticScholar }[String(input.source)] || searchArxiv;
      return JSON.stringify(await fn(String(input.query), { max: 8 }), null, 1).slice(0, TOOL_OUTPUT_CAP);
    }
    case 'mcp__web_search__url2text':
      return url2text(String(input.url));
    case 'mcp__notebook__create_new_notebook': {
      ctx.nb = { path: input.path || 'project/notebook/main.ipynb', cells: [], kernel: 0 };
      return JSON.stringify({ created: true, path: ctx.nb.path, cells: 0 });
    }
    case 'mcp__notebook__add_cell_and_execute': {
      ctx.nb = ctx.nb || { path: 'project/notebook/main.ipynb', cells: [] };
      const cell = { cell_type: input.cell_type || 'code', source: String(input.source) };
      if (cell.cell_type === 'code') {
        const tmp = `.nb_cell_${Date.now().toString(36)}.py`;
        const abs = inWorkspace(ws, tmp);
        fs.writeFileSync(abs, cell.source);
        // 线上语义：cell 在 notebook 内核顺序执行；本地用 python3 单进程近似（变量经 _nb_ctx.pkl 传递）
        const prelude = `import pickle,os\n_ctx='.nb_ctx.pkl'\n_g={}\nif os.path.exists(_ctx):\n _g=pickle.load(open(_ctx,'rb'));globals().update(_g)\nexec(open(${JSON.stringify(tmp)}).read())\nimport sys\n_d={}\nfor k,v in list(globals().items()):\n if k.startswith('__') or k in ('pickle','os','sys'):continue\n try:_d[k]=pickle.dumps(v) and v\n except Exception:pass\ntry:pickle.dump(_d,open(_ctx,'wb'))\nexcept Exception:pass`;
        const pre = `.nb_pre_${Date.now().toString(36)}.py`;
        fs.writeFileSync(inWorkspace(ws, pre), prelude);
        const r = await sh(`python3 ${pre}`, ws, ctx.signal);
        fs.rmSync(abs, { force: true }); fs.rmSync(inWorkspace(ws, pre), { force: true });
        cell.outputs = [{ output_type: 'stream', text: r.output }];
        cell.execution_count = ++ctx.nb.kernel;
      }
      ctx.nb.cells.push(cell);
      persistNotebook(ctx, ws);
      return JSON.stringify({ index: ctx.nb.cells.length - 1, execution_count: cell.execution_count ?? null, output: (cell.outputs?.[0]?.text || '').slice(0, TOOL_OUTPUT_CAP) });
    }
    case 'mcp__notebook__get_number_of_cells':
      return JSON.stringify({ count: (ctx.nb?.cells || []).length });
    case 'mcp__notebook__get_cell_type_and_source': {
      const c = ctx.nb?.cells?.[input.index];
      return c ? JSON.stringify({ cell_type: c.cell_type, source: c.source }) : 'cell 不存在';
    }
    case 'mcp__notebook__get_cell_output': {
      const c = ctx.nb?.cells?.[input.index];
      return JSON.stringify({ output: c?.outputs?.[0]?.text ?? null });
    }
    case 'mcp__notebook__delete_cell': {
      if (ctx.nb?.cells) { ctx.nb.cells.splice(Number(input.index), 1); persistNotebook(ctx, ws); }
      return JSON.stringify({ deleted: true });
    }
    case 'mcp__paper_search__get_paper_fulltext': {
      const r = await fetchPaperFulltext(String(input.identifier));
      return JSON.stringify(r.error ? r : { arxivId: r.arxivId, chars: r.chars, text: r.text?.slice(0, TOOL_OUTPUT_CAP) });
    }
    case 'mcp__web_search__web_search':
      return JSON.stringify(await webSearch({ query: String(input.query), limit: input.limit || 5 }));
    case 'mcp__web_search__google_scholar_search':
      return JSON.stringify(await scholarSearch({ query: String(input.query), limit: input.limit || 5 }));
    case 'mcp__files__open_files': {
      const paths = Array.isArray(input.paths) ? input.paths : [];
      ctx.openedFiles = [...(ctx.openedFiles || []), ...paths];
      return JSON.stringify({ opened: paths.length, files: paths });
    }
    case 'mcp__delivery__deliver_to_user': {
      const files = Array.isArray(input.files) ? input.files : [];
      fs.mkdirSync(inWorkspace(ws, 'delivery'), { recursive: true });
      fs.writeFileSync(inWorkspace(ws, 'delivery/MANIFEST.md'), `# 交付清单\n\n${files.map((f) => `- \`${f}\``).join('\n')}\n${input.note ? `\n> ${input.note}\n` : ''}`);
      return JSON.stringify({ delivered: files.length, files, manifest: 'delivery/MANIFEST.md' });
    }
    case 'PythonExecute':
      return JSON.stringify(await executeOpenNovaTool(name, input, { workspaceDir: ws, signal: ctx.signal }));
    case 'BrowserUse':
      return JSON.stringify(await executeOpenNovaTool(name, input, { workspaceDir: ws, signal: ctx.signal }));
    case 'StrReplaceEditor':
      return JSON.stringify(await executeOpenNovaTool(name, input, { workspaceDir: ws, signal: ctx.signal }));
    case 'FileSaver':
      return JSON.stringify(await executeOpenNovaTool(name, input, { workspaceDir: ws, signal: ctx.signal }));
    case 'Terminate':
      ctx.terminated = true;
      return JSON.stringify(await executeOpenNovaTool(name, input, { workspaceDir: ws, signal: ctx.signal }));
    default:
      return `未实现的工具：${name}`;
  }
}

/** OpenAI 兼容补全（带 tools）。返回 {content, toolCalls}。 */
function completions({ baseUrl, apiKey, model, messages, tools, signal }) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl.replace(/\/+$/, '') + '/chat/completions');
    const client = url.protocol === 'https:' ? https : http;
    const payload = JSON.stringify({ model, messages, tools, tool_choice: 'auto' });
    const req = client.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'Content-Length': Buffer.byteLength(payload) },
      timeout: 180_000,
    }, (res) => {
      let buf = '';
      res.on('data', (d) => (buf += d));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`LLM ${res.statusCode}: ${buf.slice(0, 200)}`));
        try {
          const j = JSON.parse(buf);
          const msg = j.choices?.[0]?.message || { content: '' };
          resolve({ content: msg.content || '', toolCalls: msg.tool_calls || [] });
        } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('LLM 超时')));
    req.on('error', reject);
    if (signal) signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true });
    req.end(payload);
  });
}

/**
 * 自治工具循环。async generator 产出与 executor 兼容的事件：
 *   {kind:'trajectory', message}   —— 一条原始 OpenAI 消息（executor 负责按线上格式落步）
 *   {kind:'tool', name, input, output}
 *   {kind:'artifact', path, bytes}
 *   {kind:'final', content}
 */
function taskOf(ctx) { return ctx.taskRef?.id ?? ctx.taskId ?? ''; }
function sessionOf(ctx) { return ctx.sessionRef?.id ?? ctx.sessionId ?? ''; }

// 身族工具面分化（P0-3 GAP-LIST v2 2026-10-11）
const WRITER_FAMILY = new Set(['deepsurvey', 'ideaspark', 'methoddesign', 'auto']);
const CODE_FAMILY = new Set(['autoexperiment', 'notebook', 'reproduce']);

function toolsForFamily(modeKey) {
  if (CODE_FAMILY.has(modeKey)) return TOOLS; // 全开（Bash/GPU/notebook/MCP 全部）
  // Writer 系：去掉 notebook 域（写作不需要逐 cell 执行）
  return TOOLS.filter(t => !t.function.name.startsWith('mcp__notebook__'));
}

export async function* runAgentLoop(ctx) {
  const tpl = LIVE_TEMPLATES[ctx.modeKey] || LIVE_TEMPLATES.auto;
  const familyTools = toolsForFamily(ctx.modeKey);
  const wrapped = tpl.wrapper(ctx.queryContent || ctx.query, ctx.controls || {});
  const system = [
    'You are a research agent running inside an "agentic workspace for research".',
    'Workspace is a sandbox directory; operate only through the provided tools.',
    'Verify facts with tools before claiming them; prefer real citations with identifiers (arXiv id / DOI).',
    'Produce concrete artifacts (files) rather than commentary. Respond in the language of the user task.',
  ].join('\n');

  ctx.plan = [];
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: wrapped },
  ];
  const { baseUrl, apiKey, model } = resolveModel(ctx.model || ctx.modeDef?.defaultModel);
  if (!baseUrl || !apiKey) throw new Error('未配置 LLM 网关（.env 的 LLM_API_BASE/LLM_API_KEY）');

  let lastContent = '';
  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (ctx.signal?.aborted) break;
    const { content, toolCalls } = await completions({ baseUrl, apiKey, model, messages, tools: familyTools, signal: ctx.signal });
    if (content) lastContent = content;
    const msg = { role: 'assistant', content: content || '', ...(toolCalls.length ? { tool_calls: toolCalls } : {}), agent_name: tpl.agentName };
    yield { kind: 'trajectory', message: msg };
    if (!toolCalls.length) break;
    messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });
    ctx.taskId = ctx.taskId || String(taskOf(ctx) || '');
    ctx.sessionId = ctx.sessionId || sessionOf(ctx);
    for (const tc of toolCalls) {
      let input = {};
      try { input = JSON.parse(tc.function?.arguments || '{}'); } catch { /* keep {} */ }
      const name = tc.function?.name || '';
      ctx.currentToolCallId = tc.id;
      let output;
      try {
        output = await executeTool(ctx, name, input);
      } catch (e) {
        output = `工具错误: ${e.message}`;
      }
      if (name === 'Write' && input.file_path) {
        try {
          yield { kind: 'artifact', path: input.file_path, bytes: Buffer.byteLength(input.content ?? '') };
        } catch { /* ignore */ }
      }
      yield { kind: 'tool', name, input, output };
      messages.push({ role: 'tool', tool_call_id: tc.id, content: String(output).slice(0, TOOL_OUTPUT_CAP) });
    }
  }
  yield { kind: 'final', content: lastContent };
}
