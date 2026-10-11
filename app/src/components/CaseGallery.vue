<script setup>
import { store } from '../stores/app.js';
import { navigate } from '../lib/router.js';

const props = defineProps({ mode: { type: String, default: null } });
</script>

<template>
  <section class="gallery">
    <h3 class="gh">CASE GALLERY</h3>
    <div v-for="c in store.gallery" :key="c.id" class="row" @click="c.sessionId && navigate(`/search-v1/${c.sessionId}`)">
      <span class="title">{{ c.title }}</span>
      <span class="chip mode">{{ (store.modes.find((m) => m.key === c.mode) || {}).label || c.mode }}</span>
      <span class="arrow">→</span>
    </div>
    <div v-if="!store.gallery.length" class="muted empty">No published cases yet — run a task and hit Publish.</div>
  </section>
</template>

<style scoped>
.gallery {
  margin-top: 26px;
}
.gh {
  font-size: var(--fs-10);
  letter-spacing: 0.12em;
  color: var(--muted-foreground);
  font-weight: 700;
  margin: 0 0 4px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
  border-top: 1px dashed var(--border);
  cursor: pointer;
}
.row:hover .title {
  color: var(--primary);
}
.title {
  flex: 1;
  font-size: var(--fs-13);
}
.chip.mode {
  font-size: var(--fs-10);
  color: var(--muted-foreground);
}
.arrow {
  color: var(--muted-foreground);
}
.empty {
  font-size: var(--fs-12);
  padding: 10px 0;
}
</style>
