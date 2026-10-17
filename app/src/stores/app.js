// Global reactive state. Plain `reactive` keeps this build dependency-light.
import { reactive } from 'vue';
import { api, getToken, setToken } from '../lib/api.js';
import MODES from '../lib/modes.generated.js';

export const store = reactive({
  theme: localStorage.getItem('nova_theme') || 'light',
  user: null,
  plan: null,
  modes: MODES.modes || [],
  plans: MODES.plans || [],
  models: [],
  defaultModel: '',
  site: null,
  sessions: [],
  currentSessionId: null,
  sessionMeta: null,
  messages: [],
  currentTask: null,
  pendingPayload: null,
  trajectory: [],
  pendingQuestion: null,
  workspaceTree: null,
  homeFiles: { files: [], total: 0 },
  openFile: null,
  openFileContent: '',
  streamText: '',
  streaming: false,
  activeTaskId: null,
  notifications: [],
  toasts: [],
  overlays: { account: false, settings: false, notifications: false, share: false, login: false },
  workspaceMode: 'auto-discovery',
  mode: 'auto',
  composer: {
    text: '',
    model: '',
    enableGpu: false,
    enableBrainstorming: false,
    writeUpType: 'paper',
    controls: {},
    files: [],
    fileIds: [],
    uploading: false,
    error: '',
  },
});

export function toast(message, kind = 'info') {
  const id = Math.random().toString(36).slice(2);
  store.toasts.push({ id, message, kind });
  setTimeout(() => {
    const i = store.toasts.findIndex((t) => t.id === id);
    if (i >= 0) store.toasts.splice(i, 1);
  }, 4200);
}

export function setTheme(t) {
  store.theme = t;
  localStorage.setItem('nova_theme', t);
  document.documentElement.classList.toggle('dark', t === 'dark');
}

export async function refreshUser() {
  if (getToken() === '') {
    store.user = null;
    return null;
  }
  const { user, plan } = await api.me();
  store.user = user;
  store.plan = plan;
  return user;
}

export async function refreshSessions() {
  if (getToken() === '') {
    store.sessions = [];
    return;
  }
  try {
    const { items } = await api.listSessions();
    store.sessions = items || [];
  } catch {
    store.sessions = [];
  }
}

export async function refreshNotifications() {
  if (getToken() === '') {
    store.notifications = [];
    return;
  }
  try {
    const r = await api.notifications();
    store.notifications = r.items || r.records || [];
  } catch {
    store.notifications = [];
  }
}

export async function login(email, password) {
  const r = await api.login(email, password);
  setToken(r.token);
  await refreshUser();
  await Promise.all([refreshSessions(), refreshNotifications()]);
  return r.user || store.user;
}

export async function signup(email, password, name, referralCode = '') {
  const r = await api.signUp(email, password, name);
  setToken(r.token);
  await refreshUser();
  await Promise.all([refreshSessions(), refreshNotifications()]);
  if (referralCode) {
    try { await api.joinReferral(referralCode); } catch { /* invites are optional */ }
  }
  return r.user || store.user;
}

export function logout() {
  setToken('');
  store.user = null;
  store.plan = null;
  store.sessions = [];
  store.notifications = [];
  store.currentSessionId = null;
}

export function resetComposer() {
  store.composer.text = '';
  store.composer.files = [];
  store.composer.fileIds = [];
  store.composer.controls = {};
  store.composer.error = '';
  store.streamText = '';
  store.trajectory = [];
  store.pendingQuestion = null;
}

export async function bootstrap() {
  document.documentElement.classList.toggle('dark', store.theme === 'dark');
  try { store.site = await api.siteConfig(); } catch { /* offline */ }
  try {
    const m = await api.models();
    store.models = m.models || [];
    store.defaultModel = m.defaultModel || '';
  } catch { /* offline */ }
  store.modes = MODES.modes || [];
  store.plans = MODES.plans || [];
  if (store.defaultModel === '') store.defaultModel = MODES.defaultModel;
  if (store.models.length === 0) store.models = MODES.models || [];
  if (store.composer.model === '') store.composer.model = store.defaultModel;
  if (getToken()) {
    try {
      await refreshUser();
      await Promise.all([refreshSessions(), refreshNotifications()]);
    } catch {
      setToken('');
    }
  }
}

export { setToken };
