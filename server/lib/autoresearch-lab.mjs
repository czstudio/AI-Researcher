// AutoResearch lab: zero-dependency keep/discard/crash experiment loop.
// Adapted behavior from novix-science/autoresearch (MIT declared) and the
// vectorized-env contract from novix-science/mlx-sim (MIT declared). This is an
// independent implementation; no upstream training or physics code is copied.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const TAB = String.fromCharCode(9);
export const NL = String.fromCharCode(10);
export const CR = String.fromCharCode(13);
export const RESULTS_COLUMNS = Object.freeze(['commit', 'val_bpb', 'memory_gb', 'status', 'description']);
export const RESULTS_HEADER = RESULTS_COLUMNS.join(TAB);
export const RUN_STATUSES = Object.freeze(['queued', 'running', 'cancelling', 'completed', 'cancelled', 'failed']);
export const EXPERIMENT_STATUSES = Object.freeze(['keep', 'discard', 'crash']);
export const DEFAULT_BASELINE_SPEC = Object.freeze({ depth: 8, learningRate: 0.02, batchSize: 262144, qkNormBeforeRope: false, qScale: 1, warmdownRatio: 0.5 });
export const VECTORIZED_ENV_CONTRACT = Object.freeze({
  reset: 'obs, infos = reset(seed?)',
  step: 'obs, rewards, terminateds, truncateds, infos = step(actions)',
  spaces: { observation: 'Box', action: 'Box' },
  batch: 'parallel envs are addressed by a leading vector axis',
  source: 'mlx-sim vectorized-env contract shape only; no physics engine copied',
});
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_CANDIDATES = 100;
const MAX_PATCH_BYTES = 64 * 1024;
const MAX_TOTAL_INPUT_BYTES = 256 * 1024;
let SEQ = 0;
export class LabValidationError extends Error {
  constructor(message, code = '5001') { super(message); this.name = 'LabValidationError'; this.code = String(code); }
}
export class ExperimentTimeoutError extends Error {
  constructor(timeBudgetMs) { super('experiment time budget exceeded (' + timeBudgetMs + 'ms)'); this.name = 'ExperimentTimeoutError'; this.timedOut = true; this.timeBudgetMs = timeBudgetMs; }
}
function clone(value) { if (value === undefined) return undefined; if (typeof structuredClone === 'function') return structuredClone(value); return JSON.parse(JSON.stringify(value)); }
function text(value, fallback = '', max = 240) {
  const raw = String(value == null ? fallback : value);
  return raw.split(CR).join(' ').split(NL).join(' ').split(TAB).join(' ').trim().slice(0, max);
}
function safeId(value, label = 'id') {
  const s = String(value || '');
  if (s.length < 1 || s.length > 80) throw new LabValidationError(label + ' invalid');
  for (const ch of s) if (ID_CHARS.indexOf(ch) < 0 && ch !== '_' && ch !== '-') throw new LabValidationError(label + ' invalid');
  return s;
}
function newId(prefix = 'lab') { SEQ = (SEQ + 1) % 1000000; return prefix + '_' + Date.now().toString(36) + '_' + SEQ.toString(36) + crypto.randomBytes(3).toString('hex'); }
function shortHash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 7); }
function safeObject(value, label) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) throw new LabValidationError(label + ' must be an object');
  const out = {};
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) throw new LabValidationError(label + ' contains forbidden key');
    const v = value[key];
    if (v == null || ['string', 'number', 'boolean'].includes(typeof v)) out[key] = v;
    else if (typeof v === 'object' && Array.isArray(v) === false) out[key] = safeObject(v, label + '.' + key);
    else throw new LabValidationError(label + ' has unsupported value');
  }
  return out;
}
function normalizeSpec(input, label = 'spec') {
  const base = { ...DEFAULT_BASELINE_SPEC, ...safeObject(input || {}, label) };
  return {
    depth: Math.trunc(finite(base.depth, 8, 1, 64)),
    learningRate: finite(base.learningRate, 0.02, 0.000001, 1),
    batchSize: Math.trunc(finite(base.batchSize, 262144, 256, 1048576)),
    qkNormBeforeRope: base.qkNormBeforeRope === true,
    qScale: finite(base.qScale, 1, 0.1, 4),
    warmdownRatio: finite(base.warmdownRatio, 0.5, 0, 1),
  };
}
export function defaultEvaluator(spec, ctx = {}) {
  if (ctx.signal?.aborted) throw new LabValidationError('experiment aborted', '4999');
  const s = normalizeSpec(spec);
  if (s.depth > 20) throw new Error('simulated OOM: depth ' + s.depth + ' exceeds simulator capacity');
  let score = 1.044;
  score -= (s.depth - 8) * 0.0034;
  score -= (s.learningRate - 0.02) * 1.9;
  score -= (262144 - s.batchSize) / 262144 * 0.014;
  score -= s.qkNormBeforeRope ? 0.008 : 0;
  score -= Math.max(0, s.qScale - 1) * 0.006;
  score -= Math.max(0, s.warmdownRatio - 0.5) * 0.018;
  score += Math.abs(s.learningRate - 0.025) * 0.4;
  const memoryGb = Math.max(0.5, 6.5 + s.depth * 1.15 + s.batchSize / 262144 * 2.2);
  return { valBpb: Number(Math.max(0.1, score).toFixed(6)), memoryGb: Number(memoryGb.toFixed(1)) };
}
export const DEFAULT_CANDIDATES = Object.freeze([
  { description: 'depth 12 and four times smaller batch', spec: { depth: 12, batchSize: 65536 } },
  { description: 'norm before RoPE plus query scale', spec: { depth: 12, batchSize: 65536, qkNormBeforeRope: true, qScale: 1.25 } },
  { description: 'longer warmdown and tuned learning rate', spec: { depth: 12, batchSize: 65536, qkNormBeforeRope: true, qScale: 1.25, warmdownRatio: 0.88, learningRate: 0.028 } },
  { description: 'deliberately worse learning rate', spec: { depth: 8, batchSize: 262144, learningRate: 0.001 } },
  { description: 'intentional OOM candidate', spec: { depth: 24, batchSize: 1048576 } },
]);
export class AutoResearchLab {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.resolve(process.cwd(), 'data', 'autoresearch');
    this.evaluator = typeof options.evaluator === 'function' ? options.evaluator : defaultEvaluator;
    fs.mkdirSync(this.rootDir, { recursive: true });
  }
  runPath(id) { return path.join(this.rootDir, safeId(id, 'runId') + '.json'); }
  save(run) {
    const file = this.runPath(run.id);
    const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(run, null, 2));
    fs.renameSync(tmp, file);
    return run;
  }
  load(id) {
    try { return JSON.parse(fs.readFileSync(this.runPath(id), 'utf8')); } catch { return null; }
  }
  list(ownerId) {
    const out = [];
    for (const f of fs.readdirSync(this.rootDir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const r = JSON.parse(fs.readFileSync(path.join(this.rootDir, f), 'utf8'));
        if (ownerId == null || r.ownerId === ownerId) out.push(r);
      } catch { }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }
  create(input = {}) {
    const candidates = input.candidates == null ? [] : input.candidates;
    if (Array.isArray(candidates) === false || candidates.length > MAX_CANDIDATES) throw new LabValidationError("candidates invalid");
    const raw = JSON.stringify(candidates);
    if (raw.length > MAX_TOTAL_INPUT_BYTES) throw new LabValidationError("candidates too large");
    const normalized = (candidates.length ? candidates : DEFAULT_CANDIDATES).map((c, i) => ({
      description: text(c && c.description, "candidate " + (i + 1), 120),
      spec: normalizeSpec(c && c.spec, "candidate[" + i + "]"),
    }));
    const run = {
      id: newId(), ownerId: input.ownerId == null ? null : String(input.ownerId),
      name: text(input.name, "AutoResearch run", 120), status: "queued",
      timeBudgetMs: Math.trunc(finite(input.timeBudgetMs, 300000, 50, 3600000)),
      maxExperiments: Math.trunc(finite(input.maxExperiments, 8, 1, MAX_CANDIDATES)),
      baselineSpec: normalizeSpec(input.baselineSpec, "baselineSpec"),
      bestMetric: null, bestSpec: normalizeSpec(input.baselineSpec, 'baselineSpec'),
      candidates: normalized, results: [], createdAt: Date.now(), startedAt: null, finishedAt: null, cancelRequested: false, error: null,
    };
    return this.save(run);
  }
  row(spec, result, status, description) {
    return { commit: shortHash(spec), val_bpb: Number(result.valBpb).toFixed(6), memory_gb: Number(result.memoryGb).toFixed(1), status, description: text(description, "", 120) };
  }
  async evaluate(spec, signal, budgetMs) {
    let timer = null;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new ExperimentTimeoutError(budgetMs)), budgetMs); });
    try {
      return await Promise.race([Promise.resolve().then(() => this.evaluator(spec, { signal })), timeout]);
    } finally { if (timer) clearTimeout(timer); }
  }
  async start(id, ownerId) {
    const run = this.load(id);
    if (run == null) throw new LabValidationError("run not found", "5001");
    if (ownerId != null && run.ownerId !== String(ownerId)) throw new LabValidationError("run not owned by caller", "5200");
    if (run.status === "running" || run.status === "completed" || run.status === "cancelled") return run;
    run.status = "running"; run.startedAt = Date.now(); run.finishedAt = null; run.cancelRequested = false; run.error = null; this.save(run);
    this.controllers = this.controllers || new Map();
    const controller = new AbortController();
    this.controllers.set(run.id, controller);
    try {
      const base = await this.evaluate(run.baselineSpec, controller.signal, run.timeBudgetMs);
      run.results.push(this.row(run.baselineSpec, base, "keep", "baseline"));
      run.bestMetric = base.valBpb; run.bestSpec = clone(run.baselineSpec); this.save(run);
      for (const candidate of run.candidates.slice(0, run.maxExperiments)) {
        if (controller.signal.aborted || run.cancelRequested) break;
        try {
          const result = await this.evaluate(candidate.spec, controller.signal, run.timeBudgetMs);
          const improved = result.valBpb < run.bestMetric;
          run.results.push(this.row(candidate.spec, result, improved ? "keep" : "discard", candidate.description));
          if (improved) { run.bestMetric = result.valBpb; run.bestSpec = clone(candidate.spec); }
          this.save(run);
        } catch (err) {
          if (controller.signal.aborted || run.cancelRequested) break;
          const crash = { valBpb: 0, memoryGb: 0 };
          run.results.push(this.row(candidate.spec, crash, "crash", candidate.description + " :: " + text(err.message, "crash", 80)));
          this.save(run);
        }
      }
      run.status = controller.signal.aborted || run.cancelRequested ? "cancelled" : "completed";
      run.finishedAt = Date.now(); this.save(run); return run;
    } catch (err) {
      run.status = controller.signal.aborted ? "cancelled" : "failed";
      run.error = text(err.message, "experiment failed", 300);
      if (controller.signal.aborted === false) run.results.push(this.row(run.baselineSpec, { valBpb: 0, memoryGb: 0 }, "crash", "baseline :: " + run.error));
      run.finishedAt = Date.now(); this.save(run); return run;
    } finally {
      this.controllers.delete(run.id);
    }
  }
  cancel(id, ownerId) {
    const run = this.load(id);
    if (run == null) throw new LabValidationError("run not found", "5001");
    if (ownerId != null && run.ownerId !== String(ownerId)) throw new LabValidationError("run not owned by caller", "5200");
    run.cancelRequested = true; if (run.status === "queued") run.status = "cancelled"; this.save(run);
    const controller = this.controllers && this.controllers.get(run.id);
    if (controller) controller.abort();
    return run;
  }
  tsv(run) {
    const rows = [RESULTS_HEADER];
    for (const r of run.results || []) rows.push([r.commit, r.val_bpb, r.memory_gb, r.status, r.description].join(TAB));
    return rows.join(NL) + NL;
  }
}
function finite(value, fallback, min = -Infinity, max = Infinity) { const n = Number(value); if (Number.isFinite(n) === false || n < min || n > max) return fallback; return n; }
