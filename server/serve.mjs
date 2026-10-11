#!/usr/bin/env node
// novix-open server: zero dependencies, one process.
//   node server/serve.mjs            -> http://127.0.0.1:8081

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathOf, mimeOf, json, DATA_DIR } from './lib/util.mjs';
import { handleApi } from './routes/api.mjs';
import { ensureDir, llmConfiguredSafe } from './lib/boot.mjs';

const PORT_SITE = Number(process.env.PORT_SITE || 8081);
const APP_DIR = process.env.APP_DIR ? path.resolve(process.env.APP_DIR) : path.resolve(process.cwd(), 'app/dist');

ensureDir(DATA_DIR);

function sendFile(res, file) {
  const stat = fs.statSync(file);
  res.writeHead(200, {
    'Content-Type': mimeOf(file),
    'Content-Length': stat.size,
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

function serveStatic(res, pathname) {
  const candidate = path.join(APP_DIR, pathname);
  if (candidate.startsWith(APP_DIR) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return sendFile(res, candidate);
  }
  // SPA fallback
  const index = path.join(APP_DIR, 'index.html');
  if (fs.existsSync(index)) return sendFile(res, index);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(
    `<!doctype html><meta charset="utf-8"><title>novix-open</title>
     <div style="font:14px/1.6 system-ui;padding:48px;max-width:720px;margin:0 auto">
     <h1>novix-open is running</h1>
     <p>The UI bundle was not built yet. Run:</p>
     <pre>cd app && npm install && npm run build</pre>
     <p>then reload. API is live at <code>/api/...</code>.</p></div>`
  );
}

const server = http.createServer(async (req, res) => {
  const pathname = decodeURIComponent(pathOf(req.url));
  try {
    if (pathname === '/healthz') return json(res, 200, { ok: true, llmConfigured: llmConfiguredSafe() });
    if (pathname.startsWith('/api/') || pathname === '/api') return handleApi(req, res, pathname, req.url);
    if (pathname === '/favicon.ico') {
      const f = path.join(APP_DIR, 'favicon.svg');
      if (fs.existsSync(f)) return sendFile(res, f);
    }
    return serveStatic(res, pathname);
  } catch (e) {
    return json(res, 500, { code: '5000', message: String(e?.message || e), result: null });
  }
});

server.listen(PORT_SITE, () => {
  const mode = llmConfiguredSafe() ? 'LLM configured' : 'LLM NOT configured (offline sketch mode)';
  console.log(`[novix-open] site   http://127.0.0.1:${PORT_SITE}`);
  console.log(`[novix-open] api    http://127.0.0.1:${PORT_SITE}/api`);
  console.log(`[novix-open] data   ${DATA_DIR}`);
  console.log(`[novix-open] app    ${APP_DIR}${fs.existsSync(APP_DIR) ? '' : '  (missing — build app/ first)'}`);
  console.log(`[novix-open] llm    ${mode}`);
});

server.on('error', (e) => {
  console.error('[novix-open] server error', e);
  process.exit(1);
});
