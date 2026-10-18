import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const PORT = Number(process.env.OFFICIAL_TEST_PORT || 8145);
const BASE = 'http://127.0.0.1:' + PORT;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'novix-official-int-'));
const child = spawn(process.execPath, ['server/serve.mjs'], { env: { ...process.env, PORT_SITE: String(PORT), NOVIX_DATA_DIR: DATA, NOVIX_JWT_SECRET: 'official-integration' }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
let pass = 0;
async function call(method, p, body = null, token = null) {
  const headers = { Accept: 'application/json' };
  if (body != null) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(BASE + '/api' + p, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
  const json = await res.json();
  if (json.code !== '0') throw new Error(method + ' ' + p + ' -> ' + json.code + ' ' + json.message);
  return json.result;
}
function ok(name) { pass++; console.log('PASS', name); }
async function waitUp() { for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE + '/healthz')).ok) return; } catch { } await new Promise((r) => setTimeout(r, 150)); } throw new Error('server not up'); }
try {
  await waitUp();
  ok('health');
  const email = 'official-int-' + Date.now() + '@example.test';
  const signup = await call('POST', '/user/emailSignUp?email=' + encodeURIComponent(email) + '&password=secret123');
  const token = signup.token;
  await call('POST', '/credit/upgrade_plan?level=pro', { level: 'pro' }, token);
  ok('auth + pro plan');
  const roles = await call('GET', '/team/roles', null, token);
  assert.equal(roles.roles.length, 11);
  ok('team roles');
  const team = await call('POST', '/team/sprints', { name: 'Integration team', goal: 'prove absorbed features work' }, token);
  await call('POST', '/team/sprints/' + team.id + '/spawn', { role: 'ceo' }, token);
  const task = await call('POST', '/team/sprints/' + team.id + '/tasks', { subject: 'integration delegation', ownerRole: 'ceo' }, token);
  await call('POST', '/team/sprints/' + team.id + '/tasks/' + task.id + '/claim', { role: 'ceo' }, token);
  await call('POST', '/team/sprints/' + team.id + '/tasks/' + task.id + '/complete', { role: 'ceo', evidence: 'integration delegation artifact created' }, token);
  await call('POST', '/team/sprints/' + team.id + '/artifacts', { role: 'ceo', artifactType: 'delegation', filename: 'delegation.json', content: 'ceo delegated integration work to pm engineer qa' }, token);
  const advanced = await call('POST', '/team/sprints/' + team.id + '/phase/advance', { role: 'ceo', toPhase: 'plan' }, token);
  assert.equal(advanced.phase, 'plan');
  await call('POST', '/team/sprints/' + team.id + '/mail', { from: 'ceo', to: 'engineer', body: 'implementation starts now' }, token);
  const mail = await call('GET', '/team/sprints/' + team.id + '/mail?role=engineer', null, token);
  assert.equal(mail.items.length, 1);
  await call('POST', '/team/sprints/' + team.id + '/messages', { role: 'ceo', parts: [{ type: 'text', text: 'integration message' }, { type: 'reasoning', text: 'gate first' }, { type: 'tool', toolName: 'Bash', output: 'ok' }] }, token);
  ok('team task/evidence/phase/mail/chat');  const review = await call('POST', '/team/sprints/' + team.id + '/review/route', { diffPaths: ['src/auth/login.ts', 'docs/spec.md'] }, token);
  assert.ok(review.reviewers.includes('reviewer'));
  assert.ok(review.reviewers.includes('security'));
  ok('team review router');
  await call('POST', '/team/sprints/' + team.id + '/messages', { role: 'engineer', parts: [{ type: 'approval', title: 'Approve integration release?', text: 'approval request', blocking: true, reversibility: 'easy' }] }, token);
  const attention = await call('GET', '/team/sprints/' + team.id + '/attention', null, token);
  assert.ok(attention.items.length >= 1);
  const approvalItem = attention.items.find((x) => x.source === 'chat-approval');
  await call('POST', '/team/sprints/' + team.id + '/attention/' + encodeURIComponent(approvalItem.id) + '/answer', { decision: 'approved', answer: 'approved in integration test' }, token);
  ok('team attention approval queue');
  await call('POST', '/team/sprints/' + team.id + '/memory', { author: 'human@integration', title: 'Evidence before ship', body: 'A verify-first process prevents false green claims and keeps review honest.', tags: ['decision','retro'], learnedFrom: 'user', evidence: 'integration:memory' }, token);
  const memory = await call('GET', '/team/sprints/' + team.id + '/memory?q=evidence', null, token);
  assert.ok(memory.items.length >= 1);
  ok('team memory JSONL search');
  const turn1 = await call('POST', '/team/sprints/' + team.id + '/progress/turn', { role: 'engineer', turnId: 't1' }, token);
  const turn2 = await call('POST', '/team/sprints/' + team.id + '/progress/turn', { role: 'engineer', turnId: 't2' }, token);
  assert.equal(turn2.triggered, true);
  const theater = await call('GET', '/team/sprints/' + team.id + '/theater', null, token);
  assert.equal(theater.threshold, 2);
  ok('team theater detector');

  const contract = await call('GET', '/autoresearch/lab/contract', null, token);
  assert.ok(contract.vectorized.step.includes('terminateds'));
  const run = await call('POST', '/autoresearch/lab/runs', { name: 'integration run', maxExperiments: 3, timeBudgetMs: 1000 }, token);
  await call('POST', '/autoresearch/lab/runs/' + run.id + '/start', null, token);
  let done = null;
  for (let i = 0; i < 40; i++) { done = await call('GET', '/autoresearch/lab/runs/' + run.id, null, token); if (['completed','failed','cancelled'].includes(done.status)) break; await new Promise((r) => setTimeout(r, 100)); }
  assert.equal(done.status, 'completed');
  const tsv = await call('GET', '/autoresearch/lab/runs/' + run.id + '/results.tsv', null, token);
  assert.ok(tsv.tsv.startsWith('commit\tval_bpb\tmemory_gb\tstatus\tdescription'));
  ok('autoresearch lab + tsv');  const batch = await call('POST', '/autoresearch/lab/batches', { name: 'integration batch', numEnvs: 2, batchBudgetMs: 2000, maxExperiments: 2, timeBudgetMs: 1000 }, token);
  assert.equal(batch.kind, 'batch');
  assert.equal(batch.numEnvs, 2);
  await call('POST', '/autoresearch/lab/runs/' + batch.id + '/start', null, token);
  let batchDone = null;
  for (let i = 0; i < 60; i++) { batchDone = await call('GET', '/autoresearch/lab/runs/' + batch.id, null, token); if (['completed','failed','cancelled'].includes(batchDone.aggregate?.status) || ['completed','failed','cancelled'].includes(batchDone.status)) break; await new Promise((r) => setTimeout(r, 100)); }
  assert.equal(batchDone.aggregate.simulatedVectorized, true);
  assert.ok(batchDone.children.length === 2);
  const verify = await call('GET', '/autoresearch/lab/runs/' + run.id + '/verify', null, token);
  assert.equal(verify.ok, true);
  ok('autoresearch batch + atomic tsv verify');

  const ws = await call('POST', '/sandbox/workspaces', { namespace: 'novix', sandboxId: 'integration' }, token);
  await call('POST', '/sandbox/workspaces/novix/integration/files', { path: 'notes/check.txt', content: 'sandbox-ok' }, token);
  const read = await call('GET', '/sandbox/workspaces/novix/integration/files?path=notes/check.txt', null, token);
  assert.equal(read.content, 'sandbox-ok');
  const exec = await call('POST', '/sandbox/workspaces/novix/integration/exec', { command: 'printf sandbox-exec' }, token);
  assert.equal(exec.exitCode, 0);
  assert.ok(exec.output.includes('sandbox-exec'));
  ok('sandbox provider read/write/exec');  const providers = await call('GET', '/sandbox/providers', null, token);
  assert.equal(providers.provider, 'local');
  assert.equal(providers.websocket, 'remote-target-only');
  ok('sandbox provider capability matrix');

  for (const route of ['/team', '/autoexperiment']) {
    const res = await fetch(BASE + route);
    const text = await res.text();
    assert.ok(text.includes('<div id="app">'));
  }
  ok('SPA routes /team and /autoexperiment');
} finally {
  child.kill('SIGKILL');
}
console.log('SUMMARY parity_official_integration rows=' + pass + ' pass=' + pass);
