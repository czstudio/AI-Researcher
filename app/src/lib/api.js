// Thin client for the /api contract. Success envelope: {code:"0", result}.

const TOKEN_KEY = 'nova_open_token';
const FP_KEY = 'fingerprint';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}
export function setToken(t) {
  t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY);
}

export function fingerprint() {
  let fp = localStorage.getItem(FP_KEY);
  if (!fp) {
    fp = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    localStorage.setItem(FP_KEY, fp);
  }
  return fp;
}

function headers(extra = {}) {
  const h = { Accept: 'application/json', fingerprint: fingerprint(), ...extra };
  const t = getToken();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

async function call(method, path, { query = {}, body = null, raw = false } = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  const url = `/api${path}${qs.toString() ? `?${qs}` : ''}`;
  const init = { method, headers: headers() };
  if (body !== null && (method === 'POST' || method === 'PUT')) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (raw) return res;
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { code: '5000', message: text.slice(0, 200), result: null };
  }
  if (json.code && json.code !== '0') {
    const e = new Error(json.message || `error ${json.code}`);
    e.code = String(json.code);
    throw e;
  }
  return json.result;
}

export const api = {
  get: (p, o) => call('GET', p, o),
  post: (p, o) => call('POST', p, o),

  // public
  siteConfig: () => call('GET', '/site-config/public'),
  models: () => call('GET', '/models'),
  versionHistory: () => call('GET', '/notification/version-history'),
  gallery: (mode) => call('GET', '/gallery/list', { query: { mode } }),

  // user
  login: (email, password) => call('POST', '/user/login', { query: { email, password } }),
  signUp: (email, password, name) => call('POST', '/user/emailSignUp', { query: { email, password, name } }),
  me: () => call('POST', '/user/getUserInfo'),
  creditInfo: () => call('POST', '/user/getUserCreditInfo'),
  creditUsage: () => call('POST', '/user/getUserCreditUsage'),
  whiteList: () => call('GET', '/user/feature_white_list/enabled'),
  upgradePlan: (level) => call('POST', '/credit/upgrade_plan', { query: { level } }),
  referral: () => call('GET', '/referral/me'),
  notifications: () => call('GET', '/notification/list'),

  // sessions
  createSession: () => call('POST', '/chat_session/create', { body: {} }),
  createAnonymousSession: () => call('POST', '/chat_session/create_anonymous', { body: {} }),
  listSessions: () => call('GET', '/chat_session/list'),
  messages: (sid) => call('GET', '/chat_session/message/list', { query: { chatSessionId: sid } }),
  share: (sid) => call('POST', '/chat_session/share', { body: { chatSessionId: sid } }),
  rename: (sid, title) => call('POST', '/chat_session/rename', { body: { chatSessionId: sid, title } }),
  deleteSession: (sid) => call('POST', '/chat_session/delete', { body: { chatSessionId: sid } }),
  subtree: (sid, p = '.') => call('POST', '/chat_session/workspace/subtree', { body: { chatSessionId: sid, path: p } }),
  homeFilePreview: (sid, p) => call('POST', '/chat_session/workspace/home_file_preview', { body: { chatSessionId: sid, path: p } }),
  downloadUrl: (sid) => call('GET', '/chat_session/workspace/download_workspace_url', { query: { chatSessionId: sid } }),

  // tasks
  createTask: (payload) => call('POST', '/task/create_task', { body: payload }),
  createAnonymousTask: (payload) => call('POST', '/task/create_anonymous_task', { body: payload }),
  getTask: (taskId) => call('GET', '/task/get_task', { query: { taskId } }),
  agents: () => call('GET', '/agents'),

  // files
  batchTempUrls: (names) => call('POST', '/file/batch_temp_urls', { body: { files: names } }),
  uploadComplete: (fileIds) => call('POST', '/file/upload_complete', { body: { fileIds } }),
  upload(file, chatSessionId) {
    const fd = new FormData();
    fd.append('file', file);
    return fetch(`/api/file/upload_stream?chatSessionId=${encodeURIComponent(chatSessionId)}&name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: headers(),
      body: fd,
    }).then((r) => r.json());
  },

  // publish
  publish: (sid) => call('POST', '/published/item/publish', { body: { chatSessionId: sid } }),
  revisionSession: (rid) => call('GET', `/published/revision/${rid}/session`),
  revisionWorkspace: (rid) => call('GET', `/published/revision/${rid}/workspace/subtree`),

  // search
  search: (q) => call('POST', '/search', { body: { query: q, request_id: Date.now(), topK: 20 } }),
};

/**
 * Live stream for a session. Mirrors GET /api/chat/ (fetch + reader, not EventSource)
 * and also polls get_task so trajectories show up without a login.
 */
export function openStream({ chatSessionId, chatStatus = 'init', onMessage, onResponse, onComplete, onError }) {
  const token = getToken();
  const qs = new URLSearchParams({ chatSessionId, chatStatus });
  if (token) qs.set('token', token);
  const controller = new AbortController();
  const url = `/api/chat/?${qs}`;

  fetch(url, {
    method: 'GET',
    headers: { ...headers(), Accept: 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        onError && onError(new Error(`stream ${res.status}`));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let event = 'message';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith(':')) continue;
          if (line.startsWith('event:')) {
            event = line.slice(6).trim();
            continue;
          }
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (event === 'message') onMessage && onMessage(data);
            else if (event === 'response') {
              try {
                onResponse && onResponse(JSON.parse(data));
              } catch {
                onResponse && onResponse({ messages: [] });
              }
            } else if (event === 'complete') onComplete && onComplete();
          } else if (line.trim() === '') event = 'message';
        }
      }
      onComplete && onComplete();
    })
    .catch((e) => {
      if (e.name !== 'AbortError') onError && onError(e);
    });

  return () => controller.abort();
}
