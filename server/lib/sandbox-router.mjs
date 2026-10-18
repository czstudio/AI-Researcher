// Sandbox routing and provider absorption.
// Adapted from novix-science/agent-sandbox origin/novix @ f64ec82 (Apache-2.0,
// Kubernetes Authors). Independent Node implementation; no upstream Python or
// Go source copied. The special branch added path-prefix routing, Location
// rewrite, and WebSocket proxy semantics on top of the sandbox-router example.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import { spawn } from 'node:child_process';

export const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade',
]);
const RESERVED_ROOT = new Set(['api', 'assets', 'healthz', 'favicon.ico']);
const MAX_PATH_LENGTH = 4096;
const MAX_SEGMENT_LENGTH = 255;
const MAX_HEADER_LENGTH = 8192;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const SAFE_ROUTE_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,61}[A-Za-z0-9])?$/;
const WS_REQUEST_HEADERS = new Set([
  'authorization', 'cookie', 'origin', 'user-agent', 'sec-websocket-key',
  'sec-websocket-version', 'sec-websocket-protocol', 'sec-websocket-extensions',
  'x-request-id', 'x-correlation-id',
]);
const WS_RESPONSE_HEADERS = new Set([
  'upgrade', 'connection', 'sec-websocket-accept', 'sec-websocket-protocol',
  'sec-websocket-extensions',
]);
const ERROR_RESPONSE_HEADERS = new Set([
  'content-type', 'content-length', 'location', 'retry-after',
]);

export class SandboxError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'SandboxError';
    this.code = String(code);
    this.status = status;
  }
}

function invalidPath(message, code = 'SANDBOX_PATH_INVALID', status = 400) {
  return new SandboxError(code, message, status);
}

function decodeForSecurity(rawSegment) {
  let decoded = String(rawSegment);
  for (let i = 0; i < 4; i += 1) {
    let next;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw invalidPath('malformed percent-encoding in sandbox path');
    }
    if (next === decoded) break;
    decoded = next;
  }
  if (CONTROL_CHARS.test(decoded)) throw invalidPath('control character in sandbox path');
  if (decoded.includes('/') || decoded.includes('\\')) throw invalidPath('encoded path separator rejected');
  if (decoded === '.' || decoded === '..') throw invalidPath('dot segment rejected');
  return decoded;
}

export function validateSandboxSegment(value, label = 'sandbox segment') {
  const text = String(value == null ? '' : value);
  if (text.length === 0 || text.length > MAX_SEGMENT_LENGTH || SAFE_ROUTE_SEGMENT.test(text) === false) {
    throw invalidPath(label + ' invalid');
  }
  return text;
}

export function parseSandboxPath(pathname) {
  const raw = String(pathname == null ? '' : pathname);
  if (raw.length === 0) return null;
  if (raw.length > MAX_PATH_LENGTH) throw invalidPath('sandbox path too long', 'SANDBOX_PATH_TOO_LONG', 414);
  if (raw.startsWith('/') === false) throw invalidPath('sandbox path must be absolute');
  if (CONTROL_CHARS.test(raw)) throw invalidPath('control character in sandbox path');
  if (raw.includes('\\')) throw invalidPath('backslash rejected in sandbox path');
  const question = raw.indexOf('?');
  const pathnameOnly = question >= 0 ? raw.slice(0, question) : raw;
  if (pathnameOnly.includes('//')) throw invalidPath('double slash rejected in sandbox path');
  const parts = pathnameOnly.split('/').filter(Boolean);
  for (const part of parts) {
    if (part.length > MAX_SEGMENT_LENGTH) throw invalidPath('sandbox path segment too long', 'SANDBOX_PATH_TOO_LONG', 414);
    decodeForSecurity(part);
  }
  if (parts.length < 2) return null;
  const decodedFirst = decodeForSecurity(parts[0]);
  if (RESERVED_ROOT.has(decodedFirst)) return null;
  const namespace = validateSandboxSegment(decodedFirst, 'namespace');
  const sandboxId = validateSandboxSegment(decodeForSecurity(parts[1]), 'sandboxId');
  const restSegments = parts.slice(2);
  const rest = restSegments.join('/');
  return {
    namespace,
    sandboxId,
    rest,
    prefix: '/' + namespace + '/' + sandboxId,
    trailingSlash: pathnameOnly.length > 1 && pathnameOnly.endsWith('/'),
  };
}

export function validateHostHeader(host) {
  const value = String(host == null ? '' : host);
  if (value.length === 0 || value.length > 255 || CONTROL_CHARS.test(value) || /\s/.test(value)) {
    throw new SandboxError('SANDBOX_HOST_INVALID', 'invalid Host header', 400);
  }
  if (/[\/\\@]/.test(value)) throw new SandboxError('SANDBOX_HOST_INVALID', 'invalid Host header', 400);
  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    if (close < 0) throw new SandboxError('SANDBOX_HOST_INVALID', 'invalid IPv6 Host header', 400);
    const suffix = value.slice(close + 1);
    if (suffix !== '' && /^:[0-9]{1,5}$/.test(suffix) === false) {
      throw new SandboxError('SANDBOX_HOST_INVALID', 'invalid Host header port', 400);
    }
    return value;
  }
  const pieces = value.split(':');
  if (pieces.length > 2) throw new SandboxError('SANDBOX_HOST_INVALID', 'invalid Host header', 400);
  const hostname = pieces[0];
  if (hostname.length === 0 || hostname.length > 253) throw new SandboxError('SANDBOX_HOST_INVALID', 'invalid Host header', 400);
  if (pieces.length === 2 && /^[0-9]{1,5}$/.test(pieces[1]) === false) {
    throw new SandboxError('SANDBOX_HOST_INVALID', 'invalid Host header port', 400);
  }
  if (/^[A-Za-z0-9.-]+$/.test(hostname) === false) throw new SandboxError('SANDBOX_HOST_INVALID', 'invalid Host header', 400);
  return value;
}

function validateHeaderValue(name, value) {
  if (Array.isArray(value)) return value.map((item) => validateHeaderValue(name, item));
  const text = String(value == null ? '' : value);
  if (text.length > MAX_HEADER_LENGTH || CONTROL_CHARS.test(text)) {
    throw new SandboxError('SANDBOX_HEADER_INVALID', 'invalid header value for ' + name, 400);
  }
  return text;
}

export function filterRequestHeaders(input = {}) {
  const out = {};
  for (const [rawName, rawValue] of Object.entries(input || {})) {
    const name = String(rawName || '').toLowerCase();
    if (HEADER_NAME.test(name) === false) throw new SandboxError('SANDBOX_HEADER_INVALID', 'invalid request header name', 400);
    if (name === 'host' || HOP_BY_HOP.has(name)) continue;
    out[name] = validateHeaderValue(name, rawValue);
  }
  return out;
}

export function filterResponseHeaders(input = {}) {
  const out = {};
  for (const [rawName, rawValue] of Object.entries(input || {})) {
    const name = String(rawName || '').toLowerCase();
    if (HEADER_NAME.test(name) === false) throw new SandboxError('SANDBOX_HEADER_INVALID', 'invalid response header name', 500);
    if (HOP_BY_HOP.has(name)) continue;
    out[name] = validateHeaderValue(name, rawValue);
  }
  return out;
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

function safeJoin(root, rel) {
  const base = path.resolve(root);
  const abs = path.resolve(base, String(rel || '.').replace(/^[/\\]+/, ''));
  if (abs !== base && abs.startsWith(base + path.sep) === false) {
    throw new SandboxError('SANDBOX_PATH_TRAVERSAL', 'path escapes workspace', 403);
  }
  return abs;
}

function capOutput(value, max = 8000) {
  return String(value == null ? '' : value).slice(0, max);
}

function runChild(command, args, options = {}) {
  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || 30000, 100), 120000);
  return new Promise((resolve) => {
    if (options.signal?.aborted) {
      resolve({ exitCode: null, signal: null, output: 'aborted before start', timedOut: false, aborted: true });
      return;
    }
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: options.env || { PATH: process.env.PATH || '/usr/bin:/bin', HOME: options.cwd || process.cwd() },
      });
    } catch (error) {
      resolve({ exitCode: null, signal: null, output: '', error: error.message, timedOut: false, unavailable: true });
      return;
    }
    let output = '';
    let killed = false;
    let settled = false;
    const collect = (data) => { if (output.length < 8000) output += String(data); };
    const stop = () => {
      if (killed) return;
      killed = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { } }
    };
    const timer = setTimeout(stop, timeoutMs);
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (options.signal) options.signal.removeEventListener('abort', stop);
      resolve({ ...result, output: capOutput(output) });
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    if (options.signal) options.signal.addEventListener('abort', stop, { once: true });
    child.on('error', (error) => finish({ exitCode: null, signal: null, error: error.message, timedOut: false, unavailable: true }));
    child.on('close', (code, signal) => finish({ exitCode: code, signal: signal || null, timedOut: killed && signal === 'SIGKILL', aborted: options.signal?.aborted === true }));
  });
}

export class LocalSandboxProvider {
  constructor(options = {}) {
    this.kind = 'local';
    this.rootDir = options.rootDir || path.resolve(process.cwd(), 'data', 'sandboxes');
    this.timeoutMs = options.timeoutMs || 30000;
    this.shell = options.shell || '/bin/sh';
    fs.mkdirSync(this.rootDir, { recursive: true });
  }

  workspace(namespace, sandboxId) {
    const ns = validateSandboxSegment(namespace, 'namespace');
    const sid = validateSandboxSegment(sandboxId, 'sandboxId');
    const dir = safeJoin(this.rootDir, path.join(ns, sid));
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  resolve(params) {
    return { kind: this.kind, workspace: this.workspace(params.namespace, params.sandboxId) };
  }

  capabilities() {
    return { provider: 'local', websocket: 'remote-target-only', controlPlane: false };
  }

  async runCommand(params, command, options = {}) {
    const cwd = this.workspace(params.namespace, params.sandboxId);
    const result = await runChild(this.shell, ['-c', String(command || '')], {
      cwd,
      timeoutMs: options.timeoutMs || this.timeoutMs,
      signal: options.signal,
      env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: cwd, LANG: 'C.UTF-8' },
    });
    return { ...result, output: capOutput(result.output) };
  }

  readFile(params, rel) {
    const cwd = this.workspace(params.namespace, params.sandboxId);
    const abs = safeJoin(cwd, rel);
    return fs.readFileSync(abs, 'utf8').slice(0, 200000);
  }

  writeFile(params, rel, content) {
    const cwd = this.workspace(params.namespace, params.sandboxId);
    const abs = safeJoin(cwd, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const text = String(content == null ? '' : content);
    fs.writeFileSync(abs, text);
    return { path: rel, bytes: Buffer.byteLength(text) };
  }
}

export class DockerSandboxProvider extends LocalSandboxProvider {
  constructor(options = {}) {
    super(options);
    this.kind = 'docker';
    this.dockerCmd = options.dockerCmd || process.env.DOCKER_CMD || 'docker';
    this.image = options.image || process.env.NOVIX_SANDBOX_DOCKER_IMAGE || 'alpine:3.20';
    this.network = options.network || 'none';
    this.cpus = options.cpus || process.env.NOVIX_SANDBOX_CPUS || '';
    this.memory = options.memory || process.env.NOVIX_SANDBOX_MEMORY || '512m';
    this.pidsLimit = options.pidsLimit || '';
    this.probeTimeoutMs = options.probeTimeoutMs || 3000;
    this._available = undefined;
  }

  capabilities() {
    return { provider: 'docker', websocket: 'remote-target-only', controlPlane: false, image: this.image };
  }

  async available() {
    if (this._available !== undefined) return this._available;
    const probe = await runChild(this.dockerCmd, ['info'], {
      cwd: this.rootDir,
      timeoutMs: this.probeTimeoutMs,
      env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: process.env.HOME || process.cwd() },
    });
    this._available = probe.exitCode === 0;
    return this._available;
  }

  async runCommand(params, command, options = {}) {
    const workspace = this.workspace(params.namespace, params.sandboxId);
    const available = await this.available();
    if (available === false) {
      throw new SandboxError(
        'SANDBOX_DOCKER_UNAVAILABLE',
        'Docker CLI or daemon is unavailable; set DOCKER_CMD/image or use the local provider',
        503,
      );
    }
    const args = ['run', '--rm', '--name', 'novix-' + params.namespace + '-' + params.sandboxId + '-' + process.pid];
    args.push('--network', this.network, '-v', workspace + ':/workspace:rw', '-w', '/workspace');
    if (this.cpus) args.push('--cpus', String(this.cpus));
    if (this.memory) args.push('--memory', String(this.memory));
    if (this.pidsLimit) args.push('--pids-limit', String(this.pidsLimit));
    args.push('--', this.image, '/bin/sh', '-lc', String(command || ''));
    const result = await runChild(this.dockerCmd, args, {
      cwd: workspace,
      timeoutMs: options.timeoutMs || this.timeoutMs,
      signal: options.signal,
      env: { PATH: process.env.PATH || '/usr/bin:/bin', HOME: process.env.HOME || workspace, LANG: 'C.UTF-8' },
    });
    if (result.unavailable) {
      throw new SandboxError('SANDBOX_DOCKER_UNAVAILABLE', result.error || 'docker command could not start', 503);
    }
    return { ...result, output: capOutput(result.output), provider: 'docker', image: this.image };
  }
}

export class KubernetesTargetProvider {
  constructor(options = {}) {
    this.kind = 'kubernetes';
    this.config = options.config || options;
    this.namespace = this.config.namespace || process.env.NOVIX_K8S_NAMESPACE || 'default';
    this.serviceDomain = this.config.serviceDomain || process.env.NOVIX_K8S_SERVICE_DOMAIN || 'svc.cluster.local';
    this.port = Number(this.config.port || process.env.NOVIX_K8S_SANDBOX_PORT || 8080);
    if (Number.isInteger(this.port) === false || this.port < 1 || this.port > 65535) {
      throw new SandboxError('SANDBOX_KUBERNETES_CONFIG_INVALID', 'invalid Kubernetes sandbox port', 400);
    }
  }

  resolve(params) {
    const namespace = validateSandboxSegment(params.namespace || this.namespace, 'namespace');
    const sandboxId = validateSandboxSegment(params.sandboxId, 'sandboxId');
    const targetBase = 'http://' + sandboxId + '.' + namespace + '.' + this.serviceDomain + ':' + this.port;
    return {
      kind: this.kind,
      namespace,
      sandboxId,
      port: this.port,
      targetBase,
      controlPlane: false,
      note: 'DNS target resolution only; Kubernetes CRD/Pod/Service control-plane reconciliation is not implemented',
    };
  }

  capabilities() {
    return {
      provider: 'kubernetes',
      websocket: 'remote-target-only',
      controlPlane: false,
      note: 'target resolution only; no Kubernetes control-plane support',
    };
  }
}

export function createSandboxProvider(options = {}) {
  if (options.provider && typeof options.provider === 'object' && typeof options.provider.resolve === 'function') {
    return options.provider;
  }
  const kind = String(options.provider || options.kind || process.env.SANDBOX_PROVIDER || 'local').toLowerCase();
  if (kind === 'local') return new LocalSandboxProvider(options);
  if (kind === 'docker') return new DockerSandboxProvider(options);
  if (kind === 'kubernetes' || kind === 'k8s') return new KubernetesTargetProvider(options);
  throw new SandboxError('SANDBOX_PROVIDER_UNKNOWN', 'unknown sandbox provider: ' + kind, 400);
}

function firstHeader(headers, name) {
  const value = headers?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function mergeTargetSearch(incomingSearch, baseSearch) {
  const merged = new URLSearchParams();
  for (const source of [baseSearch || '', incomingSearch || '']) {
    const params = new URLSearchParams(source.startsWith('?') ? source.slice(1) : source);
    for (const [key, value] of params.entries()) merged.append(key, value);
  }
  const text = merged.toString();
  return text.length > 0 ? '?' + text : '';
}

export function resolveWebSocketTarget(req, targetBase, options = {}) {
  const requestUrl = String(req?.url || '/');
  if (requestUrl.startsWith('/') === false || CONTROL_CHARS.test(requestUrl)) {
    throw new SandboxError('SANDBOX_WEBSOCKET_URL_INVALID', 'invalid WebSocket request URL', 400);
  }
  let incoming;
  try {
    incoming = new URL(requestUrl, 'http://sandbox-router.local');
  } catch {
    throw new SandboxError('SANDBOX_WEBSOCKET_URL_INVALID', 'invalid WebSocket request URL', 400);
  }
  const route = parseSandboxPath(incoming.pathname);
  let base;
  try {
    base = new URL(String(targetBase || ''));
  } catch {
    throw new SandboxError('SANDBOX_WEBSOCKET_TARGET_INVALID', 'invalid WebSocket target base', 500);
  }
  const protocol = base.protocol.toLowerCase();
  if (['http:', 'https:', 'ws:', 'wss:'].includes(protocol) === false) {
    throw new SandboxError('SANDBOX_WEBSOCKET_TARGET_INVALID', 'unsupported WebSocket target protocol', 500);
  }
  if (base.username || base.password || base.hash) {
    throw new SandboxError('SANDBOX_WEBSOCKET_TARGET_INVALID', 'credentials/fragments are not allowed in target base', 500);
  }
  validateHostHeader(base.host);
  let basePath = base.pathname || '/';
  if (basePath === '/') basePath = '';
  else basePath = basePath.replace(/\/+$/, '');
  let upstreamPath;
  if (route) {
    upstreamPath = basePath + '/' + route.rest;
    if (route.rest.length === 0) upstreamPath = basePath + '/';
    else if (route.trailingSlash) upstreamPath += '/';
  } else {
    upstreamPath = basePath + '/' + incoming.pathname.replace(/^\/+/, '');
    if (incoming.pathname.endsWith('/') && upstreamPath.endsWith('/') === false) upstreamPath += '/';
  }
  upstreamPath = upstreamPath.replace(/\/{2,}/g, '/');
  if (upstreamPath.startsWith('/') === false) upstreamPath = '/' + upstreamPath;
  const search = mergeTargetSearch(incoming.search, base.search);
  const secure = protocol === 'https:' || protocol === 'wss:';
  return {
    route,
    protocol,
    secure,
    host: base.hostname.replace(/^\[|\]$/g, ''),
    port: Number(base.port || (secure ? 443 : 80)),
    hostHeader: base.host,
    path: upstreamPath + search,
    upstreamUrl: (secure ? 'wss://' : 'ws://') + base.host + upstreamPath + search,
    requestPath: incoming.pathname,
    query: search,
  };
}

export function buildWebSocketUpgradeHeaders(req, target, options = {}) {
  const input = req?.headers || {};
  const headers = {};
  for (const [rawName, rawValue] of Object.entries(input)) {
    const name = String(rawName || '').toLowerCase();
    if (HEADER_NAME.test(name) === false) throw new SandboxError('SANDBOX_HEADER_INVALID', 'invalid WebSocket header name', 400);
    if (WS_REQUEST_HEADERS.has(name) === false) continue;
    headers[name] = validateHeaderValue(name, rawValue);
  }
  const key = String(firstHeader(input, 'sec-websocket-key') || '');
  const version = String(firstHeader(input, 'sec-websocket-version') || '13');
  if (/^[A-Za-z0-9+/]{22}==$/.test(key) === false) {
    throw new SandboxError('SANDBOX_WEBSOCKET_KEY_INVALID', 'missing or invalid Sec-WebSocket-Key', 400);
  }
  if (version !== '13') throw new SandboxError('SANDBOX_WEBSOCKET_VERSION_INVALID', 'only WebSocket version 13 is supported', 400);
  headers['sec-websocket-key'] = key;
  headers['sec-websocket-version'] = '13';
  headers.host = target.hostHeader;
  headers.connection = 'Upgrade';
  headers.upgrade = 'websocket';
  const originalHost = firstHeader(input, 'host');
  if (originalHost) headers['x-forwarded-host'] = validateHostHeader(originalHost);
  headers['x-forwarded-proto'] = req?.socket?.encrypted === true ? 'https' : 'http';
  if (options.forwardedFor === true) {
    const remote = String(req?.socket?.remoteAddress || '');
    if (remote && CONTROL_CHARS.test(remote) === false) headers['x-forwarded-for'] = remote;
  }
  return headers;
}

function serializeHeaders(headers) {
  const lines = [];
  for (const [name, value] of Object.entries(headers || {})) {
    if (Array.isArray(value)) {
      for (const item of value) lines.push(name + ': ' + item);
    } else {
      lines.push(name + ': ' + value);
    }
  }
  return lines.join('\r\n') + '\r\n';
}

function parseHttpResponseHead(buffer) {
  const end = buffer.indexOf('\r\n\r\n');
  if (end < 0) return null;
  const text = buffer.subarray(0, end).toString('latin1');
  const lines = text.split('\r\n');
  const match = /^HTTP\/1\.[01] ([0-9]{3})(?: (.*))?$/.exec(lines.shift() || '');
  if (match === null) throw new SandboxError('SANDBOX_WEBSOCKET_BAD_RESPONSE', 'invalid upstream HTTP response', 502);
  const headers = {};
  for (const line of lines) {
    const colon = line.indexOf(':');
    if (colon <= 0) throw new SandboxError('SANDBOX_WEBSOCKET_BAD_RESPONSE', 'invalid upstream header', 502);
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (HEADER_NAME.test(name) === false || CONTROL_CHARS.test(value) || value.length > MAX_HEADER_LENGTH) {
      throw new SandboxError('SANDBOX_WEBSOCKET_BAD_RESPONSE', 'invalid upstream header', 502);
    }
    if (headers[name] === undefined) headers[name] = value;
    else headers[name] = [].concat(headers[name], value);
  }
  return { status: Number(match[1]), message: match[2] || http.STATUS_CODES[Number(match[1])] || 'Upstream Error', headers, end };
}

function writeRawResponse(socket, status, message, extraHeaders = {}, body = '') {
  if (socket?.writable === false || socket?.destroyed === true) return;
  const payload = Buffer.from(String(body || ''), 'utf8');
  const headers = {
    connection: 'close',
    'content-type': 'text/plain; charset=utf-8',
    'content-length': String(payload.length),
    ...extraHeaders,
  };
  const head = 'HTTP/1.1 ' + status + ' ' + (http.STATUS_CODES[status] || message || 'Error') + '\r\n' + serializeHeaders(headers) + '\r\n';
  try {
    socket.write(Buffer.concat([Buffer.from(head, 'latin1'), payload]));
    socket.end();
  } catch { }
}

function destroyQuietly(stream) {
  try { stream?.destroy(); } catch { }
}

function wsResponseHeaders(headers) {
  const out = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (WS_RESPONSE_HEADERS.has(name)) out[name] = value;
  }
  return out;
}

export function proxyWebSocketUpgrade(req, socket, head, targetBase, options = {}) {
  const target = resolveWebSocketTarget(req, targetBase, options);
  const headers = buildWebSocketUpgradeHeaders(req, target, options);
  const connectTimeoutMs = Math.min(Math.max(Number(options.connectTimeoutMs) || 10000, 100), 120000);
  const handshakeTimeoutMs = Math.min(Math.max(Number(options.handshakeTimeoutMs) || 10000, 100), 120000);
  const idleTimeoutMs = Math.max(Number(options.idleTimeoutMs) || 0, 0);
  let upstream;
  let handshakeDone = false;
  let finalized = false;
  let clientClosed = false;
  let idleTimer = null;
  let connectTimer = null;
  let handshakeTimer = null;

  const clearTimers = () => {
    if (connectTimer) clearTimeout(connectTimer);
    if (handshakeTimer) clearTimeout(handshakeTimer);
    if (idleTimer) clearTimeout(idleTimer);
    connectTimer = null;
    handshakeTimer = null;
    idleTimer = null;
  };
  const fail = (status, message) => {
    if (finalized) return;
    finalized = true;
    clearTimers();
    destroyQuietly(upstream);
    writeRawResponse(socket, status, message, {}, message);
  };
  const touch = () => {
    if (idleTimeoutMs <= 0 || handshakeDone === false) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (handshakeDone) {
        clearTimers();
        destroyQuietly(upstream);
        destroyQuietly(socket);
      }
    }, idleTimeoutMs);
  };

  socket.on?.('error', () => { clientClosed = true; destroyQuietly(upstream); });
  socket.on?.('close', () => { clientClosed = true; destroyQuietly(upstream); });
  if (clientClosed) throw new SandboxError('SANDBOX_WEBSOCKET_CLIENT_CLOSED', 'client socket closed before upgrade', 400);

  const connectOptions = {
    host: target.host,
    port: target.port,
    servername: target.secure ? target.host : undefined,
    rejectUnauthorized: options.rejectUnauthorized !== false,
  };
  upstream = target.secure ? tls.connect(connectOptions) : net.connect(connectOptions);
  upstream.setNoDelay?.(true);

  connectTimer = setTimeout(() => fail(504, 'WebSocket upstream connect timeout'), connectTimeoutMs);
  const onConnected = () => {
    if (finalized) return;
    if (connectTimer) clearTimeout(connectTimer);
    connectTimer = null;
    const requestHead = 'GET ' + target.path + ' HTTP/1.1\r\n' + serializeHeaders(headers) + '\r\n';
    upstream.write(requestHead);
    handshakeTimer = setTimeout(() => fail(504, 'WebSocket upstream handshake timeout'), handshakeTimeoutMs);
  };
  if (target.secure) upstream.once('secureConnect', onConnected);
  else upstream.once('connect', onConnected);

  let responseBuffer = Buffer.alloc(0);
  const onHandshakeData = (chunk) => {
    if (finalized || handshakeDone) return;
    responseBuffer = Buffer.concat([responseBuffer, chunk]);
    if (responseBuffer.length > 65536) {
      fail(502, 'WebSocket upstream response headers too large');
      return;
    }
    const parsed = parseHttpResponseHead(responseBuffer);
    if (parsed === null) return;
    if (handshakeTimer) clearTimeout(handshakeTimer);
    handshakeTimer = null;
    const remainder = responseBuffer.subarray(parsed.end + 4);
    if (parsed.status !== 101) {
      finalized = true;
      const safe = {};
      for (const [name, value] of Object.entries(parsed.headers)) {
        if (ERROR_RESPONSE_HEADERS.has(name)) safe[name] = value;
      }
      writeRawResponse(socket, parsed.status, parsed.message, safe, remainder.toString('utf8'));
      destroyQuietly(upstream);
      return;
    }
    if (String(parsed.headers.upgrade || '').toLowerCase() !== 'websocket') {
      fail(502, 'upstream did not accept WebSocket upgrade');
      return;
    }
    if (parsed.headers['sec-websocket-accept'] === undefined) {
      fail(502, 'upstream WebSocket accept header missing');
      return;
    }
    handshakeDone = true;
    finalized = true;
    clearTimers();
    upstream.removeListener('data', onHandshakeData);
    const response = 'HTTP/1.1 101 Switching Protocols\r\n' + serializeHeaders(wsResponseHeaders(parsed.headers)) + '\r\n';
    socket.write(response);
    if (remainder.length > 0) socket.write(remainder);
    const initialHead = Buffer.isBuffer(head) ? head : Buffer.from(head || '');
    if (initialHead.length > 0) upstream.write(initialHead);
    upstream.pipe(socket);
    socket.pipe(upstream);
    socket.on('data', touch);
    upstream.on('data', touch);
    touch();
  };

  upstream.on('data', onHandshakeData);
  upstream.on('error', () => {
    if (handshakeDone) destroyQuietly(socket);
    else fail(502, 'WebSocket upstream connection failed');
  });
  upstream.on('close', () => {
    clearTimers();
    if (handshakeDone) {
      try { socket.end(); } catch { }
    } else {
      fail(502, 'WebSocket upstream closed before handshake');
    }
  });
  return { target, upstream, headers };
}

export class SandboxRouter {
  constructor(options = {}) {
    if (options.provider && typeof options.provider === 'object' && typeof options.provider.resolve === 'function') {
      this.provider = options.provider;
    } else {
      this.provider = createSandboxProvider(options);
    }
    this.prefix = options.prefix || '';
  }

  capabilities() {
    return typeof this.provider.capabilities === 'function'
      ? this.provider.capabilities()
      : { provider: this.provider.kind || 'custom', websocket: 'unknown' };
  }

  resolve(pathname) {
    const params = parseSandboxPath(pathname);
    if (params == null) return null;
    params.target = this.provider.resolve(params);
    return params;
  }

  resolveRequest(req) {
    const rawUrl = String(req?.url || '/');
    const pathname = rawUrl.split('?')[0];
    let params = this.resolve(pathname);
    if (params) return params;
    const headers = req?.headers || {};
    const sandboxId = headers['x-sandbox-id'];
    if (sandboxId === undefined) return null;
    const namespace = headers['x-sandbox-namespace'] || 'default';
    params = {
      namespace: validateSandboxSegment(namespace, 'namespace'),
      sandboxId: validateSandboxSegment(sandboxId, 'sandboxId'),
      rest: pathname.replace(/^\/+/, ''),
      prefix: '',
      trailingSlash: pathname.endsWith('/'),
    };
    params.target = this.provider.resolve(params);
    return params;
  }

  upgrade(req, socket, head, targetBase) {
    if (req === undefined || req === null) {
      throw new SandboxError(
        'SANDBOX_WEBSOCKET_LOCAL_UNSUPPORTED',
        'WebSocket upgrade needs a request plus a remote targetBase; the local provider does not host a WebSocket endpoint',
        501,
      );
    }
    const route = this.resolveRequest(req);
    if (route === null) throw new SandboxError('SANDBOX_ROUTE_REQUIRED', 'sandbox path or X-Sandbox-ID header is required', 400);
    const target = route.target || {};
    const base = targetBase || target.targetBase || target.websocketTarget || this.provider.websocketTarget;
    if (base === undefined || base === null || base === '') {
      throw new SandboxError(
        'SANDBOX_WEBSOCKET_LOCAL_UNSUPPORTED',
        'local/docker providers do not host a WebSocket endpoint; pass a real remote targetBase or use KubernetesTargetProvider',
        501,
      );
    }
    return proxyWebSocketUpgrade(req, socket, head, base);
  }
}

export function registerSandboxRoutes(route, helpers = {}) {
  const provider = helpers.provider || createSandboxProvider({ ...helpers, rootDir: helpers.rootDir });
  const router = new SandboxRouter({ provider });
  const ok = helpers.ok || ((result) => ({ code: '0', message: 'Success', result }));
  const fail = helpers.fail || ((code, message) => ({ code: String(code), message, result: null }));
  const auth = (req, p) => helpers.requireUser ? helpers.requireUser(req, p) : { user: { id: 'local' }, anon: false };
  route('GET', '/sandbox/health', async () => ok({ ok: true, provider: provider.kind || 'custom', capabilities: router.capabilities() }));
  route('GET', '/sandbox/providers', async () => ok(router.capabilities()));
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
    try { return ok(await provider.runCommand(p, body.command, { timeoutMs: body.timeoutMs })); } catch (err) { return fail(err.code || '5000', err.message); }
  });
}
