// Real-HTTP dispatch regression for the GPU scope boundary (seat contract:
// "a real handleApi invocation regression rather than another fifth-arg VM-only test").
//
// Boots the actual server (serve.mjs) with a fully isolated data dir and a DEAD
// loopback provider host (AUTODL_API_HOST=127.0.0.1:9 → ECONNREFUSED, zero
// external network, zero provider launches), then drives real handleApi dispatch:
//   - no-actor rent → 401; anonymous fingerprint rent → 403
//   - owned-task rent → passes the scope gate and REACHES the broker (lease file
//     written); final 5000 comes from the unreachable provider transport only
//   - foreign / missing / shared-session task rent → 5200 with ZERO broker writes
//   - wallet scope over HTTP: registered user gets own budget, anonymous → 403
//
// Run: node server/tests/gpu-http-dispatch-controls.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const REPO = path.resolve(new URL('..', import.meta.url).pathname, '..');
const PORT = 6199 + Math.floor(Math.random() * 500);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'novix-http-data-'));
const BROKER = fs.mkdtempSync(path.join(os.tmpdir(), 'novix-http-gpu-'));
const BASE = `http://127.0.0.1:${PORT}`;
let server;

const rows = [];
function expect(cond, name, detail) {
  rows.push({ name, pass: !!cond, detail: String(detail) });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name} :: ${detail}`);
  if (!cond) process.exitCode = 1;
}

async function api(method, apiPath, { token, fingerprint, body } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (fingerprint) headers.fingerprint = fingerprint;
  const res = await fetch(BASE + '/api' + apiPath, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text };
}

const leaseFiles = () => fs.readdirSync(BROKER).filter((f) => f.endsWith('.json') && f !== 'byo-targets.json').length;

async function main() {
  server = spawn('node', ['server/serve.mjs'], {
    cwd: REPO,
    env: {
      ...process.env,
      PORT_SITE: String(PORT),
      NOVIX_DATA_DIR: DATA,
      GPU_BROKER_DIR: BROKER,
      AUTODL_API_HOST: '127.0.0.1:9', // dead loopback: provider transport fails fast, no external calls
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try { const h = await api('GET', '/site-config/public'); up = h.json?.code === '0'; } catch { /* retry */ }
  }
  if (!up) throw new Error('server did not become healthy');
  expect(true, 'fresh-server-health', `port=${PORT}`);

  // fixtures: two registered users, one owned task each, one shared session
  const suffix = Date.now();
  const owner = (await api('POST', '/user/emailSignUp', { body: { email: `owner-${suffix}@t.test`, password: 'pw-123456' } })).json.result;
  const other = (await api('POST', '/user/emailSignUp', { body: { email: `other-${suffix}@t.test`, password: 'pw-123456' } })).json.result;
  expect(!!owner?.token && !!other?.token, 'two-registered-users', 'emailSignUp tokens issued');

  const sidOwner = (await api('POST', '/chat_session/create', { token: owner.token, body: { query: 'owner task' } })).json.result.id;
  const ownedTask = (await api('POST', '/task/create_task', { token: owner.token, body: { chatSessionId: sidOwner, queryContent: 'owner task', mode: 'auto' } })).json.result;
  const sidOther = (await api('POST', '/chat_session/create', { token: other.token, body: { query: 'other task' } })).json.result.id;
  const foreignTask = (await api('POST', '/task/create_task', { token: other.token, body: { chatSessionId: sidOther, queryContent: 'other task', mode: 'auto' } })).json.result;
  await api('POST', '/chat_session/share', { token: other.token, body: { chatSessionId: sidOther } });
  expect(!!ownedTask?.id && !!foreignTask?.id, 'fixtures-created', `owned=${ownedTask?.id}, foreign=${foreignTask?.id}`);

  // 1. no actor → 401
  const noActor = await api('POST', '/gpu/rent', { body: { taskId: ownedTask.id } });
  expect(String(noActor.json?.code) === '401', 'http-no-actor-rent-401', `code=${noActor.json?.code}`);

  // 2. anonymous fingerprint → 403
  const anon = await api('POST', '/gpu/rent', { fingerprint: `anon-${suffix}`, body: { taskId: ownedTask.id } });
  expect(String(anon.json?.code) === '403', 'http-anonymous-rent-403', `code=${anon.json?.code}`);

  // 3. owned task → scope gate passes, broker reached (lease written); 5000 only from dead provider transport
  const leasesBeforeOwned = leaseFiles();
  const owned = await api('POST', '/gpu/rent', { token: owner.token, body: { taskId: ownedTask.id } });
  expect(!['401', '403', '5001', '5200'].includes(String(owned.json?.code)) && leaseFiles() > leasesBeforeOwned,
    'http-owned-rent-passes-scope-gate-reaches-broker', `code=${owned.json?.code}, leases+${leaseFiles() - leasesBeforeOwned} (5000=dead loopback provider transport only)`);

  // 4/5/6. foreign / missing / shared-session task → 5200 with zero broker writes
  const beforeNeg = leaseFiles();
  const foreign = await api('POST', '/gpu/rent', { token: owner.token, body: { taskId: foreignTask.id } });
  expect(String(foreign.json?.code) === '5200', 'http-foreign-task-rent-5200', `code=${foreign.json?.code}`);
  const missing = await api('POST', '/gpu/rent', { token: owner.token, body: { taskId: 'missing-task-xyz' } });
  expect(String(missing.json?.code) === '5200', 'http-missing-task-rent-5200', `code=${missing.json?.code}`);
  const shared = await api('POST', '/gpu/rent', { token: owner.token, body: { taskId: foreignTask.id } });
  expect(String(shared.json?.code) === '5200', 'http-shared-session-task-still-5200', `code=${shared.json?.code}`);
  expect(leaseFiles() === beforeNeg, 'http-negatives-zero-broker-writes', `delta=${leaseFiles() - beforeNeg}`);

  // 7/8. wallet scope over HTTP
  const bal = await api('GET', '/gpu/balance', { token: owner.token });
  expect(String(bal.json?.code) === '0' && bal.json?.result?.scope === 'user' && !JSON.stringify(bal.json).includes('PLATFORM-WALLET-SENTINEL'),
    'http-registered-wallet-scoped-to-user', `scope=${bal.json?.result?.scope}`);
  const balAnon = await api('GET', '/gpu/balance', { fingerprint: `anon-${suffix}` });
  expect(String(balAnon.json?.code) === '403', 'http-anonymous-balance-403', `code=${balAnon.json?.code}`);
}

main().catch((e) => { console.error('HARNESS ERROR', e); process.exitCode = 1; }).finally(() => {
  try { server?.kill('SIGTERM'); } catch { /* already gone */ }
  setTimeout(() => {
    try { fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(BROKER, { recursive: true, force: true }); } catch { /* temp */ }
    const pass = rows.filter((r) => r.pass).length;
    console.log(`SUMMARY http_dispatch rows=${rows.length} pass=${pass} provider_network_calls=0 (dead loopback transport)`);
    process.exit(process.exitCode || 0);
  }, 300);
});
