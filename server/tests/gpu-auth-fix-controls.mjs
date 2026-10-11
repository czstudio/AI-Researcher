// Auth fix controls for the GPU route edge — same methodology as the seat's
// NOVIX-GPU-AUTH-ROOT-CONTROLS.mjs: execute the actual auth helper bodies sliced
// from api.mjs and the actual gpu.js route module through vm.SourceTextModule with
// DB/JWT/provider-transport mocks. No network, provider, GPU, or real DB.
//
// Covers the seat's root 4 (no-actor 401, signed member positive, anonymous
// fingerprint rent/wallet denial with zero provider calls) plus the wallet-scope
// extension: a normal registered user must NOT receive the platform wallet
// sentinel (gets existing per-user budget instead), an authorized operator
// (GPU_WALLET_OPERATOR_IDS) gets the platform balance.
//
// Run: node --experimental-vm-modules server/tests/gpu-auth-fix-controls.mjs <head>
// Pass --no-process-env to reproduce the seat's minimal context (no process global).

import { execFileSync } from 'node:child_process';
import * as vm from 'node:vm';
import * as fs from 'node:fs';

const REPO = '/Users/cz/code/novix-open';
const HEAD = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(HEAD || '')) throw new Error('40-character fixed SHA required');
const noProcessEnv = process.argv.includes('--no-process-env');

const read = (p) => execFileSync('git', ['-C', REPO, 'show', `${HEAD}:${p}`], { encoding: 'utf8' });
const api = read('server/routes/api.mjs');
const authSource = api.slice(api.indexOf('function err(code)'), api.indexOf('function planOf(user)'));
if (!authSource.includes('function actor(req, p)') || !authSource.includes('function requireUser(req, p)')) {
  throw new Error('auth helper slice not found');
}

const users = new Map([
  ['member', { id: 'member', isAnonymous: false, level: 'free', credits: 50 }],
  ['wallet-operator', { id: 'wallet-operator', isAnonymous: false, level: 'pro', credits: 500 }],
]);
const tasks = new Map([
  ['owned-task', { id: 'owned-task', chatSessionId: 'owned-session' }],
  ['foreign-task', { id: 'foreign-task', chatSessionId: 'foreign-session' }],
]);
const sessions = new Map([
  ['owned-session', { id: 'owned-session', creatorUserId: 'member', share: false }],
  ['foreign-session', { id: 'foreign-session', creatorUserId: 'other', share: false }],
]);
const calls = { rent: [], wallet: 0 };
const contextObj = {
  ERRORS: { codes: {}, httpOverrides: {} },
  U: {
    bearer: (req) => req.headers.authorization,
    verifyJwt: (token) => (token === 'signed-positive' ? { uid: 'member' }
      : token === 'signed-operator' ? { uid: 'wallet-operator' } : null),
    fail: (code) => ({ code: String(code), message: 'denied' }),
  },
  db: {
    get: (table, id) => (table === 'tasks' ? tasks : table === 'sessions' ? sessions : users).get(id),
    put: (table, id, v) => users.set(id, v),
    newUser: (spec) => ({ id: 'generated', ...spec, credits: 50 }),
  },
};
if (!noProcessEnv) contextObj.process = { env: { GPU_WALLET_OPERATOR_IDS: 'wallet-operator' } };
const context = vm.createContext(contextObj);

const auth = new vm.SourceTextModule(authSource + '\nexport {requireUser};', { context });
await auth.link(() => { throw Error('unexpected import'); });
await auth.evaluate();

const brokerValues = {
  submit: async (uid, tid, spec) => { calls.rent.push({ uid, tid, spec }); return { mock: true }; },
  cancel: async () => ({}),
  status: () => ({}),
  health: () => ({}),
  registerByoTarget: () => ({}),
  listByoTargets: () => [],
};
const autoValues = {
  getBalance: async () => { calls.wallet += 1; return { balance: 'PLATFORM-WALLET-SENTINEL' }; },
  estimateCost: () => ({}),
};
const synth = (values) => new vm.SyntheticModule(Object.keys(values), function () {
  for (const [k, v] of Object.entries(values)) this.setExport(k, v);
}, { context });
const b = synth(brokerValues), a = synth(autoValues);

const routes = new vm.SourceTextModule(read('server/routes/gpu.js'), { context });
await routes.link((s) => (s.endsWith('/broker.js') ? b : s.endsWith('/autodl.js') ? a : Promise.reject(Error(s))));
await routes.evaluate();

const handlers = new Map();
routes.namespace.registerGpuRoutes((method, path, fn) => handlers.set(`${method} ${path}`, fn), auth.namespace.requireUser);

const rows = [];
async function check(name, headers, path, body, expectCode, expectRent, expectWallet, extra) {
  calls.rent = []; calls.wallet = 0;
  const result = await handlers.get(path)({ headers }, {}, {}, body, {});
  const codeOK = Array.isArray(expectCode) ? expectCode.includes(String(result.code)) : String(result.code) === expectCode;
  let extraOK = true;
  if (extra) extraOK = extra(result);
  const pass = codeOK && extraOK && calls.rent.length === expectRent && calls.wallet === expectWallet;
  rows.push({ name, pass, expected: { code: expectCode, rent: expectRent, wallet: expectWallet }, actual: { code: String(result.code), rent: calls.rent.length, wallet: calls.wallet }, mockOnly: true });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}: code=${result.code} rent=${calls.rent.length} wallet=${calls.wallet}${extraOK ? '' : ' (extra predicate failed)'}`);
  return result;
}

// Root 4 (seat semantics) + task-scope rent binding.
await check('no-actor-rent-denied', {}, 'POST /gpu/rent', { taskId: 'test' }, '401', 0, 0);
await check('signed-member-rent-route-positive', { authorization: 'signed-positive' }, 'POST /gpu/rent', { taskId: 'owned-task' }, '0', 1, 0);
await check('anonymous-fingerprint-rent-must-deny', { fingerprint: 'root-fp-negative' }, 'POST /gpu/rent', { taskId: 'arbitrary-unbound-task' }, ['401', '403'], 0, 0);
await check('anonymous-fingerprint-wallet-must-deny', { fingerprint: 'root-fp-negative' }, 'GET /gpu/balance', {}, ['401', '403'], 0, 0);
await check('registered-user-foreign-task-rent-must-deny', { authorization: 'signed-positive' }, 'POST /gpu/rent', { taskId: 'foreign-task' }, ['401', '403', '404', '5001', '5200'], 0, 0);
await check('registered-user-missing-task-rent-must-deny', { authorization: 'signed-positive' }, 'POST /gpu/rent', { taskId: 'missing-task' }, ['401', '403', '404', '5001', '5200'], 0, 0);

// Wallet scope: normal registered user gets own budget, platform wallet untouched.
const userScope = await check('normal-user-wallet-scoped-to-own-budget', { authorization: 'signed-positive' }, 'GET /gpu/balance', {}, '0', 0, 0,
  (r) => r?.result?.scope === 'user' && r.result.userId === 'member' && r.result.credits === 50 && !JSON.stringify(r).includes('PLATFORM-WALLET-SENTINEL'));
console.log(`  normal-user wallet payload: ${JSON.stringify(userScope.result)}`);

// Authorized operator positive: platform balance allowed only via allowlist.
// In a context WITHOUT a process global (seat-minimal), no allowlist can be
// configured, so the fail-closed direction applies: even a registered user
// must not reach the platform wallet.
if (noProcessEnv) {
  await check('operator-without-env-fails-closed-to-user-scope', { authorization: 'signed-operator' }, 'GET /gpu/balance', {}, '0', 0, 0,
    (r) => r?.result?.scope === 'user' && !JSON.stringify(r).includes('PLATFORM-WALLET-SENTINEL'));
} else {
  await check('authorized-operator-reads-platform-wallet', { authorization: 'signed-operator' }, 'GET /gpu/balance', {}, '0', 0, 1,
    (r) => r?.result?.scope === 'platform' && JSON.stringify(r.result.balance).includes('PLATFORM-WALLET-SENTINEL'));
}

// Anonymous also denied on BYO register (same boundary, provider untouched).
await check('anonymous-byo-register-denied', { fingerprint: 'root-fp-negative' }, 'POST /gpu/byo/register', { host: 'h', port: 22 }, ['401', '403'], 0, 0);

const summary = { sha: HEAD, contextProcessGlobal: !noProcessEnv, sourceExecution: 'unmodified actual auth bodies (api.mjs slice) + actual gpu.js route module; DB/JWT/provider transport mocked', rows, realProviderCalls: 0 };
fs.writeFileSync('/tmp/novix-gpu-auth-fix-controls.json', JSON.stringify(summary, null, 2));
process.exitCode = rows.some((r) => !r.pass) ? 1 : 0;
console.log(`SUMMARY fixed_head=${HEAD} mode=auth-boundary rows=${rows.length} pass=${rows.filter(r => r.pass).length}`);
