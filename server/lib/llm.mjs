// Real LLM access. OpenAI-compatible Chat Completions API with SSE streaming.
// Configure one or more gateways in .env; the mode registry keeps the
// `<gateway>__<model-id>` naming so the client can pass modelOverride verbatim.

import https from 'node:https';
import http from 'node:http';
import { URL } from 'node:url';

const GATEWAYS = {
  // gateway prefix -> { baseUrl, apiKeyEnv, defaultModel }
  novix_proxy: { baseUrl: process.env.PROXY_API_BASE, keyEnv: 'PROXY_API_KEY', defaultModel: process.env.PROXY_MODEL || 'gpt-4o-mini' },
  openrouter: { baseUrl: process.env.OPENROUTER_API_BASE || 'https://openrouter.ai/api/v1', keyEnv: 'OPENROUTER_API_KEY', defaultModel: 'openai/gpt-4o-mini' },
  litellm: { baseUrl: process.env.LITELLM_API_BASE, keyEnv: 'LITELLM_API_KEY', defaultModel: process.env.LITELLM_MODEL || 'gpt-4o-mini' },
  kimi: { baseUrl: process.env.KIMI_API_BASE || 'https://api.moonshot.cn/v1', keyEnv: 'KIMI_API_KEY', defaultModel: 'kimi-k2.5' },
  zai: { baseUrl: process.env.ZAI_API_BASE || 'https://open.bigmodel.cn/api/paas/v4', keyEnv: 'ZAI_API_KEY', defaultModel: 'glm-5.1' },
  openai: { baseUrl: process.env.OPENAI_API_BASE || 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY', defaultModel: 'gpt-4o-mini' },
  local: { baseUrl: process.env.LOCAL_API_BASE || 'http://127.0.0.1:11434/v1', keyEnv: 'LOCAL_API_KEY', defaultModel: process.env.LOCAL_MODEL || 'qwen2.5:7b' },
};

// Fallback: a single generic OpenAI-compatible endpoint covers 90% of setups.
const GENERIC = {
  baseUrl: process.env.LLM_API_BASE || '',
  apiKey: process.env.LLM_API_KEY || '',
  model: process.env.LLM_MODEL || 'gpt-4o-mini',
};

export function resolveModel(value) {
  if (!value) return { gateway: 'auto', model: GENERIC.model, baseUrl: GENERIC.baseUrl, apiKey: GENERIC.apiKey };
  const s = String(value);
  const idx = s.indexOf('__');
  if (idx > 0) {
    const gw = s.slice(0, idx);
    const model = s.slice(idx + 2);
    const cfg = GATEWAYS[gw];
    if (cfg && cfg.baseUrl) {
      const apiKey = process.env[cfg.keyEnv] || '';
      return { gateway: gw, model, baseUrl: cfg.baseUrl, apiKey };
    }
    // unknown gateway but a generic endpoint exists -> strip prefix and use it
    return { gateway: 'auto', model: model || GENERIC.model, baseUrl: GENERIC.baseUrl, apiKey: GENERIC.apiKey };
  }
  return { gateway: 'auto', model: s, baseUrl: GENERIC.baseUrl, apiKey: GENERIC.apiKey };
}

export function llmConfigured() {
  if (GENERIC.baseUrl && GENERIC.apiKey) return true;
  return Object.values(GATEWAYS).some((g) => g.baseUrl && process.env[g.keyEnv]);
}

function request({ baseUrl, apiKey, body, onDelta, signal }) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl.replace(/\/+$/, '') + '/chat/completions');
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;
    const payload = JSON.stringify(body);
    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      'Content-Length': Buffer.byteLength(payload),
      Accept: 'text/event-stream',
    };
    if (baseUrl.includes('openrouter')) {
      headers['HTTP-Referer'] = process.env.PUBLIC_ORIGIN || 'http://127.0.0.1:8081';
      headers['X-Title'] = 'novix-open';
    }
    const req = client.request(
      url,
      { method: 'POST', headers, timeout: 0 },
      (res) => {
        if (res.statusCode >= 400) {
          let err = '';
          res.on('data', (c) => (err += c));
          res.on('end', () => reject(new Error(`llm http ${res.statusCode}: ${err.slice(0, 400)}`)));
          return;
        }
        let text = '';
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += chunk;
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            const l = line.trim();
            if (!l.startsWith('data:')) continue;
            const data = l.slice(5).trim();
            if (data === '[DONE]') continue;
            try {
              const json = JSON.parse(data);
              const delta = json?.choices?.[0]?.delta?.content;
              if (typeof delta === 'string' && delta) {
                text += delta;
                onDelta && onDelta(delta);
              }
              if (json?.usage) request.lastUsage = json.usage;
            } catch {
              /* ignore keepalives */
            }
          }
        });
        res.on('end', () => {
          if (buffer.trim().startsWith('data:')) {
            const data = buffer.trim().slice(5).trim();
            if (data && data !== '[DONE]') {
              try {
                const json = JSON.parse(data);
                const delta = json?.choices?.[0]?.delta?.content;
                if (typeof delta === 'string' && delta) {
                  text += delta;
                  onDelta && onDelta(delta);
                }
              } catch {
                /* ignore */
              }
            }
          }
          resolve(text);
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    if (signal) signal.addEventListener('abort', () => req.destroy(new Error('aborted')));
    req.write(payload);
    req.end();
  });
}

/**
 * Stream a chat completion. Falls back to a deterministic offline sketch when
 * no gateway is configured, so the site is fully usable without a key.
 */
export async function chat({ model, messages, temperature = 0.4, maxTokens = 4096, onDelta, signal }) {
  const cfg = resolveModel(model);
  if (cfg.baseUrl && cfg.apiKey) {
    return request({
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey,
      body: { model: cfg.model, messages, temperature, max_tokens: maxTokens, stream: true },
      onDelta,
      signal,
    });
  }
  return offlineSketch({ messages, onDelta });
}

// ---------- offline fallback ----------
function offlineSketch({ messages, onDelta }) {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  const q = last ? String(last.content) : '';
  const sys = messages.find((m) => m.role === 'system');
  const lines = [
    `## Draft answer (offline mode)`,
    '',
    `> No LLM gateway is configured. Set \`LLM_API_BASE\` + \`LLM_API_KEY\` in \`.env\` and restart to get real output.`,
    '',
    `**Request received:** ${q.slice(0, 200)}`,
    '',
    `**Plan that would run:**`,
    `1. ${sys ? 'Apply the agent system contract below.' : 'Classify the request.'}`,
    `2. Decompose into sub-tasks and gather evidence.`,
    `3. Produce the artifact and write it into the session workspace.`,
    '',
    `**System contract in effect:**`,
    '```',
    sys ? String(sys.content).slice(0, 600) : '(none)',
    '```',
  ].join('\n');
  return new Promise((resolve) => {
    let i = 0;
    const timer = setInterval(() => {
      const chunk = lines.slice(i, i + 24);
      i += 24;
      onDelta && onDelta(chunk);
      if (i >= lines.length) {
        clearInterval(timer);
        resolve(lines);
      }
    }, 12);
  });
}
