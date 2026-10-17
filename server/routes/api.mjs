// REST surface. Every route listed in contracts/api.json is implemented.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as db from '../store/db.mjs';
import * as U from '../lib/util.mjs';
import { subscribe, publish } from '../lib/hub.mjs';
import { runTask } from '../lib/executor.mjs';
import { searchAll } from '../lib/literature.mjs';
import { llmConfigured } from '../lib/llm.mjs';
import { registerGpuRoutes } from './gpu.js';
import { registerAutoresearchRoutes } from './autoresearch-lab.mjs';
import { registerTeamRoutes } from './team-sprint.mjs';
import { registerSandboxRoutes } from '../lib/sandbox-router.mjs';
import { workspaceTree, homeFiles, copyDir, previewTypeOf, normRel, parseTargets, workspaceNode } from '../lib/workspace.mjs';
import { dateTime, onboardingOf, saveOnboarding, ensureDefaultNotifications, notificationRecord, billingRows, addBillingStatement, planForLevelOrSku, applyUpgrade, verifyInternalSignature } from '../lib/parity.mjs';

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

function isOwner(session, a) {
  return Boolean(session && a && a.user && String(session.creatorUserId) === String(a.user.id));
}

function assertOwner(session, a, code = 5200) {
  if (isOwner(session, a)) return null;
  return err(code);
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
registerAutoresearchRoutes(route, { requireUser });
registerTeamRoutes(route, { requireUser });
registerSandboxRoutes(route, { requireUser, ok: U.ok, fail: U.fail, rootDir: path.join(process.env.NOVIX_DATA_DIR ? path.resolve(process.env.NOVIX_DATA_DIR) : path.resolve(process.cwd(), 'data'), 'sandboxes') });

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

route('POST', '/login', (req, res, p) => routes.get('POST /user/login')(req, res, p));

route('POST', '/user/emailSignUp', async (req, res, p) => {
  const email = p.email;
  if (!email || !p.password) return err(5000);
  if (db.all('users').some((u) => u.email === email)) return err(5000);
  const user = db.newUser({ email, passwordHash: U.hashPassword(p.password), name: p.name || null });
  db.appendLedger({ userId: user.id, kind: 'signup_bonus', delta: 0, balance: user.credits });
  return U.ok({ token: U.signJwt({ uid: user.id, level: user.level }), user: publicUser(user) });
});

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, level: u.level, credits: u.credits, subscriptionStatus: u.subscriptionStatus, subscriptionProvider: u.subscriptionProvider || null, sku: u.sku || null, entitlementEndsAt: u.entitlementEndsAt || null, avatarInitial: u.avatarInitial, isAnonymous: Boolean(u.isAnonymous) };
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
  const used = Math.max(0, Number(plan.monthlyCredits || 0) - Number(a.user.credits || 0));
  const resetDate = a.user.entitlementEndsAt || (U.nowMs() + 30 * 24 * 3600 * 1000);
  return U.ok({ userId: a.user.id, userLevel: a.user.level, sku: a.user.sku || 'FREE_MONTHLY', totalCredit: plan.monthlyCredits, usedCredit: used, remainingCredit: a.user.credits, inviteList: null, resetDate, userLevelSouce: null, subscriptionStatus: a.user.subscriptionStatus || 'free', subscriptionProvider: a.user.subscriptionProvider || null, entitlementEndsAt: resetDate, onboardingState: onboardingOf(a.user), credits: a.user.credits, level: a.user.level, monthlyCredits: plan.monthlyCredits, nextMonthCredit: plan.monthlyCredits });
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
  const dir = db.userWorkspaceDir(a.user.id);
  return U.ok({ path: dir, root: dir, workspaceTreeJson: JSON.stringify(workspaceTree(dir, 'home-' + a.user.id, [['', 3]])) });
});

route('POST', '/home/novix/workspace', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const dir = db.userWorkspaceDir(a.user.id);
  const tree = workspaceTree(dir, 'home-' + a.user.id, p.targets || [['', 3]], p.path || '');
  return U.ok({ root: dir, workspaceTreeJson: JSON.stringify(tree), tree, files: homeFiles(dir, 'home-' + a.user.id) });
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

route('GET', '/account/info', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const plan = planOf(a.user);
  return U.ok({ user: publicUser(a.user), plan, subscription: { status: a.user.subscriptionStatus || 'free', provider: a.user.subscriptionProvider || null, sku: a.user.sku || null, entitlementEndsAt: a.user.entitlementEndsAt || null }, onboardingState: onboardingOf(a.user), credit: { remaining: a.user.credits, total: plan.monthlyCredits } });
});

route('POST', '/account/upgrade', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const idempotencyKey = req.headers['idempotency-key'] || body.idempotencyKey || p.idempotencyKey || null;
  const up = applyUpgrade(a.user, { level: body.level || p.level, sku: body.sku || p.sku, provider: body.provider || p.provider, idempotencyKey }, MODES.plans);
  db.pushNotification(a.user.id, { type: 'BILLING', name: 'Subscription updated', title: 'Subscription updated', body: 'Your plan is now ' + up.plan.label + '.', content: 'Your plan is now ' + up.plan.label + '.' });
  return U.ok({ user: publicUser(a.user), plan: up.plan, level: up.plan.level, credits: a.user.credits, subscriptionStatus: a.user.subscriptionStatus, statement: up.statement, idempotent: up.idempotent });
});

route('POST', '/user/ackOnboardingMilestone', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const patch = {};
  const milestone = String(body.milestone || p.milestone || '').toLowerCase();
  if (milestone.includes('first') || body.firstTaskAcked === true || p.firstTaskAcked === true || p.firstTaskAcked === 'true') patch.firstTaskAcked = true;
  if (milestone.includes('third') || body.thirdTaskAcked === true || p.thirdTaskAcked === true || p.thirdTaskAcked === 'true') patch.thirdTaskAcked = true;
  if (body.activePromoCode != null) patch.activePromoCode = body.activePromoCode;
  if (body.discountPercent != null) patch.discountPercent = Number(body.discountPercent);
  if (Object.keys(patch).length === 0) patch[milestone || 'firstTaskAcked'] = true;
  return U.ok(saveOnboarding(a.user, patch));
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
    .filter((t) => { const ss = db.get('sessions', t.chatSessionId); return ss && String(ss.creatorUserId) === String(a.user.id); })
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
  const a = actor(req, p);
  const { session, denied } = sessionOrShared(p.chatSessionId);
  if (denied) return denied;
  const gate = assertReadable(session, a);
  if (gate) return gate;
  return U.ok({ id: session.id, status: 'idle', storageTier: session.storageTier, share: session.share });
});

route('POST', '/chat_session/share', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const { session, denied } = sessionOrShared(body.chatSessionId || p.chatSessionId);
  if (denied) return denied;
  const gate = assertOwner(session, a);
  if (gate) return gate;
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
  const fp = req.headers.fingerprint || p.fingerprint || body.fingerprint;
  const fpUid = fp ? 'fp-' + String(fp).slice(0, 24) : null;
  const sameAnonymousOwner = String(session.creatorUserId) === String(a.user.id) || (fpUid && String(session.creatorUserId) === fpUid);
  if (session.isAnonymous !== true && isOwner(session, a) === false) return err(5200);
  if (session.isAnonymous === true && sameAnonymousOwner === false) return err(5200);
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
  const gate = assertOwner(session, a);
  if (gate) return gate;
  session.title = body.title || p.title || session.title;
  db.put('sessions', session.id, session);
  return U.ok(session);
});

route('POST', '/chat_session/delete', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const sid = body.chatSessionId || p.chatSessionId;
  const { session, denied } = sessionOrShared(sid);
  if (denied) return denied;
  const gate = assertOwner(session, a);
  if (gate) return gate;
  db.del('sessions', sid);
  return U.ok({ deleted: true });
});

route('GET', '/chat_session/workspace', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const { session, denied } = sessionOrShared(p.chatSessionId);
  if (denied) return denied;
  const gate = assertOwner(session, a);
  if (gate) return gate;
  const dir = db.workspaceDir(session.id);
  const node = workspaceTree(dir, session.id, p.targets || [['', 6]], p.path || '');
  return U.ok({ root: dir, tree: node, workspaceTreeJson: JSON.stringify(node) });
});

route('POST', '/chat_session/workspace/subtree', async (req, res, p, body) => {
  const a = actor(req, p);
  const { session, denied } = sessionOrShared(body.chatSessionId || p.chatSessionId);
  if (denied) return denied;
  const gate = assertReadable(session, a);
  if (gate) return gate;
  const dir = db.workspaceDir(session.id);
  const targets = body.targets || p.targets || (body.path || p.path ? [[body.path || p.path, 3]] : [['', 3]]);
  const node = workspaceTree(dir, session.id, targets, body.path || p.path || '');
  return U.ok({ workspaceTreeJson: JSON.stringify(node) });
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
  const { session, denied } = sessionOrShared(p.chatSessionId);
  if (denied) return denied;
  const gate = assertOwner(session, a);
  if (gate) return gate;
  const dir = db.workspaceDir(session.id);
  return U.ok(homeFiles(dir, session.id));
});

route('POST', '/chat_session/workspace/home_file_preview', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const sid = body.chatSessionId || p.chatSessionId;
  const { session, denied } = sessionOrShared(sid);
  if (denied) return denied;
  const gate = assertOwner(session, a);
  if (gate) return gate;
  const dir = db.workspaceDir(session.id);
  const abs = U.safeJoin(dir, body.path || p.path || '');
  if (abs == null || fs.existsSync(abs) === false || fs.statSync(abs).isFile() === false) return err(5001);
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
  const sid = body.chatSessionId || p.chatSessionId;
  const { session, denied } = sessionOrShared(sid);
  if (denied) return denied;
  const gate = assertOwner(session, a);
  if (gate) return gate;
  const dir = db.workspaceDir(session.id);
  const abs = U.safeJoin(dir, 'user_data/' + (body.path || p.path || ''));
  if (abs && fs.existsSync(abs)) fs.rmSync(abs, { force: true });
  return U.ok({ deleted: true });
});

route('POST', '/chat_session/workspace/user_workspace/subtree', async (req, res, p, body) => {
  const a = actor(req, p);
  const { session, denied } = sessionOrShared(body.chatSessionId || p.chatSessionId);
  if (denied) return denied;
  const gate = assertOwner(session, a);
  if (gate) return gate;
  const dir = db.workspaceDir(session.id);
  const node = workspaceNode(dir, 'user_data', session.id, 6) || workspaceTree(dir, session.id, [['', 3]]);
  return U.ok({ workspaceTreeJson: JSON.stringify(node) });
});

// ---- tasks ----
async function createTask(req, res, p, body, { anonymous, userOverride = null } = {}) {
  const a = userOverride ? { user: userOverride, anon: false } : (anonymous ? actor(req, p) : requireUser(req, p));
  if (a.denied) return a.denied;
  if (anonymous && a.user == null) a.user = db.newUser({ level: 'free', isAnonymous: true });

  const queryContent = body.queryContent ?? body.query;
  if (queryContent == null || String(queryContent).trim() === '') return err(4000);

  const enableBrainstorming = body.enableBrainstorming === true || body.enableBrainstorming === 'true';
  const fileIds = Array.isArray(body.fileIds) ? body.fileIds.map(String) : [];
  const tempUrl = body.tempUrl ?? null;

  let sessionId = body.chatSessionId || null;
  let session;
  if (sessionId) {
    const r = sessionOrShared(sessionId);
    if (r.denied) return r.denied;
    session = r.session;
    if (String(session.creatorUserId) === String(a.user.id)) {} else return err(5200);
  } else {
    session = db.newSession({ userId: a.user.id, isAnonymous: anonymous || a.anon === true });
  }

  const plan = planOf(a.user);
  const modeKey = body.mode || p.mode || 'auto';
  const modeDef = modeByKey(modeKey);
  const agentName = body.agentName ?? modeDef?.agentName ?? '';

  if (['autoexperiment', 'notebook'].includes(modeKey) && plan.codeAgentAllowed === false) return err(5019);
  const cost = modeDef?.creditCost || 1;
  if ((a.user.credits ?? 0) < cost && anonymous === false) return err(5016);

  if (anonymous === false) {
    a.user.credits = Math.max(0, (a.user.credits ?? 0) - cost);
    db.put('users', a.user.id, a.user);
    db.appendLedger({ userId: a.user.id, kind: 'task', delta: -cost, balance: a.user.credits, mode: modeKey });
  }

  for (const fileId of fileIds) {
    const file = db.get('files', fileId);
    if (file && file.owner && String(file.owner) === String(a.user.id)) {}
    else if (file && file.owner) return err(5200);
  }

  const enableGpu = body.enableGpu === true || body.enableGpu === 'true';
  const task = db.newTask({ sessionId: session.id, agentName, query: body.query || queryContent, queryContent, mode: modeKey, createdBy: a.user.id });
  task.enableGpu = fileIds.length ? false : enableGpu;
  task.enableBrainstorming = enableBrainstorming;
  task.questionMode = body.questionMode || (enableBrainstorming ? 'discuss' : 'task');
  task.modelOverride = body.modelOverride || (enableBrainstorming ? MODES.discussModelOverride : MODES.defaultModel);
  task.controls = body.controls || [];
  task.fileIds = fileIds;
  task.tempUrl = tempUrl;
  if (body.writeUpType) task.writeUpType = body.writeUpType;
  session.enableGpu = task.enableGpu;
  session.updatedAt = U.nowMs();
  if (session.title == null || session.title === '') session.title = String(queryContent).slice(0, 60);
  db.put('sessions', session.id, session);
  db.put('tasks', task.id, task);

  setImmediate(() => runTask({ task, session, modeDef, body: { ...body, controls: task.controls, modelOverride: task.modelOverride, queryContent } }));
  return U.ok({ ...task, chatSessionId: session.id });
}

route('POST', '/task/create_task', (req, res, p, body) => createTask(req, res, p, body, { anonymous: false }));
route('POST', '/task/create_anonymous_task', (req, res, p, body) => createTask(req, res, p, body, { anonymous: true }));

route('POST', '/task/create_internal_task_with_signature', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  if (verifyInternalSignature(req, body) === false) return err(403);
  let target = a.user;
  if (body.userId) {
    const found = db.get('users', String(body.userId));
    if (found == null) return err(401);
    target = found;
  }
  const payload = { ...body, chatSessionId: body.chatSessionId || p.chatSessionId || null };
  return createTask(req, res, p, payload, { anonymous: false, userOverride: target });
});

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
  if (body.taskId) {
    const t = db.get('tasks', String(body.taskId));
    if (t == null) return err(5001);
    const own = db.get('sessions', t.chatSessionId);
    if (own == null || String(own.creatorUserId) !== String(a.user.id)) return err(5100);
  }
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
  const sid = body.chatSessionId || p.chatSessionId || null;
  if (sid) {
    const { session, denied } = sessionOrShared(sid);
    if (denied) return denied;
    const gate = assertOwner(session, a);
    if (gate) return gate;
  }
  const names = Array.isArray(body.files) ? body.files : (Array.isArray(body.names) ? body.names : []);
  const items = names.map((n) => {
    const fileId = U.id(16);
    db.put('files', fileId, { id: fileId, name: n, owner: a.user.id, chatSessionId: sid, createdAt: U.nowMs() });
    return { fileId, name: n, tempUrl: '/api/file/upload_stream?fileId=' + fileId + (sid ? '&chatSessionId=' + encodeURIComponent(sid) : '') };
  });
  return U.ok({ items });
});

route('POST', '/file/upload_stream', async (req, res, p, body) => {
  const a = actor(req, p);
  if (a.user == null) return err(401);
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
  // 上传名加固：反斜杠归一后取 basename；服务端可执行/危险扩展拒收
  // （strix 2026-10-12 发现：无白名单校验，.php/.sh/.htaccess 原样入库）
  name = path.basename(String(name).replace(/\\/g, '/')) || 'upload.bin';
  if (/\.(php\d*|phtml|jsp|jspx|asp|aspx|exe|dll|so|bat|cmd|ps1|htaccess|cgi|pl|sh)$/i.test(name)) {
    return err(5001);
  }
  const existing = fileId ? db.get('files', fileId) : null;
  if (existing && existing.owner && String(existing.owner) === String(a.user.id)) {} else if (existing && existing.owner) return err(5200);
  const sessionId = p.chatSessionId || body.chatSessionId || existing?.chatSessionId || null;
  if (sessionId) {
    const { session, denied } = sessionOrShared(sessionId);
    if (denied) return denied;
    const gate = assertOwner(session, a);
    if (gate) return gate;
  }
  const dir = sessionId ? db.workspaceDir(sessionId) : db.userUploadDir(a.user.id);
  const target = U.safeJoin(dir, `user_data/${path.basename(name)}`);
  if (!target) return err(5000);
  U.ensureDir(path.dirname(target));
  fs.writeFileSync(target, data);
  db.put('files', fileId, { id: fileId, name, size: data.length, path: target, owner: a.user.id, chatSessionId: sessionId, fileKey: sessionId ? 'nova_agent_v1/user_data/session_' + sessionId + '/workspace/user_data/' + path.basename(name) : null, createdAt: U.nowMs() });
  return U.ok({ fileId, name, size: data.length, path: `user_data/${path.basename(name)}` });
});

route('POST', '/file/upload_complete', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const ids = body.fileIds || [p.fileId].filter(Boolean);
  for (const fid of ids) {
    const f = db.get('files', String(fid));
    if (f && f.owner && String(f.owner) === String(a.user.id)) {} else if (f && f.owner) return err(5200);
  }
  return U.ok({ fileIds: ids, completed: true });
});

route('GET', '/file/temp_url', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  if (p.fileId) {
    const f = db.get('files', String(p.fileId));
    if (f && f.owner && String(f.owner) === String(a.user.id)) {} else if (f && f.owner) return err(5200);
  }
  return U.ok({ tempUrl: '/api/file/upload_stream?fileId=' + (p.fileId || U.id(16)) });
});

route('GET', '/file/download', async (req, res, p) => {
  const a = actor(req, p);
  const key = p.fileKey || '';
  const wsMatch = /^nova_agent_v1\/user_data\/session_([^/]+)\/workspace\/?(.*)$/.exec(key);
  if (wsMatch) {
    const sid = wsMatch[1];
    const { session, denied } = sessionOrShared(sid);
    if (denied) return denied;
    const sigOk = U.verifyJwt(p.signature || '')?.dl === sid;
    const gate = session.share || sigOk ? null : assertReadable(session, a);
    if (gate) return gate;
    const abs = U.safeJoin(db.workspaceDir(sid), wsMatch[2] || '.');
    if (abs == null || fs.existsSync(abs) === false || fs.statSync(abs).isFile() === false) return err(5001);
    return { __streamFile: abs, name: path.basename(abs), inline: p.isDownload !== 'true' };
  }
  if (key.startsWith('workspace/')) {
    const sid = key.split('/')[1];
    const { session, denied } = sessionOrShared(sid);
    if (denied) return denied;
    const sigOk = U.verifyJwt(p.signature || '')?.dl === sid;
    const gate = session.share || sigOk ? null : assertReadable(session, a);
    if (gate) return gate;
    return { __streamZip: db.workspaceDir(sid), name: 'workspace-' + sid + '.zip' };
  }
  const f = db.get('files', key);
  if (f == null || f.path == null) return err(5001);
  if (f.owner && String(f.owner) === String(a.user?.id)) {}
  else if (f.chatSessionId) {
    const { session } = sessionOrShared(f.chatSessionId);
    if (session == null || session.share !== true) return err(5200);
  } else return err(5200);
  return { __streamFile: f.path, name: f.name, inline: p.isDownload !== 'true' };
});

route('GET', '/oss/getSTSToken', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const expiration = U.nowMs() + 3600_000;
  const credentials = { accessKeyId: null, accessKeySecret: null, securityToken: null, expiration };
  return U.ok({ provider: 'local', bucket: 'novix-open-local', region: 'local', endpoint: '/api/file', credentials, accessKeyId: null, accessKeySecret: null, securityToken: null, expiration, uploadUrl: '/api/file/upload_stream', putUrl: '/api/file/putToGcs' });
});

route('POST', '/file/putToGcs', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const sid = body.chatSessionId || p.chatSessionId || null;
  if (sid) {
    const { session, denied } = sessionOrShared(sid);
    if (denied) return denied;
    const gate = assertOwner(session, a);
    if (gate) return gate;
  }
  const rawName = body.fileName || body.name || body.path || 'upload.bin';
  const name = path.basename(String(rawName).replace(/\\/g, '/'));
  if (/\.(php\d*|phtml|jsp|jspx|asp|aspx|exe|dll|so|bat|cmd|ps1|htaccess|cgi|pl|sh)$/i.test(name)) return err(5001);
  let data = Buffer.alloc(0);
  const content = body.contentBase64 || body.base64 || body.content || '';
  if (typeof content === 'string' && content.startsWith('data:')) {
    const idx = content.indexOf(',');
    data = Buffer.from(idx >= 0 ? content.slice(idx + 1) : '', 'base64');
  } else if (body.encoding === 'base64' || body.contentBase64 || body.base64) {
    data = Buffer.from(String(content), 'base64');
  } else {
    data = Buffer.from(String(content), 'utf8');
  }
  const dir = sid ? db.workspaceDir(sid) : db.userUploadDir(a.user.id);
  const target = U.safeJoin(dir, 'user_data/' + name);
  if (target == null) return err(5000);
  U.ensureDir(path.dirname(target));
  fs.writeFileSync(target, data);
  const fileId = body.fileId || U.id(16);
  db.put('files', fileId, { id: fileId, name, size: data.length, path: target, owner: a.user.id, chatSessionId: sid, fileKey: sid ? 'nova_agent_v1/user_data/session_' + sid + '/workspace/user_data/' + name : null, createdAt: U.nowMs() });
  return U.ok({ fileId, name, size: data.length, path: 'user_data/' + name, fileKey: sid ? 'nova_agent_v1/user_data/session_' + sid + '/workspace/user_data/' + name : null, gcsUri: 'local://novix-open/' + a.user.id + '/' + name });
});

// ---- published ----
function publishedRevision(revisionId) {
  const rec = db.get('revisions', String(revisionId));
  if (rec) return rec;
  const s = db.all('sessions').find((x) => x.revisionId === revisionId);
  if (s == null) return null;
  return { id: revisionId, sessionId: s.id, ownerUserId: s.creatorUserId, status: 'ready', revisionNo: 1 };
}

route('POST', '/published/item/publish', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const { session, denied } = sessionOrShared(body.chatSessionId || p.chatSessionId);
  if (denied) return denied;
  const gate = assertOwner(session, a);
  if (gate) return gate;
  const prior = db.all('revisions').filter((r) => String(r.sessionId) === String(session.id));
  const revisionNo = prior.reduce((m, r) => Math.max(m, Number(r.revisionNo || 0)), 0) + 1;
  const revisionId = U.id(16);
  const snap = db.revisionDir(revisionId);
  copyDir(db.workspaceDir(session.id), snap);
  const revision = {
    id: revisionId, publishedItemId: revisionId, sessionId: session.id,
    ownerUserId: String(a.user.id), revisionNo, status: 'ready', title: session.title || 'Untitled session',
    mode: session.mode || 'auto', summary: (lastMessageOf(session.id)?.result || '').slice(0, 240),
    publishedAt: U.nowMs(), workspaceDir: snap,
  };
  db.put('revisions', revisionId, revision);
  session.share = true;
  session.revisionId = revisionId;
  session.latestRevisionId = revisionId;
  db.put('sessions', session.id, session);
  db.put('gallery', revisionId, { id: revisionId, mode: revision.mode, title: revision.title, summary: revision.summary, sessionId: session.id, revisionId });
  return U.ok({ revisionId, publishedItemId: revisionId, revisionNo, url: '/published/revision/' + revisionId });
});

route('POST', '/published/item/withdraw', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const { session, denied } = sessionOrShared(body.chatSessionId || p.chatSessionId);
  if (denied) return denied;
  const gate = assertOwner(session, a);
  if (gate) return gate;
  let rec = db.get('revisions', String(session.latestRevisionId || session.revisionId || ''));
  if (rec == null) rec = db.all('revisions').filter((r) => String(r.sessionId) === String(session.id)).sort((x, y) => y.publishedAt - x.publishedAt)[0] || null;
  if (rec) {
    rec.status = 'withdrawn';
    rec.withdrawnAt = U.nowMs();
    db.put('revisions', rec.id, rec);
    db.del('gallery', rec.id);
  }
  session.share = false;
  session.withdrawnAt = U.nowMs();
  db.put('sessions', session.id, session);
  return U.ok({ withdrawn: true, chatSessionId: session.id, revisionId: rec?.id || null });
});

route('GET', '/published/item/publish/access', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  return U.ok({ canPublish: true, message: 'OK', reason: null });
});

function revisionSession(revisionId) {
  const rec = publishedRevision(revisionId);
  if (rec == null) return null;
  return db.get('sessions', rec.sessionId) || null;
}

route('GET', '/published/revision/:id/session', async (req, res, p) => {
  const rec = publishedRevision(p.id);
  if (rec == null || rec.status !== 'ready') return err(5001);
  const s = db.get('sessions', rec.sessionId);
  if (s == null) return err(5001);
  return U.ok({ chatSession: { ...s, revisionId: rec.id, revisionNo: rec.revisionNo }, chatSessionMessages: messagesOf(s.id), revision: rec });
});

route('GET', '/published/revision/:id/task', async (req, res, p) => {
  const rec = publishedRevision(p.id);
  if (rec == null || rec.status !== 'ready') return err(5001);
  const task = db.get('tasks', p.taskId);
  if (task == null || task.chatSessionId !== rec.sessionId) return err(5001);
  return U.ok(task);
});

async function publishedSubtree(req, res, p, body) {
  const rec = publishedRevision(p.id);
  if (rec == null || rec.status !== 'ready') return err(5001);
  const root = rec.workspaceDir && fs.existsSync(rec.workspaceDir) ? rec.workspaceDir : db.workspaceDir(rec.sessionId);
  const targets = body.targets || p.targets || (body.path || p.path ? [[body.path || p.path, 3]] : [['', 3]]);
  const node = workspaceTree(root, rec.sessionId, targets, body.path || p.path || '');
  return U.ok({ workspaceTreeJson: JSON.stringify(node) });
}

route('POST', '/published/revision/:id/workspace/subtree', publishedSubtree);
route('GET', '/published/revision/:id/workspace/subtree', publishedSubtree);

route('POST', '/published/revision/:id/fork', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const rec = publishedRevision(p.id);
  if (rec == null || rec.status !== 'ready') return err(5001);
  const src = db.get('sessions', rec.sessionId);
  if (src == null) return err(5001);
  const child = db.newSession({ userId: a.user.id, title: 'Fork of ' + (rec.title || src.title || 'published revision') });
  child.forkedFromRevisionId = rec.id;
  child.forkedFromSessionId = src.id;
  child.forkLineage = Array.isArray(src.forkLineage) ? src.forkLineage.concat(rec.id) : [rec.id];
  child.share = false;
  child.mode = src.mode || 'auto';
  db.put('sessions', child.id, child);
  const srcRoot = rec.workspaceDir && fs.existsSync(rec.workspaceDir) ? rec.workspaceDir : db.workspaceDir(src.id);
  copyDir(srcRoot, db.workspaceDir(child.id));
  const fork = { id: U.id(16), sessionId: child.id, sourceRevisionId: rec.id, sourceSessionId: src.id, userId: String(a.user.id), createdAt: U.nowMs() };
  db.put('forks', fork.id, fork);
  return U.ok({ sessionId: child.id, chatSessionId: child.id, id: child.id, session: child, forkId: fork.id, forkedFromRevisionId: rec.id });
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
  const taskId = String(body.taskId || p.taskId || '');
  if (taskId === '') return err(5001);
  const task = db.get('tasks', taskId);
  if (task == null) return err(5001);
  const { session, denied } = sessionOrShared(task.chatSessionId);
  if (denied) return denied;
  const gate = assertReadable(session, a);
  if (gate) return gate;
  const like = body.like !== undefined ? Boolean(body.like) : (body.liked !== undefined ? Boolean(body.liked) : true);
  const filePath = body.filePath || body.path || null;
  const rec = db.get('feedback', taskId) || { taskId, rows: [], createdAt: U.nowMs() };
  if (Array.isArray(rec.rows) === false) rec.rows = [];
  const rowId = String(a.user.id) + ':' + String(filePath || 'task');
  const existing = rec.rows.find((x) => x.rowId === rowId);
  if (existing) {
    existing.like = like;
    existing.updatedAt = U.nowMs();
  } else {
    rec.rows.push({ rowId, userId: String(a.user.id), like, filePath, createdAt: U.nowMs(), updatedAt: U.nowMs() });
  }
  rec.updatedAt = U.nowMs();
  db.put('feedback', taskId, rec);
  const taskRows = rec.rows.filter((x) => (x.filePath || null) == null);
  const taskLikeCount = taskRows.filter((x) => x.like === true).length;
  const taskDislikeCount = taskRows.filter((x) => x.like === false).length;
  return U.ok({ liked: like, taskLike: like, taskId, taskLikeCount, taskDislikeCount, filePath });
});

route('GET', '/getTaskFeedback', async (req, res, p) => {
  const taskId = String(p.taskId || '');
  if (taskId === '') return U.ok({ items: [], taskLike: null, fileLikes: [], taskLikeCount: 0, taskDislikeCount: 0, fileCounts: {} });
  const task = db.get('tasks', taskId);
  if (task == null) return err(5001);
  const a = actor(req, p);
  const { session, denied } = sessionOrShared(task.chatSessionId);
  if (denied) return denied;
  const gate = assertReadable(session, a);
  if (gate) return gate;
  const rec = db.get('feedback', taskId) || { taskId, rows: [] };
  const rows = Array.isArray(rec.rows) ? rec.rows : [];
  const taskRows = rows.filter((x) => (x.filePath || null) == null);
  const taskLikeCount = taskRows.filter((x) => x.like === true).length;
  const taskDislikeCount = taskRows.filter((x) => x.like === false).length;
  const fileLikes = rows.filter((x) => x.filePath != null).map((x) => ({ filePath: x.filePath, liked: x.like, userId: x.userId }));
  const fileCounts = {};
  for (const row of fileLikes) fileCounts[row.filePath] = (fileCounts[row.filePath] || 0) + 1;
  const mine = taskRows.find((x) => a.user && String(x.userId) === String(a.user.id)) || null;
  const item = { taskId, taskLike: mine ? mine.like : null, liked: mine ? mine.like : null, taskLikeCount, taskDislikeCount, likes: taskLikeCount, dislikes: taskDislikeCount };
  return U.ok({ items: [item], taskLike: item.taskLike, liked: item.liked, fileLikes, taskLikeCount, taskDislikeCount, fileCounts });
});

route('POST', '/credit/upgrade_plan', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const key = req.headers['idempotency-key'] || body.idempotencyKey || p.idempotencyKey || null;
  const up = applyUpgrade(a.user, { level: body.level || p.level, sku: body.sku || p.sku, provider: body.provider || p.provider, idempotencyKey: key }, MODES.plans);
  return U.ok({ level: up.plan.level, plan: up.plan, credits: a.user.credits, subscriptionStatus: a.user.subscriptionStatus, statement: up.statement, idempotent: up.idempotent });
});

route('POST', '/credit/subscription/upgrade', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  if (body.level || p.level || body.sku || p.sku) {
    const key = req.headers['idempotency-key'] || body.idempotencyKey || p.idempotencyKey || null;
    const up = applyUpgrade(a.user, { level: body.level || p.level, sku: body.sku || p.sku, provider: body.provider || p.provider, idempotencyKey: key }, MODES.plans);
    return U.ok({ level: up.plan.level, plan: up.plan, subscriptionStatus: a.user.subscriptionStatus, credits: a.user.credits, statement: up.statement, idempotent: up.idempotent });
  }
  a.user.subscriptionStatus = body.action === 'cancel' ? 'cancel_scheduled' : 'active';
  db.put('users', a.user.id, a.user);
  return U.ok({ subscriptionStatus: a.user.subscriptionStatus });
});

route('POST', '/credit/cancel', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  a.user.subscriptionStatus = 'cancel_scheduled';
  a.user.cancelAtPeriodEnd = true;
  a.user.cancelledAt = a.user.cancelledAt || U.nowMs();
  db.put('users', a.user.id, a.user);
  return U.ok({ subscriptionStatus: a.user.subscriptionStatus, cancelAtPeriodEnd: true, entitlementEndsAt: a.user.entitlementEndsAt || null, cancelledAt: a.user.cancelledAt });
});

function inviteView(rec) {
  return { inviteId: rec.id, inviteCode: rec.code, inviteLink: rec.link, referralCode: rec.code, status: rec.status || 'active', invitedCount: (rec.joinedUserIds || []).length, invited: (rec.joinedUserIds || []).length, rewardCredits: 30 };
}

route('POST', '/credit/invite', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  let rec = db.all('invites').find((x) => String(x.ownerUserId) === String(a.user.id) && x.status !== 'revoked');
  if (rec == null) {
    const id = U.id(12);
    const code = 'NV' + String(a.user.id).replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toUpperCase() + U.id(4).toUpperCase();
    rec = { id, ownerUserId: String(a.user.id), code, link: '/register?referralCode=' + code, status: 'active', joinedUserIds: [], createdAt: U.nowMs() };
    db.put('invites', id, rec);
  }
  return U.ok(inviteView(rec));
});

route('GET', '/credit/list', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const list = db.all('invites').filter((x) => String(x.ownerUserId) === String(a.user.id)).map(inviteView);
  return U.ok({ inviteInfoList: list });
});

route('POST', '/credit/list', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const list = db.all('invites').filter((x) => String(x.ownerUserId) === String(a.user.id)).map(inviteView);
  return U.ok({ inviteInfoList: list });
});

route('POST', '/credit/join', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const inviteId = body.inviteId || p.inviteId || body.referralCode || p.referralCode;
  if (inviteId == null || inviteId === '') return err(5001);
  let rec = db.get('invites', String(inviteId));
  if (rec == null) rec = db.all('invites').find((x) => x.code === String(inviteId)) || null;
  if (rec == null) return err(5001);
  if (String(rec.ownerUserId) === String(a.user.id)) return err(5200);
  rec.joinedUserIds = Array.isArray(rec.joinedUserIds) ? rec.joinedUserIds : [];
  if (rec.joinedUserIds.includes(String(a.user.id))) {
    return U.ok({ credits: a.user.credits, inviteId: rec.id, alreadyJoined: true });
  }
  rec.joinedUserIds.push(String(a.user.id));
  db.put('invites', rec.id, rec);
  a.user.credits = (a.user.credits || 0) + 30;
  db.put('users', a.user.id, a.user);
  db.appendLedger({ userId: a.user.id, kind: 'invite_join', delta: 30, balance: a.user.credits, inviteId: rec.id });
  return U.ok({ credits: a.user.credits, inviteId: rec.id, alreadyJoined: false });
});

route('POST', '/credit/remove', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const amount = Math.max(0, Number(body.amount || p.amount || 0));
  a.user.credits = Math.max(0, (a.user.credits || 0) - amount);
  db.put('users', a.user.id, a.user);
  db.appendLedger({ userId: a.user.id, kind: 'credit_remove', delta: -amount, balance: a.user.credits });
  return U.ok({ credits: a.user.credits });
});

route('GET', '/credit/billing-statements', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  return U.ok(billingRows(a.user.id));
});

route('GET', '/credit/one-time-plans', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const items = [];
  for (const [level, terms] of Object.entries(MODES.oneTimeTerms || {})) {
    for (const t of terms) items.push({ level, sku: t.sku, label: t.label, price: t.price, currency: 'usd' });
  }
  return U.ok({ buyOneGetOne: false, groups: null, items });
});

route('GET', '/notification/list', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const rec = ensureDefaultNotifications(a.user.id);
  const page = Math.max(1, Number(p.page || 1));
  const size = Math.max(1, Math.min(200, Number(p.pageSize || 50)));
  const records = rec.items.map(notificationRecord);
  const total = records.length;
  const start = (page - 1) * size;
  return U.ok({ records: records.slice(start, start + size), total, size, current: page, pages: Math.ceil(total / size), orders: [], optimizeCountSql: true, searchCount: true, countId: null, maxLimit: null });
});

route('GET', '/notification/latest', async (req, res, p) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const rec = ensureDefaultNotifications(a.user.id);
  const unread = rec.items.filter((x) => x.read !== true);
  const ids = (unread.length ? unread : rec.items).slice(0, 20).map((x) => x.id);
  return U.ok({ ids, total: ids.length });
});

route('POST', '/auto_ideaspark/trigger', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const key = req.headers['idempotency-key'] || body.idempotencyKey || p.idempotencyKey || null;
  if (key) {
    const existing = db.all('triggers').find((x) => String(x.userId) === String(a.user.id) && x.idempotencyKey === key);
    if (existing) return U.ok({ triggerId: existing.id, status: existing.status, accepted: true, idempotent: true, createdAt: existing.createdAt });
  }
  const trigger = { id: U.id(12), userId: String(a.user.id), status: 'queued', reason: body.reason || p.reason || 'manual', idempotencyKey: key || undefined, createdAt: U.nowMs() };
  db.put('triggers', trigger.id, trigger);
  return U.ok({ triggerId: trigger.id, status: trigger.status, accepted: true, idempotent: false, createdAt: trigger.createdAt });
});

route('POST', '/auto_ideaspark/modify', async (req, res, p, body) => {
  const a = requireUser(req, p);
  if (a.denied) return a.denied;
  const idea = body.idea || p.idea || null;
  const rec = { id: U.id(12), userId: String(a.user.id), idea, updatedAt: U.nowMs() };
  db.put('triggers', rec.id, { ...rec, status: 'idea_modified' });
  return U.ok({ ok: true, idea, id: rec.id });
});

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
