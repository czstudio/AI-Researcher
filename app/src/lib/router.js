// Tiny history router. Route table mirrors contracts/routes.json.

import { reactive } from 'vue';

export const router = reactive({ path: location.pathname, query: {}, params: {} });

const listeners = new Set();

function parse() {
  const u = new URL(location.href);
  router.path = u.pathname.replace(/\/+$/, '') || '/';
  router.query = Object.fromEntries(u.searchParams.entries());
  for (const fn of listeners) fn(router);
}

export function navigate(to, { replace = false } = {}) {
  if (to === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState']({}, '', to);
  parse();
}

window.addEventListener('popstate', parse);
parse();

export function onRouteChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// /search-v1/:sessionId, /published/revision/:id, /deepsurvey ...
export function matchRoute(path) {
  const seg = path.split('/').filter(Boolean);
  if (!seg.length) return { name: 'Workspace', params: {} };
  if (seg[0] === 'search-v1') return { name: seg[1] ? 'Session' : 'Workspace', params: { sessionId: seg[1] || null } };
  if (seg[0] === 'published' && seg[1] === 'revision') return { name: 'Published', params: { revisionId: seg[2] } };
  if (seg[0] === 'gallery') return { name: 'Gallery', params: {} };
  if (seg[0] === 'login') return { name: 'Login', params: {} };
  if (seg[0] === 'chat') return { name: 'Workspace', params: { mode: 'auto' } };
  const modes = ['deepsurvey', 'ideaspark', 'methoddesign', 'autoexperiment', 'notebook', 'reproduce', 'deeptutor', 'drawplot'];
  if (modes.includes(seg[0])) return { name: 'Mode', params: { mode: seg[0] } };
  return { name: 'Workspace', params: {} };
}
