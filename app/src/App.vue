<script setup>
import { computed, ref, watch } from 'vue';
import { router, matchRoute, navigate } from './lib/router.js';
import { store, toast, refreshSessions } from './stores/app.js';
import { api, getToken } from './lib/api.js';
import AppRail from './components/AppRail.vue';
import AccountMenu from './components/AccountMenu.vue';
import ToastHost from './components/ToastHost.vue';
import NotificationPanel from './components/NotificationPanel.vue';
import WorkspacePage from './pages/WorkspacePage.vue';
import SessionPage from './pages/SessionPage.vue';
import GalleryPage from './pages/GalleryPage.vue';
import PublishedPage from './pages/PublishedPage.vue';

const route = computed(() => matchRoute(router.path));
const sessionPage = ref(0);

async function ensureSession() {
  try {
    const s = getToken() ? await api.createSession() : await api.createAnonymousSession();
    store.currentSessionId = s.id;
    return s.id;
  } catch (e) {
    toast(String(e.message || e), 'error');
    return null;
  }
}

async function onSubmit(payload) {
  const sid = store.currentSessionId || (await ensureSession());
  if (!sid) return;
  navigate(`/search-v1/${sid}`);
  // give SessionPage a tick to mount, then hand it the payload
  setTimeout(() => {
    window.dispatchEvent(new CustomEvent('novix:submit', { detail: payload }));
  }, 60);
}

function newSession() {
  store.currentSessionId = null;
  navigate('/');
  refreshSessions();
}

watch(
  () => router.path,
  () => refreshSessions()
);
</script>

<template>
  <div class="shell">
    <AppRail @toggle-account="store.overlays.account = true" @toggle-notifications="store.overlays.notifications = true" @new-session="newSession" />

    <main class="main">
      <WorkspacePage v-if="route.name === 'Workspace'" :mode="route.params.mode || 'auto'" @submit="onSubmit" />
      <WorkspacePage v-else-if="route.name === 'Mode'" :mode="route.params.mode" @submit="onSubmit" />
      <SessionPage v-else-if="route.name === 'Session'" :key="route.params.sessionId" :session-id="route.params.sessionId" />
      <GalleryPage v-else-if="route.name === 'Gallery'" />
      <PublishedPage v-else-if="route.name === 'Published'" :revision-id="route.params.revisionId" />
    </main>

    <AccountMenu v-if="store.overlays.account" @close="store.overlays.account = false" />
    <NotificationPanel v-if="store.overlays.notifications" />
    <ToastHost />
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  height: 100%;
  min-height: 0;
}
.main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.main > * {
  min-height: 0;
}
</style>
