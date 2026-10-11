<script setup>
import { ref, onMounted, onBeforeUnmount, computed, nextTick } from 'vue';
import { store, toast } from '../stores/app.js';
import { api, openStream, getToken } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import MarkdownBlock from '../components/MarkdownBlock.vue';
import WorkspaceCanvas from '../components/WorkspaceCanvas.vue';

const props = defineProps({ sessionId: { type: String, required: true } });

const loading = ref(true);
const messages = ref([]);
const tree = ref(null);
const terminal = ref('');
const steps = ref([]);
const streamText = ref('');
const streaming = ref(false);
const elapsed = ref(0);
const phase = ref('Live');
const phases = ['Live', 'Analyze', 'Operate', 'Extract', 'Fault'];
const revisionId = ref(null);

let closeStream = null;
let pollTimer = null;
let tickTimer = null;
let startedAt = 0;

const shareUrl = computed(() => `${location.origin}/search-v1/${props.sessionId}`);

function beginTimer() {
  startedAt = Date.now();
  clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    elapsed.value = Math.floor((Date.now() - startedAt) / 1000);
    phase.value = phases[Math.min(phases.length - 1, Math.floor(elapsed.value / 8))];
  }, 1000);
}
function endTimer() {
  clearInterval(tickTimer);
  phase.value = 'Live';
}

async function load() {
  loading.value = true;
  try {
    const r = await api.messages(props.sessionId);
    messages.value = r.chatSessionMessages || [];
    store.currentSessionId = props.sessionId;
    const t = await api.subtree(props.sessionId, '.');
    tree.value = t.workspaceTreeJson;
  } catch (e) {
    toast(String(e.message || e), 'error');
  } finally {
    loading.value = false;
  }
}

async function refreshTree() {
  try {
    const t = await api.subtree(props.sessionId, '.');
    tree.value = t.workspaceTreeJson;
  } catch {
    /* ignore */
  }
}

function connect() {
  closeStream && closeStream();
  closeStream = openStream({
    chatSessionId: props.sessionId,
    chatStatus: 'continue',
    onMessage: (d) => {
      streaming.value = true;
      beginTimer();
      streamText.value += d;
      nextTick(scrollBottom);
    },
    onResponse: (r) => {
      const last = (r.messages || []).filter((m) => m.role === 'assistant').pop();
      if (last?.content) streamText.value = last.content;
    },
    onComplete: () => {
      streaming.value = false;
      endTimer();
      if (streamText.value.trim()) {
        messages.value = [
          ...messages.value,
          { id: `local-${Date.now()}`, type: 'task', query: '', result: streamText.value, status: 'finish', taskId: null },
        ];
        streamText.value = '';
      }
      refreshTree();
      load();
    },
    onError: () => {
      // anonymous / no SSE -> fall back to polling
      startPolling();
    },
  });
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const r = await api.messages(props.sessionId);
      const next = r.chatSessionMessages || [];
      // Always reconcile against the server so the placeholder and the real task
      // are not treated as the same item.
      const hasResult = next.some((m) => m.result);
      const wasSame = next.length === messages.value.length;
      if (!wasSame || hasResult || messages.value.some((m) => m.status === 'processing')) {
        messages.value = next;
        if (hasResult) streamText.value = '';
        refreshTree();
      }
      if (!next.some((m) => ['init', 'processing'].includes(m.status))) {
        streaming.value = false;
        endTimer();
        clearInterval(pollTimer);
      }
    } catch {
      /* ignore */
    }
  }, 2000);
}

async function submit(payload) {
  if (!props.sessionId) return;
  streaming.value = true;
  beginTimer();
  streamText.value = '';
  try {
    const body = { ...payload, chatSessionId: props.sessionId };
    const task = getToken() ? await api.createTask(body) : await api.createAnonymousTask(body);
    store.activeTaskId = task.id;
    // Anonymous sessions: flip to public-read so the polling/refetch path works
    // even before the caller creates an account.
    if (!getToken()) {
      api.share(props.sessionId).catch(() => {});
    }
    nextTick(scrollBottom);
    setTimeout(() => {
      if (!streaming.value) return;
      connect();
    }, 400);
    startPolling();
  } catch (e) {
    streaming.value = false;
    endTimer();
    toast(String(e.message || e), 'error');
  }
}

async function share() {
  try {
    await api.share(props.sessionId);
    toast('Session shared — link copied to clipboard');
    navigator.clipboard?.writeText(shareUrl.value);
  } catch (e) {
    toast(String(e.message || e), 'error');
  }
}

async function publish() {
  try {
    const r = await api.publish(props.sessionId);
    revisionId.value = r.revisionId;
    toast(`Published: /published/revision/${r.revisionId}`);
  } catch (e) {
    toast(String(e.message || e), 'error');
  }
}

function scrollBottom() {
  const el = document.getElementById('scroll-anchor');
  el?.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

function onExternalSubmit(e) {
  submit(e.detail || {});
}

onMounted(async () => {
  window.addEventListener('novix:submit', onExternalSubmit);
  await load();
  connect();
});
onBeforeUnmount(() => {
  window.removeEventListener('novix:submit', onExternalSubmit);
  closeStream && closeStream();
  clearInterval(pollTimer);
  clearInterval(tickTimer);
});
</script>

<template>
  <div class="session">
    <header class="shead">
      <div class="title">
        <button class="btn ghost" @click="navigate('/')">←</button>
        <span class="t">{{ messages[0]?.query?.slice(0, 60) || 'New session' }}</span>
      </div>
      <div class="grow" />
      <span v-if="streaming" class="status"><i class="dot-pulse" /> {{ phase }} · {{ elapsed }}s</span>
      <button class="btn" @click="share">Share</button>
      <button class="btn primary" @click="publish">Publish</button>
    </header>

    <div class="panes">
      <section class="process">
        <div class="stream">
          <div v-if="loading" class="muted">Loading session…</div>

          <div v-for="m in messages" :key="m.id" class="msg fade-up">
            <div v-if="m.query" class="q">{{ m.query }}</div>
            <div v-if="m.result" class="r"><MarkdownBlock :content="m.result" /></div>
            <div v-else-if="m.status === 'processing' || m.status === 'init'" class="muted small">Working on task…</div>
          </div>

          <div v-if="streamText" class="msg">
            <MarkdownBlock :content="streamText" />
            <span class="caret" />
          </div>
          <div v-else-if="streaming" class="muted small">Novix is working…</div>
          <div id="scroll-anchor" />
        </div>

        <div class="composer-mini">
          <textarea
            v-model="store.composer.text"
            rows="2"
            placeholder="Ask a follow-up… (Enter to send)"
            @keydown.enter.exact.prevent="submit({ mode: 'auto', query: store.composer.text, queryContent: store.composer.text }); store.composer.text = ''"
          />
          <button class="btn primary" :disabled="!store.composer.text.trim()" @click="submit({ mode: 'auto', query: store.composer.text, queryContent: store.composer.text }); store.composer.text = ''">
            Send
          </button>
        </div>
      </section>

      <WorkspaceCanvas
        :session-id="props.sessionId"
        :tree="tree"
        :terminal="terminal"
        @refresh="refreshTree"
        @followup="(f) => submit({ mode: 'auto', query: `${f.text}\n\n(file: ${f.file})`, queryContent: `${f.text}\n\n(file: ${f.file})` })"
      />
    </div>
  </div>
</template>

<style scoped>
.session {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.shead {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
}
.title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.t {
  font-size: var(--fs-13);
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 340px;
}
.grow {
  flex: 1;
}
.status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-11);
  color: var(--muted-foreground);
}
.panes {
  flex: 1;
  display: flex;
  min-height: 0;
}
.process {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.stream {
  flex: 1;
  overflow-y: auto;
  padding: 18px 22px;
}
.msg {
  margin-bottom: 18px;
}
.q {
  background: var(--muted);
  border-radius: var(--r-14);
  padding: 8px 12px;
  margin-bottom: 8px;
  font-size: var(--fs-13);
  max-width: 85%;
  margin-left: auto;
}
.small {
  font-size: var(--fs-12);
}
.caret {
  display: inline-block;
  width: 7px;
  height: 14px;
  background: var(--primary);
  animation: pulse 1s steps(2, start) infinite;
  vertical-align: text-bottom;
}
.composer-mini {
  display: flex;
  gap: 6px;
  padding: 10px 12px;
  border-top: 1px solid var(--border);
  align-items: flex-end;
}
.composer-mini textarea {
  flex: 1;
  resize: none;
  border: 1px solid var(--input);
  border-radius: var(--r-12);
  padding: 8px 10px;
  background: var(--card);
  font-size: var(--fs-13);
  max-height: 120px;
}
@media (max-width: 900px) {
  .panes {
    flex-direction: column;
  }
}
</style>
