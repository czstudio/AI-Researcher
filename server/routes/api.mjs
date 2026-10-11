// REST surface. Every route listed in contracts/api.json is implemented.

import fs from 'node:fs';
import path from 'node:path';
import * as db from '../store/db.mjs';
import * as U from '../lib/util.mjs';
import { subscribe, publish } from '../lib/hub.mjs';
import { runTask } from '../lib/executor.mjs';
import { searchAll } from '../lib/literature.mjs';
import { llmConfigured } from '../lib/llm.mjs';
import { registerGpuRoutes } from './gpu.js';

const MODES = U.readJson(path.resolve(process.cwd(), 'contracts/modes.json'), { modes: [], models: [], plans: [] });
const ERRORS = U.readJson(path.resolve(process.cwd(), 'contracts/errors.json'), { codes: {} });
const VERSION_HISTORY = [
  { version: '2.4.0', date: '2026-10-09', title: 'Open replication: full workspace canvas, ANSI terminal, artifact viewer' },
  { version: '2.3.0', date: '2026-10-01', title: 'Case gallery and publish channel' },
  { version: '2.2.0', date: '2026-09-15', title: 'Auto-Discovery workspace mode' },
];

const modeByKey = (k) => MODES.modes.find((m) => m.key === k) || MODES.modes[0];
const modeByAgent = (n) => MODES.modes.find((m) => m.agentName === n) || null;

function err(code) {
  return U.fail(code, ERRORS.codes[String(code)] || 'error', ERRORS.httpOverrides?.[String(code)] || null);
}

// ---------- actors ----------
function actor(req, p) {
  const token = U.bearer(req);
  const claims = U.verifyJwt(token);
  if (claims?.uid) {
    const user = db.get('users', claims.uid);
    if (user) return { user, anon: false };
  }
  const fp = req.headers.fingerprint ? String(req.headers.fingerprint) : p?.fingerprint;
  if (fp) {
    const uid = `fp-${String(fp).slice(0, 24)}`;
    let user = db.get('users', uid);
    if (!user) user = db.newUser({ email: null, level: 'free', isAnonymous: true });
    if (user.id !== uid) {
      user.id = uid;
      db.put('users', uid, user);
    }
    return { user, anon: true };
  }
  return { user: null, anon: true };
}

function requireUser(req, p) {
  const a = actor(req, p);
  if (!a.user) return { ...a, denied: err(401) };
  return a;
}

function planOf(user) {
  return MODES.plans.find((p) => p.level === (user?.level || 'free')) || MODES.plans[0];
}

// ---------- workspace ----------
function tree(root, rel = '.', depth = 0) {
  const abs = U.safeJoin(root, rel);
  if (!abs) return null;
  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) {
    return { name: path.basename(abs), type: 'file', path: rel, size: stat.size, updatedAt: stat.mtimeMs };
  }
  const children = [];
  if (depth < 6) {
    for (const entry of fs.readdirSync(abs).sort()) {
      if (entry === '.git' || entry === 'node_modules') continue;
      const childAbs = path.join(abs, entry);
      const st = fs.statSync(childAbs);
      children.push(
        st.isDirectory()
          ? tree(root, path.posix.join(rel === '.' ? '' : rel, entry), depth + 1)
          : { name: entry, type: 'file', path: path.posix.join(rel === '.' ? '' : rel, entry), size: st.size, updatedAt: st.mtimeMs }
      );
    }
  }
  return {
    name: rel === '.' ? 'workspace' : path.basename(abs),
    type: 'directory',
    path: rel,
    children: children.filter(Boolean),
  };
}

function sessionOrShared(sessionId) {
  const s = db.get('sessions', sessionId);
  if (!s) return { session: null, denied: err(5001) };
  return { session: s, denied: null };
}

function assertReadable(session, a) {
  if (session.share) return null;
  // 只有 owner 可读私有；注册身份本身不授权（分享=只读公开，不扩展到私有）
  if (a.user && String(a.user.id) === String(session.creatorUserId)) return null;
  return err(5200);
}

// ---------- multipart ----------
function parseMultipart(buffer, boundary) {
  const parts = [];
  const sep = Buffer.from(`--${boundary}`);
  let idx = buffer.indexOf(sep);
  while (idx >= 0) {
    const start = idx + sep.length + 2;
    const end = buffer.indexOf(sep, start);
    if (end < 0) break;
    const chunk = buffer.subarray(start, end - 2);
    const headEnd = chunk.indexOf('\r\n\r\n');
    if (headEnd < 0) {
      idx = end;
      continue;
    }
    const head = chunk.subarray(0, headEnd).toString('utf8');
    const body = chunk.subarray(headEnd + 4);
    const name = /name="([^"]+)"/.exec(head)?.[1];
    const filename = /filename="([^"]*)"/.exec(head)?.[1];
    parts.push({ name, filename, data: body });
    idx = buffer.indexOf(sep, end);
  }
  return parts;
}

// ---------- handlers ----------
const routes = new Map();
const route = (method, p, fn) => routes.set(`${method} ${p}`, fn);

// GPU 租用面（自动租用/取消/状态/BYO）——注册进同一张路由表
registerGpuRoutes(route, requireUser);

// ---- public ----
route('GET', '/site-config/public', async () =>
  U.ok({ siteName: 'novix-open', llmConfigured: llmConfigured(), sandbox: process.env.SANDBOX || 'auto', version: VERSION_HISTORY[0].version })
);

route('GET', '/models', async () => U.ok({ models: MODES.models, defaultModel: MODES.defaultModel }));

route('GET', '/notification/version-history', async () => U.ok({ items: VERSION_HISTORY }));

route('GET', '/gallery/list', async (req, res, p) => {
  const key = p.mode || null;
  let items = db.all('gallery');
  if (!items.length) items = seedGallery();
  if (key && key !== 'auto') items = items.filter((i) => i.mode === key);
  return U.ok({ items });
});

function seedGallery() {
  const items = [
    { id: 'g1', mode: 'ideaspark', title: 'World models for embodied intelligence: a gap map', summary: 'Idea tree over three families of world-model designs.', sessionId: null },
    { id: 'g2', mode: 'autoexperiment', title: 'Benchmarking Gated Attention at 1B scale', summary: 'Smoke-scale reimplementation with a runnable entrypoint.', sessionId: null },
    { id: 'g3', mode: 'deepsurvey', title: 'LoRA and its variants: a five-paper mini survey', summary: 'Compiled survey with bibtex and taxonomy figure.', sessionId: null },
    { id: 'g4', mode: 'notebook', title: 'Iris revisited: a dependency-light analysis', summary: 'Profile, group statistics and a matplotlib scatter.', sessionId: null },
    { id: 'g5', mode: 'reproduce', title: 'Attention Is All You Need — smoke-test reproduction', summary: 'Toy sequence-copy task, CPU only, declared deviations.', sessionId: null },
  ];
  for (const it of items) db.put('gallery', it.id, it);
  return items;
}

// ---- user ----
route('POST', '/user/login', async (req, res, p) => {
  const email = p.email || p.username;
  const pw = p.password;
  if (!email || !pw) return err(5000);
  const user = db.all('users').find((u) => u.email === email);
  if (!user || !U.checkPassword(pw, user.passwordHash)) return err(5000);
  return U.ok({ token: U.signJwt({ uid: user.id, level: user.level }), user: publicUser(user) });
});

route('POST', '/user/emailSignUp', async (req, res, p) => {
  const email = p.email;
  if (!email || !p.password) return err(5000);
  if (db.all('users').some((u) => u.email === email)) return err(5000);
  const user = db.newUser({ email, passwordHash: U.hashPassword(p.password), name: p.name || null });
  db.appendLedger({ userId: user.id, kind: 'signup_bonus', delta: 0, balance: user.credits });
  return U.ok({ token: U.signJwt({ uid: user.id, level: user.level }), user: publicUser(user) });
});

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, level: u.level, credits: u.credits, subscriptionStatus: u.subscriptionStatus, avatarInitial: u.avatarInitial, isAnonymous: !!u.isAnonymous };
}

route('GET', '/user/sendEmailAuthCode', async () => U.ok({ sent: true, note: 'no-op in self-hosted mode' }));
route('POST', '/user/resetPassword', async () => U.ok({ ok: true, note: 'no-op in self-hosted mode' }));

route('POST', '/user/getUserInfo', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  return U.ok({ user: publicUser(a.user), plan: planOf(a.user) });
});

route('POST', '/user/getUserCreditInfo', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const plan = planOf(a.user);
  return U.ok({ credits: a.user.credits, level: a.user.level, monthlyCredits: plan.monthlyCredits, nextMonthCredit: plan.monthlyCredits, subscriptionStatus: a.user.subscriptionStatus });
});

route('POST', '/user/getUserCreditUsage', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const rows = db.get('ledger', a.user.id)?.rows || [];
  return U.ok({ rows: rows.slice(-100), total: rows.length });
});

route('GET', '/user/getAvailableCoupons', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  return U.ok({ items: [] });
});

route('POST', '/user/workspace/init', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const dir = db.sessionDir(`home-${a.user.id}`);
  return U.ok({ path: dir });
});

route('GET', '/user/workspace/interest', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  return U.ok({ files: [] });
});

route('GET', '/user/feature_white_list/enabled', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const plan = planOf(a.user);
  return U.ok({ codeAgent: plan.codeAgentAllowed, gpu: plan.level !== 'free', llmConfigured: llmConfigured() });
});

// ---- sessions ----
function createSession(a, body) {
  const session = db.newSession({ userId: a.user?.id || '-1', isAnonymous: !a.user || a.anon });
  if (body.mode) session.mode = body.mode;
  db.put('sessions', session.id, session);
  return session;
}

route('POST', '/chat_session/create', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  return U.ok(createSession(a, body));
});

route('POST', '/chat_session/create_anonymous', async (req, res, p, body) => {
  const a = actor(req, p);
  if (!a.user) {
    // no fingerprint either -> mint one so the caller still gets a session
    a.user = db.newUser({ level: 'free', isAnonymous: true });
  }
  return U.ok(createSession(a, body));
});

route('GET', '/chat_session/list', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const sessions = db
    .all('sessions')
    .filter((s) => s.creatorUserId === a.user.id)
    .sort((x, y) => y.updatedAt - x.updatedAt)
    .map((s) => ({ ...s, lastMessage: lastMessageOf(s.id) }));
  return U.ok({ items: sessions });
});

function messagesOf(sessionId) {
  return db
    .all('tasks')
    .filter((t) => t.chatSessionId === sessionId)
    .sort((x, y) => x.createdAt - y.createdAt)
    .map((t) => ({
      id: t.id,
      type: 'task',
      query: t.query,
      result: t.result || '',
      status: t.status,
      taskId: t.id,
      agentName: t.agentName || '',
      questionMode: t.questionMode || 'task',
      createdAt: t.createdAt,
      extInfo: { chatResultType: '1', mode: t.mode },
    }));
}

function lastMessageOf(sessionId) {
  const m = messagesOf(sessionId);
  return m.length ? m[m.length - 1] : null;
}

route('GET', '/chat_session/active', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const active = db
    .all('tasks')
    .filter((t) => ['init', 'processing'].includes(t.status))
    .map((t) => ({ taskId: t.id, chatSessionId: t.chatSessionId, status: t.status }));
  return U.ok({ items: active });
});

route('GET', '/chat_session/message/list', async (req, res, p) => {
  const a = actor(req, p);
  const { session, denied } = sessionOrShared(p.chatSessionId);
  if (denied) return denied;
  const gate = assertReadable(session, a);
  if (gate) return gate;
  return U.ok({ chatSession: session, chatSessionMessages: messagesOf(session.id) });
});

route('GET', '/chat_session/status', async (req, res, p) => {
  const { session, denied } = sessionOrShared(p.chatSessionId);
  if (denied) return denied;
  return U.ok({ id: session.id, status: 'idle', storageTier: session.storageTier, share: session.share });
});

route('POST', '/chat_session/share', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const { session, denied } = sessionOrShared(body.chatSessionId || p.chatSessionId);
  if (denied) return denied;
  session.share = true;
  session.updatedAt = U.nowMs();
  db.put('sessions', session.id, session);
  return U.ok({ chatSessionId: session.id, share: true, url: `/search-v1/${session.id}` });
});

route('POST', '/chat_session/bind_anonymous', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const { session, denied } = sessionOrShared(body.chatSessionId || p.chatSessionId);
  if (denied) return denied;
  session.creatorUserId = a.user.id;
  session.isAnonymous = false;
  db.put('sessions', session.id, session);
  return U.ok(session);
});

route('POST', '/chat_session/rename', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const { session, denied } = sessionOrShared(body.chatSessionId || p.chatSessionId);
  if (denied) return denied;
  session.title = body.title || p.title || session.title;
  db.put('sessions', session.id, session);
  return U.ok(session);
});

route('POST', '/chat_session/delete', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  db.del('sessions', body.chatSessionId || p.chatSessionId);
  return U.ok({ deleted: true });
});

route('GET', '/chat_session/workspace', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const dir = db.workspaceDir(p.chatSessionId);
  return U.ok({ root: dir, tree: tree(dir) });
});

route('POST', '/chat_session/workspace/subtree', async (req, res, p, body) => {
  const a = actor(req, p);
  const { session, denied } = sessionOrShared(body.chatSessionId || p.chatSessionId);
  if (denied) return denied;
  const gate = assertReadable(session, a);
  if (gate) return gate;
  const dir = db.workspaceDir(session.id);
  const rel = body.path || p.path || '.';
  return U.ok({ workspaceTreeJson: tree(dir, rel) });
});

route('GET', '/chat_session/workspace/download_workspace_url', async (req, res, p) => {
  const a = actor(req, p);
  const { session, denied } = sessionOrShared(p.chatSessionId);
  if (denied) return denied;
  const gate = assertReadable(session, a);
  if (gate) return gate;
  const sig = U.signJwt({ dl: session.id }, 3600);
  return U.ok({ url: `/api/file/download?fileKey=workspace/${session.id}&signature=${sig}`, expiresAt: Date.now() + 3600_000, signature: sig });
});

route('GET', '/chat_session/workspace/home_files', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const dir = db.workspaceDir(p.chatSessionId);
  return U.ok({ files: (tree(dir)?.children || []).slice(0, 50) });
});

route('POST', '/chat_session/workspace/home_file_preview', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const dir = db.workspaceDir(body.chatSessionId || p.chatSessionId);
  const abs = U.safeJoin(dir, body.path || p.path || '');
  if (!abs || !fs.existsSync(abs)) return err(5001);
  const content = fs.readFileSync(abs, 'utf8');
  return U.ok({ path: body.path, content: content.slice(0, 200000), language: languageOf(abs) });
});

function languageOf(file) {
  const ext = path.extname(file).toLowerCase();
  return (
    {
      '.py': 'python',
      '.js': 'javascript',
      '.mjs': 'javascript',
      '.ts': 'typescript',
      '.json': 'json',
      '.md': 'markdown',
      '.tex': 'latex',
      '.sh': 'shell',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.csv': 'csv',
      '.bib': 'bibtex',
    }[ext] || 'text'
  );
}

route('POST', '/chat_session/workspace/user_upload/delete', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const dir = db.workspaceDir(body.chatSessionId || p.chatSessionId);
  const abs = U.safeJoin(dir, `user_data/${body.path || p.path || ''}`);
  if (abs && fs.existsSync(abs)) fs.rmSync(abs, { force: true });
  return U.ok({ deleted: true });
});

route('POST', '/chat_session/workspace/user_workspace/subtree', async (req, res, p, body) => {
  const a = actor(req, p);
  const { session, denied } = sessionOrShared(body.chatSessionId || p.chatSessionId);
  if (denied) return denied;
  const gate = assertReadable(session, a);
  if (gate) return gate;
  const dir = db.workspaceDir(session.id);
  return U.ok({ workspaceTreeJson: tree(dir, 'user_data') || tree(dir) });
});

// ---- tasks ----
async function createTask(req, res, p, body, { anonymous }) {
  const a = anonymous ? actor(req, p) : requireUser(req, p);
  if (a.denied) return a.denied;
  if (anonymous && !a.user) a.user = db.newUser({ level: 'free', isAnonymous: true });

  const queryContent = body.queryContent ?? body.query;
  if (!queryContent || !String(queryContent).trim()) return err(4000);

  let sessionId = body.chatSessionId;
  let session;
  if (sessionId) {
    const r = sessionOrShared(sessionId);
    if (r.denied) return r.denied;
    session = r.session;
    // 归属门：foreign/shared 会话不得借道创建任务（分享只授权读）——
    // 在扣 credits/appendLedger/newTask/调度之前拒绝，异常零副作用
    if (String(session.creatorUserId) !== String(a.user.id)) return err(5200);
  } else {
    session = db.newSession({ userId: a.user.id, isAnonymous: anonymous });
  }

  const plan = planOf(a.user);
  const modeKey = body.mode || p.mode || 'auto';
  const modeDef = modeByKey(modeKey);
  const agentName = body.agentName || modeDef?.agentName || '';

  if (['autoexperiment', 'notebook'].includes(modeKey) && !plan.codeAgentAllowed) return err(5019);
  const cost = modeDef?.creditCost || 1;
  if ((a.user.credits ?? 0) < cost && !anonymous) return err(5016);

  if (!anonymous) {
    a.user.credits = Math.max(0, (a.user.credits ?? 0) - cost);
    db.put('users', a.user.id, a.user);
    db.appendLedger({ userId: a.user.id, kind: 'task', delta: -cost, balance: a.user.credits, mode: modeKey });
  }

  const enableGpu = body.enableGpu === true || body.enableGpu === 'true';
  const fileIds = body.fileIds || [];
  const task = db.newTask({ sessionId: session.id, agentName, query: body.query || queryContent, queryContent, mode: modeKey });
  task.enableGpu = fileIds.length ? false : enableGpu;
  task.questionMode = body.enableBrainstorming ? 'discuss' : 'task';
  task.modelOverride = body.enableBrainstorming ? MODES.discussModelOverride : body.modelOverride || MODES.defaultModel;
  task.controls = body.controls || [];
  if (body.writeUpType) task.writeUpType = body.writeUpType;
  session.updatedAt = U.nowMs();
  if (!session.title) session.title = String(queryContent).slice(0, 60);
  db.put('sessions', session.id, session);
  db.put('tasks', task.id, task);

  setImmediate(() => runTask({ task, session, modeDef, body: { ...body, controls: task.controls, modelOverride: task.modelOverride, queryContent } }));
  return U.ok({ ...task, chatSessionId: session.id });
}

route('POST', '/task/create_task', (req, res, p, body) => createTask(req, res, p, body, { anonymous: false }));
route('POST', '/task/create_anonymous_task', (req, res, p, body) => createTask(req, res, p, body, { anonymous: true }));

route('GET', '/task/get_task', async (req, res, p) => {
  const a = actor(req, p);
  const task = db.get('tasks', p.taskId);
  if (!task) return err(5001);
  const { session, denied } = sessionOrShared(task.chatSessionId);
  if (denied) return denied;
  const gate = assertReadable(session, a);
  if (gate) return gate;
  return U.ok(task);
});

route('POST', '/task/submit_user_question', async (req, res, p, body) => {
  // 线上语义（2026-10-10 实测）：回填挂起中的 AskUserQuestion 工具调用。
  // {sessionId, taskId, toolCallId, result: "{\"问题\":\"用户答\"}"} → agent 继续
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const { pendingQuestions } = await import('../lib/agent-loop.mjs');
  const rec = body.toolCallId && pendingQuestions.get(String(body.toolCallId));
  if (rec) {
    pendingQuestions.delete(String(body.toolCallId));
    let answer = body.result;
    if (typeof answer === 'string') { try { answer = JSON.parse(answer); } catch { answer = { [rec.question]: answer }; } }
    rec.resolve(answer || { [rec.question]: '(空回答)' });
    return U.ok({ accepted: true, toolCallId: body.toolCallId });
  }
  // 兼容旧语义：无挂起问题时作为新任务创建
  return createTask(req, res, p, { ...body, chatSessionId: body.chatSessionId || p.chatSessionId }, { anonymous: false });
});

// ---- Auto-Discovery（线上实测契约）----
route('GET', '/user/workspace/interest', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  // 兴趣画像：由近期会话标题派生（线上未启用时为 null；本地给最小实现）
  const sessions = db.all('sessions').filter((x) => String(x.creatorUserId) === String(a.user.id)).slice(-20);
  const titles = sessions.map((x) => (x.title || '').trim()).filter(Boolean);
  return U.ok(titles.length ? { topics: [...new Set(titles)].slice(0, 8), updatedAt: U.nowMs() } : null);
});

route('GET', '/auto_ideaspark/ideas', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  // Mind Mining：聚合各会话工作区的 idea-tree*.json 为统一树（线上 auto-ideaspark-root 形态）
  const root = {
    id: 'auto-ideaspark-root', parent: null, children: [], summary: 'Research Space',
    description: 'Personalized idea trees generated from recent sessions and user feedback.',
    references: [], next_action: null, created_at: null,
  };
  const seen = new Map();
  for (const s of db.all('sessions').filter((x) => String(x.creatorUserId) === String(a.user.id)).slice(-30)) {
    try {
      const dir = db.workspaceDir(s.id);
      for (const f of fs.readdirSync(path.join(dir, 'project')).catch(() => []) || []) {
        if (/idea-tree.*\.json$/.test(f)) {
          const tree = JSON.parse(fs.readFileSync(path.join(dir, 'project', f), 'utf8'));
          const key = `${f.replace(/\.json$/, '').replace(/-idea-tree$/, '')}__root`;
          if (!seen.has(key)) { seen.set(key, true); root.children.push(key); }
          for (const [id, node] of Object.entries(tree)) seen.set(`${key}:${id}`, node);
        }
      }
    } catch { /* skip */ }
  }
  const tree = { 'auto-ideaspark-root': root };
  for (const [k, v] of seen) { if (typeof v === 'object') tree[k.replace(/^[^:]+__root:/, (m) => m)] = v; }
  // 展开为 父树id__节点id 形态（线上命名法）
  const out = { 'auto-ideaspark-root': root };
  for (const [k, v] of Object.entries(seen)) {
    if (typeof v === 'object' && v) out[`${v.id}`] = v;
  }
  return U.ok({ tree: out });
});

// ---- Code Agent 端点族（线上 bundle 判明的契约，最小同形实现）----
route('POST', '/task/start_code_agent', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  return createTask(req, res, p, { ...body, mode: 'auto', agentName: body.agentName || 'Code Agent' }, { anonymous: false });
});

route('GET', '/sandbox_processes/:user_id/:session_id', async (req, res, p) => U.ok({ processes: [], userId: p.user_id, sessionId: p.session_id }));
route('GET', '/history_updates/:user_id/:session_id', async (req, res, p) => U.ok({ updates: [], userId: p.user_id, sessionId: p.session_id }));

route('POST', '/task/cancel/:taskId', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const taskId = p.taskId;
  const t = taskId && db.get('tasks', String(taskId));
  if (!t) return U.fail('5101', 'task not found');
  // 归属校验（2026-10-10 执行单 04 负验收发现：匿名 B fingerprint 可取消 A 的任务——IDOR 同族）
  const own = db.get('sessions', t.chatSessionId);
  const creatorOk = own && String(own.creatorUserId) === String(a.user.id);
  if (!creatorOk) return U.fail('5100', 'not your task');
  // 真中止：先 abort agent 循环（LLM fetch + Bash 子进程），再落终态
  const { abortTask } = await import('../lib/executor.mjs');
  const aborted = abortTask(taskId);
  t.status = 'cancelled';
  t.finishedAt = U.nowMs();
  db.put('tasks', t.id, t);
  publish(t.sessionId, { type: 'complete', taskId: t.id, cancelled: true });
  return U.ok({ cancelled: true, taskId: t.id, processTerminated: aborted });
});

route('POST', '/call_agent', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  return createTask(req, res, p, { ...body, mode: body.mode || 'auto', agentName: body.agentName }, { anonymous: false });
});

route('GET', '/agents', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  return U.ok({ items: MODES.modes.filter((m) => m.agentName).map((m) => ({ key: m.key, name: m.agentName, label: m.label, creditCost: m.creditCost })) });
});

// ---- files ----
route('POST', '/file/batch_temp_urls', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const names = body.files || body.names || [];
  const items = names.map((n) => {
    const fileId = U.id(16);
    db.put('files', fileId, { id: fileId, name: n, owner: a.user.id, createdAt: U.nowMs() });
    return { fileId, name: n, tempUrl: `/api/file/upload_stream?fileId=${fileId}` };
  });
  return U.ok({ items });
});

route('POST', '/file/upload_stream', async (req, res, p, body) => {
  const a = actor(req, p);
  const ct = String(req.headers['content-type'] || '');
  const b = await U.readBody(req);
  const fileId = p.fileId || U.id(16);
  let name = p.name || 'upload.bin';
  let data = b.raw;
  const bm = /boundary=(?:"([^"]+)"|([^;]+))/.exec(ct);
  if (bm) {
    const parts = parseMultipart(b.raw, bm[1] || bm[2]);
    const part = parts.find((x) => x.filename) || parts[0];
    if (part) {
      name = part.filename || name;
      data = part.data;
    }
  }
  const sessionId = p.chatSessionId || body.chatSessionId;
  const dir = sessionId ? db.workspaceDir(sessionId) : U.ensureDir(path.join(U.DATA_DIR, 'uploads'));
  const target = U.safeJoin(dir, `user_data/${path.basename(name)}`);
  if (!target) return err(5000);
  U.ensureDir(path.dirname(target));
  fs.writeFileSync(target, data);
  db.put('files', fileId, { id: fileId, name, size: data.length, path: target, owner: a.user?.id || null, createdAt: U.nowMs() });
  return U.ok({ fileId, name, size: data.length, path: `user_data/${path.basename(name)}` });
});

route('POST', '/file/upload_complete', async (req, res, p, body) => {
  const ids = body.fileIds || [p.fileId].filter(Boolean);
  return U.ok({ fileIds: ids, completed: true });
});

route('GET', '/file/temp_url', async (req, res, p) => U.ok({ tempUrl: `/api/file/upload_stream?fileId=${p.fileId || U.id(16)}` }));

route('GET', '/file/download', async (req, res, p) => {
  const a = actor(req, p);
  const key = p.fileKey || '';
  if (key.startsWith('workspace/')) {
    const sid = key.split('/')[1];
    const { session, denied } = sessionOrShared(sid);
    if (denied) return denied;
    const gate = session.share ? null : assertReadable(session, a);
    if (gate) return gate;
    return { __streamZip: db.workspaceDir(sid), name: `workspace-${sid}.zip` };
  }
  const f = db.get('files', key);
  if (!f || !f.path) return err(5001);
  return { __streamFile: f.path, name: f.name };
});

// ---- published ----
route('POST', '/published/item/publish', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const { session, denied } = sessionOrShared(body.chatSessionId || p.chatSessionId);
  if (denied) return denied;
  const revisionId = U.id(16);
  session.share = true;
  session.revisionId = revisionId;
  db.put('sessions', session.id, session);
  db.put('gallery', revisionId, {
    id: revisionId,
    mode: session.mode || 'auto',
    title: session.title || 'Untitled session',
    summary: (lastMessageOf(session.id)?.result || '').slice(0, 240),
    sessionId: session.id,
  });
  return U.ok({ revisionId, url: `/published/revision/${revisionId}` });
});

route('GET', '/published/item/publish/access', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  return U.ok({ canPublish: true, reason: null });
});

function revisionSession(revisionId) {
  const s = db.all('sessions').find((x) => x.revisionId === revisionId);
  return s || null;
}

route('GET', '/published/revision/:id/session', async (req, res, p) => {
  const s = revisionSession(p.id);
  if (!s) return err(5001);
  return U.ok({ chatSession: s, chatSessionMessages: messagesOf(s.id) });
});

route('GET', '/published/revision/:id/task', async (req, res, p) => {
  const s = revisionSession(p.id);
  if (!s) return err(5001);
  const task = db.get('tasks', p.taskId);
  if (!task || task.chatSessionId !== s.id) return err(5001);
  return U.ok(task);
});

route('GET', '/published/revision/:id/workspace/subtree', async (req, res, p) => {
  const s = revisionSession(p.id);
  if (!s) return err(5001);
  return U.ok({ workspaceTreeJson: tree(db.workspaceDir(s.id), p.path || '.') });
});

// ---- search / growth / notifications / billing ----
route('POST', '/search', async (req, res, p, body) => {
  const q = body.query || p.query;
  if (!q) return err(4000);
  const topK = Number(body.topK || p.topK || 20);
  const hits = await searchAll(q, { max: Math.min(topK, 30) });
  return U.ok({ items: hits, requestId: body.request_id || p.request_id || null, total: hits.length });
});

route('GET', '/get_searchHistory', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  return U.ok({ items: [] });
});

route('GET', '/referral/me', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  return U.ok({ code: `REF-${String(a.user.id).slice(0, 8).toUpperCase()}`, invited: 0, bonus: 30 });
});

route('POST', '/likeTask', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  return U.ok({ liked: true, taskId: body.taskId || p.taskId });
});

route('GET', '/getTaskFeedback', async (req, res, p) => U.ok({ items: [] }));

route('POST', '/credit/upgrade_plan', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const level = body.level || p.level || 'pro';
  const plan = MODES.plans.find((x) => x.level === level) || MODES.plans[1];
  a.user.level = plan.level;
  a.user.credits = plan.monthlyCredits;
  a.user.subscriptionStatus = 'active';
  db.put('users', a.user.id, a.user);
  db.appendLedger({ userId: a.user.id, kind: 'upgrade', delta: plan.monthlyCredits, balance: a.user.credits, plan: plan.level });
  return U.ok({ level: plan.level, credits: a.user.credits });
});

route('POST', '/credit/subscription/upgrade', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  a.user.subscriptionStatus = body.action === 'cancel' ? 'cancel_scheduled' : 'active';
  db.put('users', a.user.id, a.user);
  return U.ok({ subscriptionStatus: a.user.subscriptionStatus });
});

route('POST', '/credit/join', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  a.user.credits = (a.user.credits || 0) + 30;
  db.put('users', a.user.id, a.user);
  return U.ok({ credits: a.user.credits, inviteId: p.inviteId });
});

route('POST', '/credit/remove', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const amount = Number(body.amount || p.amount || 0);
  a.user.credits = Math.max(0, (a.user.credits || 0) - amount);
  db.put('users', a.user.id, a.user);
  return U.ok({ credits: a.user.credits });
});

route('GET', '/notification/list', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  return U.ok({ items: db.get('notifications', a.user.id)?.items || [] });
});

route('GET', '/auto_ideaspark/ideas', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  return U.ok({ items: db.all('gallery').filter((g) => g.mode === 'ideaspark').slice(0, 12) });
});

route('POST', '/auto_ideaspark/modify', async (req, res, p, body) => U.ok({ ok: true, idea: body.idea || null }));

// ---------- router ----------
function match(method, pathname) {
  const key = `${method} ${pathname}`;
  if (routes.has(key)) return { fn: routes.get(key), params: {} };
  for (const [k, fn] of routes) {
    const [m, p] = k.split(' ');
    if (m !== method || !p.includes(':')) continue;
    const kr = p.split('/');
    const pr = pathname.split('/');
    if (kr.length !== pr.length) continue;
    const params = {};
    let okAll = true;
    for (let i = 0; i < kr.length; i++) {
      if (kr[i].startsWith(':')) params[kr[i].slice(1)] = decodeURIComponent(pr[i]);
      else if (kr[i] !== pr[i]) {
        okAll = false;
        break;
      }
    }
    if (okAll) return { fn, params };
  }
  return null;
}

export async function handleApi(req, res, pathname, url) {
  const apiPath = pathname.replace(/^\/api/, '') || '/';

  // SSE channel is special-cased before the table.
  if (apiPath === '/chat/' || apiPath === '/chat') return handleSse(req, res, url);

  const hit = match(req.method, apiPath);
  if (!hit) return U.json(res, 404, { code: '5001', message: 'endpoint not found', result: null });

  const p = await U.params(req, url);
  let body = {};
  if (p && Object.keys(p).length) body = p;

  let out;
  try {
    out = await hit.fn(req, res, { ...p, ...hit.params }, body);
  } catch (e) {
    out = U.fail(5000, String(e?.message || e));
  }

  if (out && out.__streamFile) {
    const abs = out.__streamFile;
    if (!fs.existsSync(abs)) return U.json(res, 404, { code: '5001', message: 'file not found', result: null });
    const stat = fs.statSync(abs);
    res.writeHead(200, {
      'Content-Type': U.mimeOf(abs),
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(out.name || 'file')}"`,
    });
    fs.createReadStream(abs).pipe(res);
    return;
  }
  if (out && out.__streamZip) return streamZip(res, out.__streamZip, out.name);

  const status = out?.__http || 200;
  if (isFailShape(out)) {
    const { __http, ...rest } = out;
    return U.json(res, __http || 200, rest);
  }
  return U.json(res, status, out);
}

function isFailShape(v) {
  return v && typeof v === 'object' && 'code' in v && 'message' in v && 'result' in v && v.code !== '0';
}

// Minimal, dependency-free zip (store-only) so workspace download works anywhere.
import zlib from 'node:zlib';
function crc32(buf) {
  let c;
  const table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}
function zipEntry(name, data) {
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8); // store
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(0, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(0, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);
  return { chunk: Buffer.concat([local, nameBuf, data]), central: Buffer.concat([central, nameBuf]) };
}
function streamZip(res, rootDir, zipName) {
  const chunks = [];
  const centrals = [];
  const walk = (dir, rel) => {
    for (const entry of fs.readdirSync(dir)) {
      const abs = path.join(dir, entry);
      const st = fs.statSync(abs);
      const relPath = rel ? `${rel}/${entry}` : entry;
      if (st.isDirectory()) walk(abs, relPath);
      else {
        const e = zipEntry(relPath, fs.readFileSync(abs));
        chunks.push(e.chunk);
        centrals.push(e.central);
      }
    }
  };
  walk(rootDir, '');
  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(Buffer.concat(chunks).length, 16);
  const out = Buffer.concat([...chunks, centralBuf, end]);
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Length': out.length,
    'Content-Disposition': `attachment; filename="${encodeURIComponent(zipName || 'workspace.zip')}"`,
  });
  res.end(out);
  void zlib;
}

// ---------- SSE ----------
function handleSse(req, res, url) {
  const q = U.parseQuery(url);
  const sessionId = q.chatSessionId;
  const token = U.bearer(req) || q.token;
  const claims = U.verifyJwt(token);
  const user = claims?.uid ? db.get('users', claims.uid) : null;

  if (!sessionId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ code: '5001', message: 'chatSessionId required', result: null }));
  }
  const session = db.get('sessions', sessionId);
  if (!session) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ code: '5001', message: 'chatSession not exist', result: null }));
  }
  if (!session.share && !user) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ code: '401', message: 'user not found', result: null }));
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');

  const send = (event, data) => {
    if (res.writableEnded) return;
    res.write(`event:${event}\n`);
    if (data !== undefined) res.write(`data:${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
    else res.write('\n');
  };

  // Replay anything already finished for this session.
  for (const t of db.all('tasks').filter((t) => t.chatSessionId === sessionId).sort((a, b) => a.createdAt - b.createdAt)) {
    if (t.result) send('message', t.result);
  }

  const unsub = subscribe(sessionId, (ev) => {
    if (ev.type === 'message') send('message', ev.delta);
    else if (ev.type === 'step') send('message', `\n\n> **${ev.name}** — ${ev.status}${ev.detail ? ` (${ev.detail})` : ''}\n\n`);
    else if (ev.type === 'terminal') send('message', `\n\n\`\`\`ansi\n${ev.text}\n\`\`\`\n\n`);
    else if (ev.type === 'artifact') send('message', `\n\n📄 \`${ev.path}\`\n\n`);
    else if (ev.type === 'tool') send('message', '');
    else if (ev.type === 'plan') send('message', `\n\n**Plan:** ${ev.steps.join(' → ')}\n\n`);
    else if (ev.type === 'response') send('response', { messages: ev.messages });
    else if (ev.type === 'error') send('response', { messages: [{ role: 'assistant', content: ev.message }], errorCode: ev.errorCode });
    else if (ev.type === 'complete') {
      send('complete');
      try {
        res.end();
      } catch {
        /* already closed */
      }
    }
  });

  const keepAlive = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(keepAlive);
    unsub();
  });
}
