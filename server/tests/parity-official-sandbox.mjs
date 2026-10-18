import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import {
  parseSandboxPath,
  rewriteLocation,
  filterRequestHeaders,
  filterResponseHeaders,
  validateHostHeader,
  resolveWebSocketTarget,
  buildWebSocketUpgradeHeaders,
  proxyWebSocketUpgrade,
  LocalSandboxProvider,
  DockerSandboxProvider,
  KubernetesTargetProvider,
  SandboxRouter,
  SandboxError,
  createSandboxProvider,
} from '../lib/sandbox-router.mjs';
import {
  executeOpenNovaTool,
  mergeOpenNovaTools,
  splitCommandLine,
  maybeTruncate,
  OPEN_NOVA_TOOL_DESCRIPTORS,
  ToolError,
} from '../lib/open-nova-tools.mjs';

let pass = 0;
const failures = [];
function ok(name, fn) {
  try {
    fn();
    pass += 1;
    console.log('PASS', name);
  } catch (error) {
    failures.push({ name, error });
    console.error('FAIL', name, error?.message || error);
  }
}
async function okAsync(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log('PASS', name);
  } catch (error) {
    failures.push({ name, error });
    console.error('FAIL', name, error?.message || error);
  }
}
function parse(value) { return parseSandboxPath(value); }
function assertInvalid(value) { assert.throws(() => parseSandboxPath(value), SandboxError); }
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout: ' + label)), ms)),
  ]);
}
function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

ok('path prefix parses namespace sandbox and rest', () => {
  const p = parse('/novix/ml-agent-1/proxy/health');
  assert.deepEqual({ namespace: p.namespace, sandboxId: p.sandboxId, rest: p.rest }, { namespace: 'novix', sandboxId: 'ml-agent-1', rest: 'proxy/health' });
  assert.equal(p.prefix, '/novix/ml-agent-1');
});
ok('path prefix preserves trailing slash metadata', () => assert.equal(parse('/novix/s1/code-server/').trailingSlash, true));
ok('api paths are not sandbox targets', () => assert.equal(parseSandboxPath('/api/chat/'), null));
ok('encoded reserved root still cannot be routed', () => assert.equal(parseSandboxPath('/%61pi/chat'), null));
ok('health path is not a sandbox target', () => assert.equal(parseSandboxPath('/healthz'), null));
ok('short paths are not sandbox targets', () => assert.equal(parseSandboxPath('/novix'), null));
ok('raw traversal rejected', () => assertInvalid('/novix/../etc/passwd'));
ok('encoded dot traversal rejected', () => assertInvalid('/novix/%2e%2e/secret'));
ok('encoded dot traversal rejected in remainder', () => assertInvalid('/novix/s1/foo/%2e%2e'));
ok('double-encoded dot traversal rejected', () => assertInvalid('/novix/%252e%252e/secret'));
ok('encoded slash rejected', () => assertInvalid('/novix%2fs1/secret'));
ok('encoded backslash rejected', () => assertInvalid('/novix/s1/%5csecret'));
ok('raw backslash rejected', () => assertInvalid('/novix/s1/foo\\bar'));
ok('double slash rejected', () => assertInvalid('/novix/s1//secret'));
ok('null/control characters rejected', () => assertInvalid('/novix/s1/%00secret'));
ok('malformed percent encoding rejected', () => assertInvalid('/novix/%zz/secret'));
ok('oversized path segment rejected', () => assertInvalid('/novix/' + 'a'.repeat(256) + '/secret'));
ok('invalid namespace rejected', () => assertInvalid('/no vix/s1/secret'));
ok('invalid sandbox id rejected', () => assertInvalid('/novix/s1:bad/secret'));
ok('host header injection rejected', () => assert.throws(() => validateHostHeader('good.example\r\nX-Injected: yes'), SandboxError));
ok('host header path injection rejected', () => assert.throws(() => validateHostHeader('good.example/evil'), SandboxError));
ok('valid host with port accepted', () => assert.equal(validateHostHeader('127.0.0.1:8080'), '127.0.0.1:8080'));
ok('location rewrite preserves absolute origin', () => assert.equal(rewriteLocation('http://10.0.0.4:8080/a?b=1', '/novix/s1'), 'http://10.0.0.4:8080/novix/s1/a?b=1'));
ok('location rewrite idempotent', () => assert.equal(rewriteLocation('/novix/s1/a', '/novix/s1'), '/novix/s1/a'));
ok('request header hygiene strips host and hop headers', () => {
  const out = filterRequestHeaders({ host: 'evil', connection: 'keep-alive', 'proxy-connection': 'x', 'x-test': 'ok' });
  assert.deepEqual(out, { 'x-test': 'ok' });
});
ok('request header hygiene rejects CRLF injection', () => assert.throws(() => filterRequestHeaders({ 'x-test': 'ok\r\nX-Evil: yes' }), SandboxError));
ok('response header hygiene strips hop headers', () => assert.deepEqual(filterResponseHeaders({ upgrade: 'websocket', 'x-ok': '1' }), { 'x-ok': '1' }));

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'novix-sandbox-'));
const provider = new LocalSandboxProvider({ rootDir: root, timeoutMs: 5000 });
provider.writeFile({ namespace: 'novix', sandboxId: 's1' }, 'notes/a.txt', 'alpha');
provider.writeFile({ namespace: 'novix', sandboxId: 's2' }, 'notes/a.txt', 'beta');

ok('local provider isolates workspaces', () => {
  assert.equal(provider.readFile({ namespace: 'novix', sandboxId: 's1' }, 'notes/a.txt'), 'alpha');
  assert.equal(provider.readFile({ namespace: 'novix', sandboxId: 's2' }, 'notes/a.txt'), 'beta');
});
ok('local provider rejects traversal reads', () => assert.throws(() => provider.readFile({ namespace: 'novix', sandboxId: 's1' }, '../other/secret'), SandboxError));
ok('local provider rejects invalid workspace identifiers', () => assert.throws(() => provider.workspace('..', 's1'), SandboxError));
await okAsync('local provider executes in workspace', async () => {
  const routed = await provider.runCommand({ namespace: 'novix', sandboxId: 's1' }, 'pwd');
  assert.equal(routed.exitCode, 0);
  assert.ok(routed.output.includes('novix'));
});
await okAsync('local provider timeout kills child', async () => {
  const slow = await provider.runCommand({ namespace: 'novix', sandboxId: 's1' }, 'sleep 3', { timeoutMs: 100 });
  assert.equal(slow.timedOut, true);
});
await okAsync('docker provider fails honestly when CLI unavailable', async () => {
  const docker = new DockerSandboxProvider({ rootDir: root, dockerCmd: '/definitely/not/a/docker-binary', probeTimeoutMs: 500 });
  assert.equal(await docker.available(), false);
  await assert.rejects(
    () => docker.runCommand({ namespace: 'novix', sandboxId: 's1' }, 'true'),
    (error) => error instanceof SandboxError && error.code === 'SANDBOX_DOCKER_UNAVAILABLE',
  );
});
ok('kubernetes provider resolves DNS target without control-plane claim', () => {
  const k8s = new KubernetesTargetProvider({ namespace: 'team-a', serviceDomain: 'svc.cluster.local', port: 8080 });
  const target = k8s.resolve({ namespace: 'team-a', sandboxId: 'sandbox-1' });
  assert.equal(target.kind, 'kubernetes');
  assert.equal(target.targetBase, 'http://sandbox-1.team-a.svc.cluster.local:8080');
  assert.equal(target.controlPlane, false);
  assert.match(target.note, /control-plane/);
});
ok('unknown provider is rejected', () => assert.throws(() => createSandboxProvider({ provider: 'mystery' }), (error) => error instanceof SandboxError && error.code === 'SANDBOX_PROVIDER_UNKNOWN'));
ok('router factory accepts local provider name', () => assert.equal(new SandboxRouter({ provider: 'local', rootDir: root }).provider.kind, 'local'));
ok('router factory accepts kubernetes provider name', () => assert.equal(new SandboxRouter({ provider: 'kubernetes', namespace: 'default' }).provider.kind, 'kubernetes'));
ok('router local websocket upgrade has explicit limitation', () => {
  assert.throws(() => new SandboxRouter({ provider }).upgrade({ url: '/novix/s1/ws', headers: {} }, {}, Buffer.alloc(0)), (error) => error instanceof SandboxError && error.code === 'SANDBOX_WEBSOCKET_LOCAL_UNSUPPORTED');
});
ok('unknown custom provider object is rejected by factory', () => assert.throws(() => createSandboxProvider({ provider: { kind: 'weird' } }), SandboxError));

ok('websocket target strips sandbox prefix and keeps query', () => {
  const target = resolveWebSocketTarget({ url: '/novix/s1/code-server/?trace=1', headers: { host: 'router.local' } }, 'http://10.0.0.5:9090');
  assert.equal(target.path, '/code-server/?trace=1');
  assert.equal(target.upstreamUrl, 'ws://10.0.0.5:9090/code-server/?trace=1');
});
ok('websocket target supports a configured base path', () => {
  const target = resolveWebSocketTarget({ url: '/novix/s1/chat/socket?x=1', headers: { host: 'router.local' } }, 'http://127.0.0.1:9000/base/');
  assert.equal(target.path, '/base/chat/socket?x=1');
});
ok('websocket target rejects credential-bearing target', () => assert.throws(() => resolveWebSocketTarget({ url: '/novix/s1/ws', headers: {} }, 'ws://user:pass@127.0.0.1:9000'), SandboxError));
ok('websocket upgrade header whitelist and host rewrite', () => {
  const target = { hostHeader: '127.0.0.1:9000' };
  const headers = buildWebSocketUpgradeHeaders({
    headers: {
      host: 'router.local',
      'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'sec-websocket-version': '13',
      'sec-websocket-protocol': 'chat',
      cookie: 'session=one',
      'x-evil': 'drop-me',
      connection: 'Upgrade',
      upgrade: 'websocket',
    },
  }, target);
  assert.equal(headers.host, '127.0.0.1:9000');
  assert.equal(headers.cookie, 'session=one');
  assert.equal(headers['x-forwarded-host'], 'router.local');
  assert.equal(headers['x-evil'], undefined);
  assert.equal(headers.connection, 'Upgrade');
});
ok('websocket upgrade rejects invalid key', () => assert.throws(() => buildWebSocketUpgradeHeaders({ headers: { 'sec-websocket-key': 'short' } }, { hostHeader: '127.0.0.1:1' }), SandboxError));
ok('websocket upgrade rejects non-version-13', () => assert.throws(() => buildWebSocketUpgradeHeaders({ headers: { 'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==', 'sec-websocket-version': '8' } }, { hostHeader: '127.0.0.1:1' }), SandboxError));

await okAsync('websocket proxy tunnels frames with path-prefix and header hygiene', async () => {
  const upstreamSockets = new Set();
  let seen = null;
  const upstream = http.createServer();
  upstream.on('upgrade', (req, socket) => {
    seen = {
      url: req.url,
      host: req.headers.host,
      cookie: req.headers.cookie,
      forwardedHost: req.headers['x-forwarded-host'],
      evil: req.headers['x-evil'],
    };
    upstreamSockets.add(socket);
    socket.on('close', () => upstreamSockets.delete(socket));
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: dummy\r\n\r\n');
    socket.on('data', (data) => socket.write(Buffer.concat([Buffer.from('echo:'), data])));
  });
  const upstreamPort = await listen(upstream);
  const router = http.createServer();
  router.on('upgrade', (req, socket, head) => proxyWebSocketUpgrade(req, socket, head, 'http://127.0.0.1:' + upstreamPort, {
    connectTimeoutMs: 1000,
    handshakeTimeoutMs: 1000,
    idleTimeoutMs: 4000,
  }));
  const routerPort = await listen(router);
  const client = net.connect(routerPort, '127.0.0.1');
  try {
    const received = await withTimeout(new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      client.on('connect', () => {
        client.write('GET /novix/s1/ws?trace=1 HTTP/1.1\r\n' +
          'Host: router.local\r\n' +
          'Upgrade: websocket\r\n' +
          'Connection: Upgrade\r\n' +
          'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n' +
          'Sec-WebSocket-Version: 13\r\n' +
          'Cookie: session=one\r\n' +
          'X-Evil: drop-me\r\n\r\n' +
          'early');
      });
      client.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);
        if (buffer.toString('latin1').includes('echo:early')) resolve(buffer);
      });
      client.on('error', reject);
    }), 5000, 'websocket echo');
    const text = received.toString('latin1');
    assert.match(text, /HTTP\/1\.1 101 Switching Protocols/);
    assert.match(text, /echo:early/);
    assert.equal(seen.url, '/ws?trace=1');
    assert.equal(seen.host, '127.0.0.1:' + upstreamPort);
    assert.equal(seen.cookie, 'session=one');
    assert.equal(seen.forwardedHost, 'router.local');
    assert.equal(seen.evil, undefined);
  } finally {
    client.destroy();
    for (const socket of upstreamSockets) socket.destroy();
    await closeServer(router);
    await closeServer(upstream);
  }
});

await okAsync('websocket proxy fails closed and fast for unreachable target', async () => {
  const probe = net.createServer();
  const closedPort = await listen(probe);
  await closeServer(probe);
  const router = http.createServer();
  router.on('upgrade', (req, socket, head) => proxyWebSocketUpgrade(req, socket, head, 'http://127.0.0.1:' + closedPort, {
    connectTimeoutMs: 500,
    handshakeTimeoutMs: 500,
  }));
  const routerPort = await listen(router);
  const client = net.connect(routerPort, '127.0.0.1');
  try {
    const response = await withTimeout(new Promise((resolve, reject) => {
      let buffer = '';
      client.on('connect', () => client.write('GET /novix/s1/ws HTTP/1.1\r\nHost: router.local\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n'));
      client.on('data', (data) => { buffer += data.toString('latin1'); });
      client.on('end', () => resolve(buffer));
      client.on('close', () => resolve(buffer));
      client.on('error', reject);
    }), 4000, 'websocket failure');
    assert.match(response, /HTTP\/1\.1 502 Bad Gateway/);
  } finally {
    client.destroy();
    await closeServer(router);
  }
});

const ws = path.join(root, 'tools');
fs.mkdirSync(ws, { recursive: true });

ok('command line splitter keeps quoted arguments and rejects unterminated quotes', () => {
  assert.deepEqual(splitCommandLine('node "script with space.js" --flag x'), ['node', 'script with space.js', '--flag', 'x']);
  assert.throws(() => splitCommandLine('node "unterminated'), ToolError);
});
ok('response truncation appends explicit clip notice', () => {
  const clipped = maybeTruncate('a'.repeat(40), 10);
  assert.match(clipped, /^aaaaaaaaaa<response clipped>/);
});
await okAsync('PythonExecute returns real output', async () => {
  const py = await executeOpenNovaTool('PythonExecute', { code: 'print(6 * 7)' }, { workspaceDir: ws });
  assert.equal(py.exitCode, 0);
  assert.equal(py.output.trim(), '42');
  assert.equal(py.isolated, false);
});
await okAsync('PythonExecute honors timeout', async () => {
  const py = await executeOpenNovaTool('PythonExecute', { code: 'import time; time.sleep(2)', timeout_ms: 100 }, { workspaceDir: ws });
  assert.equal(py.timedOut, true);
  assert.equal(py.success, false);
});
await okAsync('PythonExecute docker isolation fails honestly when docker is unavailable', async () => {
  const py = await executeOpenNovaTool('PythonExecute', { code: 'print(1)' }, {
    workspaceDir: ws,
    dockerImage: 'python:3.12-alpine',
    dockerCmd: '/definitely/not/a/docker-binary',
  });
  assert.equal(py.isolated, true);
  assert.equal(py.unavailable, true);
  assert.equal(py.success, false);
  assert.match(py.output, /docker isolation unavailable/);
});

const browserScript = path.join(ws, 'browser-helper.mjs');
fs.writeFileSync(browserScript, [
  "const args = process.argv.slice(2);",
  "const action = args[args.indexOf('--action') + 1];",
  "const payload = JSON.parse(args[args.indexOf('--payload') + 1]);",
  "console.log(JSON.stringify({ action, payload, argvLength: args.length }));",
].join('\n'));
const browserTimeoutScript = path.join(ws, 'browser-timeout.mjs');
fs.writeFileSync(browserTimeoutScript, 'setTimeout(() => process.exit(0), 2000);\n');

await okAsync('BrowserUse invokes configured external CLI argv-safely', async () => {
  const previous = process.env.BROWSER_AUTOMATION_CMD;
  process.env.BROWSER_AUTOMATION_CMD = process.execPath + ' ' + browserScript;
  try {
    const hostileUrl = 'https://example.com/;touch should-not-run';
    const result = await executeOpenNovaTool('BrowserUse', { action: 'go_to_url', url: hostileUrl }, { workspaceDir: ws });
    assert.equal(result.ok, true);
    assert.equal(result.status, 'ok');
    assert.equal(result.result.action, 'go_to_url');
    assert.equal(result.result.payload.url, hostileUrl);
    assert.equal(fs.existsSync(path.join(ws, 'should-not-run')), false);
    assert.equal(fs.existsSync(path.join(ws, ';touch')), false);
  } finally {
    if (previous === undefined) delete process.env.BROWSER_AUTOMATION_CMD;
    else process.env.BROWSER_AUTOMATION_CMD = previous;
  }
});
await okAsync('BrowserUse timeout returns honest timeout status', async () => {
  const previous = process.env.BROWSER_AUTOMATION_CMD;
  process.env.BROWSER_AUTOMATION_CMD = process.execPath + ' ' + browserTimeoutScript;
  try {
    const result = await executeOpenNovaTool('BrowserUse', { action: 'go_back', timeout_ms: 100 }, { workspaceDir: ws });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'timeout');
  } finally {
    if (previous === undefined) delete process.env.BROWSER_AUTOMATION_CMD;
    else process.env.BROWSER_AUTOMATION_CMD = previous;
  }
});
await okAsync('BrowserUse is honest when unconfigured', async () => {
  const previous = process.env.BROWSER_AUTOMATION_CMD;
  delete process.env.BROWSER_AUTOMATION_CMD;
  try {
    const browser = await executeOpenNovaTool('BrowserUse', { action: 'open', url: 'https://example.com' }, { workspaceDir: ws });
    assert.equal(browser.status, 'not_configured');
  } finally {
    if (previous !== undefined) process.env.BROWSER_AUTOMATION_CMD = previous;
  }
});
await okAsync('BrowserUse rejects unsupported action and non-http URL', async () => {
  const previous = process.env.BROWSER_AUTOMATION_CMD;
  process.env.BROWSER_AUTOMATION_CMD = process.execPath + ' ' + browserScript;
  try {
    await assert.rejects(() => executeOpenNovaTool('BrowserUse', { action: 'destroy-everything' }, { workspaceDir: ws }), ToolError);
    await assert.rejects(() => executeOpenNovaTool('BrowserUse', { action: 'go_to_url', url: 'file:///etc/passwd' }, { workspaceDir: ws }), ToolError);
  } finally {
    if (previous === undefined) delete process.env.BROWSER_AUTOMATION_CMD;
    else process.env.BROWSER_AUTOMATION_CMD = previous;
  }
});

await okAsync('FileSaver writes workspace file', async () => {
  const saved = await executeOpenNovaTool('FileSaver', { path: 'doc.txt', content: 'one two' }, { workspaceDir: ws });
  assert.equal(saved.bytes, 7);
  assert.equal(fs.readFileSync(path.join(ws, 'doc.txt'), 'utf8'), 'one two');
});
await okAsync('FileSaver mode append appends content', async () => {
  await executeOpenNovaTool('FileSaver', { file_path: 'doc.txt', content: ' three', mode: 'a' }, { workspaceDir: ws });
  assert.equal(fs.readFileSync(path.join(ws, 'doc.txt'), 'utf8'), 'one two three');
});
await okAsync('FileSaver rejects traversal', async () => {
  await assert.rejects(() => executeOpenNovaTool('FileSaver', { path: '../escape.txt', content: 'x' }, { workspaceDir: ws }), ToolError);
});

await okAsync('StrReplaceEditor create writes a new file', async () => {
  const created = await executeOpenNovaTool('StrReplaceEditor', { command: 'create', path: 'editor.txt', file_text: 'one\ntwo\nthree\nfour\nfive\n' }, { workspaceDir: ws });
  assert.equal(created.created, true);
  assert.match(created.output, /created successfully/);
});
await okAsync('StrReplaceEditor create refuses to overwrite', async () => {
  await assert.rejects(() => executeOpenNovaTool('StrReplaceEditor', { command: 'create', path: 'editor.txt', file_text: 'replace' }, { workspaceDir: ws }), /already exists/);
});
await okAsync('StrReplaceEditor view returns numbered lines with view_range', async () => {
  const viewed = await executeOpenNovaTool('StrReplaceEditor', { command: 'view', path: 'editor.txt', view_range: [2, 3] }, { workspaceDir: ws });
  assert.match(viewed.output, /^\s+2\ttwo/m);
  assert.match(viewed.output, /^\s+3\tthree/m);
  assert.doesNotMatch(viewed.output, /^\s+4\tfour/m);
  assert.equal(viewed.initLine, 2);
});
await okAsync('StrReplaceEditor view_range -1 reads to EOF', async () => {
  const viewed = await executeOpenNovaTool('StrReplaceEditor', { command: 'view', path: 'editor.txt', view_range: [4, -1] }, { workspaceDir: ws });
  assert.match(viewed.output, /four/);
  assert.match(viewed.output, /five/);
});
await okAsync('StrReplaceEditor rejects invalid view_range', async () => {
  await assert.rejects(() => executeOpenNovaTool('StrReplaceEditor', { command: 'view', path: 'editor.txt', view_range: [9, 10] }, { workspaceDir: ws }), ToolError);
});
await okAsync('StrReplaceEditor lists directory to two levels', async () => {
  fs.mkdirSync(path.join(ws, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'sub', 'nested.txt'), 'x');
  fs.mkdirSync(path.join(ws, '.hidden'), { recursive: true });
  const viewed = await executeOpenNovaTool('StrReplaceEditor', { command: 'view', path: '.' }, { workspaceDir: ws });
  assert.equal(viewed.isDirectory, true);
  assert.ok(viewed.entries.includes('sub/'));
  assert.ok(viewed.entries.includes('sub/nested.txt'));
  assert.equal(viewed.entries.some((entry) => entry.startsWith('.hidden')), false);
});
await okAsync('StrReplaceEditor str_replace updates exactly one occurrence', async () => {
  const replaced = await executeOpenNovaTool('StrReplaceEditor', { command: 'str_replace', path: 'editor.txt', old_str: 'two', new_str: 'TWO' }, { workspaceDir: ws });
  assert.equal(replaced.replaced, true);
  assert.match(fs.readFileSync(path.join(ws, 'editor.txt'), 'utf8'), /TWO/);
});
await okAsync('StrReplaceEditor rejects ambiguous replace', async () => {
  fs.writeFileSync(path.join(ws, 'dup.txt'), 'x x');
  await assert.rejects(() => executeOpenNovaTool('StrReplaceEditor', { command: 'str_replace', path: 'dup.txt', old_str: 'x', new_str: 'y' }, { workspaceDir: ws }), /more than once/);
});
await okAsync('StrReplaceEditor insert places text after requested line', async () => {
  await executeOpenNovaTool('StrReplaceEditor', { command: 'insert', path: 'editor.txt', insert_line: 1, new_str: 'inserted' }, { workspaceDir: ws });
  const lines = fs.readFileSync(path.join(ws, 'editor.txt'), 'utf8').split('\n');
  assert.equal(lines[0], 'one');
  assert.equal(lines[1], 'inserted');
  assert.equal(lines[2], 'TWO');
});
await okAsync('StrReplaceEditor undo_edit is explicitly unsupported', async () => {
  await assert.rejects(
    () => executeOpenNovaTool('StrReplaceEditor', { command: 'undo_edit', path: 'editor.txt' }, { workspaceDir: ws }),
    (error) => error instanceof ToolError && error.code === 'TOOL_UNDO_UNSUPPORTED',
  );
});
await okAsync('StrReplaceEditor truncates oversized view with visible notice', async () => {
  fs.writeFileSync(path.join(ws, 'large.txt'), 'x'.repeat(17000));
  const viewed = await executeOpenNovaTool('StrReplaceEditor', { command: 'view', path: 'large.txt' }, { workspaceDir: ws });
  assert.equal(viewed.truncated, true);
  assert.match(viewed.output, /<response clipped>/);
});
await okAsync('StrReplaceEditor rejects traversal path', async () => {
  await assert.rejects(() => executeOpenNovaTool('StrReplaceEditor', { command: 'view', path: '../outside.txt' }, { workspaceDir: ws }), ToolError);
});
await okAsync('FileSaver rejects invalid mode', async () => {
  await assert.rejects(() => executeOpenNovaTool('FileSaver', { path: 'x.txt', content: 'x', mode: 'x' }, { workspaceDir: ws }), ToolError);
});
await okAsync('Terminate returns a termination flag', async () => {
  const result = await executeOpenNovaTool('Terminate', { reason: 'done' }, { workspaceDir: ws });
  assert.equal(result.terminated, true);
  assert.equal(result.reason, 'done');
});
await okAsync('unknown tool is rejected', async () => {
  await assert.rejects(() => executeOpenNovaTool('NoSuchTool', {}, { workspaceDir: ws }), (error) => error instanceof ToolError && error.code === 'TOOL_UNKNOWN');
});
ok('mergeOpenNovaTools avoids duplicate names', () => assert.equal(mergeOpenNovaTools(OPEN_NOVA_TOOL_DESCRIPTORS).length, OPEN_NOVA_TOOL_DESCRIPTORS.length));
ok('OpenNova descriptor catalog exposes expected tool names', () => {
  const names = OPEN_NOVA_TOOL_DESCRIPTORS.map((tool) => tool.function.name);
  assert.deepEqual(names, ['PythonExecute', 'BrowserUse', 'StrReplaceEditor', 'FileSaver', 'Terminate']);
});

console.log('SUMMARY parity_official_sandbox rows=' + (pass + failures.length) + ' pass=' + pass + ' fail=' + failures.length);
if (failures.length > 0) {
  for (const failure of failures) console.error('FAILED', failure.name, failure.error?.stack || failure.error);
  process.exitCode = 1;
}
