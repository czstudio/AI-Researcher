<script setup>
import { computed, onMounted, watch } from 'vue';
import { router, matchRoute, navigate, isAccountRoute, titleForRoute } from './lib/router.js';
import { store, toast, refreshSessions, resetComposer } from './stores/app.js';
import { api, getToken } from './lib/api.js';
import AppRail from './components/AppRail.vue';
import ToastHost from './components/ToastHost.vue';
import NotificationPanel from './components/NotificationPanel.vue';
import LoginOverlay from './components/LoginOverlay.vue';
import WorkspacePage from './pages/WorkspacePage.vue';
import SessionPage from './pages/SessionPage.vue';
import PublishedPage from './pages/PublishedPage.vue';
import LandingPage from './pages/LandingPage.vue';
import RegisterPage from './pages/RegisterPage.vue';
import AccountPage from './pages/AccountPage.vue';
import AutoDiscoveryPage from './pages/AutoDiscoveryPage.vue';
import TeamPage from './pages/TeamPage.vue';
import StaticPage from './pages/StaticPage.vue';
import MarkdownDebugPage from './pages/MarkdownDebugPage.vue';

const route = computed(() => matchRoute(router.path));
const standalone = computed(() => ['Landing', 'Register', 'Privacy', 'Terms', 'Contact', 'UserManual', 'MarkdownDebug'].includes(route.value.name) || isAccountRoute(route.value.name) || route.value.name === 'Published');

async function ensureSession(mode) {
  if (store.currentSessionId) return store.currentSessionId;
  try {
    const s = getToken() ? await api.createSession(mode) : await api.createAnonymousSession(mode);
    store.currentSessionId = s.id;
    return s.id;
  } catch (e) {
    toast(String(e.message || e), 'error');
    return null;
  }
}
async function onSubmit(payload) {
  const sid = await ensureSession(payload.mode);
  if (sid == null) return;
  store.pendingPayload = payload;
  navigate(`/search-v1/${sid}`);
  setTimeout(() => {
    store.composer.text = '';
    store.composer.files = [];
    store.composer.fileIds = [];
  }, 1200);
}
function newSession() {
  store.currentSessionId = null;
  resetComposer();
  navigate('/chat');
}
function openLogin() {
  store.overlays.login = true;
}
function openAccount() {
  navigate('/account/upgrade');
}
watch(
  () => router.path,
  () => {
    const r = matchRoute(router.path);
    if (r.name === 'Redirect') {
      navigate(r.redirect, { replace: true });
      return;
    }
    document.title = titleForRoute(r);
    if (getToken()) refreshSessions();
  },
  { immediate: true }
);
onMounted(() => {
  document.title = titleForRoute(route.value);
});
</script>

<template>
  <div v-if="route.name === 'Redirect'" class="redirecting muted">Redirecting…</div>
  <div v-else-if="standalone" class="standalone">
    <LandingPage v-if="route.name === 'Landing'" />
    <RegisterPage v-else-if="route.name === 'Register'" :referral-code="router.query.referralCode || ''" />
    <PublishedPage v-else-if="route.name === 'Published'" :revision-id="route.params.revisionId" />
    <AccountPage v-else-if="isAccountRoute(route.name)" :tab="route.params.tab" />
    <StaticPage v-else-if="['Privacy', 'Terms', 'Contact', 'UserManual'].includes(route.name)" :page="route.page || route.name.toLowerCase()" />
    <MarkdownDebugPage v-else-if="route.name === 'MarkdownDebug'" />
  </div>
  <div v-else class="shell">
    <AppRail @toggle-notifications="store.overlays.notifications = true" @new-session="newSession" @login="openLogin" @account="openAccount" />
    <main class="main">
      <WorkspacePage v-if="route.name === 'Workspace'" :key="route.params.mode" :mode="route.params.mode || 'auto'" @submit="onSubmit" />
      <AutoDiscoveryPage v-else-if="route.name === 'AutoDiscovery'" />
      <TeamPage v-else-if="route.name === 'Team'" />
      <SessionPage v-else-if="route.name === 'Session'" :key="route.params.sessionId" :session-id="route.params.sessionId" />
    </main>
  </div>

  <LoginOverlay v-if="store.overlays.login" />
  <NotificationPanel v-if="store.overlays.notifications" />
  <ToastHost />
</template>

<style scoped>
.shell { display: flex; height: 100%; min-height: 0; }
.main { flex: 1; min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
.main > * { min-height: 0; }
.standalone { height: 100%; min-height: 0; overflow: hidden; }
.redirecting { height: 100%; display: grid; place-items: center; }
</style>
