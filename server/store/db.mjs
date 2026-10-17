// JSON-file persistence. Single process, atomic writes, no external deps.
// Layout: data/{users,sessions,tasks,files,notifications,gallery,ledger}/*.json + data/workspaces/<sid>/...

import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ensureDir, id, readJson, writeJson, nowMs } from '../lib/util.mjs';

const COLLECTIONS = ['users', 'sessions', 'tasks', 'files', 'gallery', 'ledger', 'notifications', 'revisions', 'billing', 'invites', 'forks', 'onboarding', 'triggers', 'feedback'];

ensureDir(DATA_DIR);
for (const c of COLLECTIONS) ensureDir(path.join(DATA_DIR, c));

function fileOf(c, key) {
  return path.join(DATA_DIR, c, `${key}.json`);
}

export function get(c, key) {
  return readJson(fileOf(c, key), null);
}

export function put(c, key, value) {
  return writeJson(fileOf(c, key), value);
}

export function all(c) {
  const dir = path.join(DATA_DIR, c);
  ensureDir(dir);
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
    } catch {
      /* skip corrupt */
    }
  }
  return out;
}

export function del(c, key) {
  try {
    fs.unlinkSync(fileOf(c, key));
    return true;
  } catch {
    return false;
  }
}

// ---------- derived paths ----------
export function workspaceDir(sessionId) {
  const d = path.join(DATA_DIR, 'workspaces', sessionId, 'workspace');
  ensureDir(d);
  return d;
}

export function sessionDir(sessionId) {
  const d = path.join(DATA_DIR, 'workspaces', sessionId);
  ensureDir(d);
  return d;
}

export function revisionDir(revisionId) {
  const d = path.join(DATA_DIR, 'revisions', revisionId, 'workspace');
  ensureDir(d);
  return d;
}

export function userWorkspaceDir(userId) {
  const d = path.join(DATA_DIR, 'workspaces', `home-${userId}`, 'workspace');
  ensureDir(d);
  return d;
}

export function userUploadDir(userId) {
  const d = path.join(DATA_DIR, 'uploads', String(userId));
  ensureDir(d);
  return d;
}

// ---------- factories ----------
export function newSession({ userId = '-1', isAnonymous = false, title = null } = {}) {
  const sid = id(32);
  const session = {
    id: sid,
    title,
    titleType: 'user',
    version: 2,
    share: false,
    visitType: 'owner',
    creatorUserId: String(userId),
    isAnonymous: !!isAnonymous,
    storageTier: 'HOT',
    storageTierChangedAt: nowMs(),
    createdAt: nowMs(),
    updatedAt: nowMs(),
    enableGpu: false,
  };
  put('sessions', sid, session);
  ensureDir(workspaceDir(sid));
  return session;
}

export function newTask({ sessionId, agentName = '', query = '', queryContent = '', mode = 'auto', createdBy = null } = {}) {
  const tid = String(Math.floor(Math.random() * 900000) + 100000);
  const task = {
    id: tid,
    chatSessionId: sessionId,
    agentName,
    mode,
    query,
    queryContent,
    status: 'init',
    steps: null,
    errorCode: null,
    createdBy,
    createdAt: nowMs(),
    updatedAt: nowMs(),
    finishedAt: null,
  };
  put('tasks', tid, task);
  return task;
}

export function newUser({ email, passwordHash, name = null, level = 'free', isAnonymous = false }) {
  const uid = isAnonymous ? `anonymous-${id(3)}` : id(16);
  const user = {
    id: uid,
    email: email || null,
    name: name || (email ? email.split('@')[0] : 'Guest'),
    passwordHash: passwordHash || null,
    level,
    isAnonymous: !!isAnonymous,
    credits: level === 'pro' ? 500 : level === 'lab' ? 5000 : 50,
    subscriptionStatus: 'active',
    createdAt: nowMs(),
    avatarInitial: ((name || email || 'G')[0] || 'G').toUpperCase(),
  };
  put('users', uid, user);
  return user;
}

export function appendLedger(entry) {
  const key = `${entry.userId || 'anon'}`;
  const rows = get('ledger', key) || { userId: key, rows: [] };
  rows.rows.push({ id: id(8), at: nowMs(), ...entry });
  put('ledger', key, rows);
  return rows.rows[rows.rows.length - 1];
}

export function pushNotification(userId, notif) {
  const key = String(userId);
  const rows = get('notifications', key) || { userId: key, items: [] };
  const item = {
    id: Number(String(Date.now()).slice(-9)),
    at: nowMs(),
    read: false,
    type: 'UPDATE',
    status: 1,
    ...notif,
  };
  rows.items.unshift(item);
  put('notifications', key, rows);
  return item;
}
