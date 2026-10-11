#!/usr/bin/env node
// End-to-end smoke test: boots the server, walks the contract, prints a table.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.SMOKE_PORT || 8099);
const DATA = process.env.SMOKE_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'novix-smoke-'));
const BASE = `http://127.0.0.1:${PORT}`;

const child = spawn(process.execPath, ['server/serve.mjs'], {
  env: { ...process.env, PORT_SITE: String(PORT), NOVIX_DATA_DIR: DATA, NOVIX_JWT_SECRET: 'smoke-secret', SANDBOX: 'local' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/healthz`);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start');
}

let pass = 0;
let fail = 0;
const rows = [];

async function step(name, fn) {
  try {
    const detail = await fn();
    pass++;
    rows.push(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    fail++;
    rows.push(`  ✗ ${name} — ${e.message}`);
  }
}

async function call(method, p, { body = null, token = null, fp = null } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;
  if (fp) headers.fingerprint = fp;
  const res = await fetch(`${BASE}/api${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { code: String(res.status), message: text.slice(0, 200), result: null };
  }
  return { status: res.status, ...json };
}

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

async function main() {
  await waitUp();

  await step('GET /site-config/public', async () => {
    const r = await call('GET', '/site-config/public');
    assert(r.code === '0', JSON.stringify(r));
    return `llmConfigured=${r.result.llmConfigured}`;
  });

  await step('GET /models', async () => {
    const r = await call('GET', '/models');
    assert(r.result.models.length === 5, JSON.stringify(r));
    return `${r.result.models.length} models`;
  });

  await step('GET /gallery/list', async () => {
    const r = await call('GET', '/gallery/list');
    assert(r.result.items.length > 0, JSON.stringify(r));
    return `${r.result.items.length} cases`;
  });

  // --- signup / auth ---
  let token = null;
  await step('POST /user/emailSignUp', async () => {
    const r = await call('POST', '/user/emailSignUp?email=smoke@novix.test&password=smoke1234&name=Smoke');
    assert(r.code === '0', JSON.stringify(r));
    token = r.result.token;
    return 'token issued';
  });

  await step('POST /user/getUserInfo', async () => {
    const r = await call('POST', '/user/getUserInfo', { token });
    assert(r.result.user.email === 'smoke@novix.test', JSON.stringify(r));
    return r.result.user.email;
  });

  await step('POST /user/getUserInfo without token -> 401', async () => {
    const r = await call('POST', '/user/getUserInfo');
    assert(r.code === '401' || r.status === 401, JSON.stringify(r));
    return '401 as expected';
  });

  // Code-executing modes need Pro upstream (5019 on free).
  await step('POST /credit/upgrade_plan -> pro', async () => {
    const r = await call('POST', '/credit/upgrade_plan?level=pro', { token });
    assert(r.result.level === 'pro', JSON.stringify(r));
    return `${r.result.level} / ${r.result.credits} cr`;
  });

  // --- session ---
  let sid = null;
  await step('POST /chat_session/create', async () => {
    const r = await call('POST', '/chat_session/create', { token, body: {} });
    assert(r.code === '0', JSON.stringify(r));
    sid = r.result.id;
    return sid;
  });

  // Open the live channel BEFORE the task so we actually observe frames.
  const sse = { status: 0, events: new Set(), reader: null };
  await step('GET /api/chat/ opens the SSE channel', async () => {
    const res = await fetch(`${BASE}/api/chat/?chatSessionId=${sid}`, {
      headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
    });
    sse.status = res.status;
    assert(res.ok, `status ${res.status}`);
    const reader = res.body.getReader();
    sse.reader = reader;
    const dec = new TextDecoder();
    (async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const line of dec.decode(value, { stream: true }).split('\n')) {
            if (line.startsWith('event:')) sse.events.add(line.slice(6).trim());
          }
        }
      } catch {
        /* stream closed */
      }
    })();
    return 'connected';
  });

  await step('POST /task/create_task (validation 4000)', async () => {
    const r = await call('POST', '/task/create_task', { token, body: { chatSessionId: sid, queryContent: '' } });
    assert(r.code === '4000', JSON.stringify(r));
    return '4000 as expected';
  });

  await step('POST /task/create_anonymous_task', async () => {
    const r = await call('POST', '/task/create_anonymous_task', { fp: 'smokefp0001', body: { query: 'hello', queryContent: 'hello' } });
    assert(r.code === '0', JSON.stringify(r));
    return `task ${r.result.id}`;
  });

  // --- real execution: notebook kernel (runs python for real) ---
  let taskId = null;
  await step('POST /task/create_task -> notebook kernel runs', async () => {
    const r = await call('POST', '/task/create_task', {
      token,
      body: { chatSessionId: sid, query: 'profile this dataset', queryContent: 'profile this dataset', mode: 'notebook' },
    });
    assert(r.code === '0', JSON.stringify(r));
    taskId = r.result.id;
    return `task ${taskId}`;
  });

  await step('task reaches terminal state', async () => {
    for (let i = 0; i < 120; i++) {
      const r = await call('GET', `/task/get_task?taskId=${taskId}`, { token });
      if (['finish', 'error'].includes(r.result.status)) {
        assert(r.result.status === 'finish', `status=${r.result.status}`);
        return `${r.result.status}, ${(r.result.steps || []).length} steps`;
      }
      await new Promise((r2) => setTimeout(r2, 500));
    }
    throw new Error('timeout waiting for task');
  });

  await step('artifacts written to workspace', async () => {
    const r = await call('POST', '/chat_session/workspace/subtree', { token, body: { chatSessionId: sid, path: '.' } });
    const names = JSON.stringify(r.result.workspaceTreeJson);
    assert(names.includes('analysis.py'), names.slice(0, 200));
    return 'analysis.py present';
  });

  await step('GET /chat_session/message/list', async () => {
    const r = await call('GET', `/chat_session/message/list?chatSessionId=${sid}`, { token });
    assert(r.result.chatSessionMessages.length >= 1, JSON.stringify(r).slice(0, 200));
    return `${r.result.chatSessionMessages.length} messages`;
  });

  await step('POST /search (arXiv + Crossref, live)', async () => {
    const r = await call('POST', '/search', { token, body: { query: 'sparse attention', topK: 5 } });
    assert(r.code === '0', JSON.stringify(r));
    return `${(r.result.items || []).length} hits`;
  });

  await step('POST /chat_session/share', async () => {
    const r = await call('POST', '/chat_session/share', { token, body: { chatSessionId: sid } });
    assert(r.result.share === true, JSON.stringify(r));
    return r.result.url;
  });

  await step('shared session readable without token', async () => {
    const r = await call('GET', `/chat_session/message/list?chatSessionId=${sid}`);
    assert(r.code === '0', JSON.stringify(r));
    return 'public read OK';
  });

  await step('POST /published/item/publish', async () => {
    const r = await call('POST', '/published/item/publish', { token, body: { chatSessionId: sid } });
    assert(r.result.revisionId, JSON.stringify(r));
    return r.result.revisionId;
  });

  await step('SSE frames observed during the run', async () => {
    assert(sse.events.has('message'), `events: ${[...sse.events].join(',') || '(none)'}`);
    return [...sse.events].join(',');
  });

  await step('credit ledger recorded', async () => {
    const r = await call('POST', '/user/getUserCreditUsage', { token });
    assert((r.result.rows || []).length > 0, JSON.stringify(r).slice(0, 200));
    return `${r.result.rows.length} rows`;
  });

  await step('static UI bundle served', async () => {
    const res = await fetch(`${BASE}/`);
    const text = await res.text();
    assert(text.includes('<div id="app">'), text.slice(0, 120));
    return 'index.html served';
  });
}

main()
  .catch((e) => {
    rows.push(`  ✗ fatal — ${e.message}`);
    fail++;
  })
  .finally(() => {
    console.log('\nnovix-open smoke test');
    console.log(rows.join('\n'));
    console.log(`\n${pass} passed, ${fail} failed  (data: ${DATA})`);
    child.kill('SIGKILL');
    process.exit(fail ? 1 : 0);
  });
