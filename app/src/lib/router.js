// Tiny history router. Route table mirrors contracts/routes.json exactly.
// Dependency-free by design: the app ships without vue-router.
import { reactive } from 'vue';

export const router = reactive({ path: location.pathname, query: {}, params: {} });
const listeners = new Set();

function cleanPath(path) {
  const p = String(path || '/').split('?')[0].replace(/\/+$/, '');
  return p || '/';
}

function parse() {
  const u = new URL(location.href);
  router.path = cleanPath(u.pathname);
  router.query = Object.fromEntries(u.searchParams.entries());
  for (const fn of listeners) fn(router);
}

export function navigate(to, { replace = false } = {}) {
  const target = new URL(to, location.origin);
  if (target.pathname === location.pathname && target.search === location.search) return;
  history[replace ? 'replaceState' : 'pushState']({}, '', target.pathname + target.search + target.hash);
  parse();
}

window.addEventListener('popstate', parse);
parse();

export function onRouteChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const MODE_ROUTE_IDS = new Set([
  'auto-discovery', 'chat', 'deepsurvey', 'methoddesign', 'ideaspark',
  'autoexperiment', 'notebook', 'reproduce',
]);

const ACCOUNT_PAGES = {
  upgrade: 'AccountUpgrade',
  credit: 'AccountCredit',
  billing: 'AccountBilling',
  referrals: 'AccountReferrals',
  info: 'AccountInfo',
  'version-history': 'AccountVersionHistory',
};

const STATIC_PAGES = {
  privacy: { name: 'Privacy', page: 'privacy', title: 'Privacy · Novix Open' },
  terms: { name: 'Terms', page: 'terms', title: 'Terms · Novix Open' },
  contact: { name: 'Contact', page: 'contact', title: 'Contact · Novix Open' },
  'user-manual': { name: 'UserManual', page: 'user-manual', title: 'User manual · Novix Open' },
};

/** Resolve pathname to a page descriptor. Redirects are applied by App.vue. */
export function matchRoute(path) {
  const p = cleanPath(path);
  const seg = p.split('/').filter(Boolean);

  if (p === '/') return { name: 'Landing', params: {} };
  if (p === '/register') return { name: 'Register', params: {} };
  if (p === '/debug/markdown') return { name: 'MarkdownDebug', params: {} };

  if (seg[0] === 'search-v1') {
    if (seg[1] == null) return { name: 'Redirect', redirect: '/chat', params: {} };
    return { name: 'Session', params: { sessionId: decodeURIComponent(seg[1]) } };
  }

  if (seg[0] === 'published' && seg[1] === 'revision') {
    if (seg[2] == null) return { name: 'Redirect', redirect: '/chat', params: {} };
    return { name: 'Published', params: { revisionId: decodeURIComponent(seg[2]) } };
  }

  if (p === '/account') return { name: 'Redirect', redirect: '/account/upgrade', params: {} };
  if (p === '/upgrade') return { name: 'Redirect', redirect: '/account/upgrade', params: {} };
  if (p === '/account/community') return { name: 'Redirect', redirect: '/account/info', params: {} };
  if (seg[0] === 'account' && seg[1] && ACCOUNT_PAGES[seg[1]]) {
    return { name: ACCOUNT_PAGES[seg[1]], params: { tab: seg[1] } };
  }

  if (STATIC_PAGES[p.slice(1)]) return STATIC_PAGES[p.slice(1)];

  if (seg[0] === 'auto-discovery' && seg.length === 1) {
    return { name: 'AutoDiscovery', params: { mode: 'auto-discovery' } };
  }
  if (MODE_ROUTE_IDS.has(seg[0]) && seg.length === 1) {
    const mode = seg[0] === 'chat' ? 'auto' : seg[0];
    return { name: 'Workspace', params: { mode, routeId: seg[0] } };
  }

  // routes explicitly removed in contracts/routes.json and every unknown path
  return { name: 'Redirect', redirect: '/chat', params: {} };
}

export function isAccountRoute(name) {
  return String(name || '').startsWith('Account');
}

export function titleForRoute(route) {
  const names = {
    Landing: 'Novix Open · Agentic Workspace for Research',
    Register: 'Create account · Novix Open',
    Session: 'Research session · Novix Open',
    Published: 'Published revision · Novix Open',
    AutoDiscovery: 'Auto-Discovery · Novix Open',
    AccountUpgrade: 'Subscription · Novix Open',
    AccountCredit: 'Credit & Usage · Novix Open',
    AccountBilling: 'Billing & Invoices · Novix Open',
    AccountReferrals: 'Referrals · Novix Open',
    AccountInfo: 'Profile · Novix Open',
    AccountVersionHistory: 'Version History · Novix Open',
  };
  if (names[route?.name]) return names[route.name];
  if (route?.name === 'Workspace') {
    const label = route.params?.mode && route.params.mode !== 'auto' ? route.params.mode : 'Auto Pilot';
    return `${label} · Novix Open`;
  }
  return route?.params?.title || 'Novix Open';
}
