<script setup>
import { store, setTheme, toast } from '../stores/app.js';
import { navigate } from '../lib/router.js';

const emit = defineEmits(['toggle-account', 'toggle-notifications', 'new-session']);

function cycleTheme() {
  setTheme(store.theme === 'dark' ? 'light' : 'dark');
}
</script>

<template>
  <nav class="rail">
    <button class="rail-btn" title="Menu" @click="navigate('/')">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <button class="rail-btn" title="New session" @click="emit('new-session')">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    </button>
    <button class="rail-btn" title="Gallery" @click="navigate('/gallery')">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="2" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/><rect x="9" y="9" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.4"/></svg>
    </button>

    <div class="spacer" />

    <button class="rail-btn" title="Notifications" @click="emit('toggle-notifications')">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 6a4 4 0 018 0c0 3 1 4 1 4H3s1-1 1-4z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6.5 13a1.5 1.5 0 003 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
    </button>
    <button class="rail-btn" title="Theme" @click="cycleTheme">
      <svg v-if="store.theme === 'dark'" width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M13 10.5A5.5 5.5 0 015.5 3 5.5 5.5 0 1013 10.5z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
      <svg v-else width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3.2" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
    </button>
    <button class="rail-btn" title="Settings" @click="emit('toggle-account')">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.4"/><path d="M12.8 8h1.2M2 8h1.2M8 2v1.2M8 12.8V14m3.4-9.4l.8-.8m-8.4 8.4l.8-.8m6.8 0l.8.8M4.6 4.6l.8.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
    </button>
    <button class="avatar" :title="store.user?.email || 'Guest'" @click="emit('toggle-account')">
      {{ store.user ? (store.user.avatarInitial || 'U') : 'G' }}
    </button>
  </nav>
</template>

<style scoped>
.rail {
  width: var(--rail-w);
  flex: 0 0 var(--rail-w);
  border-right: 1px solid var(--border);
  background: var(--background);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 0;
}
.spacer {
  flex: 1;
}
.rail-btn {
  width: 30px;
  height: 30px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: var(--r-8);
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
}
.rail-btn:hover {
  background: var(--secondary);
  color: var(--foreground);
}
.avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--primary);
  color: var(--primary-foreground);
  font-size: var(--fs-11);
  font-weight: 600;
  cursor: pointer;
  display: grid;
  place-items: center;
}
</style>
