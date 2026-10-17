// Sandbox routing and local provider absorption.
// Adapted from novix-science/agent-sandbox origin/novix @ f64ec82 (Apache-2.0,
// Kubernetes Authors). Independent Node implementation; no upstream Python or
// Go source copied. The special branch added path-prefix routing, Location
// rewrite, and WebSocket proxy semantics on top of the sandbox-router example.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';

export const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const RESERVED_ROOT = new Set(['api', 'assets', 'healthz', 'favicon.ico']);
export class SandboxError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'SandboxError'; this.code = String(code); this.status = status; }
}
export function parseSandboxPath(pathname) {
  const raw = String(pathname || '');
  const segs = raw.split('?')[0].split('/').filter(Boolean);
  if (segs.length < 2) return null;
  if (RESERVED_ROOT.has(segs[0])) return null;
  for (const seg of segs.slice(0, 2)) {
    if (seg === '.' || seg === '..' || seg.includes(String.fromCharCode(92))) throw new SandboxError('SANDBOX_PATH_INVALID', 'sandbox path segment invalid', 400);
  }
  const namespace = segs[0];
  const sandboxId = segs[1];
  const rest = segs.slice(2).join('/');
  return { namespace, sandboxId, rest, prefix: '/' + namespace + '/' + sandboxId };
}
export function rewriteLocation(location, prefix) {
  if (location == null || location === '') return location;
  const value = String(location);
  if (value.startsWith('http://') || value.startsWith('https://')) {
    const u = new URL(value);
    if (u.pathname.startsWith(prefix + '/') || u.pathname === prefix) return value;
    u.pathname = prefix + (u.pathname.startsWith('/') ? u.pathname : '/' + u.pathname);
    return u.toString();
  }
  if (value.startsWith(prefix + '/') || value === prefix) return value;
  if (value.startsWith('/')) return prefix + value;
  return prefix + '/' + value;
}
export function filterRequestHeaders(input = {}) {
  const out = {};
  for (const [k, v] of Object.entries(input)) if (HOP_BY_HOP.has(k.toLowerCase()) === false && k.toLowerCase() !== 'host') out[k] = v;
  return out;
}
export function filterResponseHeaders(input = {}) {
  const out = {};
  for (const [k, v] of Object.entries(input)) if (HOP_BY_HOP.has(k.toLowerCase()) === false) out[k] = v;
  return out;
}
function safeJoin(root, rel) {
  const abs = path.resolve(root, String(rel || '.').replace(/^[/\\]+/, ''));
  const base = path.resolve(root);
  if (abs !== base && abs.startsWith(base + path.sep) === false) throw new SandboxError('SANDBOX_PATH_TRAVERSAL', 'path escapes workspace', 403);
  return abs;
}
export class LocalSandboxProvider {
  constructor(options = {}) {
    this.rootDir = options.rootDir || path.resolve(process.cwd(), 'data', 'sandboxes');
    this.timeoutMs = options.timeoutMs || 30000;
    fs.mkdirSync(this.rootDir, { recursive: true });
  }
  workspace(namespace, sandboxId) {
    const ns = String(namespace || '');
    const sid = String(sandboxId || '');
    if (ns === '' || sid === '' || ns === '.' || sid === '.' || ns === '..' || sid === '..') throw new SandboxError('SANDBOX_ID_INVALID', 'namespace and sandboxId required', 400);
    const dir = safeJoin(this.rootDir, path.join(ns, sid));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  resolve(params) { return { kind: 'local', workspace: this.workspace(params.namespace, params.sandboxId) }; }
}
LocalSandboxProvider.prototype.runCommand = function runCommand(params, command, options = {}) {
  const cwd = this.workspace(params.namespace, params.sandboxId);
  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || this.timeoutMs, 100), 120000);
  return new Promise((resolve) => {
    if (options.signal?.aborted) return resolve({ exitCode: null, output: 'aborted before start', aborted: true });
    const child = spawn('/bin/zsh', ['-c', String(command || '')], { cwd, detached: true, env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: cwd, LANG: 'C.UTF-8' } });
    let output = '';
    let killed = false;
    const stop = () => { if (killed) return; killed = true; try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { } } };
    const timer = setTimeout(stop, timeoutMs);
    child.stdout.on('data', (d) => { if (output.length < 8000) output += String(d); });
    child.stderr.on('data', (d) => { if (output.length < 8000) output += String(d); });
    if (options.signal) options.signal.addEventListener('abort', stop, { once: true });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener('abort', stop);
      resolve({ exitCode: code, signal: signal || null, output: output.slice(0, 8000), timedOut: killed && signal === 'SIGKILL', aborted: options.signal?.aborted === true });
    });
  });
};
LocalSandboxProvider.prototype.readFile = function readFile(params, rel) {
  const cwd = this.workspace(params.namespace, params.sandboxId);
  const abs = safeJoin(cwd, rel);
  return fs.readFileSync(abs, 'utf8').slice(0, 200000);
};
LocalSandboxProvider.prototype.writeFile = function writeFile(params, rel, content) {
  const cwd = this.workspace(params.namespace, params.sandboxId);
  const abs = safeJoin(cwd, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, String(content || ''));
  return { path: rel, bytes: Buffer.byteLength(String(content || '')) };
};
export class SandboxRouter {
  constructor(options = {}) { this.provider = options.provider || new LocalSandboxProvider(options); this.prefix = options.prefix || ''; }
  resolve(pathname) { const params = parseSandboxPath(pathname); if (params == null) return null; params.target = this.provider.resolve(params); return params; }
  upgrade() { throw new SandboxError('SANDBOX_WEBSOCKET_NOT_IMPLEMENTED', 'WebSocket upgrade requires a shared WebSocket runtime; HTTP/path routing and Location rewrite are implemented', 501); }
}
export function registerSandboxRoutes(route, helpers = {}) {
  const provider = helpers.provider || new LocalSandboxProvider({ rootDir: helpers.rootDir });
  const router = new SandboxRouter({ provider });
  const ok = helpers.ok || ((result) => ({ code: '0', message: 'Success', result }));
  const fail = helpers.fail || ((code, message) => ({ code: String(code), message, result: null }));
  const auth = (req, p) => helpers.requireUser ? helpers.requireUser(req, p) : { user: { id: 'local' }, anon: false };
  route('GET', '/sandbox/health', async () => ok({ ok: true, provider: 'local', websocket: 'not_implemented' }));
  route('POST', '/sandbox/workspaces', async (req, res, p, body) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    try { return ok({ workspace: provider.workspace(body.namespace, body.sandboxId) }); } catch (err) { return fail(err.code || '5000', err.message); }
  });
  route('GET', '/sandbox/router/parse', async (req, res, p) => {
    try { return ok(router.resolve(p.path || '')); } catch (err) { return fail(err.code || '5000', err.message); }
  });
  route('GET', '/sandbox/workspaces/:namespace/:sandboxId/files', async (req, res, p) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    try { return ok({ path: p.path || '.', content: provider.readFile(p, p.path || '.') }); } catch (err) { return fail(err.code || '5000', err.message); }
  });
  route('POST', '/sandbox/workspaces/:namespace/:sandboxId/files', async (req, res, p, body) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    try { return ok(provider.writeFile(p, body.path, body.content)); } catch (err) { return fail(err.code || '5000', err.message); }
  });
  route('POST', '/sandbox/workspaces/:namespace/:sandboxId/exec', async (req, res, p, body) => {
    const a = auth(req, p); if (a.denied) return a.denied;
    if (typeof body.command !== 'string' || body.command.trim() === '') return fail('4000', 'command required');
    return ok(await provider.runCommand(p, body.command, { timeoutMs: body.timeoutMs }));
  });
}
