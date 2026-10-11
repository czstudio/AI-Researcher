<script setup>
import { store } from '../stores/app.js';

const props = defineProps({
  value: { type: String, default: 'auto' },
});
const emit = defineEmits(['select']);
</script>

<template>
  <aside class="mode-list">
    <button
      v-for="m in store.modes"
      :key="m.key"
      class="mode-row"
      :class="{ on: m.key === value, soon: m.comingSoon }"
      :disabled="m.comingSoon"
      @click="!m.comingSoon && emit('select', m.key)"
    >
      <span class="label">{{ m.label }}</span>
      <span v-if="m.comingSoon" class="soon-tag">Soon</span>
      <span v-else-if="m.creditCost" class="cost">{{ m.creditCost }} cr</span>
    </button>
  </aside>
</template>

<style scoped>
.mode-list {
  width: 176px;
  flex: 0 0 176px;
  border-right: 1px solid var(--border);
  padding: 8px 6px;
  overflow-y: auto;
  background: var(--background);
}
.mode-row {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  height: 30px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--r-8);
  background: transparent;
  color: var(--muted-foreground);
  font-size: var(--fs-13);
  text-align: left;
  cursor: pointer;
}
.mode-row:hover:not(:disabled) {
  background: var(--secondary);
  color: var(--foreground);
}
.mode-row.on {
  background: var(--accent);
  color: var(--foreground);
  font-weight: 600;
}
.mode-row:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.soon-tag {
  font-size: var(--fs-10);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  padding: 0 6px;
}
.cost {
  font-size: var(--fs-10);
  color: var(--muted-foreground);
}
@media (max-width: 760px) {
  .mode-list {
    width: 100%;
    flex: none;
    border-right: 0;
    border-bottom: 1px solid var(--border);
    display: flex;
    overflow-x: auto;
  }
  .mode-row {
    width: auto;
    white-space: nowrap;
  }
}
</style>
