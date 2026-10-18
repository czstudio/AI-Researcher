// AutoResearch lab: zero-dependency keep/discard/crash experiment loop.
//
// Behavior adapted from novix-science/autoresearch (MIT declared) at
// 29a5846ba40f25c24ce316c50fe99e376d1dff8f: fixed budget, baseline first,
// lower val_bpb wins, crash rows, five-column results.tsv. The vectorized
// environment contract shape is adapted from novix-science/mlx-sim at
// a7d4e2b84e36e1601438b08e7a1d6c973e95e16a. No upstream training, physics or
// rendering source is copied. This is an independent protocol implementation.
//
// Real GPU training is NOT executed here. The default evaluator is an honest
// deterministic simulator. Production callers must supply an external worker
// evaluator through AutoResearchLab({ evaluator }) or the environment variables
// documented in docs/absorption/autoresearch-mlxsim-20261017.md.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const TAB = String.fromCharCode(9);
export const NL = String.fromCharCode(10);
export const CR = String.fromCharCode(13);
export const RESULTS_COLUMNS = Object.freeze(['commit', 'val_bpb', 'memory_gb', 'status', 'description']);
export const RESULTS_HEADER = RESULTS_COLUMNS.join(TAB);
export const RUN_STATUSES = Object.freeze(['queued', 'running', 'cancelling', 'completed', 'cancelled', 'failed']);
export const EXPERIMENT_STATUSES = Object.freeze(['keep', 'discard', 'crash']);
export const EVALUATOR_ENV_VARS = Object.freeze(['NOVIX_AUTORESEARCH_EVALUATOR', 'NOVIX_AUTORESEARCH_EVALUATOR_CMD', 'NOVIX_AUTORESEARCH_EVALUATOR_ARGS']);

export const DEFAULT_BASELINE_SPEC = Object.freeze({
  depth: 8,
  learningRate: 0.02,
  batchSize: 262144,
  qkNormBeforeRope: false,
  qScale: 1,
  warmdownRatio: 0.5,
});

export const VECTORIZED_ENV_CONTRACT = Object.freeze({
  sourceRepo: 'novix-science/mlx-sim',
  sourceCommit: 'a7d4e2b84e36e1601438b08e7a1d6c973e95e16a',
  sourceFiles: ['python/mlx_sim/envs/vec_env.py', 'python/mlx_sim/parallel/sync_runner.py', 'docs/api/environments.md'],
  reset: 'obs, infos = reset(seed=None, options=None); child i receives seed + i',
  step: 'obs, rewards, terminateds, truncateds, infos = step(actions); actions shape (num_envs, *action_shape)',
  spaces: { observation: 'single observation space, batch axis is leading', action: 'Box(false, true, shape=(num_envs, *action_shape))' },
  autoReset: true,
  terminalObservationKey: 'final_observation',
  singleSpaces: ['single_observation_space', 'single_action_space'],
  marker: { simulatedVectorized: true, realMlxSimEngine: false, realMetalPhysics: false },
});

export class LabValidationError extends Error {
  constructor(message, code = '5001') {
    super(message);
    this.name = 'LabValidationError';
    this.code = String(code);
  }
}

export class ExperimentTimeoutError extends Error {
  constructor(timeBudgetMs) {
    super('experiment time budget exceeded (' + timeBudgetMs + 'ms)');
    this.name = 'ExperimentTimeoutError';
    this.timedOut = true;
    this.timeBudgetMs = timeBudgetMs;
  }
}

export class ExperimentAbortError extends Error {
  constructor(message = 'experiment aborted') {
    super(message);
    this.name = 'ExperimentAbortError';
    this.aborted = true;
  }
}

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_CANDIDATES = 100;
const MAX_PATCH_BYTES = 64 * 1024;
const MAX_TOTAL_INPUT_BYTES = 256 * 1024;
const WORKTREE_PREFIX = 'novix-autoresearch-';
let SEQ = 0;

export function safeId(value, label = 'runId') {
  const s = String(value == null ? '' : value);
  if (s.length < 1 || s.length > 80) throw new LabValidationError(label + ' invalid');
  for (const ch of s) {
    if (ID_CHARS.indexOf(ch) < 0 && ch !== '_' && ch !== '-') throw new LabValidationError(label + ' invalid');
  }
  return s;
}

function clone(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function text(value, fallback = '', max = 240) {
  const raw = String(value == null ? fallback : value);
  return raw.split(CR).join(' ').split(NL).join(' ').split(TAB).join(' ').trim().slice(0, max);
}

function finite(value, fallback, min = -Infinity, max = Infinity) {
  const n = Number(value);
  if (Number.isFinite(n) === false || n < min || n > max) return fallback;
  return n;
}

function integer(value, fallback, min, max) {
  const n = Number(value);
  if (Number.isInteger(n) === false || n < min || n > max) return fallback;
  return n;
}

function newId(prefix = 'arl') {
  SEQ = (SEQ + 1) % 1000000;
  return prefix + '_' + Date.now().toString(36) + '_' + SEQ.toString(36) + crypto.randomBytes(4).toString('hex');
}

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
  const base = Object.assign({}, DEFAULT_BASELINE_SPEC, safeObject(input || {}, label));
  return {
    depth: Math.trunc(finite(base.depth, 8, 1, 64)),
    learningRate: finite(base.learningRate, 0.02, 0.000001, 1),
    batchSize: Math.trunc(finite(base.batchSize, 262144, 256, 1048576)),
    qkNormBeforeRope: base.qkNormBeforeRope === true,
    qScale: finite(base.qScale, 1, 0.1, 4),
    warmdownRatio: finite(base.warmdownRatio, 0.5, 0, 1),
  };
}

export function safeRelativePath(rel, label = 'file path') {
  const raw = String(rel == null ? '' : rel);
  if (raw.length < 1 || raw.length > 240 || raw.indexOf('\u0000') >= 0) throw new LabValidationError(label + ' invalid');
  if (raw.startsWith('/') || raw.startsWith('\\') || /^[A-Za-z]:/.test(raw)) throw new LabValidationError(label + ' must be relative');
  const parts = raw.split(/[\\/]+/);
  for (const part of parts) {
    if (part === '' || part === '.' || part === '..') throw new LabValidationError(label + ' escapes workspace');
  }
  return parts.join('/');
}

export function atomicWriteFile(file, data) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
  let fd = null;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, file);
  } catch (err) {
    if (fd != null) { try { fs.closeSync(fd); } catch { } }
    try { fs.unlinkSync(tmp); } catch { }
    throw err;
  }
}

export function rowToTsv(row) {
  const status = EXPERIMENT_STATUSES.includes(row.status) ? row.status : 'crash';
  const crash = status === 'crash';
  const val = crash ? 0 : finite(row.val_bpb, 0, 0, 1e9);
  const mem = crash ? 0 : finite(row.memory_gb, 0, 0, 1e9);
  return [String(row.commit || '0000000').slice(0, 7), Number(val).toFixed(6), Number(mem).toFixed(1), status, text(row.description, 'experiment', 180)].join(TAB);
}

export function toResultsTsv(run) {
  const lines = [RESULTS_HEADER];
  for (const row of run.results || []) lines.push(rowToTsv(row));
  return lines.join(NL) + NL;
}

function safeRemoveTemp(target, tempRoot) {
  const abs = path.resolve(target);
  const root = path.resolve(tempRoot) + path.sep;
  if (abs.startsWith(root) === false) return false;
  try { fs.rmSync(abs, { recursive: true, force: true }); return true; } catch { return false; }
}

function copySnapshot(sourceDir, targetDir) {
  const src = path.resolve(sourceDir);
  const skip = new Set(['.git', 'node_modules', 'dist', 'data', '.cache', '.venv']);
  fs.mkdirSync(targetDir, { recursive: true });
  fs.cpSync(src, targetDir, {
    recursive: true,
    dereference: false,
    force: false,
    filter: (from) => {
      if (path.resolve(from) === src) return true;
      return skip.has(path.basename(from)) === false;
    },
  });
}

export function createIsolatedWorkspace(options = {}) {
  const tempRoot = path.resolve(options.tempRoot || os.tmpdir());
  fs.mkdirSync(tempRoot, { recursive: true });
  const parent = fs.mkdtempSync(path.join(tempRoot, WORKTREE_PREFIX));
  const dir = path.join(parent, 'workspace');
  const sourceDir = options.sourceDir ? path.resolve(options.sourceDir) : null;
  const requestedMode = options.mode || 'auto';
  let mode = 'empty';
  try {
    if (sourceDir != null) {
      const wantsGit = requestedMode === 'git-worktree' || (requestedMode === 'auto' && options.useGitWorktree === true);
      if (wantsGit) {
        try {
          execFileSync('git', ['-C', sourceDir, 'worktree', 'add', '--detach', '--force', dir, String(options.baseCommit || 'HEAD')], { stdio: 'pipe' });
          mode = 'git-worktree';
        } catch {
          mode = 'snapshot';
        }
      } else {
        mode = 'snapshot';
      }
      if (mode === 'snapshot') copySnapshot(sourceDir, dir);
    } else {
      fs.mkdirSync(dir, { recursive: true });
    }
    const meta = {
      runId: String(options.runId || ''),
      mode,
      requestedMode,
      sourceDir,
      baseCommit: options.baseCommit ? String(options.baseCommit) : null,
      createdAt: Date.now(),
      isolation: 'per-run temp directory; main source tree is never written by the lab',
    };
    atomicWriteFile(path.join(dir, '.autoresearch-workspace.json'), JSON.stringify(meta, null, 2));
    let cleaned = false;
    return {
      dir,
      parent,
      mode,
      sourceDir,
      meta,
      writeFile(rel, content) {
        const safe = safeRelativePath(rel, 'workspace file');
        const abs = path.join(dir, safe);
        atomicWriteFile(abs, typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content));
        return abs;
      },
      cleanup() {
        if (cleaned) return { ok: true, already: true };
        cleaned = true;
        let gitError = null;
        if (mode === 'git-worktree' && sourceDir != null) {
          try { execFileSync('git', ['-C', sourceDir, 'worktree', 'remove', '--force', dir], { stdio: 'pipe' }); }
          catch (err) { gitError = text(err.message, 'git worktree cleanup failed', 200); }
        }
        const ok = safeRemoveTemp(parent, tempRoot);
        return { ok, gitError, removed: parent };
      },
    };
  } catch (err) {
    safeRemoveTemp(parent, tempRoot);
    throw err;
  }
}

export function defaultEvaluator(spec, ctx = {}) {
  if (ctx.signal && ctx.signal.aborted) throw new ExperimentAbortError();
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
  return { valBpb: Number(Math.max(0.1, score).toFixed(6)), memoryGb: Number(memoryGb.toFixed(1)), simulated: true };
}

export const DEFAULT_CANDIDATES = Object.freeze([
  { description: 'depth 12 and four times smaller batch', spec: { depth: 12, batchSize: 65536 } },
  { description: 'norm before RoPE plus query scale', spec: { depth: 12, batchSize: 65536, qkNormBeforeRope: true, qScale: 1.25 } },
  { description: 'longer warmdown and tuned learning rate', spec: { depth: 12, batchSize: 65536, qkNormBeforeRope: true, qScale: 1.25, warmdownRatio: 0.88, learningRate: 0.028 } },
  { description: 'deliberately worse learning rate', spec: { depth: 8, batchSize: 262144, learningRate: 0.001 } },
  { description: 'intentional OOM candidate', spec: { depth: 24, batchSize: 1048576 } },
]);

export function createCommandEvaluator(options = {}) {
  const command = String(options.command || '');
  if (command.length === 0) throw new LabValidationError('evaluator command required');
  const args = Array.isArray(options.args) ? options.args.map(String) : [];
  const baseEnv = options.env || process.env;
  return function commandEvaluator(spec, ctx = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let stdout = '';
      let stderr = '';
      const finish = (err, value) => {
        if (settled) return;
        settled = true;
        if (ctx.signal) ctx.signal.removeEventListener('abort', onAbort);
        if (err) reject(err); else resolve(value);
      };
      const onAbort = () => {
        try { child.kill('SIGKILL'); } catch { }
        finish(new ExperimentAbortError('external evaluator aborted'));
      };
      const env = Object.assign({}, baseEnv, {
        NOVIX_AUTORESEARCH_SPEC: JSON.stringify(spec || {}),
        NOVIX_AUTORESEARCH_WORKSPACE: String(ctx.workspaceDir || ''),
        NOVIX_AUTORESEARCH_RUN_ID: String(ctx.runId || ''),
        NOVIX_AUTORESEARCH_BUDGET_MS: String(ctx.timeBudgetMs || ''),
      });
      let child;
      try { child = spawn(command, args, { cwd: options.cwd || process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (err) { finish(err); return; }
      if (ctx.signal && ctx.signal.aborted) { onAbort(); return; }
      if (ctx.signal) ctx.signal.addEventListener('abort', onAbort, { once: true });
      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
      child.on('error', (err) => finish(err));
      child.on('close', (code, signal) => {
        if (settled) return;
        if (code !== 0) { finish(new Error('evaluator worker exited code ' + code + ' signal ' + String(signal) + ' ' + stderr.slice(0, 300))); return; }
        try {
          const parsed = JSON.parse(stdout.trim());
          finish(null, parsed);
        } catch (err) { finish(new Error('evaluator worker returned non-JSON output: ' + stdout.slice(0, 200))); }
      });
    });
  };
}

export function evaluatorFromEnvironment(env = process.env) {
  const modulePath = String(env.NOVIX_AUTORESEARCH_EVALUATOR || '').trim();
  if (modulePath.length > 0) {
    const abs = path.resolve(modulePath);
    return function moduleEvaluator(spec, ctx = {}) {
      return import(pathToFileURL(abs).href).then((mod) => {
        const fn = typeof mod.default === 'function' ? mod.default : mod.evaluate;
        if (typeof fn !== 'function') throw new Error('evaluator module must export default function or evaluate()');
        return fn(spec, ctx);
      });
    };
  }
  const command = String(env.NOVIX_AUTORESEARCH_EVALUATOR_CMD || '').trim();
  if (command.length > 0) {
    let args = [];
    try { args = JSON.parse(env.NOVIX_AUTORESEARCH_EVALUATOR_ARGS || '[]'); } catch { args = []; }
    return createCommandEvaluator({ command, args });
  }
  return defaultEvaluator;
}

export class AutoResearchLab {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || path.join(process.cwd(), 'data', 'autoresearch'));
    this.runsDir = path.join(this.rootDir, 'runs');
    this.tsvDir = path.join(this.rootDir, 'tsv');
    this.tempRoot = path.resolve(options.tempRoot || os.tmpdir());
    this.env = options.env || process.env;
    this.evaluator = typeof options.evaluator === 'function' ? options.evaluator : evaluatorFromEnvironment(this.env);
    this.evaluatorKind = typeof options.evaluator === 'function' ? 'injected' : (this.env.NOVIX_AUTORESEARCH_EVALUATOR || this.env.NOVIX_AUTORESEARCH_EVALUATOR_CMD ? 'external' : 'deterministic-simulated');
    this.useGitWorktree = options.useGitWorktree === true;
    this.allowSourceDir = options.allowSourceDir === true;
    this.active = new Map();
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    fs.mkdirSync(this.runsDir, { recursive: true });
    fs.mkdirSync(this.tsvDir, { recursive: true });
    fs.mkdirSync(this.tempRoot, { recursive: true });
  }

  runPath(id) { return path.join(this.runsDir, safeId(id) + '.json'); }
  tsvPath(id) { return path.join(this.tsvDir, safeId(id) + '.tsv'); }

  save(run) {
    run.updatedAt = this.now();
    const tsv = toResultsTsv(run);
    atomicWriteFile(this.tsvPath(run.id), tsv);
    run.evidence = Object.assign({}, run.evidence, {
      tsvFile: 'tsv/' + run.id + '.tsv',
      tsvRows: (run.results || []).length,
      tsvBytes: Buffer.byteLength(tsv),
      tsvSha256: crypto.createHash('sha256').update(tsv).digest('hex'),
      updatedAt: run.updatedAt,
    });
    atomicWriteFile(this.runPath(run.id), JSON.stringify(run, null, 2));
    return run;
  }

  load(id) {
    const file = this.runPath(id);
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  }

  list(ownerId) {
    const out = [];
    for (const file of fs.readdirSync(this.runsDir)) {
      if (file.endsWith('.json') === false) continue;
      try {
        const run = JSON.parse(fs.readFileSync(path.join(this.runsDir, file), 'utf8'));
        if (ownerId == null || String(run.ownerId) === String(ownerId)) out.push(run);
      } catch { }
    }
    return out.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }

  verify(id) {
    const run = this.load(id);
    if (run == null) return { ok: false, error: 'run not found' };
    let raw = '';
    try { raw = fs.readFileSync(this.tsvPath(id), 'utf8'); } catch { return { ok: false, error: 'results.tsv missing' }; }
    const lines = raw.endsWith(NL) ? raw.slice(0, -1).split(NL) : raw.split(NL);
    const headerExact = lines[0] === RESULTS_HEADER;
    const rows = lines.slice(1);
    const expected = (run.results || []).map(rowToTsv);
    const rowsMatch = rows.length === expected.length && rows.every((line, i) => line === expected[i]);
    const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
    return {
      ok: headerExact && rowsMatch,
      runId: run.id,
      headerExact,
      stateRows: expected.length,
      tsvRows: rows.length,
      rowsMatch,
      tsvSha256: sha256,
      evidenceRows: run.evidence ? run.evidence.tsvRows : null,
      evidenceSha256: run.evidence ? run.evidence.tsvSha256 : null,
    };
  }

  _normalizeCandidates(input) {
    const candidates = input == null ? [] : input;
    if (Array.isArray(candidates) === false || candidates.length > MAX_CANDIDATES) throw new LabValidationError('candidates invalid');
    const selected = candidates.length > 0 ? candidates : clone(DEFAULT_CANDIDATES);
    const raw = JSON.stringify(selected);
    if (raw.length > MAX_TOTAL_INPUT_BYTES) throw new LabValidationError('candidates too large');
    return selected.map((c, i) => {
      const item = c && typeof c === 'object' ? c : {};
      const files = {};
      if (item.files != null) {
        if (typeof item.files !== 'object' || Array.isArray(item.files)) throw new LabValidationError('candidate[' + i + '].files must be an object');
        for (const [rel, content] of Object.entries(item.files)) {
          const safe = safeRelativePath(rel, 'candidate[' + i + '].files');
          const data = String(content);
          if (Buffer.byteLength(data) > MAX_PATCH_BYTES) throw new LabValidationError('candidate[' + i + '] file too large');
          files[safe] = data;
        }
      }
      return {
        description: text(item.description, 'candidate ' + (i + 1), 120),
        spec: normalizeSpec(item.spec, 'candidate[' + i + '].spec'),
        files,
      };
    });
  }

  _normalizeWorkspace(input) {
    const raw = input && typeof input === 'object' ? input : {};
    let sourceDir = raw.sourceDir ? path.resolve(String(raw.sourceDir)) : null;
    if (sourceDir != null && this.allowSourceDir !== true) throw new LabValidationError('workspace.sourceDir requires a trusted local caller');
    const mode = ['auto', 'empty', 'snapshot', 'git-worktree'].includes(raw.mode) ? raw.mode : 'empty';
    return {
      mode,
      sourceDir,
      baseCommit: raw.baseCommit ? text(raw.baseCommit, '', 80) : null,
      keepOnFailure: raw.keepOnFailure === true,
      status: 'pending',
      cleanup: 'pending',
      path: null,
      createdAt: null,
      cleanedAt: null,
    };
  }

  _makeRun(input, kind) {
    const requestId = input.requestId == null ? null : text(input.requestId, '', 120);
    if (requestId) {
      const duplicate = this.list(input.ownerId == null ? null : String(input.ownerId)).find((r) => r.requestId === requestId && r.kind === kind);
      if (duplicate) throw new LabValidationError('duplicate run requestId rejected', '4090');
    }
    const candidates = this._normalizeCandidates(input.candidates);
    const baselineSpec = normalizeSpec(input.baselineSpec, 'baselineSpec');
    const timeBudgetMs = Math.trunc(finite(input.timeBudgetMs, 300000, 50, 3600000));
    const maxExperiments = Math.trunc(finite(input.maxExperiments, 8, 1, MAX_CANDIDATES + 1));
    const run = {
      schemaVersion: 2,
      id: newId(kind === 'batch' ? 'arb' : 'arl'),
      kind,
      ownerId: input.ownerId == null ? null : String(input.ownerId),
      requestId,
      name: text(input.name, 'AutoResearch run', 120),
      status: 'queued',
      evaluator: { kind: this.evaluatorKind, realGpuTraining: false, timeBudgetMs, timeoutEnforcedBy: 'AbortController + Promise race; external evaluator must kill its worker on signal' },
      timeBudgetMs,
      maxExperiments,
      baselineSpec,
      candidates,
      bestMetric: null,
      bestSpec: null,
      bestCommit: null,
      baseline: null,
      results: [],
      counts: { keep: 0, discard: 0, crash: 0 },
      workspace: this._normalizeWorkspace(input.workspace),
      parentBatchId: input.parentBatchId ? String(input.parentBatchId) : null,
      children: [],
      aggregate: null,
      cancelRequested: false,
      error: null,
      createdAt: this.now(),
      startedAt: null,
      finishedAt: null,
      updatedAt: null,
      evidence: {},
    };
    return this.save(run);
  }

  create(input = {}) {
    return this._makeRun(input, 'single');
  }

  createBatch(input = {}) {
    const numEnvs = Math.trunc(finite(input.numEnvs, 4, 1, 32));
    const batchBudgetMs = Math.trunc(finite(input.batchBudgetMs, 120000, 50, 7200000));
    const run = this._makeRun(Object.assign({}, input, { numEnvs: undefined }), 'batch');
    run.numEnvs = numEnvs;
    run.batchBudgetMs = batchBudgetMs;
    run.aggregate = { numEnvs, simulatedVectorized: true, realMlxSimEngine: false, status: 'queued', children: [] };
    return this.save(run);
  }

  _appendResult(run, row) {
    const normalized = {
      commit: String(row.commit || '0000000').slice(0, 7),
      val_bpb: Number(row.val_bpb || 0).toFixed(6),
      memory_gb: Number(row.memory_gb || 0).toFixed(1),
      status: EXPERIMENT_STATUSES.includes(row.status) ? row.status : 'crash',
      description: text(row.description, 'experiment', 180),
      timedOut: row.timedOut === true,
      durationMs: Math.max(0, Math.trunc(finite(row.durationMs, 0, 0, 1e9))),
      at: this.now(),
    };
    run.results.push(normalized);
    run.counts = { keep: 0, discard: 0, crash: 0 };
    for (const r of run.results) run.counts[r.status] += 1;
    this.save(run);
    return normalized;
  }

  async _evaluate(run, spec, ctx, sharedDeadline) {
    let budget = run.timeBudgetMs;
    if (sharedDeadline != null) budget = Math.min(budget, sharedDeadline - this.now());
    if (budget <= 0) throw new ExperimentTimeoutError(run.timeBudgetMs);
    const controller = new AbortController();
    let timedOut = false;
    let externalAbort = false;
    let timer = null;
    let rejectAbort = null;
    const external = ctx.signal;
    const abortGate = new Promise((resolve, reject) => { rejectAbort = reject; });
    const onExternalAbort = () => {
      externalAbort = true;
      try { controller.abort(); } catch { }
      if (rejectAbort) rejectAbort(new ExperimentAbortError());
    };
    if (external) {
      if (external.aborted) onExternalAbort();
      else external.addEventListener('abort', onExternalAbort, { once: true });
    }
    const timeoutGate = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        try { controller.abort(); } catch { }
        reject(new ExperimentTimeoutError(budget));
      }, budget);
    });
    const started = this.now();
    const evaluatePromise = Promise.resolve().then(() => this.evaluator(spec, {
      signal: controller.signal,
      workspaceDir: ctx.workspaceDir,
      runWorkspaceDir: ctx.runWorkspaceDir,
      runId: run.id,
      experimentIndex: ctx.experimentIndex,
      timeBudgetMs: budget,
      deadlineAt: started + budget,
      writeFile: ctx.writeFile,
    }));
    try {
      const raw = await Promise.race([evaluatePromise, timeoutGate, abortGate]);
      const metric = typeof raw === 'number' ? raw : (raw && (raw.val_bpb ?? raw.valBpb ?? raw.metric));
      const memory = raw && typeof raw === 'object' ? (raw.memory_gb ?? raw.memoryGb ?? 0) : 0;
      if (Number.isFinite(Number(metric)) === false || Number(metric) < 0) throw new Error('evaluator returned invalid val_bpb');
      return { val_bpb: Number(Number(metric).toFixed(6)), memory_gb: Number(Math.max(0, Number(memory) || 0).toFixed(1)), durationMs: this.now() - started };
    } catch (err) {
      if (timedOut) throw new ExperimentTimeoutError(budget);
      if (externalAbort) throw new ExperimentAbortError();
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
      if (external) external.removeEventListener('abort', onExternalAbort);
      try { controller.abort(); } catch { }
    }
  }

  _prepareWorkspace(run) {
    const workspace = createIsolatedWorkspace({
      runId: run.id,
      sourceDir: run.workspace.sourceDir,
      mode: run.workspace.mode,
      baseCommit: run.workspace.baseCommit,
      useGitWorktree: this.useGitWorktree,
      tempRoot: this.tempRoot,
    });
    fs.mkdirSync(path.join(workspace.dir, 'baseline'), { recursive: true });
    fs.mkdirSync(path.join(workspace.dir, 'experiments'), { recursive: true });
    run.workspace.status = 'ready';
    run.workspace.mode = workspace.mode;
    run.workspace.path = workspace.dir;
    run.workspace.createdAt = this.now();
    this.save(run);
    return workspace;
  }

  _prepareExperimentDir(workspace, run, candidate, index) {
    const rel = path.join('experiments', String(index).padStart(3, '0'));
    const abs = path.join(workspace.dir, rel);
    fs.mkdirSync(abs, { recursive: true });
    atomicWriteFile(path.join(abs, 'candidate.json'), JSON.stringify({ runId: run.id, index, description: candidate.description, spec: candidate.spec }, null, 2));
    for (const [file, content] of Object.entries(candidate.files || {})) {
      const safe = safeRelativePath(file);
      atomicWriteFile(path.join(abs, safe), content);
    }
    return abs;
  }

  _recordDecision(workspace, run, index, status, metric, description) {
    const file = path.join(workspace.dir, 'decisions.json');
    let decisions = [];
    try { decisions = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { decisions = []; }
    decisions.push({ index, status, metric, description, commit: shortHash(run.candidates[index] ? run.candidates[index].spec : run.baselineSpec), at: this.now() });
    atomicWriteFile(file, JSON.stringify(decisions, null, 2));
    if (status === 'keep') {
      const bestDir = path.join(workspace.dir, 'best');
      try { fs.rmSync(bestDir, { recursive: true, force: true }); } catch { }
      const expDir = path.join(workspace.dir, 'experiments', String(index).padStart(3, '0'));
      fs.cpSync(expDir, bestDir, { recursive: true });
    }
  }

  _cleanupWorkspace(run, handle, status) {
    const keep = run.workspace.keepOnFailure === true && status === 'failed';
    if (keep) {
      run.workspace.cleanup = 'retained-on-failure';
      run.workspace.cleanedAt = null;
      return;
    }
    const result = handle.cleanup();
    run.workspace.cleanup = result.ok ? 'done' : 'failed';
    run.workspace.cleanupError = result.gitError || (result.ok ? null : 'temp workspace cleanup failed');
    run.workspace.cleanedAt = this.now();
  }

  async _executeSingle(run, controller, sharedDeadline) {
    let workspace = null;
    let terminalStatus = 'failed';
    try {
      workspace = this._prepareWorkspace(run);
      let baseline;
      try {
        baseline = await this._evaluate(run, run.baselineSpec, {
          signal: controller.signal,
          workspaceDir: path.join(workspace.dir, 'baseline'),
          runWorkspaceDir: workspace.dir,
          experimentIndex: -1,
          writeFile: workspace.writeFile,
        }, sharedDeadline);
      } catch (err) {
        if (controller.signal.aborted || run.cancelRequested) {
          run.status = 'cancelled';
          run.finishedAt = this.now();
          terminalStatus = 'cancelled';
          this.save(run);
          return run;
        }
        run.error = text(err.message, 'baseline failed', 300);
        this._appendResult(run, { commit: shortHash(run.baselineSpec), val_bpb: 0, memory_gb: 0, status: 'crash', description: 'baseline :: ' + run.error, timedOut: err.timedOut === true });
        run.status = 'failed';
        run.finishedAt = this.now();
        terminalStatus = 'failed';
        this.save(run);
        return run;
      }
      run.baseline = { commit: shortHash(run.baselineSpec), val_bpb: baseline.val_bpb, memory_gb: baseline.memory_gb, durationMs: baseline.durationMs };
      run.bestMetric = baseline.val_bpb;
      run.bestSpec = clone(run.baselineSpec);
      run.bestCommit = run.baseline.commit;
      this._appendResult(run, { commit: run.baseline.commit, val_bpb: baseline.val_bpb, memory_gb: baseline.memory_gb, status: 'keep', description: 'baseline', durationMs: baseline.durationMs });

      let index = 0;
      while (index < run.candidates.length && run.results.length < run.maxExperiments) {
        if (controller.signal.aborted || run.cancelRequested) break;
        if (sharedDeadline != null && this.now() >= sharedDeadline) {
          run.error = 'shared batch budget exhausted before candidate ' + (index + 1);
          break;
        }
        const candidate = run.candidates[index];
        const expDir = this._prepareExperimentDir(workspace, run, candidate, index);
        let result;
        try {
          result = await this._evaluate(run, candidate.spec, {
            signal: controller.signal,
            workspaceDir: expDir,
            runWorkspaceDir: workspace.dir,
            experimentIndex: index,
            writeFile: workspace.writeFile,
          }, sharedDeadline);
        } catch (err) {
          if (controller.signal.aborted || run.cancelRequested) break;
          const errText = text(err.message, 'crash', 180);
          this._appendResult(run, { commit: shortHash(candidate.spec), val_bpb: 0, memory_gb: 0, status: 'crash', description: candidate.description + ' :: ' + errText, timedOut: err.timedOut === true });
          this._recordDecision(workspace, run, index, 'crash', null, candidate.description);
          index += 1;
          continue;
        }
        const improved = result.val_bpb < run.bestMetric;
        const status = improved ? 'keep' : 'discard';
        if (improved) {
          run.bestMetric = result.val_bpb;
          run.bestSpec = clone(candidate.spec);
          run.bestCommit = shortHash(candidate.spec);
        }
        this._appendResult(run, { commit: shortHash(candidate.spec), val_bpb: result.val_bpb, memory_gb: result.memory_gb, status, description: candidate.description, durationMs: result.durationMs });
        this._recordDecision(workspace, run, index, status, result.val_bpb, candidate.description);
        index += 1;
      }
      if (controller.signal.aborted || run.cancelRequested) {
        run.status = 'cancelled';
        run.cancelRequested = true;
        terminalStatus = 'cancelled';
      } else if (run.error) {
        run.status = 'failed';
        terminalStatus = 'failed';
      } else {
        run.status = 'completed';
        terminalStatus = 'completed';
      }
      run.finishedAt = this.now();
      this.save(run);
      return run;
    } catch (err) {
      run.status = controller.signal.aborted || run.cancelRequested ? 'cancelled' : 'failed';
      run.error = text(err.message, 'run failed', 300);
      run.finishedAt = this.now();
      terminalStatus = run.status;
      this.save(run);
      return run;
    } finally {
      if (workspace != null) {
        this._cleanupWorkspace(run, workspace, terminalStatus);
        this.save(run);
      }
    }
  }

  _createBatchChild(parent, index) {
    const child = this._makeRun({
      ownerId: parent.ownerId,
      requestId: parent.id + '-child-' + index,
      name: parent.name + ' / env ' + index,
      baselineSpec: parent.baselineSpec,
      candidates: parent.candidates,
      timeBudgetMs: parent.timeBudgetMs,
      maxExperiments: parent.maxExperiments,
      workspace: parent.workspace,
      parentBatchId: parent.id,
    }, 'single');
    child.batchIndex = index;
    child.parentBatchId = parent.id;
    child.aggregate = { simulatedVectorized: true, sharedBudget: true, realMlxSimEngine: false };
    return this.save(child);
  }

  async _executeBatch(run, controller) {
    const deadline = run.startedAt + run.batchBudgetMs;
    try {
      if (run.children.length === 0) {
        for (let i = 0; i < run.numEnvs; i += 1) {
          const child = this._createBatchChild(run, i);
          run.children.push(child.id);
        }
        run.aggregate.status = 'running';
        run.aggregate.deadlineAt = deadline;
        run.aggregate.sharedBudgetMs = run.batchBudgetMs;
        this.save(run);
      }
      const childPromises = run.children.map(async (childId) => {
        const child = this.load(childId);
        if (child == null) return { runId: childId, status: 'failed', error: 'child missing' };
        child.status = 'running';
        child.startedAt = this.now();
        this.save(child);
        const childController = new AbortController();
        const onParentAbort = () => { try { childController.abort(); } catch { } };
        if (controller.signal.aborted) onParentAbort();
        else controller.signal.addEventListener('abort', onParentAbort, { once: true });
        try {
          await this._executeSingle(child, childController, deadline);
        } catch (err) {
          child.status = 'failed';
          child.error = text(err.message, 'child failed', 300);
          child.finishedAt = this.now();
          this.save(child);
        } finally {
          controller.signal.removeEventListener('abort', onParentAbort);
        }
        return this.load(childId);
      });
      const settled = await Promise.all(childPromises);
      const children = settled.filter(Boolean);
      const totals = { rows: 0, keep: 0, discard: 0, crash: 0 };
      let best = null;
      const summaries = [];
      for (let i = 0; i < children.length; i += 1) {
        const child = children[i];
        const counts = child.counts || { keep: 0, discard: 0, crash: 0 };
        totals.rows += (child.results || []).length;
        totals.keep += counts.keep || 0;
        totals.discard += counts.discard || 0;
        totals.crash += counts.crash || 0;
        if (child.bestMetric != null && (best == null || child.bestMetric < best.val_bpb)) {
          best = { childRunId: child.id, childIndex: child.batchIndex == null ? i : child.batchIndex, val_bpb: child.bestMetric, commit: child.bestCommit, description: 'child ' + i + ' best', spec: child.bestSpec };
        }
        summaries.push({
          runId: child.id,
          index: child.batchIndex == null ? i : child.batchIndex,
          status: child.status,
          bestMetric: child.bestMetric,
          counts,
          workspace: { mode: child.workspace ? child.workspace.mode : null, cleanup: child.workspace ? child.workspace.cleanup : null },
          evidence: child.evidence || null,
        });
        for (const row of child.results || []) {
          this._appendResult(run, Object.assign({}, row, { description: '[env ' + i + '] ' + row.description }));
        }
      }
      run.bestMetric = best ? best.val_bpb : null;
      run.bestSpec = best ? best.spec : null;
      run.bestCommit = best ? best.commit : null;
      run.counts = { keep: totals.keep, discard: totals.discard, crash: totals.crash };
      run.aggregate = {
        numEnvs: run.numEnvs,
        simulatedVectorized: true,
        realMlxSimEngine: false,
        executionMode: 'independent isolated child runs with Node async concurrency; not a Metal or multiprocessing physics engine',
        sharedBudgetMs: run.batchBudgetMs,
        deadlineAt: deadline,
        status: controller.signal.aborted ? 'cancelled' : 'completed',
        totals,
        best,
        children: summaries,
        marker: VECTORIZED_ENV_CONTRACT.marker,
      };
      run.status = controller.signal.aborted ? 'cancelled' : (children.some((c) => c.status === 'completed') ? 'completed' : 'failed');
      run.error = run.status === 'failed' ? 'all batch children failed or were cancelled' : null;
      run.finishedAt = this.now();
      this.save(run);
      return run;
    } catch (err) {
      run.status = controller.signal.aborted ? 'cancelled' : 'failed';
      run.error = text(err.message, 'batch failed', 300);
      run.aggregate = Object.assign({}, run.aggregate, { status: run.status, error: run.error });
      run.finishedAt = this.now();
      this.save(run);
      return run;
    }
  }

  async start(id, ownerId) {
    const run = this.load(id);
    if (run == null) throw new LabValidationError('run not found', '5001');
    if (ownerId != null && run.ownerId !== String(ownerId)) throw new LabValidationError('run not owned by caller', '5200');
    if (run.status !== 'queued') throw new LabValidationError('duplicate start rejected: run already started or settled', '4091');
    run.status = 'running';
    run.startedAt = this.now();
    run.finishedAt = null;
    run.cancelRequested = false;
    run.error = null;
    this.save(run);
    const controller = new AbortController();
    const record = { controller, promise: null };
    this.active.set(run.id, record);
    record.promise = (async () => {
      try {
        if (run.kind === 'batch') return await this._executeBatch(run, controller);
        return await this._executeSingle(run, controller, null);
      } finally {
        this.active.delete(run.id);
      }
    })();
    return record.promise;
  }

  cancel(id, ownerId) {
    const run = this.load(id);
    if (run == null) throw new LabValidationError('run not found', '5001');
    if (ownerId != null && run.ownerId !== String(ownerId)) throw new LabValidationError('run not owned by caller', '5200');
    if (['queued', 'running', 'cancelling'].includes(run.status) === false) throw new LabValidationError('run is not active; cannot cancel', '4092');
    run.cancelRequested = true;
    if (run.status === 'queued') {
      run.status = 'cancelled';
      run.finishedAt = this.now();
    } else {
      run.status = 'cancelling';
    }
    this.save(run);
    const record = this.active.get(run.id);
    if (record) { try { record.controller.abort(); } catch { } }
    return this.load(id);
  }

  tsv(run) { return toResultsTsv(run); }
}

function shortHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 7);
}
