<script setup>
import { ref, watch, computed } from 'vue';
import { api } from '../lib/api.js';
import { store, toast } from '../stores/app.js';
import FileTree from './FileTree.vue';
import MarkdownBlock from './MarkdownBlock.vue';

const props = defineProps({
  sessionId: { type: String, required: true },
  tree: { type: Object, default: null },
  terminal: { type: String, default: '' },
});
const emit = defineEmits(['refresh', 'followup']);

const selected = ref(null);
const content = ref('');
const language = ref('text');
const loading = ref(false);
const env = ref(process.env.NODE_ENV || 'cpu-local');
const envs = ['cpu-local', 'gpu-local', 'docker-sandbox', 'byo-ssh'];
const tab = ref('code');
const followup = ref('');

async function open(node) {
  if (!node || node.type !== 'file') return;
  selected.value = node.path;
  loading.value = true;
  tab.value = /\.pdf$/i.test(node.path) ? 'pdf' : 'code';
  try {
    const r = await api.homeFilePreview(props.sessionId, node.path);
    content.value = r.content || '';
    language.value = r.language || 'text';
  } catch (e) {
    content.value = `// cannot preview: ${e.message}`;
  } finally {
    loading.value = false;
  }
}

const isPdf = computed(() => selected.value && /\.pdf$/i.test(selected.value));
const pdfUrl = computed(() => `/api/file/download?fileKey=workspace/${props.sessionId}&path=${encodeURIComponent(selected.value || '')}`);

function sendFollowup() {
  if (!followup.value.trim()) return;
  emit('followup', { text: followup.value.trim(), file: selected.value });
  followup.value = '';
}
</script>

<template>
  <section class="canvas">
    <header class="chead">
      <div class="seg">
        <button :class="{ on: tab === 'code' }" @click="tab = 'code'">Workspace</button>
        <button :class="{ on: tab === 'term' }" @click="tab = 'term'">Terminal</button>
      </div>
      <div class="grow" />
      <div class="popover-button-wrap">
        <button class="popover-trigger">
          <span class="muted">env:</span> {{ env }}
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        </button>
      </div>
      <button class="btn ghost" @click="emit('refresh')">Refresh</button>
    </header>

    <div class="body">
      <div class="tree-pane">
        <FileTree :node="tree" :selected="selected" @open="open" />
      </div>

      <div class="view-pane">
        <div v-if="tab === 'term'" class="ansi terminal">{{ terminal || 'No terminal output yet.' }}</div>

        <template v-else>
          <div v-if="!selected" class="muted empty">Pick a file on the left.</div>
          <template v-else>
            <div class="file-head">
              <span class="mono">{{ selected }}</span>
              <span v-if="loading" class="badge">editing file</span>
              <div class="grow" />
              <button class="btn ghost" @click="emit('refresh')">Reload</button>
            </div>

            <iframe v-if="isPdf" :src="pdfUrl" class="pdf" title="pdf" />
            <pre v-else-if="language !== 'markdown' && language !== 'text'" class="code"><code>{{ content }}</code></pre>
            <MarkdownBlock v-else :content="content" class="mdview" />

            <div class="secondary">
              <input v-model="followup" placeholder="Ask a follow-up about this file…" @keydown.enter="sendFollowup" />
              <button class="btn primary" @click="sendFollowup">Submit</button>
            </div>
          </template>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.canvas {
  display: flex;
  flex-direction: column;
  border-left: 1px solid var(--border);
  background: var(--background);
  min-width: 0;
  height: 100%;
}
.chead {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}
.grow {
  flex: 1;
}
.body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.tree-pane {
  width: 210px;
  overflow: auto;
  border-right: 1px solid var(--border);
  padding: 8px 4px;
  font-size: var(--fs-12);
}
.view-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.file-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--border);
  font-size: var(--fs-12);
}
.badge {
  font-size: var(--fs-10);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  padding: 0 6px;
  color: var(--primary);
}
.code {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: 12px 14px;
  font-family: var(--font-mono);
  font-size: var(--fs-12);
  line-height: 1.6;
  background: transparent;
}
.mdview {
  flex: 1;
  overflow: auto;
  padding: 12px 16px;
}
.pdf {
  flex: 1;
  border: 0;
  width: 100%;
}
.terminal {
  flex: 1;
  overflow: auto;
  margin: 10px;
  white-space: pre-wrap;
}
.empty {
  padding: 20px;
  font-size: var(--fs-12);
}
.secondary {
  display: flex;
  gap: 6px;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
}
.secondary input {
  flex: 1;
  border: 1px solid var(--input);
  border-radius: var(--r-8);
  padding: 0 10px;
  height: 28px;
  background: var(--card);
  font-size: var(--fs-12);
}
@media (max-width: 900px) {
  .canvas {
    border-left: 0;
    border-top: 1px solid var(--border);
  }
  .tree-pane {
    width: 150px;
  }
}
</style>
