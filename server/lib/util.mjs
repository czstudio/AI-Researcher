// Zero-dependency helpers shared by the whole server.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = process.env.NOVIX_DATA_DIR
  ? path.resolve(process.env.NOVIX_DATA_DIR)
  : path.resolve(process.cwd(), 'data');

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function id(len = 32) {
  return crypto.randomBytes(len / 2).toString('hex');
}

export function nowMs() {
  return Date.now();
}

// ---------- envelope ----------
export const OK = '0';

export function ok(result = null, message = 'Success') {
  return { code: OK, message, result };
}

export function fail(code, message, httpStatus = null) {
  return { __http: httpStatus, code: String(code), message, result: null };
}

export function isFail(v) {
  return v && typeof v === 'object' && v.code !== undefined && v.code !== OK;
}

// ---------- json file store ----------
export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
  return value;
}

export function appendJsonl(file, obj) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(obj)}\n`);
}

export function readJsonl(file) {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

// ---------- http ----------
export function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

export async function readBody(req, limitBytes = 32 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limitBytes) throw new Error('payload too large');
    chunks.push(c);
  }
  if (!chunks.length) return { raw: Buffer.alloc(0), text: '', json: null };
  const raw = Buffer.concat(chunks);
  const text = raw.toString('utf8');
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  return { raw, text, json: parsed };
}

export function parseQuery(url) {
  const u = new URL(url, 'http://localhost');
  const out = {};
  for (const [k, v] of u.searchParams.entries()) out[k] = v;
  return out;
}

export function pathOf(url) {
  return new URL(url, 'http://localhost').pathname;
}

// novix sends most params in the query string, some in a JSON body.
// Accept both so clients written against either shape work.
export async function params(req, url) {
  const q = parseQuery(url);
  let body = {};
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const ct = String(req.headers['content-type'] || '');
    if (ct.includes('application/json')) {
      try {
        const b = await readBody(req);
        req.__rawBody = b.text;
        req.__rawBodyBuffer = b.raw;
        if (b.json && typeof b.json === 'object') body = b.json;
      } catch {
        /* ignore */
      }
    } else if (ct.includes('application/x-www-form-urlencoded')) {
      const b = await readBody(req);
      req.__rawBody = b.text;
      req.__rawBodyBuffer = b.raw;
      body = Object.fromEntries(new URLSearchParams(b.text).entries());
    }
  }
  return { ...body, ...q };
}

// ---------- jwt (HS256, zero-dep) ----------
const SECRET = process.env.NOVIX_JWT_SECRET || 'novix-open-dev-secret-change-me';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function signJwt(payload, ttlSec = 60 * 60 * 24 * 30) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSec };
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(body));
  const sig = b64url(crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest());
  return `${h}.${p}.${sig}`;
}

export function verifyJwt(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const expect = b64url(crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest());
  if (s !== expect) return null;
  try {
    const body = JSON.parse(b64urlDecode(p).toString('utf8'));
    if (body.exp && body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}

export function bearer(req) {
  const raw = req.headers.authorization || req.headers.Authorization || '';
  const m = /^Bearer\s+(.+)$/i.exec(String(raw).trim());
  if (m) return m[1];
  const t = req.headers.token || req.headers.authtoken;
  return t ? String(t) : null;
}

export function hashPassword(pw, salt) {
  const s = salt || crypto.randomBytes(8).toString('hex');
  const dk = crypto.pbkdf2Sync(String(pw), s, 120000, 32, 'sha256').toString('hex');
  return `pbkdf2$${s}$${dk}`;
}

export function checkPassword(pw, stored) {
  if (!stored || !String(stored).startsWith('pbkdf2$')) return false;
  const [, s, dk] = String(stored).split('$');
  const calc = crypto.pbkdf2Sync(String(pw), s, 120000, 32, 'sha256').toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(calc, 'hex'), Buffer.from(dk, 'hex'));
  } catch {
    return false;
  }
}

export function safeJoin(root, rel) {
  const abs = path.resolve(root, String(rel || '.').replace(/^[/\\]+/, ''));
  const r = path.resolve(root);
  if (abs !== r && !abs.startsWith(r + path.sep)) return null;
  return abs;
}

export function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
  };
  return map[ext] || 'application/octet-stream';
}
