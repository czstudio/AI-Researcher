<script setup>
import { onMounted } from 'vue';
import { store } from '../stores/app.js';
import { navigate } from '../lib/router.js';
import { api } from '../lib/api.js';

onMounted(async () => {
  try {
    const r = await api.gallery();
    store.gallery = r.items || [];
  } catch {
    store.gallery = [];
  }
});
</script>

<template>
  <div class="wrap">
    <h1 class="hero">Case Gallery</h1>
    <p class="muted">Published sessions from this instance. Publish your own from any session.</p>
    <div class="cards">
      <article v-for="c in store.gallery" :key="c.id" class="card" @click="c.sessionId && navigate(`/search-v1/${c.sessionId}`)">
        <span class="chip">{{ (store.modes.find((m) => m.key === c.mode) || {}).label || c.mode }}</span>
        <h3>{{ c.title }}</h3>
        <p class="muted">{{ c.summary }}</p>
      </article>
    </div>
    <div v-if="!store.gallery.length" class="muted">No published cases yet.</div>
  </div>
</template>

<style scoped>
.wrap {
  max-width: 900px;
  margin: 0 auto;
  padding: 32px 20px 60px;
}
.hero {
  font-family: var(--font-display);
  font-size: var(--fs-24);
  margin: 0 0 6px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
  margin-top: 20px;
}
article {
  padding: 14px;
  cursor: pointer;
  transition: box-shadow 0.15s, transform 0.15s;
}
article:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-1px);
}
h3 {
  font-size: var(--fs-14);
  margin: 8px 0 4px;
}
p {
  font-size: var(--fs-12);
  margin: 0;
}
</style>
