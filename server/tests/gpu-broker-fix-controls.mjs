// Fix-verification controls for the GPU broker, using the same methodology as the
// acceptance seat's NOVIX-10de-GPU-CONTROLS-replica_boundaries.mjs: execute the
// FIXED head's actual broker.js source through vm.SourceTextModule with provider /
// filesystem / path / crypto mocks. No repository module, real filesystem, network,
// provider, DB, credentials, or GPU is used.
//
// The seat's script asserted the DEFECT outcomes (PASS NEGATIVE) at head 10de15d.
// This script asserts the DESIRED outcomes at the fixed head:
//   1. cancel-ready race: cancelled lease never resurrects to active
//   2. provider stop=false: cancel must NOT report cancelled
//   3. same-task replay: rentServer called exactly once (idempotent submit)
// plus releaseAfterTask honesty and route wiring smoke (module load registers routes).
//
// Run: node --experimental-vm-modules server/tests/gpu-broker-fix-controls.mjs <head>
// HEAD may also come from NOVIX_GPU_CONTROLS_HEAD env.

import { execFileSync } from 'node:child_process';
import * as vm from 'node:vm';

const REPO = '/Users/cz/code/novix-open';
const HEAD = process.argv[2] || process.env.NOVIX_GPU_CONTROLS_HEAD;
if (!HEAD || !/^[0-9a-f]{40}$/.test(HEAD)) {
  console.error('usage: node --experimental-vm-modules gpu-broker-fix-controls.mjs <40-hex-head>');
  process.exit(2);
}
const source = execFileSync('git', ['-C', REPO, 'show', `${HEAD}:server/lib/gpu/broker.js`], { encoding: 'utf8' });
if (!source.includes('export async function submit') || !source.includes('export async function cancel')) throw new Error('fixed broker source not loaded');
if (source.includes('await releaseServer(lease.deploymentId).catch(() => {})')) {
  throw new Error('fixed head still swallows provider stop result');
}

const files = new Map();
const fsMock = {
  mkdirSync() {},
  writeFileSync(file, text) { files.set(String(file), String(text)); },
  readFileSync(file) { if (!files.has(String(file))) throw new Error('ENOENT'); return files.get(String(file)); },
  readdirSync() { return [...files.keys()].map((x) => x.split('/').pop()); },
  rmSync(file) { files.delete(String(file)); },
};
const pathMock = { join: (...parts) => parts.join('/').replaceAll('//', '/'), resolve: (...parts) => parts.join('/').replaceAll('//', '/') };
let uuidSeq = 0;
const cryptoMock = { randomUUID: () => `mock-uuid-${++uuidSeq}` };

let rentCalls = 0;
let stopOk = true;
let stopCalls = 0;
let gateNextStop = false;
let gateResolve;
let readyResolve;
let readyProgress;
let readyNameSeen;
let sshIdSeen;
let gateNextRent = false;
let rentGateResolve;
// fixture = official documented create shape (autodl.com/docs/esd_api_doc):
// deployment_uuid — NOT the legacy deployment_id alias.
const autodlMock = {
  async rentServer() {
    rentCalls += 1;
    if (rentCalls === Number(process.env.NOVIX_FIXCTL_BAD_RENT || 0)) return {};
    if (gateNextRent) { gateNextRent = false; return new Promise((resolve) => { rentGateResolve = resolve; }); }
    return { deployment_uuid: `dep-${rentCalls}`, deployment_name: `gpu-${rentCalls}` };
  },
  async waitForReady(name, _timeout, onProgress) {
    readyNameSeen = name;
    readyProgress = onProgress;
    return new Promise((resolve) => { readyResolve = resolve; });
  },
  async releaseServer() {
    stopCalls += 1;
    if (gateNextStop) { gateNextStop = false; return new Promise((resolve) => { gateResolve = resolve; }); }
    return stopOk;
  },
  async destroyServer() { return true; },
  async getContainerSsh(id) { sshIdSeen = id; return null; },
  async getBalance() { return null; },
  estimateCost() { return { ratePerHour: 1, hours: 1, estimatedCost: '1.00' }; },
};

const context = vm.createContext({
  process: { env: { GPU_BROKER_DIR: '/mock-gpu', GPU_MAX_TOTAL: '64' } },
  setTimeout, clearTimeout, setImmediate,
});
const synthetic = (name, value) => {
  const keys = Object.keys(value);
  return new vm.SyntheticModule(keys, function () { for (const key of keys) this.setExport(key, value[key]); }, { context, identifier: name });
};
const modules = {
  './autodl.js': synthetic('./autodl.js', autodlMock),
  'node:fs': synthetic('node:fs', { default: fsMock }),
  'node:path': synthetic('node:path', { default: pathMock }),
  'node:crypto': synthetic('node:crypto', { default: cryptoMock }),
};
const mod = new vm.SourceTextModule(source, {
  context,
  identifier: `${REPO}@${HEAD}:server/lib/gpu/broker.js`,
  initializeImportMeta(meta) { meta.dirname = '/mock/server/lib'; },
});
await mod.link(async (specifier) => { if (!modules[specifier]) throw new Error(`unexpected import ${specifier}`); return modules[specifier]; });
await mod.evaluate();
const broker = mod.namespace;

function log(kind, name, detail) { console.log(`${kind} ${name} :: ${detail}`); }
function expect(condition, name, detail) { log(condition ? 'PASS' : 'FAIL', name, detail); if (!condition) process.exitCode = 1; }

// Positive control (unchanged semantics from the seat's script): ownership filter.
await broker.submit('alice', 'task-own', { route: 'autodl' });
const wrong = await broker.cancel('bob', 'task-own');
expect(wrong.cancelled === false && wrong.reason === 'not_found', 'cross-user-cancel-denied', JSON.stringify(wrong));
stopOk = true;
const ownCancel = await broker.cancel('alice', 'task-own');
expect(ownCancel.cancelled === true && broker.status('alice', 'task-own').status === 'cancelled', 'normal-cancel-returns-cancelled', JSON.stringify(ownCancel));

// Fix 1: cancel during provisioning, then the deferred waitForReady fires —
// the lease must stay cancelled (no resurrection to active).
await broker.submit('alice', 'task-race', { route: 'autodl' });
const raceCancel = await broker.cancel('alice', 'task-race');
expect(raceCancel.cancelled === true, 'cancel-during-provisioning-accepted', JSON.stringify(raceCancel));
readyProgress?.({ status: 'running' });
readyResolve?.({ status: 'running' });
await new Promise((resolve) => setImmediate(resolve));
expect(broker.status('alice', 'task-race').status === 'cancelled', 'cancel-ready-race-stays-cancelled', `actual=${broker.status('alice', 'task-race').status}`);

// Fix 2: provider stop=false — cancel must not report cancelled and must not
// flip the lease to cancelled.
stopOk = false;
await broker.submit('alice', 'task-stop-failure', { route: 'autodl' });
const stopResult = await broker.cancel('alice', 'task-stop-failure');
expect(stopResult.cancelled === false && stopResult.reason === 'provider_stop_failed', 'stop-failure-reports-honestly', JSON.stringify(stopResult));
expect(broker.status('alice', 'task-stop-failure').status !== 'cancelled', 'stop-failure-lease-not-cancelled', `actual=${broker.status('alice', 'task-stop-failure').status}`);

// Fix 2b: releaseAfterTask with failing provider stop marks release_failed, not released.
stopOk = false;
await broker.submit('defer-user', 'task-deferred-fail', { route: 'autodl' });
readyResolve?.({ status: 'running' });
await new Promise((resolve) => setImmediate(resolve));
await broker.releaseAfterTask('defer-user', 'task-deferred-fail', 1);
await new Promise((resolve) => setTimeout(resolve, 30));
expect(broker.status('defer-user', 'task-deferred-fail').status === 'release_failed', 'deferred-stop-failure-marks-release-failed', `actual=${broker.status('defer-user', 'task-deferred-fail').status}`);

// Fix 2c: releaseAfterTask with successful stop still releases.
stopOk = true;
await broker.submit('defer-user', 'task-deferred-ok', { route: 'autodl' });
readyResolve?.({ status: 'running' });
await new Promise((resolve) => setImmediate(resolve));
await broker.releaseAfterTask('defer-user', 'task-deferred-ok', 1);
await new Promise((resolve) => setTimeout(resolve, 30));
expect(broker.status('defer-user', 'task-deferred-ok').status === 'released', 'deferred-stop-ok-releases', `actual=${broker.status('defer-user', 'task-deferred-ok').status}`);

// Fix 3: same (user, task) replay rents exactly once.
const beforeReplay = rentCalls;
const first = await broker.submit('alice', 'task-replay', { route: 'autodl' });
const replay = await broker.submit('alice', 'task-replay', { route: 'autodl' });
expect(rentCalls - beforeReplay === 1, 'same-task-replay-rents-once', `replayRentCalls=${rentCalls - beforeReplay}`);
expect(replay.deduped === true && replay.leaseId === first.leaseId, 'replay-returns-same-lease', `first=${first.leaseId}, replay=${JSON.stringify(replay)}`);

// Fix 6: CONCURRENT same-task submit (Promise.all) rents exactly once —
// the placeholder lease is written synchronously before the provider call.
const concurrentBefore = rentCalls;
await Promise.all([
  broker.submit('replay-user', 'same-concurrent-task', { route: 'autodl' }),
  broker.submit('replay-user', 'same-concurrent-task', { route: 'autodl' }),
]);
expect(rentCalls - concurrentBefore === 1, 'concurrent-same-task-rents-once', `actual=${rentCalls - concurrentBefore},expected=1`);

// Fix 7: per-user cap counts provisioning occupancy (MAX_PER_USER=2 → 2 rents, 3rd rejected).
const quotaBefore = rentCalls;
const q1 = await broker.submit('quota-user', 'quota-first', { route: 'autodl' });
const q2 = await broker.submit('quota-user', 'quota-second', { route: 'autodl' });
const q3 = await broker.submit('quota-user', 'quota-third', { route: 'autodl' });
expect(rentCalls - quotaBefore === 2, 'provisioning-counts-per-user-cap-two', `actual=${rentCalls - quotaBefore},expected=2`);
expect(q3.rejected === true && q3.reason === 'per_user_limit', 'third-submit-rejected-per-user-limit', JSON.stringify(q3));

// Fix 8: official documented create shape (deployment_uuid) is preserved into the lease.
const oc = broker.status('replay-user', 'same-concurrent-task');
expect(typeof oc.deploymentId === 'string' && oc.deploymentId === `dep-${rentCalls - 2}`, 'documented-create-uuid-preserved-in-lease', `actual=${JSON.stringify(oc.deploymentId)}`);

// Fix 9: create response without any uuid → fail-closed (lease failed, capacity freed).
{
  const badRent = rentCalls + 1;
  const prevBad = process.env.NOVIX_FIXCTL_BAD_RENT;
  process.env.NOVIX_FIXCTL_BAD_RENT = String(badRent);
  let threw = false;
  try { await broker.submit('fail-user', 'fail-task', { route: 'autodl' }); } catch { threw = true; }
  if (prevBad === undefined) delete process.env.NOVIX_FIXCTL_BAD_RENT; else process.env.NOVIX_FIXCTL_BAD_RENT = prevBad;
  expect(threw, 'missing-uuid-submit-throws', `threw=${threw}`);
  expect(broker.status('fail-user', 'fail-task').status === 'failed', 'missing-uuid-lease-failed-closed', `actual=${broker.status('fail-user', 'fail-task').status}`);
}

// Fix 10: cancel AFTER releaseAfterTask is armed — the old timer must be a no-op
// (no extra provider stop, terminal 'cancelled' not overwritten to 'released').
stopOk = true;
{
  await broker.submit('timer-user', 'task-timer-cancel', { route: 'autodl' });
  await broker.releaseAfterTask('timer-user', 'task-timer-cancel', 20);
  const before = stopCalls;
  await broker.cancel('timer-user', 'task-timer-cancel');
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(stopCalls - before === 1, 'cancel-after-arm-single-stop', `extraStops=${stopCalls - before - 1},expected 0 extra (cancel's own stop only)`);
  expect(broker.status('timer-user', 'task-timer-cancel').status === 'cancelled', 'cancelled-lease-stays-cancelled-when-old-timer-fires', `actual=${broker.status('timer-user', 'task-timer-cancel').status}`);
}

// Fix 11: duplicate arm → exactly one provider stop, single release.
{
  await broker.submit('timer-user', 'task-dup-arm', { route: 'autodl' });
  readyResolve?.({ status: 'running' });
  await new Promise((resolve) => setImmediate(resolve));
  const before = stopCalls;
  await broker.releaseAfterTask('timer-user', 'task-dup-arm', 2);
  await broker.releaseAfterTask('timer-user', 'task-dup-arm', 2);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(stopCalls - before === 1, 'duplicate-timers-stop-once', `actual=${stopCalls - before},expected=1`);
  expect(broker.status('timer-user', 'task-dup-arm').status === 'released', 'duplicate-arm-releases-once', `actual=${broker.status('timer-user', 'task-dup-arm').status}`);
}

// Fix 12: cancel DURING the timer's provider await — durable re-check must keep 'cancelled'.
{
  await broker.submit('timer-user', 'task-cancel-during-await', { route: 'autodl' });
  readyResolve?.({ status: 'running' });
  await new Promise((resolve) => setImmediate(resolve));
  gateNextStop = true;
  await broker.releaseAfterTask('timer-user', 'task-cancel-during-await', 2);
  for (let i = 0; i < 50 && broker.status('timer-user', 'task-cancel-during-await').status !== 'releasing'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  expect(broker.status('timer-user', 'task-cancel-during-await').status === 'releasing', 'timer-claims-releasing-before-await', `actual=${broker.status('timer-user', 'task-cancel-during-await').status}`);
  const cancelDuring = await broker.cancel('timer-user', 'task-cancel-during-await');
  expect(cancelDuring.cancelled === true, 'cancel-during-await-accepted', JSON.stringify(cancelDuring));
  gateResolve?.(true);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(broker.status('timer-user', 'task-cancel-during-await').status === 'cancelled', 'cancel-during-await-not-overwritten', `actual=${broker.status('timer-user', 'task-cancel-during-await').status},expected=cancelled`);
}

// Fix 13: same-task NEW lease must not be released by the OLD timer.
{
  await broker.submit('timer-user', 'task-new-lease', { route: 'autodl' });
  await broker.releaseAfterTask('timer-user', 'task-new-lease', 30); // arm OLD timer on lease A
  await broker.cancel('timer-user', 'task-new-lease');
  const reborn = await broker.submit('timer-user', 'task-new-lease', { route: 'autodl' });
  expect(reborn.deduped !== true && reborn.leaseId, 'new-lease-after-cancel-gets-new-id', JSON.stringify(reborn));
  readyResolve?.({ status: 'running' });
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setTimeout(resolve, 60)); // old timer fires here — must not touch lease B
  const st = broker.status('timer-user', 'task-new-lease');
  expect(st.status === 'active' && st.id === reborn.leaseId, 'new-lease-not-released-by-old-timer', `actual=${st.status},expected=active (latest lease wins)`);
}

// Fix 14: provider binding — waitForReady/getContainerSsh receive the ACTUAL
// create-returned deployment name/uuid, not undefined (regression guard for the
// disk-only metadata write).
{
  readyNameSeen = undefined; sshIdSeen = undefined;
  const binding = await broker.submit('bind-user', 'task-binding', { route: 'autodl' });
  expect(typeof readyNameSeen === 'string' && readyNameSeen.length > 0, 'waitFor-ready-bound-to-deployment-name', `actual=${JSON.stringify(readyNameSeen)}`);
  readyResolve?.({ status: 'running' });
  await new Promise((resolve) => setImmediate(resolve));
  expect(sshIdSeen === `dep-${rentCalls}`, 'get-container-ssh-bound-to-create-uuid', `actual=${JSON.stringify(sshIdSeen)},expected=dep-${rentCalls}`);
  expect(broker.status('bind-user', 'task-binding').deploymentId === `dep-${rentCalls}`, 'binding-lease-disk-and-local-consistent', `actual=${JSON.stringify(broker.status('bind-user', 'task-binding').deploymentId)}, submit=${JSON.stringify(binding.status)}`);
}

// Fix 15: cancel during rentServer + create returns uuid + late-create stop=FALSE
// → release_failed (occupied, honest), never 'cancelled'.
{
  stopOk = false;
  gateNextRent = true;
  const pending = broker.submit('late-user', 'task-late-create', { route: 'autodl' });
  await new Promise((resolve) => setImmediate(resolve));
  const earlyCancel = await broker.cancel('late-user', 'task-late-create');
  expect(earlyCancel.cancelled === true, 'late-create-early-cancel-accepted', JSON.stringify(earlyCancel));
  rentGateResolve?.({ deployment_uuid: `dep-${rentCalls}`, deployment_name: `gpu-${rentCalls}` });
  const late = await pending;
  expect(late.status === 'release_failed', 'late-create-stop-false-reports-release-failed', `actual=${JSON.stringify(late)}`);
  expect(broker.status('late-user', 'task-late-create').status === 'release_failed', 'late-create-stop-false-disk-release-failed', `actual=${broker.status('late-user', 'task-late-create').status}`);
}

console.log(`SUMMARY fixed_head=${HEAD} source=git-show broker.js rentCalls=${rentCalls} stopCalls=${stopCalls} mode=desired-behavior`);
