<script setup>
import { ref } from 'vue';
import MarkdownBlock from '../components/MarkdownBlock.vue';
const input = ref('# Markdown debug\n\nUse **bold**, `code`, lists and [links](https://example.com).\n\n```js\nconsole.log("hello")\n```');
</script>

<template>
  <div class="debug">
    <header><h1>Markdown debug</h1><span class="muted">Client-side, dependency-free renderer.</span></header>
    <div class="pane">
      <textarea v-model="input" spellcheck="false" />
      <div class="preview card"><MarkdownBlock :content="input" /></div>
    </div>
  </div>
</template>

<style scoped>
.debug { padding: 24px; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; }
header { display: flex; align-items: baseline; gap: 10px; }
h1 { margin: 0; font-family: var(--font-display); font-size: 24px; }
.pane { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
textarea { width: 100%; height: 100%; resize: none; border: 1px solid var(--border); border-radius: var(--r-12); padding: 14px; background: var(--card); font-family: var(--font-mono); font-size: var(--fs-12); }
.preview { overflow-y: auto; padding: 14px 18px; }
@media (max-width: 760px) { .pane { grid-template-columns: 1fr; } }
</style>
