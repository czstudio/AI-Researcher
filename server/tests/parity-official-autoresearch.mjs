// Parity test for the absorbed AutoResearch + mlx-sim lab surface.
// Covers: isolated workspaces, no repo-index mutation, per-row atomic TSV,
// reload consistency, duplicate rejection, timeout/abort, evaluator adapters,
// simulated vectorized child runs with a shared budget, and HTTP route negatives.
// Run: node server/tests/parity-official-autoresearch.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  AutoResearchLab, RESULTS_HEADER, RESULTS_COLUMNS, VECTORIZED_ENV_CONTRACT,
  createIsolatedWorkspace, evaluatorFromEnvironment, createCommandEvaluator,
  LabValidationError, safeId,
} from '../lib/autoresearch-lab.mjs';
import { registerAutoresearchRoutes } from '../routes/autoresearch-lab.mjs';

let total = 0;
let passed = 0;
const named = [];
async function check(name, fn) {
  total += 1;
  try { await fn(); passed += 1; named.push({ name, pass: true }); console.log('PASS ' + name); }
  catch (err) { named.push({ name, pass: false, error: String(err && err.stack || err) }); console.log('FAIL ' + name + ' :: ' + String(err && err.message || err)); process.exitCode = 1; }
}
function sha256File(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function makeRoot(label) { return fs.mkdtempSync(path.join(os.tmpdir(), 'novix-autoresearch-' + label + '-')); }
function git(cwd, args) { return execFileSync('git', ['-C', cwd].concat(args), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }

const rootA = makeRoot('single');
const labA = new AutoResearchLab({ rootDir: rootA });
let labARunId = null;
let evidenceSnapshot = '';
const callsA = [];
const forcedEvaluator = async (spec, ctx) => {
  if (ctx.workspaceDir) {
    fs.mkdirSync(ctx.workspaceDir, { recursive: true });
    fs.writeFileSync(path.join(ctx.workspaceDir, 'probe.txt'), 'probe ' + ctx.experimentIndex);
  }
  callsA.push({ spec: { ...spec }, ctx: { ...ctx }, existedAtCall: Boolean(ctx.workspaceDir && fs.existsSync(ctx.workspaceDir)) });
  if (spec.learningRate === 0.01 && labARunId) evidenceSnapshot = fs.readFileSync(labA.tsvPath(labARunId), 'utf8');
  if (spec.depth === 24) throw new Error('simulated OOM');
  if (spec.learningRate === 0.03) return { val_bpb: 0.9, memory_gb: 10.1 };
  if (spec.learningRate === 0.01) return { val_bpb: 1.1, memory_gb: 9.9 };
  return { val_bpb: 1.0, memory_gb: 9.8 };
};
labA.evaluator = forcedEvaluator;
labA.evaluatorKind = 'injected-test';
const runA = labA.create({
  ownerId: 'u1', requestId: 'single-a', name: 'protocol probe', timeBudgetMs: 500, maxExperiments: 4,
  candidates: [
    { description: 'better learning rate', spec: { learningRate: 0.03 } },
    { description: 'worse learning rate', spec: { learningRate: 0.01 } },
    { description: 'simulated OOM', spec: { depth: 24 } },
  ],
});
labARunId = runA.id;
const doneA = await labA.start(runA.id, 'u1');

await check('exact five-column results.tsv header', () => {
  assert.deepEqual(RESULTS_COLUMNS, ['commit', 'val_bpb', 'memory_gb', 'status', 'description']);
  assert.equal(RESULTS_HEADER, 'commit\tval_bpb\tmemory_gb\tstatus\tdescription');
});
await check('baseline runs first and is kept', () => {
  assert.equal(doneA.status, 'completed');
  assert.equal(doneA.results[0].description, 'baseline');
  assert.equal(doneA.results[0].status, 'keep');
});
await check('keep then discard then crash statuses are correct', () => {
  assert.deepEqual(doneA.results.map((r) => r.status), ['keep', 'keep', 'discard', 'crash']);
  assert.deepEqual(doneA.counts, { keep: 2, discard: 1, crash: 1 });
});
await check('best metric only advances on lower val_bpb', () => {
  assert.equal(doneA.bestMetric, 0.9);
  assert.equal(doneA.results[1].val_bpb, '0.900000');
  assert.equal(doneA.results[2].val_bpb, '1.100000');
});
await check('crash row uses zero metric and memory', () => {
  assert.equal(doneA.results[3].val_bpb, '0.000000');
  assert.equal(doneA.results[3].memory_gb, '0.0');
});
await check('TSV was written atomically after every row', () => {
  const lines = evidenceSnapshot.trim().split(String.fromCharCode(10));
  assert.equal(lines.length, 3);
  assert.equal(lines[0], RESULTS_HEADER);
  assert.ok(lines[1].includes('baseline'));
  assert.ok(lines[2].includes('better learning rate'));
});
await check('reload from disk matches state and TSV evidence', () => {
  const reloaded = new AutoResearchLab({ rootDir: rootA });
  const again = reloaded.load(runA.id);
  assert.equal(again.results.length, 4);
  assert.equal(again.bestMetric, 0.9);
  assert.equal(reloaded.verify(runA.id).ok, true);
  const evidence = JSON.parse(fs.readFileSync(path.join(rootA, 'runs', runA.id + '.json'), 'utf8')).evidence;
  assert.equal(evidence.tsvSha256, sha256File(path.join(rootA, 'tsv', runA.id + '.tsv')));
});
await check('results.tsv has no temp writer residue', () => {
  const files = fs.readdirSync(path.join(rootA, 'tsv'));
  assert.deepEqual(files.sort(), [runA.id + '.tsv']);
});
await check('isolated evaluator workspaces existed during the run', () => {
  assert.equal(callsA.length, 4);
  for (const call of callsA) assert.ok(call.ctx.workspaceDir && call.existedAtCall);
});
await check('isolated temp workspaces are cleaned after success', () => {
  assert.equal(doneA.workspace.cleanup, 'done');
  assert.equal(fs.existsSync(doneA.workspace.path), false);
  for (const call of callsA) assert.equal(fs.existsSync(call.ctx.workspaceDir), false);
});
await check('duplicate create requestId is rejected', () => {
  assert.throws(() => labA.create({ ownerId: 'u1', requestId: 'single-a', candidates: [] }), (e) => e.code === '4090');
});
await check('duplicate start of a settled run is rejected', async () => {
  await assert.rejects(() => labA.start(runA.id, 'u1'), (e) => e.code === '4091');
});
await check('cancel of a settled run is rejected', () => {
  assert.throws(() => labA.cancel(runA.id, 'u1'), (e) => e.code === '4092');
});
await check('foreign owner cannot cancel a run and gets ownership error', () => {
  assert.throws(() => labA.cancel(runA.id, 'intruder'), (e) => e.code === '5200');
});
await check('path traversal run id is rejected before filesystem access', () => {
  assert.throws(() => safeId('../escape'), LabValidationError);
  assert.throws(() => labA.load('../escape'), LabValidationError);
  assert.throws(() => labA.load('..%2Fescape'), LabValidationError);
});

const rootT = makeRoot('timeout');
const labT = new AutoResearchLab({ rootDir: rootT, evaluator: () => new Promise((resolve) => setTimeout(() => resolve({ val_bpb: 1, memory_gb: 1 }), 1200)) });
const runT = labT.create({ ownerId: 'u1', timeBudgetMs: 60, maxExperiments: 1 });
const startedT = Date.now();
const doneT = await labT.start(runT.id, 'u1');
const timeoutMs = Date.now() - startedT;
await check('timeout is enforced and recorded as a crash', () => {
  assert.equal(doneT.status, 'failed');
  assert.equal(doneT.results[0].status, 'crash');
  assert.equal(doneT.results[0].timedOut, true);
});
await check('timeout returns promptly instead of awaiting the slow worker', () => {
  assert.ok(timeoutMs < 900, 'timeout took ' + timeoutMs + 'ms');
});

const rootAbort = makeRoot('abort');
let abortStarted = null;
const abortReady = new Promise((resolve) => { abortStarted = resolve; });
const blockingEvaluator = (spec, ctx) => new Promise((resolve, reject) => {
  abortStarted();
  const timer = setTimeout(() => resolve({ val_bpb: 1, memory_gb: 1 }), 5000);
  if (ctx.signal) ctx.signal.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('aborted by signal')); }, { once: true });
});
const labAbort = new AutoResearchLab({ rootDir: rootAbort, evaluator: blockingEvaluator });
const runAbort = labAbort.create({ ownerId: 'u1', timeBudgetMs: 5000, maxExperiments: 1 });
const abortPromise = labAbort.start(runAbort.id, 'u1');
await abortReady;
const cancelResponse = labAbort.cancel(runAbort.id, 'u1');
const doneAbort = await abortPromise;
await check('cancel aborts an in-flight external evaluator', () => {
  assert.ok(['cancelling', 'cancelled'].includes(cancelResponse.status));
  assert.equal(doneAbort.status, 'cancelled');
  assert.equal(doneAbort.results.length, 0);
  assert.equal(doneAbort.workspace.cleanup, 'done');
});

const commandRoot = makeRoot('command');
const workerScript = path.join(commandRoot, 'slow-worker.mjs');
fs.writeFileSync(workerScript, "setTimeout(() => { process.stdout.write(JSON.stringify({ val_bpb: 1, memory_gb: 1 })); }, 5000);\n");
const commandLab = new AutoResearchLab({
  rootDir: commandRoot,
  evaluator: createCommandEvaluator({ command: process.execPath, args: [workerScript] }),
});
const commandRun = commandLab.create({ ownerId: 'u1', timeBudgetMs: 80, maxExperiments: 1 });
const commandStarted = Date.now();
const commandDone = await commandLab.start(commandRun.id, 'u1');
await check('command evaluator timeout kills the child process boundary', () => {
  assert.equal(commandDone.status, 'failed');
  assert.equal(commandDone.results[0].status, 'crash');
  assert.equal(commandDone.results[0].timedOut, true);
  assert.ok(Date.now() - commandStarted < 2000);
});

const successScript = path.join(commandRoot, 'quick-worker.mjs');
fs.writeFileSync(successScript, "process.stdout.write(JSON.stringify({ val_bpb: 0.812345, memory_gb: 7.5 }));\n");
const quickLab = new AutoResearchLab({ rootDir: commandRoot, evaluator: createCommandEvaluator({ command: process.execPath, args: [successScript] }) });
const quickRun = quickLab.create({ ownerId: 'u1', timeBudgetMs: 2000, maxExperiments: 1 });
const quickDone = await quickLab.start(quickRun.id, 'u1');
await check('command evaluator adapter returns structured metrics', () => {
  assert.equal(quickDone.status, 'completed');
  assert.equal(quickDone.results[0].val_bpb, '0.812345');
  assert.equal(quickDone.results[0].memory_gb, '7.5');
});

const modulePath = path.join(commandRoot, 'module-worker.mjs');
fs.writeFileSync(modulePath, "export default async function evaluate(spec, ctx) { return { val_bpb: 0.777, memory_gb: 1.2 }; }\n");
await check('environment module evaluator boundary is injectable', async () => {
  const adapter = evaluatorFromEnvironment({ NOVIX_AUTORESEARCH_EVALUATOR: modulePath });
  const result = await adapter({ depth: 8 }, { signal: new AbortController().signal });
  assert.equal(result.val_bpb, 0.777);
  assert.equal(result.memory_gb, 1.2);
});

const repoFixture = makeRoot('fixture-repo');
fs.writeFileSync(path.join(repoFixture, 'train.py'), 'baseline source\n');
fs.writeFileSync(path.join(repoFixture, 'prepare.py'), 'fixed evaluation\n');
git(repoFixture, ['init', '-q']);
git(repoFixture, ['config', 'user.email', 'lab@test.local']);
git(repoFixture, ['config', 'user.name', 'Lab Test']);
git(repoFixture, ['add', '.']);
git(repoFixture, ['commit', '-qm', 'fixture baseline']);
const fixtureHead = git(repoFixture, ['rev-parse', 'HEAD']).trim();
const fixtureIndexHash = sha256File(path.join(repoFixture, '.git', 'index'));
const seenFiles = [];
const rootSnapshot = makeRoot('snapshot');
const labSnapshot = new AutoResearchLab({ rootDir: rootSnapshot, allowSourceDir: true, evaluator: async (spec, ctx) => {
  try { seenFiles.push(fs.readFileSync(path.join(ctx.runWorkspaceDir, 'train.py'), 'utf8').trim()); } catch { }
  try { seenFiles.push(fs.readFileSync(path.join(ctx.workspaceDir, 'train.py'), 'utf8').trim()); } catch { }
  return { val_bpb: 1.01, memory_gb: 4.2 };
} });
const snapshotRun = labSnapshot.create({
  ownerId: 'u1', timeBudgetMs: 500, maxExperiments: 2,
  workspace: { mode: 'snapshot', sourceDir: repoFixture },
  candidates: [{ description: 'candidate edits train.py inside temp snapshot', spec: { learningRate: 0.03 }, files: { 'train.py': 'candidate edit\n' } }],
});
const snapshotDone = await labSnapshot.start(snapshotRun.id, 'u1');
await check('snapshot workspace contains a copy of the source tree', () => {
  assert.equal(snapshotDone.workspace.mode, 'snapshot');
  assert.ok(seenFiles.includes('baseline source'));
});
await check('candidate patch is applied only inside isolated experiment directory', () => {
  assert.ok(seenFiles.includes('candidate edit'));
  assert.equal(fs.readFileSync(path.join(repoFixture, 'train.py'), 'utf8'), 'baseline source\n');
});
await check('source git index and HEAD are not mutated by lab runs', () => {
  assert.equal(git(repoFixture, ['rev-parse', 'HEAD']).trim(), fixtureHead);
  assert.equal(sha256File(path.join(repoFixture, '.git', 'index')), fixtureIndexHash);
  assert.equal(git(repoFixture, ['status', '--porcelain']).trim(), '');
});
await check('snapshot temp workspace cleanup removes the isolated copy', () => {
  assert.equal(snapshotDone.workspace.cleanup, 'done');
  assert.equal(fs.existsSync(snapshotDone.workspace.path), false);
});

const rootWorktree = makeRoot('worktree');
const labWorktree = new AutoResearchLab({
  rootDir: rootWorktree, allowSourceDir: true, useGitWorktree: true,
  evaluator: async (spec, ctx) => ({ val_bpb: fs.existsSync(path.join(ctx.runWorkspaceDir, 'train.py')) ? 1.02 : 2, memory_gb: 1 }),
});
const worktreeRun = labWorktree.create({ ownerId: 'u1', timeBudgetMs: 500, maxExperiments: 1, workspace: { mode: 'git-worktree', sourceDir: repoFixture } });
const worktreeDone = await labWorktree.start(worktreeRun.id, 'u1');
await check('optional git worktree strategy uses a detached isolated worktree and cleans it up', () => {
  assert.equal(worktreeDone.workspace.mode, 'git-worktree');
  assert.equal(worktreeDone.workspace.cleanup, 'done');
  assert.equal(fs.existsSync(worktreeDone.workspace.path), false);
  assert.equal(git(repoFixture, ['rev-parse', 'HEAD']).trim(), fixtureHead);
  assert.equal(git(repoFixture, ['status', '--porcelain']).trim(), '');
});

const rootBatch = makeRoot('batch');
const labBatch = new AutoResearchLab({ rootDir: rootBatch, evaluator: async (spec) => {
  await new Promise((resolve) => setTimeout(resolve, 4));
  if (spec.depth === 24) throw new Error('simulated batch crash');
  if (spec.learningRate === 0.03) return { val_bpb: 0.91, memory_gb: 10 };
  if (spec.learningRate === 0.01) return { val_bpb: 1.2, memory_gb: 9 };
  return { val_bpb: 1.0, memory_gb: 9.5 };
} });
const batchRun = labBatch.createBatch({
  ownerId: 'u1', name: 'batch probe', numEnvs: 3, batchBudgetMs: 5000, timeBudgetMs: 1000, maxExperiments: 4,
  candidates: [
    { description: 'better lr', spec: { learningRate: 0.03 } },
    { description: 'worse lr', spec: { learningRate: 0.01 } },
    { description: 'oom', spec: { depth: 24 } },
  ],
});
const batchDone = await labBatch.start(batchRun.id, 'u1');
await check('batch creates N independent child runs', () => {
  assert.equal(batchDone.kind, 'batch');
  assert.equal(batchDone.children.length, 3);
  assert.equal(new Set(batchDone.children).size, 3);
});
await check('batch aggregate totals keep/discard/crash across children', () => {
  assert.equal(batchDone.aggregate.totals.rows, 12);
  assert.equal(batchDone.aggregate.totals.keep, 6);
  assert.equal(batchDone.aggregate.totals.discard, 3);
  assert.equal(batchDone.aggregate.totals.crash, 3);
  assert.equal(batchDone.counts.keep, 6);
});
await check('batch aggregate best equals best independent child metric', () => {
  const childBest = Math.min(...batchDone.aggregate.children.map((c) => c.bestMetric));
  assert.equal(batchDone.aggregate.best.val_bpb, childBest);
  assert.equal(batchDone.bestMetric, childBest);
});
await check('batch marker is honestly simulated, not a real MLX engine', () => {
  assert.equal(batchDone.aggregate.simulatedVectorized, true);
  assert.equal(batchDone.aggregate.realMlxSimEngine, false);
  assert.equal(batchDone.aggregate.marker.realMetalPhysics, false);
  assert.ok(batchDone.aggregate.executionMode.includes('not a Metal'));
});
await check('each child run has its own valid atomic TSV evidence', () => {
  for (const id of batchDone.children) {
    const child = labBatch.load(id);
    assert.equal(child.parentBatchId, batchRun.id);
    assert.equal(labBatch.verify(id).ok, true);
    assert.ok(child.evidence.tsvRows >= 4);
  }
});

const rootShared = makeRoot('shared-budget');
const labShared = new AutoResearchLab({ rootDir: rootShared, evaluator: async (spec) => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  return { val_bpb: 1.0 - Number(spec.learningRate || 0) * 0.1, memory_gb: 5 };
} });
const sharedRun = labShared.createBatch({
  ownerId: 'u1', numEnvs: 2, batchBudgetMs: 240, timeBudgetMs: 1000, maxExperiments: 6,
  candidates: [
    { description: 'a', spec: { learningRate: 0.03 } },
    { description: 'b', spec: { learningRate: 0.01 } },
    { description: 'c', spec: { learningRate: 0.025 } },
  ],
});
const sharedStarted = Date.now();
const sharedDone = await labShared.start(sharedRun.id, 'u1');
const sharedElapsed = Date.now() - sharedStarted;
await check('batch children share one wall-clock budget and terminate', () => {
  assert.equal(sharedDone.children.length, 2);
  assert.ok(sharedElapsed < 3000, 'shared batch took ' + sharedElapsed + 'ms');
  assert.equal(sharedDone.aggregate.sharedBudgetMs, 240);
  for (const id of sharedDone.children) {
    const child = labShared.load(id);
    assert.ok(['completed', 'failed', 'cancelled'].includes(child.status));
    assert.equal(child.workspace.cleanup, 'done');
  }
  assert.ok(sharedDone.aggregate.totals.rows > 0);
});

const rootRoute = makeRoot('routes');
const labRoute = new AutoResearchLab({ rootDir: rootRoute, evaluator: async (spec) => ({ val_bpb: 1.0 - Number(spec.learningRate || 0), memory_gb: 3 }) });
const handlers = new Map();
const fakeAuth = (req) => {
  const token = String(req.headers.authorization || '');
  if (token === 'owner') return { user: { id: 'route-owner' }, anon: false };
  if (token === 'other') return { user: { id: 'route-other' }, anon: false };
  return { denied: { code: '401', message: 'authentication required', result: null } };
};
registerAutoresearchRoutes((method, routePath, fn) => handlers.set(method + ' ' + routePath, fn), { lab: labRoute, requireUser: fakeAuth });
function matchHandler(method, routePath) {
  const exact = handlers.get(method + ' ' + routePath);
  if (exact) return exact;
  for (const [key, fn] of handlers) {
    const parts = key.split(' ');
    if (parts[0] !== method) continue;
    const pattern = parts.slice(1).join(' ').split('/');
    const actual = routePath.split('/');
    if (pattern.length !== actual.length) continue;
    let match = true;
    for (let i = 0; i < pattern.length; i += 1) {
      if (pattern[i].startsWith(':') === false && pattern[i] !== actual[i]) { match = false; break; }
    }
    if (match) return fn;
  }
  return null;
}
async function routeCall(method, routePath, p, token = 'owner') {
  const fn = matchHandler(method, routePath);
  assert.ok(fn, 'missing route ' + method + ' ' + routePath);
  const merged = Object.assign({}, p || {});
  const parts = routePath.split('/');
  if (routePath.includes('/runs/') && parts.length > 4) merged.id = parts[parts.indexOf('runs') + 1];
  return fn({ headers: token ? { authorization: token } : {} }, {}, merged, merged);
}
async function waitRouteRun(id) {
  for (let i = 0; i < 80; i += 1) {
    const run = labRoute.load(id);
    if (run && ['completed', 'failed', 'cancelled'].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('route run did not settle: ' + id);
}
const unauthCreate = await routeCall('POST', '/autoresearch/lab/runs', { title: 'x' }, null);
await check('route rejects unauthenticated create', () => assert.equal(unauthCreate.code, '401'));
const createRoute = await routeCall('POST', '/autoresearch/lab/runs', {
  name: 'route run', requestId: 'route-single', timeBudgetMs: 500, maxExperiments: 2,
  candidates: [{ description: 'better', spec: { learningRate: 0.03 } }],
});
await check('route create returns an owned run', () => {
  assert.equal(createRoute.code, '0');
  assert.equal(createRoute.result.ownerId, 'route-owner');
  assert.equal(createRoute.result.status, 'queued');
});
const routeRunId = createRoute.result.id;
const foreignGet = await routeCall('GET', '/autoresearch/lab/runs/' + routeRunId, {}, 'other');
await check('route rejects cross-owner reads', () => assert.equal(foreignGet.code, '5200'));
const traversalGet = await handlers.get('GET /autoresearch/lab/runs/:id')({ headers: { authorization: 'owner' } }, {}, { id: '../escape' }, {});
await check('route rejects traversal run id without filesystem access', () => assert.equal(traversalGet.code, '5001'));
const startRoute = await routeCall('POST', '/autoresearch/lab/runs/' + encodeURIComponent(routeRunId) + '/start', {});
await check('route starts a queued run', () => assert.equal(startRoute.code, '0'));
const duplicateStart = await routeCall('POST', '/autoresearch/lab/runs/' + encodeURIComponent(routeRunId) + '/start', {});
await check('route rejects duplicate start', () => assert.equal(duplicateStart.code, '4091'));
const routeDone = await waitRouteRun(routeRunId);
const verifyRoute = await routeCall('GET', '/autoresearch/lab/runs/' + encodeURIComponent(routeRunId) + '/verify', {});
await check('route verify confirms atomic TSV consistency', () => {
  assert.equal(routeDone.status, 'completed');
  assert.equal(verifyRoute.code, '0');
  assert.equal(verifyRoute.result.ok, true);
});
const tsvRoute = await routeCall('GET', '/autoresearch/lab/runs/' + encodeURIComponent(routeRunId) + '/results.tsv', {});
await check('route returns JSON results.tsv evidence', () => {
  assert.equal(tsvRoute.code, '0');
  assert.equal(tsvRoute.result.tsv.split(String.fromCharCode(10))[0], RESULTS_HEADER);
});
const downloadRoute = await routeCall('GET', '/autoresearch/lab/runs/' + encodeURIComponent(routeRunId) + '/results.tsv', { download: '1' });
await check('route supports results.tsv download stream', () => {
  assert.ok(downloadRoute.__streamFile);
  assert.ok(fs.existsSync(downloadRoute.__streamFile));
  assert.ok(downloadRoute.name.endsWith('.results.tsv'));
});
const batchRoute = await routeCall('POST', '/autoresearch/lab/batches', { name: 'route batch', numEnvs: 2, batchBudgetMs: 2000, maxExperiments: 2, candidates: [{ description: 'b', spec: { learningRate: 0.04 } }] });
await check('route creates a batch run', () => {
  assert.equal(batchRoute.code, '0');
  assert.equal(batchRoute.result.kind, 'batch');
  assert.equal(batchRoute.result.numEnvs, 2);
});
await routeCall('POST', '/autoresearch/lab/runs/' + encodeURIComponent(batchRoute.result.id) + '/start', {});
const batchRouteDone = await waitRouteRun(batchRoute.result.id);
await check('route batch settles with shared aggregate', () => {
  assert.equal(batchRouteDone.children.length, 2);
  assert.ok(batchRouteDone.aggregate);
  assert.equal(batchRouteDone.aggregate.realMlxSimEngine, false);
});
const cancelSettled = await routeCall('POST', '/autoresearch/lab/runs/' + encodeURIComponent(routeRunId) + '/cancel', {});
await check('route rejects cancel of a settled run', () => assert.equal(cancelSettled.code, '4092'));

const summary = { total, passed, failed: total - passed, rows: named };
fs.writeFileSync(path.join(os.tmpdir(), 'novix-autoresearch-parity-summary.json'), JSON.stringify(summary, null, 2));
console.log('SUMMARY parity_official_autoresearch checks=' + total + ' pass=' + passed + ' fail=' + (total - passed));
