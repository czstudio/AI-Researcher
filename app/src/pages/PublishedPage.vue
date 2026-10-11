<script setup>
import { ref, onMounted } from 'vue';
import { api } from '../lib/api.js';
import MarkdownBlock from '../components/MarkdownBlock.vue';

const props = defineProps({ revisionId: { type: String, required: true } });
const data = ref(null);
const err = ref('');

onMounted(async () => {
  try {
    data.value = await api.revisionSession(props.revisionId);
  } catch (e) {
    err.value = String(e.message || e);
  }
});
</script>

<template>
  <div class="wrap">
    <div v-if="err" class="muted">{{ err }}</div>
    <template v-else-if="data">
      <h1 class="hero">{{ data.chatSession?.title || 'Published session' }}</h1>
      <div v-for="m in data.chatSessionMessages" :key="m.id" class="msg">
        <div v-if="m.query" class="q">{{ m.query }}</div>
        <div v-if="m.result" class="r"><MarkdownBlock :content="m.result" /></div>
      </div>
    </template>
    <div v-else class="muted">Loading…</div>
  </div>
</template>

<style scoped>
.wrap {
  max-width: var(--content-max);
  margin: 0 auto;
  padding: 32px 20px 60px;
}
.hero {
  font-family: var(--font-display);
  font-size: var(--fs-24);
}
.msg {
  margin: 18px 0;
}
.q {
  background: var(--muted);
  border-radius: var(--r-14);
  padding: 8px 12px;
  font-size: var(--fs-13);
  margin-bottom: 8px;
}
</style>
