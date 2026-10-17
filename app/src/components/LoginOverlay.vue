<script setup>
import { store } from '../stores/app.js';
import AuthForm from './AuthForm.vue';

function close() {
  store.overlays.login = false;
}
function done() {
  close();
  if (store.pendingRoute) {
    const target = store.pendingRoute;
    store.pendingRoute = null;
    history.replaceState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
}
</script>

<template>
  <div class="backdrop" @click.self="close">
    <div class="panel card">
      <button class="x" aria-label="Close" @click="close">×</button>
      <AuthForm initial-mode="login" compact @success="done" />
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; z-index: 130; display: grid; place-items: center; padding: 20px; background: rgba(20, 22, 28, 0.42); backdrop-filter: blur(2px); }
.panel { position: relative; width: 440px; max-width: 100%; padding: 26px; box-shadow: var(--shadow-lg); }
.x { position: absolute; right: 10px; top: 8px; border: 0; background: transparent; font-size: 24px; color: var(--muted-foreground); cursor: pointer; }
</style>
