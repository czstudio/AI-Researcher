// Global reactive state. No Pinia dependency — plain `reactive` is enough here.

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
  messages: [],
  workspaceTree: null,
  openFile: null,
  openFileContent: '',
  streamText: '',
  streaming: false,
  activeTaskId: null,
  planSteps: [],
  terminal: '',
  artifacts: [],
  gallery: [],
  notifications: [],
  toasts: [],
  overlays: { account: false, settings: false, notifications: false, share: false },
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

export async function bootstrap() {
  document.documentElement.classList.toggle('dark', store.theme === 'dark');
  try {
    const site = await api.siteConfig();
    store.site = site;
  } catch {
    /* offline */
  }
  try {
    const m = await api.models();
    store.models = m.models || [];
    store.defaultModel = m.defaultModel || '';
  } catch {
    /* offline */
  }
  store.modes = MODES.modes || [];
  store.plans = MODES.plans || [];
  if (!store.defaultModel) store.defaultModel = MODES.defaultModel;
  if (!store.models.length) store.models = MODES.models || [];
  if (!store.composer.model) store.composer.model = store.defaultModel;
  if (getToken()) {
    try {
      await refreshUser();
    } catch {
      setToken('');
    }
  }
}

export async function refreshUser() {
  if (!getToken()) {
    store.user = null;
    return null;
  }
  const { user, plan } = await api.me();
  store.user = user;
  store.plan = plan;
  return user;
}

export async function refreshSessions() {
  if (!getToken()) {
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

export function resetComposer() {
  store.composer.text = '';
  store.composer.files = [];
  store.composer.controls = {};
  store.streamText = '';
  store.planSteps = [];
  store.terminal = '';
  store.artifacts = [];
}

export { setToken };
