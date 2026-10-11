<script setup>
import { store } from '../stores/app.js';
</script>

<template>
  <div class="host">
    <div v-for="t in store.toasts" :key="t.id" class="toast" :class="t.kind">{{ t.message }}</div>
  </div>
</template>

<style scoped>
.host {
  position: fixed;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 120;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}
.toast {
  background: var(--popover);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  padding: 8px 16px;
  font-size: var(--fs-12);
  box-shadow: var(--shadow-md);
  animation: fade-up 0.2s ease-out both;
}
.toast.error {
  border-color: var(--destructive);
  color: var(--destructive);
}
</style>
