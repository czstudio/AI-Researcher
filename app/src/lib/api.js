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
  if (fp === null || fp === '') {
    fp = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    localStorage.setItem(FP_KEY, fp);
  }
  return fp;
}

export function authHeaders(extra = {}) {
  const h = { Accept: 'application/json', fingerprint: fingerprint(), ...extra };
  const t = getToken();
  if (t) h.Authorization = `Bearer ${t}`;
  return h;
}

function asQuery(query) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) {
    if (v === undefined || v === null || v === '') continue;
    qs.set(k, String(v));
  }
  return qs.toString();
}

async function call(method, path, { query = {}, body = null, raw = false } = {}) {
  const qs = asQuery(query);
  const url = `/api${path}${qs ? `?${qs}` : ''}`;
  const init = { method, headers: authHeaders() };
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
    json = { code: '5000', message: text.slice(0, 240), result: null };
  }
  if (json.code && json.code !== '0') {
    const e = new Error(json.message || `error ${json.code}`);
    e.code = String(json.code);
    e.status = res.status;
    throw e;
  }
  return json.result;
}

function normalizeTreeResult(result) {
  if (result == null || typeof result !== 'object') return result;
  if (typeof result.workspaceTreeJson === 'string') {
    try { result.workspaceTreeJson = JSON.parse(result.workspaceTreeJson); } catch { /* leave the raw string for an honest error state */ }
  }
  return result;
}

async function blobCall(path, query = {}) {
  const qs = asQuery(query);
  const res = await fetch(`/api${path}${qs ? `?${qs}` : ''}`, { headers: authHeaders() });
  if (res.ok === false) throw new Error(`download failed (${res.status})`);
  return res.blob();
}

export const api = {
  get: (p, o) => call('GET', p, o),
  post: (p, o) => call('POST', p, o),

  // public / discovery
  siteConfig: () => call('GET', '/site-config/public'),
  models: () => call('GET', '/models'),
  versionHistory: () => call('GET', '/notification/version-history'),
  gallery: (mode) => call('GET', '/gallery/list', { query: { mode } }),

  // user + account
  login: (email, password) => call('POST', '/user/login', { query: { email, password } }),
  signUp: (email, password, name) => call('POST', '/user/emailSignUp', { query: { email, password, name } }),
  me: () => call('POST', '/user/getUserInfo'),
  creditInfo: () => call('POST', '/user/getUserCreditInfo'),
  creditUsage: () => call('POST', '/user/getUserCreditUsage'),
  whiteList: (feature) => call('GET', '/user/feature_white_list/enabled', { query: { feature } }),
  resetPassword: (email) => call('POST', '/user/resetPassword', { query: { email } }),
  workspaceInterest: () => call('GET', '/user/workspace/interest'),
  notifications: () => call('GET', '/notification/list'),
  latestNotifications: () => call('GET', '/notification/latest'),

  // credit / plans / billing / referrals
  upgradePlan: (level, sku = null) => call('POST', '/credit/upgrade_plan', { query: { level, sku }, body: { level, sku } }),
  subscriptionUpgrade: (action) => call('POST', '/credit/subscription/upgrade', { body: { action } }),
  creditList: () => call('GET', '/credit/list'),
  billingStatements: () => call('GET', '/credit/billing-statements'),
  oneTimePlans: () => call('GET', '/credit/one-time-plans'),
  inviteList: () => call('GET', '/credit/list'),
  cancelSubscription: () => call('POST', '/credit/cancel', { body: {} }),
  invite: () => call('POST', '/credit/invite'),
  referral: () => call('GET', '/referral/me'),
  joinReferral: (inviteId) => call('POST', '/credit/join', { query: { inviteId } }),

  // sessions
  createSession: (mode) => call('POST', '/chat_session/create', { body: { mode } }),
  createAnonymousSession: (mode) => call('POST', '/chat_session/create_anonymous', { body: { mode } }),
  listSessions: () => call('GET', '/chat_session/list'),
  activeSessions: () => call('GET', '/chat_session/active'),
  messages: (sid) => call('GET', '/chat_session/message/list', { query: { chatSessionId: sid } }),
  sessionStatus: (sid) => call('GET', '/chat_session/status', { query: { chatSessionId: sid } }),
  share: (sid) => call('POST', '/chat_session/share', { body: { chatSessionId: sid } }),
  bindAnonymous: (sid) => call('POST', '/chat_session/bind_anonymous', { body: { chatSessionId: sid } }),
  rename: (sid, title) => call('POST', '/chat_session/rename', { body: { chatSessionId: sid, title } }),
  deleteSession: (sid) => call('POST', '/chat_session/delete', { body: { chatSessionId: sid } }),
  workspace: (sid) => call('GET', '/chat_session/workspace', { query: { chatSessionId: sid } }),
  subtree: async (sid, p = '.') => normalizeTreeResult(await call('POST', '/chat_session/workspace/subtree', { body: { chatSessionId: sid, path: p, targets: [[p === '.' ? '' : p, 3]] } })),
  homeFiles: (sid) => call('GET', '/chat_session/workspace/home_files', { query: { chatSessionId: sid } }),
  homeFilePreview: (sid, p) => call('POST', '/chat_session/workspace/home_file_preview', { body: { chatSessionId: sid, path: p } }),
  deleteUpload: (sid, p) => call('POST', '/chat_session/workspace/user_upload/delete', { body: { chatSessionId: sid, path: p } }),
  downloadUrl: (sid) => call('GET', '/chat_session/workspace/download_workspace_url', { query: { chatSessionId: sid } }),
  downloadFile: (fileKey, isDownload = false) => blobCall('/file/download', { fileKey, isDownload }),

  // files upload workflow: batch_temp_urls -> upload_stream -> upload_complete
  batchTempUrls: (names, chatSessionId = '') => call('POST', '/file/batch_temp_urls', { body: { files: names, chatSessionId } }),
  tempUrl: (fileId) => call('GET', '/file/temp_url', { query: { fileId } }),
  ossToken: () => call('GET', '/oss/getSTSToken'),
  putToGcs: (payload) => call('POST', '/file/putToGcs', { body: payload }),
  uploadComplete: (fileIds) => call('POST', '/file/upload_complete', { body: { fileIds } }),
  uploadStream(file, { chatSessionId = '', fileId = '' } = {}) {
    const fd = new FormData();
    fd.append('file', file);
    const qs = asQuery({ chatSessionId, name: file.name, fileId });
    return fetch(`/api/file/upload_stream${qs ? `?${qs}` : ''}`, {
      method: 'POST',
      headers: authHeaders(),
      body: fd,
    }).then(async (r) => {
      const text = await r.text();
      let out = null;
      try { out = JSON.parse(text); } catch { out = { code: '5000', message: text, result: null }; }
      if (out.code && out.code !== '0') throw new Error(out.message || `upload ${out.code}`);
      return out.result;
    });
  },
  async uploadFiles(files, chatSessionId) {
    const accepted = Array.from(files || []);
    if (accepted.length === 0) return { fileIds: [], files: [] };
    let slots = [];
    if (getToken()) {
      try {
        const batch = await api.batchTempUrls(accepted.map((f) => f.name), chatSessionId);
        slots = batch?.items || batch || [];
      } catch {
        slots = [];
      }
    }
    const queue = accepted.map((file, i) => ({ file, fileId: slots[i]?.fileId || '' }));
    const fileIds = [];
    const concurrency = Math.min(5, queue.length);
    let cursor = 0;
    async function worker() {
      while (cursor < queue.length) {
        const item = queue[cursor++];
        const uploaded = await api.uploadStream(item.file, { chatSessionId, fileId: item.fileId });
        if (uploaded?.fileId) fileIds.push(uploaded.fileId);
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    if (fileIds.length) await api.uploadComplete(fileIds);
    return { fileIds, files: accepted.map((f) => f.name) };
  },

  // tasks
  createTask: (payload) => call('POST', '/task/create_task', { body: payload }),
  createAnonymousTask: (payload) => call('POST', '/task/create_anonymous_task', { body: payload }),
  getTask: (taskId) => call('GET', '/task/get_task', { query: { taskId } }),
  submitQuestion: (payload) => call('POST', '/task/submit_user_question', { body: payload }),
  cancelTask: (taskId) => call('POST', `/task/cancel/${encodeURIComponent(taskId)}`, { body: {} }),
  agents: () => call('GET', '/agents'),

  // publishing / published revisions
  publishAccess: () => call('GET', '/published/item/publish/access'),
  publish: (sid) => call('POST', '/published/item/publish', { body: { chatSessionId: sid } }),
  withdrawPublish: (sid) => call('POST', '/published/item/withdraw', { body: { chatSessionId: sid } }),
  revisionSession: (rid) => call('GET', `/published/revision/${encodeURIComponent(rid)}/session`),
  revisionTask: (rid, taskId) => call('GET', `/published/revision/${encodeURIComponent(rid)}/task`, { query: { taskId } }),
  revisionWorkspace: async (rid, path = '.') => normalizeTreeResult(await call('POST', `/published/revision/${encodeURIComponent(rid)}/workspace/subtree`, { body: { targets: [[path === '.' ? '' : path, 3]] } })),
  forkRevision: (rid) => call('POST', `/published/revision/${encodeURIComponent(rid)}/fork`, { body: {} }),

  // feedback & discovery
  likeTask: (taskId, liked, filePath = null) => call('POST', '/likeTask', { body: { taskId, like: liked, liked, filePath } }),
  taskFeedback: (taskId) => call('GET', '/getTaskFeedback', { query: { taskId } }),
  autoIdeas: () => call('GET', '/auto_ideaspark/ideas'),
  modifyIdea: (payload) => call('POST', '/auto_ideaspark/modify', { body: payload }),
  triggerIdeas: () => call('POST', '/auto_ideaspark/trigger', { body: {} }),

  // search
  search: (q) => call('POST', '/search', { body: { query: q, request_id: Date.now(), topK: 20 } }),
  searchHistory: () => call('GET', '/get_searchHistory'),
};

/**
 * Live SSE channel (GET /api/chat/). Uses fetch + ReadableStream because the
 * upstream framing is space-padded and EventSource cannot carry auth headers.
 * Callers should pair this with get_task polling as a reliability fallback.
 */
export function openStream({ chatSessionId, chatStatus = 'continue', onMessage, onResponse, onComplete, onError }) {
  const controller = new AbortController();
  const qs = asQuery({ chatSessionId, chatStatus });
  fetch(`/api/chat/?${qs}`, {
    method: 'GET',
    headers: authHeaders({ Accept: 'text/event-stream', 'Cache-Control': 'no-cache' }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (res.ok === false) {
        onError?.(new Error(`stream ${res.status}`));
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
            if (event === 'message') onMessage?.(data);
            else if (event === 'response') {
              try { onResponse?.(JSON.parse(data)); } catch { onResponse?.({ messages: [] }); }
            } else if (event === 'complete') onComplete?.();
          } else if (line.trim() === '') event = 'message';
        }
      }
      onComplete?.();
    })
    .catch((e) => {
      if (e.name !== 'AbortError') onError?.(e);
    });
  return () => controller.abort();
}
Object.assign(api, {
  labContract: () => call('GET', '/autoresearch/lab/contract'),
  labCreate: (body) => call('POST', '/autoresearch/lab/runs', { body }),
  labList: () => call('GET', '/autoresearch/lab/runs'),
  labGet: (id) => call('GET', `/autoresearch/lab/runs/${encodeURIComponent(id)}`),
  labStart: (id) => call('POST', `/autoresearch/lab/runs/${encodeURIComponent(id)}/start`, { body: {} }),
  labCancel: (id) => call('POST', `/autoresearch/lab/runs/${encodeURIComponent(id)}/cancel`, { body: {} }),
  labResults: (id) => call('GET', `/autoresearch/lab/runs/${encodeURIComponent(id)}/results.tsv`),
  teamRoles: () => call('GET', '/team/roles'),
  teamList: () => call('GET', '/team/sprints'),
  teamCreate: (body) => call('POST', '/team/sprints', { body }),
  teamGet: (id) => call('GET', `/team/sprints/${encodeURIComponent(id)}`),
  teamSpawn: (id, role) => call('POST', `/team/sprints/${encodeURIComponent(id)}/spawn`, { body: { role } }),
  teamTaskCreate: (id, body) => call('POST', `/team/sprints/${encodeURIComponent(id)}/tasks`, { body }),
  teamTaskClaim: (id, taskId, role) => call('POST', `/team/sprints/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/claim`, { body: { role } }),
  teamTaskComplete: (id, taskId, role, evidence) => call('POST', `/team/sprints/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/complete`, { body: { role, evidence } }),
  teamArtifact: (id, body) => call('POST', `/team/sprints/${encodeURIComponent(id)}/artifacts`, { body }),
  teamAdvance: (id, role, toPhase) => call('POST', `/team/sprints/${encodeURIComponent(id)}/phase/advance`, { body: { role, toPhase } }),
  teamMail: (id, body) => call('POST', `/team/sprints/${encodeURIComponent(id)}/mail`, { body }),
  teamMessages: (id, body) => call('POST', `/team/sprints/${encodeURIComponent(id)}/messages`, { body }),
});
