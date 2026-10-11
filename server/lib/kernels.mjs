// The six agent kernels behind the nine modes.
// Each kernel is an async generator that emits progress events and writes real
// artifacts into the session workspace. Literature search and code execution are
// real; text generation is real whenever an LLM gateway is configured.

import fs from 'node:fs';
import path from 'node:path';
import { chat } from './llm.mjs';
import { searchAll, fetchArxivSource } from './literature.mjs';
import { runPython } from './sandbox.mjs';

const STAGE_NAMES = {
  literature_review: ['Scope & query', 'Retrieve sources', 'Cluster & compare', 'Draft survey', 'Compile deliverable'],
  idea_generation: ['Read the landscape', 'Mine gaps', 'Generate idea tree', 'Rank & prune', 'Package ideas'],
  proposal: ['Frame the problem', 'Decompose the method', 'Design experiments', 'Risk & ablations', 'Write proposal'],
  ml_experiment: ['Setup & scoping', 'Data preparation', 'Model implementation', 'Training run', 'Evaluation', 'Results & delivery'],
  notebook: ['Load data', 'Validate & profile', 'Analyze', 'Visualize', 'Write conclusions'],
  reproduce: ['Intake & source check', 'Scope & claims', 'Implement method', 'Run experiments', 'Compare to paper', 'Reproduction report'],
  router: ['Classify request', 'Select agent', 'Execute', 'Summarize'],
};

function writeArtifact(ctx, relPath, content) {
  const abs = path.join(ctx.workspaceDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  return { path: relPath, bytes: Buffer.byteLength(typeof content === 'string' ? content : JSON.stringify(content)) };
}

function controlsOf(ctx) {
  const out = {};
  for (const c of ctx.controls || []) out[c.id] = c.value ?? c.default ?? null;
  return out;
}

async function* stream(ctx, messages) {
  const queue = [];
  let wake = null;
  let finished = false;
  let error = null;
  let pushed = 0;

  const push = (d) => {
    if (!d) return;
    pushed += d.length;
    queue.push(d);
    if (wake) {
      const r = wake;
      wake = null;
      r();
    }
  };

  chat({ model: ctx.model, messages, onDelta: push, signal: ctx.signal })
    .then((full) => {
      // Non-streaming providers return the whole text; emit it once.
      if (!pushed && full) push(String(full));
    })
    .catch((e) => {
      error = e;
    })
    .finally(() => {
      finished = true;
      if (wake) {
        const r = wake;
        wake = null;
        r();
      }
    });

  let text = '';
  for (;;) {
    if (queue.length) {
      const d = queue.shift();
      text += d;
      yield { kind: 'delta', text: d };
      continue;
    }
    if (finished) break;
    await new Promise((r) => {
      wake = r;
    });
  }
  if (error) throw error;
  return text;
}

function systemFor(mode, ctx) {
  const c = controlsOf(ctx);
  const base = [
    'You are a research agent running inside an "agentic workspace for research".',
    'You must produce concrete, checkable artifacts — not commentary about what could be done.',
    'Prefer real citations with identifiers (arXiv id / DOI). Flag anything you could not verify.',
    'Write with LaTeX-safe structure when the deliverable is a paper.',
  ].join('\n');
  const detail = {
    literature_review: `Deliverable: a survey${c.writeUpType && c.writeUpType !== 'paper' ? ` formatted as ${c.writeUpType}` : ' formatted as a paper'}. Recency window: ${c.years || '5 years'}. Focus: ${c.focus || 'Methods'}.`,
    idea_generation: `Deliverable: an idea tree with root -> families -> concrete ideas. Source of inspiration: ${c.source || 'Topic'}. Each idea needs summary, description, next_action, references.`,
    proposal: `Deliverable: a method/experiment proposal. Field: ${c.field || 'ML Systems'}. Constraints: ${c.constraints || 'Any'}. Output: ${c.writeUpType || 'paper'}.`,
    ml_experiment: `Deliverable: runnable experiment code + metrics. Data: ${c.data || 'Synthetic'}. Primary metric: ${c.metric || 'Accuracy'}. Must include an entrypoint.sh that reproduces end to end.`,
    notebook: `Deliverable: analysis + figures. Data: ${c.data || 'Built-in'}. Plotting library: ${c.library || 'matplotlib'}. Output: ${c.output || 'Notebook'}.`,
    reproduce: `Deliverable: reproduction of a paper result. Scope: ${c.scope || 'Smoke test'}. Framework: ${c.framework || 'PyTorch'}. Must state deviations explicitly.`,
    router: 'Deliverable: answer the question, or delegate to the right agent and explain the routing.',
  }[mode];
  return `${base}\n${detail || ''}`;
}

// ---------------- kernels ----------------

async function* literatureReview(ctx) {
  const c = controlsOf(ctx);
  yield { kind: 'plan', steps: STAGE_NAMES.literature_review };
  yield { kind: 'step', name: 'Retrieve sources', status: 'running' };
  const hits = await searchAll(ctx.query, { max: 10 });
  yield { kind: 'tool', name: 'paper_search', input: ctx.query, output: hits.slice(0, 6) };
  const a = writeArtifact(ctx, 'search_results/papers.json', { query: ctx.query, hits });
  yield { kind: 'artifact', ...a };
  yield { kind: 'step', name: 'Retrieve sources', status: 'done', detail: `${hits.length} sources` };

  const bib = hits
    .map(
      (h, i) => `@misc{ref${i + 1},
  title  = {${h.title.replace(/[{}]/g, '')}},
  author = {${h.author}},
  year   = {${(h.time || '').slice(0, 4) || 'n/a'}},
  url    = {${h.url}}
}`
    )
    .join('\n\n');
  const b = writeArtifact(ctx, 'references/references.bib', bib);
  yield { kind: 'artifact', ...b };

  yield { kind: 'step', name: 'Draft survey', status: 'running' };
  const messages = [
    { role: 'system', content: systemFor('literature_review', ctx) },
    {
      role: 'user',
      content: `Write the survey. Topic: ${ctx.query}\n\nSources (use these, cite with \\cite{refN}):\n${hits
        .slice(0, 10)
        .map((h, i) => `[ref${i + 1}] ${h.title} — ${h.author} (${(h.time || '').slice(0, 4)}) ${h.url}\n${h.desc}`)
        .join('\n\n')}`,
    },
  ];
  const text = yield* stream(ctx, messages);
  const t = writeArtifact(ctx, 'writing_space/final/manuscript.md', text);
  yield { kind: 'artifact', ...t };
  yield { kind: 'step', name: 'Draft survey', status: 'done' };
  yield { kind: 'final', content: text, citations: hits.slice(0, 10) };
}

async function* ideaGeneration(ctx) {
  yield { kind: 'plan', steps: STAGE_NAMES.idea_generation };
  yield { kind: 'step', name: 'Read the landscape', status: 'running' };
  const hits = await searchAll(ctx.query, { max: 8 });
  yield { kind: 'tool', name: 'paper_search', input: ctx.query, output: hits.slice(0, 5) };
  const a = writeArtifact(ctx, 'search_results/papers.json', { query: ctx.query, hits });
  yield { kind: 'artifact', ...a };
  yield { kind: 'step', name: 'Read the landscape', status: 'done', detail: `${hits.length} sources` };

  const messages = [
    { role: 'system', content: systemFor('idea_generation', ctx) },
    {
      role: 'user',
      content: `Topic: ${ctx.query}\nRecent work:\n${hits
        .slice(0, 8)
        .map((h) => `- ${h.title} (${(h.time || '').slice(0, 4)}) ${h.url}`)
        .join('\n')}\n\nReturn STRICT JSON only: {"root":{"summary":...},"families":[{"id":"family_x","summary":...,"ideas":[{"id":"idea_x","summary":...,"description":...,"next_action":...,"references":["url"]}]}]}`,
    },
  ];
  const raw = yield* stream(ctx, messages);
  let tree = null;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      tree = JSON.parse(raw.slice(start, end + 1));
    } catch {
      tree = null;
    }
  }
  if (!tree) {
    tree = {
      root: { summary: ctx.query },
      families: [{ id: 'family_auto', summary: 'Generated from the request', ideas: [{ id: 'idea_1', summary: raw.slice(0, 400), description: raw.slice(0, 2000), next_action: 'Validate feasibility', references: hits.slice(0, 3).map((h) => h.url) }] }],
    };
  }
  const t = writeArtifact(ctx, 'idea-tree.json', tree);
  yield { kind: 'artifact', ...t };
  yield { kind: 'final', content: raw, tree };
}

async function* proposal(ctx) {
  yield { kind: 'plan', steps: STAGE_NAMES.proposal };
  const hits = await searchAll(ctx.query, { max: 8 });
  yield { kind: 'tool', name: 'paper_search', input: ctx.query, output: hits.slice(0, 5) };
  const messages = [
    { role: 'system', content: systemFor('proposal', ctx) },
    {
      role: 'user',
      content: `Design a method and experiment plan for: ${ctx.query}\nRelated work:\n${hits
        .slice(0, 8)
        .map((h) => `- ${h.title} (${(h.time || '').slice(0, 4)})`)
        .join('\n')}\n\nSections required: Problem framing, Method interface, Experimental design, Ablations, Risks & limitations, Success criteria.`,
    },
  ];
  const text = yield* stream(ctx, messages);
  const t = writeArtifact(ctx, 'writing_space/final/manuscript.md', text);
  yield { kind: 'artifact', ...t };
  yield { kind: 'final', content: text, citations: hits.slice(0, 8) };
}

async function* mlExperiment(ctx) {
  const c = controlsOf(ctx);
  yield { kind: 'plan', steps: STAGE_NAMES.ml_experiment };

  // Deterministic, dependency-light experiment scaffold. Runs for real.
  const code = `import json, math, random, os, hashlib
random.seed(7)
try:
    import numpy as np
except Exception:
    np = None

# --- synthetic task: learn XOR-like mapping with a tiny MLP from scratch ---
def sigmoid(x):
    return 1 / (1 + math.exp(-x))

W1 = [[random.uniform(-1, 1) for _ in range(4)] for _ in range(2)]
b1 = [0.0] * 4
W2 = [random.uniform(-1, 1) for _ in range(4)]
b2 = 0.0

X = [[0, 0], [0, 1], [1, 0], [1, 1]]
Y = [0, 1, 1, 0]

def forward(x):
    h = [sigmoid(sum(W1[j][i] * x[i] for i in range(2)) + b1[j]) for j in range(4)]
    y = sigmoid(sum(W2[j] * h[j] for j in range(4)) + b2)
    return h, y

lr = 0.5
losses = []
for step in range(2000):
    total = 0.0
    grads_W1 = [[0.0] * 2 for _ in range(4)]
    grads_b1 = [0.0] * 4
    grads_W2 = [0.0] * 4
    grad_b2 = 0.0
    for x, t in zip(X, Y):
        h, y = forward(x)
        e = y - t
        total += -(t * math.log(max(y, 1e-9)) + (1 - t) * math.log(max(1 - y, 1e-9)))
        for j in range(4):
            grads_W2[j] += e * h[j]
            grad_b2 += e
            for i in range(2):
                grads_W1[j][i] += e * W2[j] * h[j] * (1 - h[j]) * x[i]
            grads_b1[j] += e * W2[j] * h[j] * (1 - h[j])
    n = len(X)
    for j in range(4):
        W2[j] -= lr * grads_W2[j] / n
        for i in range(2):
            W1[j][i] -= lr * grads_W1[j][i] / n
        b1[j] -= lr * grads_b1[j] / n
    b2 -= lr * grad_b2 / n
    losses.append(total / n)
    if step % 100 == 0:
        print(f"step {step:5d} loss {total / n:.6f}", flush=True)

correct = sum(1 for x, t in zip(X, Y) if (forward(x)[1] >= 0.5) == bool(t))
acc = correct / len(X)
print(json.dumps({"final_loss": losses[-1], "accuracy": acc, "steps": len(losses)}))
os.makedirs("outputs", exist_ok=True)
json.dump({"final_loss": losses[-1], "accuracy": acc, "loss_curve": losses[::20],
           "metric": os.environ.get("METRIC", "accuracy"), "seed": 7},
          open("outputs/metrics.json", "w"), indent=2)
`;
  const a = writeArtifact(ctx, 'project/src/experiment.py', code);
  yield { kind: 'artifact', ...a };
  const b = writeArtifact(
    ctx,
    'project/entrypoint.sh',
    `#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")"\nexport PYTHONHASHSEED=7\nexport CUDA_VISIBLE_DEVICES=${ctx.enableGpu ? "0" : ""}\nPY=\${PYTHON:-python3}\n"\${PY}" src/experiment.py\n`
  );
  yield { kind: 'artifact', ...b };

  yield { kind: 'step', name: 'Training run', status: 'running' };
  const run = await runPython({
    cwd: path.join(ctx.workspaceDir, 'project'),
    code,
    env: { METRIC: String(c.metric || 'Accuracy').toLowerCase() },
  });
  yield { kind: 'terminal', text: `${run.stdout}${run.stderr ? `\n${run.stderr}` : ''}`, backend: run.backend, exitCode: run.exitCode };
  yield { kind: 'step', name: 'Training run', status: 'done', detail: `exit=${run.exitCode} in ${run.durationMs}ms` };

  let metrics = null;
  try {
    metrics = JSON.parse(fs.readFileSync(path.join(ctx.workspaceDir, 'project/outputs/metrics.json'), 'utf8'));
  } catch {
    metrics = null;
  }
  if (metrics) yield { kind: 'artifact', path: 'project/outputs/metrics.json', bytes: Buffer.byteLength(JSON.stringify(metrics)) };

  const messages = [
    { role: 'system', content: systemFor('ml_experiment', ctx) },
    {
      role: 'user',
      content: `Experiment request: ${ctx.query}\nThe scaffolded run finished with these real numbers:\n${JSON.stringify(metrics || run.stdout.slice(-800), null, 2)}\n\nWrite a short results section: what was measured, the numbers, what they mean, and how to reproduce (entrypoint.sh). Be explicit that this is the scaffolded run, not the full requested system, if that is the case.`,
    },
  ];
  const text = yield* stream(ctx, messages);
  const t = writeArtifact(ctx, 'project/REPORT.md', text);
  yield { kind: 'artifact', ...t };
  yield { kind: 'final', content: text, metrics };
}

async function* notebook(ctx) {
  const c = controlsOf(ctx);
  yield { kind: 'plan', steps: STAGE_NAMES.notebook };
  const code = `import csv, statistics, json, os, math, random
random.seed(7)
# Built-in dataset: classic iris measurements (Fisher, 1936)
DATA = """sepal_length,sepal_width,petal_length,petal_width,species
5.1,3.5,1.4,0.2,setosa
4.9,3.0,1.4,0.2,setosa
4.7,3.2,1.3,0.2,setosa
7.0,3.2,4.7,1.4,versicolor
6.4,3.2,4.5,1.5,versicolor
6.9,3.1,4.9,1.5,versicolor
6.3,3.3,6.0,2.5,virginica
6.5,3.0,5.8,2.2,virginica
7.6,3.0,6.6,2.1,virginica
"""
rows = list(csv.DictReader(DATA.strip().splitlines()))
cols = ["sepal_length", "sepal_width", "petal_length", "petal_width"]
summary = {}
for col in cols:
    vals = [float(r[col]) for r in rows]
    summary[col] = {"n": len(vals), "mean": statistics.mean(vals), "stdev": statistics.stdev(vals),
                    "min": min(vals), "max": max(vals)}
by_species = {}
for r in rows:
    by_species.setdefault(r["species"], []).append(r)
group_stats = {k: {c: statistics.mean([float(x[c]) for x in v]) for c in cols} for k, v in by_species.items()}
os.makedirs("figures", exist_ok=True)
try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(6, 4))
    for k, v in by_species.items():
        ax.scatter([float(x["sepal_length"]) for x in v], [float(x["petal_length"]) for x in v], label=k)
    ax.set_xlabel("sepal_length"); ax.set_ylabel("petal_length"); ax.legend()
    fig.tight_layout(); fig.savefig("figures/scatter.png", dpi=120)
    plotted = "figures/scatter.png"
except Exception as e:
    plotted = f"matplotlib unavailable: {e}"
print(json.dumps({"summary": summary, "group_stats": group_stats, "figure": plotted}, indent=2))
`;
  const a = writeArtifact(ctx, 'analysis.py', code);
  yield { kind: 'artifact', ...a };
  yield { kind: 'step', name: 'Analyze', status: 'running' };
  const run = await runPython({ cwd: ctx.workspaceDir, code, env: { LIBRARY: String(c.library || 'matplotlib') } });
  yield { kind: 'terminal', text: `${run.stdout}${run.stderr ? `\n${run.stderr}` : ''}`, backend: run.backend, exitCode: run.exitCode };
  yield { kind: 'step', name: 'Analyze', status: 'done', detail: `exit=${run.exitCode}` };
  if (fs.existsSync(path.join(ctx.workspaceDir, 'figures/scatter.png'))) {
    yield { kind: 'artifact', path: 'figures/scatter.png', bytes: fs.statSync(path.join(ctx.workspaceDir, 'figures/scatter.png')).size };
  }

  const messages = [
    { role: 'system', content: systemFor('notebook', ctx) },
    { role: 'user', content: `Analysis request: ${ctx.query}\nReal run output:\n${run.stdout.slice(0, 3000)}\n\nWrite the analysis report: data profile, findings, caveats, and next analyses.` },
  ];
  const text = yield* stream(ctx, messages);
  const t = writeArtifact(ctx, 'REPORT.md', text);
  yield { kind: 'artifact', ...t };
  yield { kind: 'final', content: text };
}

async function* reproduce(ctx) {
  yield { kind: 'plan', steps: STAGE_NAMES.reproduce };
  const arxivId = (ctx.query.match(/(\d{4}\.\d{4,5})(v\d+)?/) || [])[1];
  let source = null;
  if (arxivId) {
    source = await fetchArxivSource(arxivId);
    if (source) yield { kind: 'tool', name: 'fetch_paper', input: arxivId, output: { title: source.title, published: source.published } };
  }
  const hits = source ? [] : await searchAll(ctx.query, { max: 6 });
  if (hits.length) yield { kind: 'tool', name: 'paper_search', input: ctx.query, output: hits.slice(0, 5) };

  const messages = [
    { role: 'system', content: systemFor('reproduce', ctx) },
    {
      role: 'user',
      content: `Reproduce: ${ctx.query}\n${
        source ? `Paper: ${source.title}\nPublished: ${source.published}\nAbstract: ${source.abstract}\nPDF: ${source.pdfUrl}` : `Candidates:\n${hits.map((h) => `- ${h.title} ${h.url}`).join('\n')}`
      }\n\nProduce: reproduction_scope.md content (claims to test, experiment matrix, environment, deviations you must declare, and a runnable smoke test).`,
    },
  ];
  const text = yield* stream(ctx, messages);
  const t = writeArtifact(ctx, 'REPRODUCTION_REPORT.md', text);
  yield { kind: 'artifact', ...t };
  yield { kind: 'final', content: text, citations: source ? [source] : hits.slice(0, 6) };
}

async function* router(ctx) {
  yield { kind: 'plan', steps: STAGE_NAMES.router };
  const messages = [
    { role: 'system', content: systemFor('router', ctx) },
    { role: 'user', content: ctx.queryContent || ctx.query },
  ];
  const text = yield* stream(ctx, messages);
  yield { kind: 'final', content: text };
}

export const KERNELS = {
  literature_review: literatureReview,
  idea_generation: ideaGeneration,
  proposal: proposal,
  ml_experiment: mlExperiment,
  notebook: notebook,
  reproduce: reproduce,
  router: router,
};

export function kernelFor(modeKey, modeDef) {
  const name = modeDef?.kernel || 'router';
  return KERNELS[name] || router;
}

export { STAGE_NAMES };
