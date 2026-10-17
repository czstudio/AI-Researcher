import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AutoResearchLab, RESULTS_HEADER, VECTORIZED_ENV_CONTRACT } from '../lib/autoresearch-lab.mjs';
let passed = 0;
function ok(name, fn) { fn(); passed++; console.log('PASS', name); }
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novix-lab-'));
const lab = new AutoResearchLab({ rootDir: root });
const run = lab.create({ ownerId: 'u1', timeBudgetMs: 1000, maxExperiments: 3, candidates: [
  { description: 'better depth', spec: { depth: 12, batchSize: 65536 } },
  { description: 'worse lr', spec: { learningRate: 0.001 } },
  { description: 'oom', spec: { depth: 24 } },
] });
const finished = await lab.start(run.id, 'u1');
ok('run completes with persisted rows', () => { assert.equal(finished.status, 'completed'); assert.equal(finished.results.length, 4); });
ok('baseline first and best metric improves', () => { assert.equal(finished.results[0].description, 'baseline'); assert.ok(finished.bestMetric < finished.results[0].val_bpb); });
ok('keep discard and crash statuses exist', () => { const s = new Set(finished.results.map((r) => r.status)); assert.ok(s.has('keep')); assert.ok(s.has('discard')); assert.ok(s.has('crash')); });
ok('tsv header is exact upstream shape', () => { const lines = lab.tsv(finished).trim().split(String.fromCharCode(10)); assert.equal(lines[0], RESULTS_HEADER); assert.equal(lines[0].split(String.fromCharCode(9)).join(' '), 'commit val_bpb memory_gb status description'); });
ok('run persists across reload', () => { const again = new AutoResearchLab({ rootDir: root }); assert.equal(again.load(run.id).results.length, 4); });
ok('foreign owner rejected', () => { assert.throws(() => lab.cancel(run.id, 'u2'), /not owned/); });
ok('vectorized env metadata present', () => { assert.equal(VECTORIZED_ENV_CONTRACT.spaces.action, 'Box'); assert.ok(VECTORIZED_ENV_CONTRACT.step.includes('terminateds')); });
const slow = new AutoResearchLab({ rootDir: root, evaluator: () => new Promise((resolve) => setTimeout(() => resolve({ valBpb: 1, memoryGb: 1 }), 200)) });
const slowRun = slow.create({ ownerId: 'u1', timeBudgetMs: 50, maxExperiments: 1 });
const slowDone = await slow.start(slowRun.id, 'u1');
ok('timeout is recorded as crash', () => { assert.equal(slowDone.status, 'failed'); assert.equal(slowDone.results[0].status, 'crash'); });
console.log('SUMMARY parity_official_autoresearch rows=' + passed + ' pass=' + passed);
