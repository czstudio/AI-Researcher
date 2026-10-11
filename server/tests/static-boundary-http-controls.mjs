// Real-HTTP static directory boundary regression (seat contract:
// "正常HTML/JS/CSS保留，兄弟目录前缀碰撞/编码路径穿越/符号链接逃逸负例拒绝，SPA深路由正例通过").
//
// Boots the actual server against the real app/dist and synthetic fixtures:
//   - sibling-prefix directory (app/dist-private-canary-<rand>/) with a canary file
//   - outside-repo canary in os.tmpdir()
//   - symlink INSIDE app/dist pointing at the outside canary
// Negative requests must return 404 and NEVER return canary bytes; normal
// assets/SPA must stay byte-identical. All fixtures are synthetic and removed
// afterwards; no credentials, no provider, no network beyond loopback.
//
// Run: node server/tests/static-boundary-http-controls.mjs

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const REPO = path.resolve(new URL('..', import.meta.url).pathname, '..');
const APP_DIR = path.join(REPO, 'app', 'dist');
const PORT = 7199 + Math.floor(Math.random() * 500);
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'novix-static-data-'));
const OUTSIDE = fs.mkdtempSync(path.join(os.tmpdir(), 'novix-static-outside-'));
const RAND = crypto.randomBytes(4).toString('hex');
const SIBLING_DIR = path.join(REPO, 'app', `dist-private-canary-${RAND}`);
const CANARY = `synthetic_canary_${RAND}`;

const rows = [];
function expect(cond, name, detail) {
  rows.push({ name, pass: !!cond, detail: String(detail) });
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name} :: ${detail}`);
  if (!cond) process.exitCode = 1;
}

function rawGet(pathAndQuery) {
  // raw socket GET: no client-side URL normalization, server sees the encoded path
  return new Promise((resolve, reject) => {
    const s = crypto.randomBytes(8).toString('hex');
    const req = [
      `GET ${pathAndQuery} HTTP/1.1`,
      `Host: 127.0.0.1:${PORT}`,
      'Connection: close',
      `X-Discard: ${s}`,
      '', '',
    ].join('\r\n');
    const sock = import('node:net').then((net) => {
      const c = net.connect(PORT, '127.0.0.1', () => c.write(req));
      let buf = '';
      c.on('data', (d) => { buf += d.toString(); });
      c.on('end', () => {
        const m = buf.match(/^HTTP\/1\.1 (\d+)/);
        const body = buf.split('\r\n\r\n').slice(1).join('\r\n\r\n');
        resolve({ status: m ? Number(m[1]) : 0, body });
      });
      c.on('error', reject);
    });
  });
}

async function main() {
  if (!fs.existsSync(APP_DIR)) throw new Error('app/dist missing — build app first');
  // synthetic fixtures
  fs.mkdirSync(SIBLING_DIR, { recursive: true });
  fs.writeFileSync(path.join(SIBLING_DIR, 'canary.txt'), CANARY);
  const outsideCanaryPath = path.join(OUTSIDE, `canary-${RAND}.txt`);
  fs.writeFileSync(outsideCanaryPath, CANARY);
  const linkName = `escape-link-${RAND}.txt`;
  fs.symlinkSync(outsideCanaryPath, path.join(APP_DIR, linkName));

  const server = spawn('node', ['server/serve.mjs'], {
    cwd: REPO,
    env: { ...process.env, PORT_SITE: String(PORT), NOVIX_DATA_DIR: DATA },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/healthz`);
      up = res.status === 200;
    } catch { /* retry */ }
  }
  if (!up) throw new Error('server not healthy');
  expect(true, 'fresh-server-health', `port=${PORT}`);

  // positives: normal assets byte-identical
  const root = await fetch(`http://127.0.0.1:${PORT}/`).then((r) => r.text());
  expect(root.includes('<!doctype html') || root.includes('<!DOCTYPE html'), 'root-html-preserved', `${root.length}B`);
  const assetsDir = path.join(APP_DIR, 'assets');
  const assetFiles = fs.existsSync(assetsDir)
    ? fs.readdirSync(assetsDir).filter((f) => /\.(js|css|svg)$/.test(f)).slice(0, 3)
    : [];
  for (const f of assetFiles) {
    const disk = fs.readFileSync(path.join(assetsDir, f));
    const res = await fetch(`http://127.0.0.1:${PORT}/assets/${encodeURIComponent(f)}`);
    const buf = Buffer.from(await res.arrayBuffer());
    expect(res.status === 200 && buf.equals(disk), `asset-byte-identical:${f}`, `${res.status} ${buf.length}B`);
  }
  const deep = await fetch(`http://127.0.0.1:${PORT}/chat/some/deep/route`);
  expect(deep.status === 200 && (await deep.text()).includes('<!doctype html'), 'spa-deep-route-preserved', '200 index fallback');

  // negative 1: sibling-prefix collision via encoded traversal (the seat's canary path shape)
  const sib = await rawGet(`/%2e%2e%2f${path.basename(SIBLING_DIR)}/canary.txt`);
  expect(sib.status === 404 && !sib.body.includes(CANARY), 'sibling-prefix-encoded-traversal-denied', `status=${sib.status}, canaryLeaked=${sib.body.includes(CANARY)}`);

  // negative 2: deep encoded traversal to outside-repo canary
  const rel = path.relative(APP_DIR, OUTSIDE).split(path.sep);
  const ups = rel.map(() => '%2e%2e').join('%2f');
  const out = await rawGet(`/${ups}%2f${path.basename(OUTSIDE)}%2fcanary-${RAND}.txt`);
  expect(out.status === 404 && !out.body.includes(CANARY), 'outside-encoded-traversal-denied', `status=${out.status}, canaryLeaked=${out.body.includes(CANARY)}`);

  // negative 3: symlink escape from inside app/dist to outside canary
  const link = await fetch(`http://127.0.0.1:${PORT}/${linkName}`);
  const linkBody = await link.text();
  expect(link.status === 404 && !linkBody.includes(CANARY), 'symlink-escape-denied', `status=${link.status}, canaryLeaked=${linkBody.includes(CANARY)}`);

  // negative 4: plain ../ (normalized by the HTTP client to a same-root path) stays 200-SPA, never canary
  const plain = await fetch(`http://127.0.0.1:${PORT}/assets/../../../../${path.basename(OUTSIDE)}/canary-${RAND}.txt`);
  const plainBody = await plain.text();
  expect(!plainBody.includes(CANARY), 'plain-dotdot-never-canary', `status=${plain.status}, canaryLeaked=${plainBody.includes(CANARY)}`);

  // cleanup fixtures
  server.kill('SIGTERM');
  const pass = rows.filter((r) => r.pass).length;
  console.log(`SUMMARY static_boundary rows=${rows.length} pass=${pass} fixtures=synthetic cleanup=done`);
}

main().catch((e) => { console.error('HARNESS ERROR', e); process.exitCode = 1; }).finally(() => {
  try { fs.rmSync(SIBLING_DIR, { recursive: true, force: true }); } catch { /* temp */ }
  try { fs.unlinkSync(path.join(APP_DIR, linkName)); } catch { /* temp */ }
  try { fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(OUTSIDE, { recursive: true, force: true }); } catch { /* temp */ }
});
