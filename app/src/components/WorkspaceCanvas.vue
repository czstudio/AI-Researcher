<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { api } from '../lib/api.js';
import { toast } from '../stores/app.js';
import FileTree from './FileTree.vue';
import MarkdownBlock from './MarkdownBlock.vue';
import { ansiToHtml } from '../lib/markdown.js';

const props = defineProps({
  sessionId: { type: String, required: true },
  tree: { type: Object, default: null },
  terminal: { type: String, default: '' },
});
const emit = defineEmits(['refresh', 'followup']);

const selected = ref(null);
const selectedNode = ref(null);
const content = ref('');
const language = ref('text');
const loading = ref(false);
const tab = ref('workspace');
const env = ref('cpu-local');
const envOpen = ref(false);
const envs = ['cpu-local', 'gpu-local', 'docker-sandbox', 'byo-ssh'];
const followup = ref('');
const previewUrl = ref('');
const previewMime = ref('');

const files = computed(() => {
  const out = [];
  function walk(node) {
    if (node == null) return;
    if (node.type === 'file') out.push(node);
    for (const child of node.children || []) walk(child);
  }
  walk(props.tree);
  return out;
});
const groups = computed(() => {
  const map = new Map();
  for (const f of files.value) {
    const key = String(f.path || '').split('/')[0] || 'workspace';
    if (map.has(key) === false) map.set(key, []);
    map.get(key).push(f);
  }
  return Array.from(map.entries()).map(([name, rows]) => ({ name, rows }));
});
const isPdf = computed(() => selected.value != null && /\.pdf$/i.test(selected.value));
const isBinary = computed(() => selected.value != null && /\.(png|jpe?g|gif|bmp|zip|rar|7z|tar|gz|bz2|xz|tgz|docx?|xlsx?|pptx?|parquet)$/i.test(selected.value));

function languageForPath(filePath) {
  const ext = String(filePath || '').split('.').pop().toLowerCase();
  const map = { py: 'python', js: 'javascript', mjs: 'javascript', ts: 'typescript', json: 'json', md: 'markdown', tex: 'latex', sh: 'shell', yaml: 'yaml', yml: 'yaml', csv: 'csv', bib: 'bibtex', html: 'html', css: 'css' };
  return map[ext] || 'text';
}
function clearPreviewUrl() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  previewUrl.value = '';
}
async function open(node) {
  if (node == null || node.type !== 'file') return;
  selected.value = node.path;
  selectedNode.value = node;
  content.value = '';
  loading.value = true;
  tab.value = 'workspace';
  language.value = 'text';
  clearPreviewUrl();
  try {
    if (isBinary.value) {
      const key = node.fileKey || `workspace/${props.sessionId}`;
      const blob = await api.downloadFile(key, false);
      previewMime.value = blob.type || 'application/octet-stream';
      previewUrl.value = URL.createObjectURL(blob);
      if (previewMime.value.includes('zip')) {
        content.value = 'This backend returns a workspace archive for workspace-prefixed file keys. Use Download workspace below.';
      }
    } else {
      try {
        const r = await api.homeFilePreview(props.sessionId, node.path);
        content.value = r.content || '';
        language.value = r.language || 'text';
      } catch (previewError) {
        if (node.fileKey) {
          const blob = await api.downloadFile(node.fileKey, false);
          content.value = await blob.text();
          language.value = languageForPath(node.path);
        } else {
          throw previewError;
        }
      }
    }
  } catch (e) {
    content.value = `// cannot preview: ${e.message || e}`;
  } finally {
    loading.value = false;
  }
}
async function downloadSelected() {
  if (selected.value == null) return;
  try {
    const key = selectedNode.value?.fileKey || `workspace/${props.sessionId}`;
    const blob = await api.downloadFile(key, true);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selectedNode.value?.name || 'workspace-download';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) {
    toast(String(e.message || e), 'error');
  }
}
async function downloadWorkspace() {
  try {
    const blob = await api.downloadFile(`workspace/${props.sessionId}`, true);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workspace-${props.sessionId}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Workspace archive downloaded');
  } catch (e) {
    toast(String(e.message || e), 'error');
  }
}
function sendFollowup() {
  if (followup.value.trim() === '') return;
  emit('followup', { text: followup.value.trim(), file: selected.value });
  followup.value = '';
}
function chooseEnv(value) {
  env.value = value;
  envOpen.value = false;
}
watch(() => props.sessionId, () => {
  selected.value = null;
  clearPreviewUrl();
});
onBeforeUnmount(clearPreviewUrl);
</script>

<template>
  <section class="canvas">
    <header class="chead">
      <div class="seg">
        <button :class="{ on: tab === 'workspace' }" @click="tab = 'workspace'">Workspace</button>
        <button :class="{ on: tab === 'artifacts' }" @click="tab = 'artifacts'">Artifacts</button>
        <button :class="{ on: tab === 'term' }" @click="tab = 'term'">Terminal</button>
      </div>
      <div class="grow" />
      <div class="popover-wrap">
        <button class="popover-trigger" @click="envOpen = envOpen === false">
          <span class="muted">env:</span> {{ env }} <span>⌄</span>
        </button>
        <div v-if="envOpen" class="env-menu card">
          <button v-for="e in envs" :key="e" :class="{ on: env === e }" @click="chooseEnv(e)">{{ e }}</button>
        </div>
      </div>
      <button class="btn ghost" @click="emit('refresh')">Refresh</button>
      <button class="btn ghost" @click="downloadWorkspace">Download workspace</button>
    </header>

    <div class="body">
      <div v-if="tab !== 'artifacts'" class="tree-pane">
        <FileTree :node="tree" :selected="selected" @open="open" />
        <div v-if="files.length === 0" class="muted empty-tree">Workspace is empty. Artifacts appear after a task runs.</div>
      </div>

      <div class="view-pane">
        <div v-if="tab === 'term'" class="ansi terminal" v-html="ansiToHtml(terminal || 'No terminal output yet.')" />

        <div v-else-if="tab === 'artifacts'" class="artifacts">
          <div v-for="g in groups" :key="g.name" class="group">
            <strong>{{ g.name }}</strong>
            <div class="artifact-list">
              <button v-for="f in g.rows" :key="f.path" class="artifact" @click="open(f)">{{ f.name }}<span class="muted">{{ f.size }}b</span></button>
            </div>
          </div>
          <div v-if="groups.length === 0" class="muted empty">No artifacts yet.</div>
        </div>

        <template v-else>
          <div v-if="selected == null" class="muted empty">Pick a file on the left to preview it.</div>
          <template v-else>
            <div class="file-head">
              <span class="mono">{{ selected }}</span>
              <span v-if="loading" class="badge">loading</span>
              <div class="grow" />
              <button class="btn ghost" @click="downloadSelected">Download file</button>
              <button class="btn ghost" @click="emit('refresh')">Reload tree</button>
            </div>

            <img v-if="previewUrl && previewMime.startsWith('image/')" :src="previewUrl" class="image-preview" alt="file preview" />
            <iframe v-else-if="previewUrl && previewMime.includes('pdf')" :src="previewUrl" class="pdf" title="PDF preview" />
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
.canvas { display: flex; flex-direction: column; border-left: 1px solid var(--border); background: var(--background); min-width: 0; height: 100%; }
.chead { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.grow { flex: 1; }
.popover-wrap { position: relative; }
.env-menu { position: absolute; z-index: 40; right: 0; top: calc(100% + 5px); min-width: 150px; padding: 4px; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; }
.env-menu button { border: 0; background: transparent; text-align: left; padding: 6px 8px; border-radius: var(--r-5); font-size: var(--fs-11); cursor: pointer; }
.env-menu button:hover { background: var(--secondary); }
.env-menu button.on { color: var(--primary); font-weight: 600; }
.body { flex: 1; display: flex; min-height: 0; }
.tree-pane { width: 220px; overflow: auto; border-right: 1px solid var(--border); padding: 8px 4px; font-size: var(--fs-12); }
.view-pane { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.file-head { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--border); font-size: var(--fs-12); min-width: 0; }
.file-head .mono { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.badge { font-size: var(--fs-10); border: 1px solid var(--border); border-radius: var(--r-pill); padding: 0 6px; color: var(--primary); }
.code { flex: 1; overflow: auto; margin: 0; padding: 12px 14px; font-family: var(--font-mono); font-size: var(--fs-12); line-height: 1.6; background: transparent; white-space: pre-wrap; }
.mdview { flex: 1; overflow: auto; padding: 12px 16px; }
.pdf { flex: 1; border: 0; width: 100%; }
.image-preview { max-width: 100%; max-height: 100%; object-fit: contain; margin: auto; padding: 10px; }
.terminal { flex: 1; overflow: auto; margin: 10px; white-space: pre-wrap; }
.empty { padding: 20px; font-size: var(--fs-12); }
.empty-tree { padding: 14px 8px; font-size: var(--fs-11); line-height: 1.5; }
.secondary { display: flex; gap: 6px; padding: 8px 10px; border-top: 1px solid var(--border); }
.secondary input { flex: 1; min-width: 0; border: 1px solid var(--input); border-radius: var(--r-8); padding: 0 10px; height: 28px; background: var(--card); font-size: var(--fs-12); }
.artifacts { flex: 1; overflow-y: auto; padding: 14px; }
.group { margin-bottom: 16px; }
.group strong { display: block; font-size: var(--fs-12); margin-bottom: 6px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted-foreground); }
.artifact-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 5px; }
.artifact { display: flex; justify-content: space-between; gap: 8px; border: 1px solid var(--border); border-radius: var(--r-8); background: var(--card); padding: 7px 9px; text-align: left; font-size: var(--fs-11); cursor: pointer; overflow: hidden; }
.artifact:hover { border-color: var(--primary); }
.artifact span { flex: 0 0 auto; }
@media (max-width: 900px) { .canvas { border-left: 0; border-top: 1px solid var(--border); } .tree-pane { width: 160px; } .chead .btn { padding: 0 6px; } }
</style>
