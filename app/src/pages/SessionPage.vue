<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { store, toast } from '../stores/app.js';
import { api, getToken, openStream } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import MarkdownBlock from '../components/MarkdownBlock.vue';
import WorkspaceCanvas from '../components/WorkspaceCanvas.vue';
import ShareModal from '../components/ShareModal.vue';
import FeedbackBar from '../components/FeedbackBar.vue';

const props = defineProps({ sessionId: { type: String, required: true } });

const loading = ref(true);
const messages = ref([]);
const session = ref(null);
const tree = ref(null);
const tasks = ref({});
const currentTaskId = ref(null);
const liveText = ref('');
const streaming = ref(false);
const transport = ref('idle');
const elapsed = ref(0);
const phase = ref('Live');
const phases = ['Live', 'Analyze', 'Operate', 'Extract', 'Fault'];
const shareOpen = ref(false);
const publishAccess = ref(null);
const publishedRevisionId = ref(null);
const publishBusy = ref(false);
const error = ref('');
const followup = ref('');
const menuOpen = ref(false);
const renaming = ref(false);
const titleDraft = ref('');
const terminal = ref('');

let closeStream = null;
let pollTimer = null;
let tickTimer = null;
let startedAt = 0;
let transportFallback = false;

const shareUrl = computed(() => `${location.origin}/search-v1/${props.sessionId}`);
const latestMessage = computed(() => messages.value[messages.value.length - 1] || null);
const currentTask = computed(() => (currentTaskId.value ? tasks.value[currentTaskId.value] || null : null));
const isRunning = computed(() => currentTask.value != null && ['init', 'processing'].includes(currentTask.value.status));
const isPublished = computed(() => publishedRevisionId.value != null || session.value?.revisionId != null);
const canPublish = computed(() => publishAccess.value?.canPublish !== false);
const sessionTitle = computed(() => session.value?.title || latestMessage.value?.query?.slice(0, 72) || 'New research session');
const trajectory = computed(() => parseTrajectory(currentTask.value));
const pendingQuestion = computed(() => findPendingQuestion(trajectory.value));
const publishLabel = computed(() => (isPublished.value ? 'Withdraw' : 'Publish'));

function safeJson(value) {
  try { return JSON.parse(value); } catch { return null; }
}
function parseTrajectory(task) {
  if (task == null || Array.isArray(task.steps) === false) return [];
  const out = [];
  for (const step of task.steps) {
    const wrapper = safeJson(step.content);
    const rows = wrapper?.type === 'trajectory' ? safeJson(wrapper.content) : [wrapper];
    for (const [i, row] of (rows || []).entries()) {
      if (row == null) continue;
      out.push({
        id: `${step.id}-${i}`,
        role: row.role || 'assistant',
        content: typeof row.content === 'string' ? row.content : JSON.stringify(row.content || ''),
        toolCalls: row.tool_calls || [],
        name: row.name || row.agent_name || '',
        toolCallId: row.tool_call_id || '',
        at: step.createAt || step.updateAt || '',
      });
    }
  }
  return out;
}
function findPendingQuestion(rows) {
  const answered = new Set(rows.filter((r) => r.role === 'tool' && r.toolCallId).map((r) => r.toolCallId));
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (row.role !== 'assistant') continue;
    for (const call of row.toolCalls || []) {
      if (call.function?.name === 'AskUserQuestion' && answered.has(call.id) === false) {
        const args = safeJson(call.function.arguments) || {};
        return { toolCallId: call.id, question: args.question || 'The agent needs clarification to continue.' };
      }
    }
  }
  return null;
}
function beginTimer() {
  startedAt = Date.now();
  clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    elapsed.value = Math.floor((Date.now() - startedAt) / 1000);
    phase.value = phases[Math.min(phases.length - 1, Math.floor(elapsed.value / 10))];
  }, 1000);
}
function endTimer() {
  clearInterval(tickTimer);
  tickTimer = null;
}
function scrollBottom() {
  nextTick(() => document.getElementById('session-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
}

async function refreshMessages() {
  const r = await api.messages(props.sessionId);
  messages.value = r.chatSessionMessages || [];
  session.value = r.chatSession || session.value;
  store.currentSessionId = props.sessionId;
}
async function hydrateTask(taskId) {
  if (taskId == null) return null;
  try {
    const task = await api.getTask(taskId);
    tasks.value = { ...tasks.value, [String(taskId)]: task };
    return task;
  } catch {
    return null;
  }
}
async function refreshTree() {
  try {
    const r = await api.subtree(props.sessionId, '.');
    tree.value = r?.workspaceTreeJson || null;
  } catch {
    /* shared sessions may not expose a previewable tree */
  }
}
async function load() {
  loading.value = true;
  error.value = '';
  try {
    await refreshMessages();
    const last = messages.value[messages.value.length - 1];
    currentTaskId.value = last?.taskId ? String(last.taskId) : null;
    await hydrateTask(currentTaskId.value);
    await refreshTree();
    if (getToken()) {
      try { publishAccess.value = await api.publishAccess(); } catch { publishAccess.value = null; }
    }
    if (isRunning.value) {
      streaming.value = true;
      beginTimer();
      startPolling(currentTaskId.value);
      connectStream();
    }
  } catch (e) {
    error.value = String(e.message || e);
  } finally {
    loading.value = false;
  }
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}
function stopStream() {
  if (closeStream) closeStream();
  closeStream = null;
}
async function pollOnce(taskId) {
  if (taskId == null) return;
  try {
    const task = await api.getTask(taskId);
    tasks.value = { ...tasks.value, [String(taskId)]: task };
    if (['finish', 'error', 'cancelled'].includes(task.status)) {
      streaming.value = false;
      stopPolling();
      stopStream();
      endTimer();
      liveText.value = '';
      await refreshMessages();
      await refreshTree();
    }
  } catch {
    transportFallback = true;
    transport.value = 'polling fallback';
  }
}
function startPolling(taskId) {
  stopPolling();
  transport.value = 'polling';
  setTimeout(() => pollOnce(taskId), 500);
  pollTimer = setInterval(() => pollOnce(taskId), 2000);
}
function connectStream() {
  stopStream();
  closeStream = openStream({
    chatSessionId: props.sessionId,
    chatStatus: 'continue',
    onMessage: (delta) => {
      streaming.value = true;
      if (transportFallback === false) transport.value = 'stream';
      liveText.value += delta;
      scrollBottom();
    },
    onResponse: (r) => {
      const last = (r.messages || []).filter((m) => m.role === 'assistant').pop();
      if (last?.content) liveText.value = last.content;
    },
    onComplete: () => {
      transport.value = 'complete';
      streaming.value = false;
      endTimer();
      refreshMessages().then(refreshTree);
    },
    onError: () => {
      transportFallback = true;
      transport.value = 'polling fallback';
      if (pollTimer == null && isRunning.value) startPolling(currentTaskId.value);
    },
  });
}

async function createTask(payload) {
  const body = { ...payload, chatSessionId: props.sessionId };
  return getToken() ? api.createTask(body) : api.createAnonymousTask(body);
}
async function submitPayload(payload) {
  streaming.value = true;
  liveText.value = '';
  beginTimer();
  error.value = '';
  try {
    const body = { ...payload, chatSessionId: props.sessionId };
    if (body.queryContent == null || body.queryContent === '') body.queryContent = body.query || '';
    if (body.query == null || body.query === '') body.query = body.queryContent;
    const task = getToken() ? await api.createTask(body) : await api.createAnonymousTask(body);
    currentTaskId.value = String(task.id || task.taskId);
    tasks.value = { ...tasks.value, [String(currentTaskId.value)]: task };
    await refreshMessages();
    startPolling(currentTaskId.value);
    connectStream();
    scrollBottom();
  } catch (e) {
    streaming.value = false;
    endTimer();
    error.value = String(e.message || e);
  }
}
async function sendFollowup() {
  const text = followup.value.trim();
  if (text === '') return;
  error.value = '';
  if (pendingQuestion.value) {
    try {
      await api.submitQuestion({
        sessionId: props.sessionId,
        taskId: currentTaskId.value,
        toolCallId: pendingQuestion.value.toolCallId,
        result: JSON.stringify({ [pendingQuestion.value.question]: text }),
      });
      followup.value = '';
      toast('Answer submitted to the waiting agent');
      await pollOnce(currentTaskId.value);
    } catch (e) {
      error.value = String(e.message || e);
    }
    return;
  }
  const last = latestMessage.value || {};
  const payload = {
    mode: session.value?.mode || 'auto',
    agentName: last.agentName || '',
    query: text,
    queryContent: text,
    enableGpu: false,
    enableBrainstorming: false,
    questionMode: 'task',
    modelOverride: store.composer.model,
    fileIds: [],
  };
  followup.value = '';
  await submitPayload(payload);
}
async function cancelTask() {
  if (currentTaskId.value == null) return;
  try {
    await api.cancelTask(currentTaskId.value);
    toast('Cancellation requested');
    await pollOnce(currentTaskId.value);
  } catch (e) {
    error.value = String(e.message || e);
  }
}
async function forkSession() {
  if (getToken() === '') {
    store.overlays.login = true;
    return;
  }
  const revision = publishedRevisionId.value || session.value?.revisionId;
  try {
    if (revision) {
      const r = await api.forkRevision(revision);
      const sid = r.chatSessionId || r.sessionId || r.id;
      if (sid) { navigate(`/search-v1/${sid}`); return; }
      toast('Fork returned without a session id', 'error');
      return;
    }
    const fresh = await api.createSession(session.value?.mode || 'auto');
    const query = latestMessage.value?.query || '';
    if (query) {
      await api.createTask({
        mode: session.value?.mode || 'auto', agentName: latestMessage.value?.agentName || '',
        query, queryContent: query, chatSessionId: fresh.id, questionMode: 'task',
        enableGpu: false, enableBrainstorming: false, fileIds: [], modelOverride: store.composer.model,
      });
    }
    navigate(`/search-v1/${fresh.id}`);
  } catch (e) {
    toast(`Fork is unavailable on this backend: ${e.message || e}`, 'error');
  }
}
async function rerun() {
  const query = latestMessage.value?.query || '';
  if (query === '') { toast('No previous task to re-run', 'error'); return; }
  streaming.value = true;
  beginTimer();
  try {
    const last = latestMessage.value || {};
    const task = await createTask({
      mode: session.value?.mode || 'auto',
      agentName: last.agentName || '',
      query,
      queryContent: query,
      enableGpu: false,
      enableBrainstorming: false,
      questionMode: 'task',
      modelOverride: store.composer.model,
      fileIds: [],
    });
    currentTaskId.value = String(task.id || task.taskId);
    await refreshMessages();
    startPolling(currentTaskId.value);
    connectStream();
  } catch (e) {
    streaming.value = false;
    endTimer();
    error.value = String(e.message || e);
  }
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareUrl.value);
    toast('Session link copied');
  } catch {
    toast('Clipboard unavailable — copy the URL from the address bar', 'error');
  }
}
async function publishOrWithdraw() {
  if (getToken() === '') {
    store.overlays.login = true;
    return;
  }
  publishBusy.value = true;
  error.value = '';
  try {
    if (isPublished.value) {
      await api.withdrawPublish(props.sessionId);
      publishedRevisionId.value = null;
      toast('Publication withdrawn');
      return;
    }
    const access = await api.publishAccess();
    publishAccess.value = access;
    if (access?.canPublish === false) {
      error.value = access.message || 'Publishing is not allowed for this account.';
      return;
    }
    const r = await api.publish(props.sessionId);
    publishedRevisionId.value = r.revisionId || null;
    toast(`Published revision ${r.revisionId || ''}`);
  } catch (e) {
    error.value = String(e.message || e);
  } finally {
    publishBusy.value = false;
  }
}
async function renameSession() {
  if (titleDraft.value.trim() === '') return;
  try {
    const r = await api.rename(props.sessionId, titleDraft.value.trim());
    session.value = { ...session.value, ...r };
    renaming.value = false;
    menuOpen.value = false;
    toast('Session renamed');
  } catch (e) {
    toast(String(e.message || e), 'error');
  }
}
async function deleteSession() {
  if (window.confirm('Delete this session? This cannot be undone.') === false) return;
  try {
    await api.deleteSession(props.sessionId);
    toast('Session deleted');
    navigate('/chat');
  } catch (e) {
    toast(String(e.message || e), 'error');
  }
}
function startRename() {
  titleDraft.value = sessionTitle.value;
  renaming.value = true;
  menuOpen.value = false;
}
onMounted(async () => {
  await load();
  if (store.pendingPayload) {
    const payload = store.pendingPayload;
    store.pendingPayload = null;
    await submitPayload(payload);
  }
  scrollBottom();
});
onBeforeUnmount(() => {
  stopStream();
  stopPolling();
  endTimer();
});
</script>

<template>
  <div class="session">
    <header class="shead">
      <button class="btn ghost" title="Back" @click="navigate('/chat')">←</button>
      <div class="title">
        <input v-if="renaming" v-model="titleDraft" class="rename" @keydown.enter="renameSession" @keydown.esc="renaming = false" />
        <span v-else class="t">{{ sessionTitle }}</span>
        <span class="muted tiny mono">/search-v1/{{ props.sessionId }}</span>
      </div>
      <div class="grow" />
      <span v-if="streaming" class="status"><i class="dot-pulse" /> {{ phase }} · {{ elapsed }}s · {{ transport }}</span>
      <span v-else-if="transport === 'polling fallback'" class="status muted">polling fallback</span>
      <button class="btn ghost" @click="copyLink">Copy link</button>
      <button class="btn" @click="shareOpen = true">Share</button>
      <button class="btn" :disabled="publishBusy" @click="publishOrWithdraw">{{ publishBusy ? 'Working…' : publishLabel }}</button>
      <button class="btn" @click="forkSession">Fork</button>
      <button class="btn" :disabled="streaming" @click="rerun">Re-run</button>
      <button v-if="isRunning" class="btn danger" @click="cancelTask">Cancel task</button>
      <div class="menu-wrap">
        <button class="btn ghost" @click="menuOpen = menuOpen === false">⋯</button>
        <div v-if="menuOpen" class="session-menu card">
          <button @click="startRename">Rename session</button>
          <button @click="copyLink">Copy session link</button>
          <button class="danger-text" @click="deleteSession">Delete session</button>
        </div>
      </div>
    </header>

    <div v-if="error" class="error-bar">{{ error }}</div>

    <div class="panes">
      <section class="process">
        <div class="stream">
          <div v-if="loading" class="muted">Loading session…</div>

          <div v-for="m in messages" :key="m.id" class="msg fade-up">
            <div v-if="m.query" class="q">{{ m.query }}</div>
            <div v-if="m.result" class="r"><MarkdownBlock :content="m.result" /></div>
            <div v-else-if="['processing', 'init'].includes(m.status)" class="working"><i class="dot-pulse" /> Working on task…</div>
            <div v-if="m.status === 'error'" class="task-error">Task ended with an error.</div>
            <div class="msg-foot">
              <span class="muted tiny">{{ m.agentName || m.extInfo?.mode || 'agent' }}<span v-if="m.status"> · {{ m.status }}</span></span>
              <FeedbackBar v-if="m.taskId && ['finish', 'error'].includes(m.status)" :task-id="m.taskId" />
            </div>
          </div>

          <div v-if="currentTask" class="trajectory">
            <div class="trajectory-head">
              <strong>Process</strong>
              <span class="muted tiny">{{ currentTask.status }} · {{ trajectory.length }} steps</span>
            </div>
            <div v-for="row in trajectory.slice(-120)" :key="row.id" class="trajectory-row" :class="row.role">
              <div class="trajectory-label">
                <span>{{ row.role === 'tool' ? (row.name || 'tool') : row.role }}</span>
                <span class="muted tiny">{{ row.at }}</span>
              </div>
              <div v-if="row.content" class="trajectory-content"><MarkdownBlock :content="row.content.slice(0, 12000)" /></div>
              <div v-for="call in row.toolCalls" :key="call.id" class="tool-call">
                <strong>{{ call.function?.name || 'tool' }}</strong>
                <pre>{{ call.function?.arguments || '' }}</pre>
              </div>
            </div>
          </div>

          <div v-if="liveText" class="msg live">
            <MarkdownBlock :content="liveText" />
            <span class="caret" />
          </div>
          <div v-else-if="streaming" class="muted small">Novix is working…</div>
          <div id="session-anchor" />
        </div>

        <div v-if="pendingQuestion" class="pending card">
          <div class="pending-head"><strong>Agent question</strong><span class="chip">needs your answer</span></div>
          <p>{{ pendingQuestion.question }}</p>
        </div>

        <div class="composer-mini">
          <textarea v-model="followup" rows="2" :placeholder="pendingQuestion ? 'Answer the agent question…' : 'Ask a follow-up question… (Enter to send)'" @keydown.enter.exact.prevent="sendFollowup" />
          <button class="btn ghost mention-btn" title="Insert @agent mention" @click="followup = `${followup}@`">@</button>
          <button class="btn primary" :disabled="followup.trim() === '' || streaming" @click="sendFollowup">{{ pendingQuestion ? 'Answer' : 'Send' }}</button>
        </div>
      </section>

      <WorkspaceCanvas :session-id="props.sessionId" :tree="tree" :terminal="terminal" @refresh="refreshTree" @followup="(f) => { followup = `${f.text}\n\n(file: ${f.file})`; sendFollowup(); }" />
    </div>

    <ShareModal v-if="shareOpen" :session-id="props.sessionId" @close="shareOpen = false" />
  </div>
</template>

<style scoped>
.session { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.shead { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
.title { display: flex; flex-direction: column; min-width: 0; margin-left: 3px; }
.t { font-size: var(--fs-13); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 340px; }
.tiny { font-size: var(--fs-10); }
.mono { font-family: var(--font-mono); }
.rename { border: 1px solid var(--input); background: var(--background); border-radius: var(--r-5); font-size: var(--fs-12); padding: 2px 6px; width: 250px; }
.grow { flex: 1; }
.status { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-11); color: var(--muted-foreground); white-space: nowrap; }
.btn.danger { color: var(--destructive); border-color: color-mix(in oklch, var(--destructive) 45%, var(--border)); }
.menu-wrap { position: relative; }
.session-menu { position: absolute; right: 0; top: calc(100% + 5px); z-index: 60; width: 170px; padding: 4px; box-shadow: var(--shadow-lg); display: flex; flex-direction: column; }
.session-menu button { border: 0; background: transparent; text-align: left; padding: 7px 8px; border-radius: var(--r-5); font-size: var(--fs-12); cursor: pointer; color: var(--foreground); }
.session-menu button:hover { background: var(--secondary); }
.danger-text { color: var(--destructive); }
.error-bar { padding: 7px 12px; background: color-mix(in oklch, var(--destructive) 9%, var(--background)); color: var(--destructive); font-size: var(--fs-11); border-bottom: 1px solid var(--border); }
.panes { flex: 1; display: flex; min-height: 0; }
.process { flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0; }
.stream { flex: 1; overflow-y: auto; padding: 18px 22px; }
.msg { margin-bottom: 18px; }
.q { background: var(--muted); border-radius: var(--r-14); padding: 8px 12px; margin-bottom: 8px; font-size: var(--fs-13); max-width: 88%; margin-left: auto; white-space: pre-wrap; }
.r { font-size: var(--fs-13); }
.working { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-12); color: var(--muted-foreground); }
.task-error { color: var(--destructive); font-size: var(--fs-12); }
.msg-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.small { font-size: var(--fs-12); }
.trajectory { margin: 20px 0; border-top: 1px solid var(--border); padding-top: 10px; }
.trajectory-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; font-size: var(--fs-12); }
.trajectory-row { border-left: 2px solid var(--border); padding: 3px 0 8px 9px; margin-left: 3px; }
.trajectory-row.user { display: none; }
.trajectory-row.tool { border-left-color: var(--chart-2); }
.trajectory-label { display: flex; justify-content: space-between; gap: 8px; font-size: var(--fs-10); text-transform: uppercase; letter-spacing: .06em; color: var(--muted-foreground); margin-bottom: 2px; }
.trajectory-content { font-size: var(--fs-12); color: var(--foreground); max-height: 240px; overflow-y: auto; }
.tool-call { margin-top: 3px; border: 1px solid var(--border); border-radius: var(--r-5); background: var(--secondary); padding: 4px 7px; font-size: var(--fs-10); }
.tool-call pre { white-space: pre-wrap; word-break: break-word; margin: 2px 0 0; color: var(--muted-foreground); font-family: var(--font-mono); max-height: 100px; overflow: auto; }
.caret { display: inline-block; width: 7px; height: 14px; background: var(--primary); animation: pulse 1s steps(2, start) infinite; vertical-align: text-bottom; }
.pending { margin: 0 12px 8px; padding: 11px 13px; border-color: var(--primary); background: var(--accent); }
.pending-head { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
.pending p { margin: 6px 0 0; font-size: var(--fs-12); }
.composer-mini { display: flex; gap: 6px; padding: 10px 12px; border-top: 1px solid var(--border); align-items: flex-end; }
.composer-mini textarea { flex: 1; resize: none; border: 1px solid var(--input); border-radius: var(--r-12); padding: 8px 10px; background: var(--card); font-size: var(--fs-13); max-height: 120px; min-height: 38px; }
.mention-btn { height: 36px; padding: 0 8px; }
@media (max-width: 900px) { .panes { flex-direction: column; overflow-y: auto; } .process { min-height: 65vh; } .t { max-width: 180px; } }
</style>
