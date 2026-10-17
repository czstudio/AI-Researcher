<script setup>
import { computed, onMounted, ref } from 'vue';
import { api, getToken } from '../lib/api.js';
import { store, toast } from '../stores/app.js';
import { navigate } from '../lib/router.js';
import MarkdownBlock from '../components/MarkdownBlock.vue';
import FeedbackBar from '../components/FeedbackBar.vue';

const props = defineProps({ revisionId: { type: String, required: true } });
const data = ref(null);
const messages = ref([]);
const task = ref(null);
const tree = ref(null);
const err = ref('');
const busy = ref(false);
const loading = ref(true);

const sessionId = computed(() => data.value?.chatSession?.id || '');
const title = computed(() => data.value?.chatSession?.title || 'Published session');
const link = computed(() => `${location.origin}/published/revision/${props.revisionId}`);
const artifacts = computed(() => {
  const out = [];
  function walk(node) {
    if (node == null) return;
    if (node.type === 'file') out.push(node);
    for (const child of node.children || []) walk(child);
  }
  walk(tree.value);
  return out;
});
function safeJson(v) { try { return JSON.parse(v); } catch { return null; } }
const trajectory = computed(() => {
  const out = [];
  for (const step of task.value?.steps || []) {
    const wrapper = safeJson(step.content);
    const rows = wrapper?.type === 'trajectory' ? safeJson(wrapper.content) : [wrapper];
    for (const [i, row] of (rows || []).entries()) {
      if (row == null) continue;
      out.push({ id: `${step.id}-${i}`, role: row.role || 'assistant', content: String(row.content || ''), name: row.name || '', toolCalls: row.tool_calls || [] });
    }
  }
  return out;
});

async function load() {
  loading.value = true;
  try {
    const r = await api.revisionSession(props.revisionId);
    data.value = r;
    messages.value = r.chatSessionMessages || [];
    try { tree.value = (await api.revisionWorkspace(props.revisionId, '.')).workspaceTreeJson || null; } catch { tree.value = null; }
    const last = messages.value[messages.value.length - 1];
    if (last?.taskId) {
      try { task.value = await api.revisionTask(props.revisionId, last.taskId); } catch { task.value = null; }
    }
  } catch (e) {
    err.value = String(e.message || e);
  } finally {
    loading.value = false;
  }
}
async function copyLink() {
  try { await navigator.clipboard.writeText(link.value); toast('Published link copied'); }
  catch { toast('Clipboard unavailable', 'error'); }
}
async function fork() {
  if (getToken() === '') { store.overlays.login = true; return; }
  busy.value = true;
  try {
    const r = await api.forkRevision(props.revisionId);
    const sid = r.chatSessionId || r.sessionId || r.id;
    if (sid) navigate(`/search-v1/${sid}`);
    else toast('Fork created but no session id was returned', 'error');
  } catch (e) {
    toast(`Fork is unavailable on this backend: ${e.message || e}`, 'error');
  } finally {
    busy.value = false;
  }
}
async function downloadArtifact(f) {
  try {
    if (f.fileKey) {
      await api.downloadFile(f.fileKey, true).then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = f.name || 'artifact'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      });
    } else {
      toast('This artifact does not expose a file key', 'error');
    }
  } catch (e) { toast(String(e.message || e), 'error'); }
}
onMounted(load);
</script>

<template>
  <div class="published">
    <header class="top">
      <button class="brand" @click="navigate('/')"><span class="mark">N</span> Novix <span class="open">OPEN</span></button>
      <div class="grow" />
      <button class="btn ghost" @click="copyLink">Copy link</button>
      <button class="btn primary" :disabled="busy" @click="fork">{{ busy ? 'Forking…' : 'Fork / re-run' }}</button>
    </header>
    <main>
      <div v-if="loading" class="muted">Loading published revision…</div>
      <div v-else-if="err" class="notice">{{ err }}</div>
      <template v-else-if="data">
        <p class="eyebrow">Published revision</p>
        <h1>{{ title }}</h1>
        <p class="muted">Read-only artifact view. Forking creates your own copy when the backend supports it.</p>
        <div class="layout">
          <section class="messages">
            <article v-for="m in messages" :key="m.id" class="msg card">
              <div v-if="m.query" class="q">{{ m.query }}</div>
              <MarkdownBlock v-if="m.result" :content="m.result" />
              <div v-else-if="['processing', 'init'].includes(m.status)" class="muted">Task is still processing.</div>
              <FeedbackBar v-if="m.taskId" :task-id="m.taskId" />
            </article>
            <div v-if="messages.length === 0" class="muted">No messages in this revision.</div>
          </section>
          <aside>
            <section class="card panel">
              <h2>Artifacts</h2>
              <button v-for="f in artifacts" :key="f.path" class="artifact" @click="downloadArtifact(f)"><span>{{ f.name }}</span><span class="muted">{{ f.size }}b</span></button>
              <p v-if="artifacts.length === 0" class="muted small">No artifacts published.</p>
            </section>
            <section v-if="trajectory.length" class="card panel">
              <h2>Trajectory</h2>
              <details v-for="row in trajectory.slice(-80)" :key="row.id" class="traj">
                <summary>{{ row.role }} · {{ row.name || 'step' }}</summary>
                <div class="traj-body"><MarkdownBlock :content="row.content.slice(0, 5000)" /></div>
                <pre v-for="call in row.toolCalls" :key="call.id">{{ call.function?.name }} {{ call.function?.arguments }}</pre>
              </details>
            </section>
          </aside>
        </div>
      </template>
    </main>
  </div>
</template>

<style scoped>
.published { height: 100%; overflow-y: auto; }
.top { max-width: 1120px; margin: 0 auto; padding: 16px 22px; display: flex; align-items: center; gap: 8px; }
.grow { flex: 1; }
.brand { border: 0; background: transparent; display: inline-flex; align-items: center; gap: 8px; font-weight: 700; cursor: pointer; }
.mark { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--primary); color: var(--primary-foreground); font-family: var(--font-display); }
.open { font-size: 9px; letter-spacing: .12em; color: var(--muted-foreground); border: 1px solid var(--border); border-radius: var(--r-pill); padding: 1px 5px; }
main { max-width: 1120px; margin: 0 auto; padding: 30px 22px 70px; }
.eyebrow { text-transform: uppercase; letter-spacing: .15em; font-size: var(--fs-10); font-weight: 700; color: var(--primary); margin: 0; }
h1 { font-family: var(--font-display); font-size: clamp(30px, 4vw, 48px); margin: 7px 0; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; margin-top: 24px; align-items: start; }
.messages { display: flex; flex-direction: column; gap: 12px; }
.msg { padding: 16px; }
.q { background: var(--muted); border-radius: var(--r-12); padding: 8px 11px; font-size: var(--fs-12); margin-bottom: 10px; white-space: pre-wrap; }
aside { display: flex; flex-direction: column; gap: 12px; position: sticky; top: 16px; }
.panel { padding: 14px; }
h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .09em; color: var(--muted-foreground); margin: 0 0 9px; }
.artifact { width: 100%; display: flex; justify-content: space-between; gap: 8px; border: 0; border-bottom: 1px solid var(--border); background: transparent; padding: 7px 0; cursor: pointer; font-size: var(--fs-11); text-align: left; color: var(--foreground); }
.traj { border-bottom: 1px solid var(--border); padding: 6px 0; font-size: var(--fs-11); }
.traj summary { cursor: pointer; color: var(--muted-foreground); }
.traj-body { max-height: 220px; overflow-y: auto; }
pre { white-space: pre-wrap; word-break: break-word; font-family: var(--font-mono); font-size: 9px; color: var(--muted-foreground); }
.small { font-size: var(--fs-11); }
.notice { padding: 12px; color: var(--destructive); background: var(--accent); border-radius: var(--r-8); }
@media (max-width: 850px) { .layout { grid-template-columns: 1fr; } aside { position: static; } }
</style>
