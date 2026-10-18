<script setup>
import { computed, onMounted, ref } from 'vue';
import { api, authHeaders } from '../lib/api.js';
import { toast, store } from '../stores/app.js';
const teams = ref([]);
const active = ref(null);
const meta = ref({ roles: [], phases: [], definitions: {} });
const goal = ref('Build a verified research feature with evidence.');
const taskSubject = ref('');
const taskRole = ref('engineer');
const message = ref('');
const evidence = ref('');
const artifactType = ref('delegation');
const artifactFilename = ref('delegation.json');
const artifactContent = ref('ceo delegates to pm engineer qa');
const artifactJson = ref('{}');
const busy = ref(false);
const error = ref('');
const reviewPaths = ref('src/auth/login.ts' + String.fromCharCode(10) + 'app/api/team.mjs');
const reviewResult = ref(null);
const shipState = ref(null);
const attention = ref([]);
const digest = ref([]);
const approvalNote = ref('Release approved by ceo after green evidence.');
const memoryQuery = ref('evidence gate');
const memoryResults = ref([]);
const memoryTitle = ref('');
const memoryBody = ref('');
const memoryTags = ref('decision,retro');
const currentIndex = computed(() => meta.value.phases.indexOf(active.value?.phase || 'think'));
const nextPhase = computed(() => meta.value.phases[currentIndex.value + 1] || null);
async function load() {
  try {
    const [m, t] = await Promise.all([api.teamRoles(), api.teamList()]);
    meta.value = m; teams.value = t.items || [];
    if (active.value == null && teams.value.length) active.value = teams.value[0];
  } catch (e) { error.value = String(e.message || e); }
}
async function refresh() {
  await load();
  if (active.value) { active.value = await api.teamGet(active.value.id); await loadInsights(); }
}
async function createTeam() {
  busy.value = true;
  try { active.value = await api.teamCreate({ name: 'Research sprint', goal: goal.value }); await api.teamSpawn(active.value.id, 'ceo'); await refresh(); toast('Team sprint created'); }
  catch (e) { error.value = String(e.message || e); } finally { busy.value = false; }
}
async function spawn(role) { try { await api.teamSpawn(active.value.id, role); await refresh(); } catch (e) { error.value = String(e.message || e); } }
async function createTask() {
  try { await api.teamTaskCreate(active.value.id, { subject: taskSubject.value, ownerRole: taskRole.value, createdBy: 'ceo' }); taskSubject.value = ''; await refresh(); }
  catch (e) { error.value = String(e.message || e); }
}
async function claim(task) { try { await api.teamTaskClaim(active.value.id, task.id, task.ownerRole); await refresh(); } catch (e) { error.value = String(e.message || e); } }
async function complete(task) {
  try { await api.teamTaskComplete(active.value.id, task.id, task.ownerRole, evidence.value || 'evidence captured in session artifact'); await refresh(); }
  catch (e) { error.value = String(e.message || e); }
}
async function submitArtifact() {
  try {
    let payload = {};
    try { payload = JSON.parse(artifactJson.value || '{}'); } catch { payload = {}; }
    await api.teamArtifact(active.value.id, { role: 'ceo', artifactType: artifactType.value, filename: artifactFilename.value, content: artifactContent.value, payload });
    await refresh(); toast('Evidence artifact submitted');
  } catch (e) { error.value = String(e.message || e); }
}
async function advance() {
  try { active.value = await api.teamAdvance(active.value.id, 'ceo', nextPhase.value); toast('Phase advanced to ' + nextPhase.value); }
  catch (e) { error.value = String(e.message || e); }
}
async function say() {
  try { await api.teamMessages(active.value.id, { role: 'ceo', parts: [{ type: 'text', text: message.value }] }); message.value = ''; await refresh(); }
  catch (e) { error.value = String(e.message || e); }
}

async function teamFetch(method, subpath, body) {
  const init = { method, headers: authHeaders() };
  if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch('/api/team/sprints/' + encodeURIComponent(active.value.id) + subpath, init);
  const json = await res.json();
  if (String(json.code) !== '0') throw new Error(json.message || ('team api ' + json.code));
  return json.result;
}
async function routeReview() {
  try {
    const diffPaths = reviewPaths.value.split(String.fromCharCode(10)).map((x) => x.trim()).filter(Boolean);
    reviewResult.value = await teamFetch('POST', '/review/route', { diffPaths });
    await loadAttention(); toast('Reviewers routed: ' + reviewResult.value.reviewers.join(', '));
  } catch (e) { error.value = String(e.message || e); }
}
async function loadShip() {
  if (active.value == null) return;
  try { shipState.value = await teamFetch('GET', '/ship/approval'); } catch (e) { shipState.value = { passed: false, checks: [], error: String(e.message || e) }; }
}
async function approveShip() {
  try { await teamFetch('POST', '/ship/approve', { role: 'ceo', note: approvalNote.value }); await loadShip(); toast('Ship approval recorded'); }
  catch (e) { error.value = String(e.message || e); }
}
async function loadAttention() {
  if (active.value == null) return;
  try {
    const [list, dig] = await Promise.all([teamFetch('GET', '/attention'), teamFetch('GET', '/attention/digest')]);
    attention.value = list.items || []; digest.value = dig.items || [];
  } catch (e) { error.value = String(e.message || e); }
}
async function answerAttention(item, decision) {
  try { await teamFetch('POST', '/attention/' + encodeURIComponent(item.id) + '/answer', { decision, answer: decision === 'rejected' ? 'Rejected by operator' : 'Approved by operator', actor: 'user' }); await loadAttention(); }
  catch (e) { error.value = String(e.message || e); }
}
async function autoAccept() {
  try { const out = await teamFetch('POST', '/attention/auto-accept', { ttlMinutes: 15 }); await loadAttention(); toast('Auto-accepted ' + out.applied.length + ' reversible item(s)'); }
  catch (e) { error.value = String(e.message || e); }
}
async function writeMemory() {
  try {
    await teamFetch('POST', '/memory', { author: 'human@cli', title: memoryTitle.value, body: memoryBody.value, tags: memoryTags.value.split(',').map((x) => x.trim()).filter(Boolean), learnedFrom: 'user', evidence: 'team-page:manual' });
    memoryTitle.value = ''; memoryBody.value = ''; await searchMemory(); toast('Memory entry appended');
  } catch (e) { error.value = String(e.message || e); }
}
async function searchMemory() {
  try { const out = await teamFetch('GET', '/memory?q=' + encodeURIComponent(memoryQuery.value)); memoryResults.value = out.items || []; }
  catch (e) { error.value = String(e.message || e); }
}
async function loadInsights() { await Promise.all([loadShip(), loadAttention()]); }
onMounted(load);
</script>
<template>
  <div class="team-page">
    <header class="head">
      <div><p class="eyebrow">CLAWTEAM · AGENT-NATIVE WORKSPACE</p><h1>Research Team</h1><p class="muted">Eleven roles, seven gated phases, persistent evidence and agent chat.</p></div>
      <button class="btn primary" :disabled="busy" @click="createTeam">New sprint</button>
    </header>
    <p v-if="error" class="error">{{ error }}</p>
    <section class="grid">
      <aside class="card list">
        <input v-model="goal" placeholder="Sprint goal" />
        <button v-for="t in teams" :key="t.id" :class="{ on: active && active.id === t.id }" @click="active = t">
          <strong>{{ t.name }}</strong><span class="muted">{{ t.phase }} · {{ t.tasks?.length || 0 }} tasks</span>
        </button>
        <p v-if="teams.length === 0" class="muted tiny">No teams yet.</p>
      </aside>
      <main v-if="active" class="main">
        <div class="phase-rail card">
          <span v-for="(p, i) in meta.phases" :key="p" class="phase" :class="{ done: i < currentIndex, now: i === currentIndex }">{{ p }}</span>
          <div class="grow" />
          <button v-if="nextPhase" class="btn primary" @click="advance">CEO advance → {{ nextPhase }}</button>
        </div>
        <section class="card roles">
          <h2>Roster</h2>
          <div class="chips">
            <button v-for="r in meta.roles" :key="r" class="chip" :class="{ on: active.roles?.some(x => x.name === r) }" :title="meta.guidance?.[r]?.mandate || meta.definitions[r]?.authority || r" @click="spawn(r)">{{ r }}</button>
          </div>
          <p class="muted tiny">{{ meta.definitions.ceo?.authority }} Only the ceo role can advance phases.</p>
        </section>
        <section class="card tasks">
          <h2>Task board</h2>
          <div class="task-form">
            <input v-model="taskSubject" placeholder="New task subject" />
            <select v-model="taskRole"><option v-for="r in meta.roles" :key="r" :value="r">{{ r }}</option></select>
            <button class="btn" @click="createTask">Add task</button>
          </div>
          <article v-for="t in active.tasks || []" :key="t.id" class="task">
            <div><strong>{{ t.subject }}</strong><p class="muted tiny">{{ t.ownerRole }} · {{ t.status }} · deps {{ (t.dependsOn || []).join(', ') || 'none' }}</p></div>
            <button v-if="t.status === 'pending'" class="btn ghost" @click="claim(t)">Claim</button>
            <button v-if="t.status === 'in_progress'" class="btn" @click="complete(t)">Complete with evidence</button>
          </article>
          <div v-if="active.tasks?.length" class="evidence-row"><input v-model="evidence" placeholder="Completion evidence / commit / test result" /></div>
          <p v-if="(active.tasks || []).length === 0" class="muted">No tasks on the board.</p>
        </section>
        <section class="card evidence">
          <h2>Evidence gate</h2>
          <div class="task-form">
            <select v-model="artifactType"><option v-for="a in ['delegation','architecture-lock','diff','review-report','test-report','ship-approval','retro']" :key="a" :value="a">{{ a }}</option></select>
            <input v-model="artifactFilename" placeholder="filename" />
          </div>
          <textarea v-model="artifactContent" rows="2" placeholder="Evidence content (no TBD/TODO/placeholder)" />
          <input v-model="artifactJson" placeholder='Optional JSON payload, e.g. {"testCommand":"npm test","passed":1,"failed":0,"outputExcerpt":"..."}' />
          <button class="btn" @click="submitArtifact">Submit evidence</button>
          <p class="muted tiny">Gate requires phase artifact before ceo can advance. Test reports can be re-run through the verify endpoint when TEAM_ALLOW_TEST_EXEC=1.</p>
        </section>
        <section class="card chat">
          <h2>Agent chat</h2>
          <div class="thread">
            <article v-for="m in active.messages || []" :key="m.id" class="msg">
              <strong>{{ m.role }}</strong>
              <p v-for="(part, i) in m.parts" :key="i" :class="part.type">{{ part.type === 'tool' ? part.toolName : part.text }}</p>
            </article>
            <p v-if="(active.messages || []).length === 0" class="muted">No messages yet.</p>
          </div>
          <div class="say"><input v-model="message" placeholder="Message the team as ceo…" @keydown.enter="say" /><button class="btn primary" @click="say">Send</button></div>
        </section>

        <section class="card review">
          <h2>Review router</h2>
          <textarea v-model="reviewPaths" rows="2" placeholder="One changed path per line" />
          <button class="btn" @click="routeReview">Route reviewers</button>
          <p v-if="reviewResult" class="tiny">Floor + matched: <strong>{{ (reviewResult.reviewers || []).join(', ') }}</strong></p>
          <p v-if="reviewResult" class="muted tiny">Rules: {{ (reviewResult.matchedRules || []).map(r => r.pattern).join(', ') || 'floor only' }}</p>
        </section>
        <section class="card ship">
          <h2>Ship approval gate</h2>
          <div v-if="shipState">
            <p class="tiny" :class="shipState.passed ? 'good' : 'warn'">{{ shipState.passed ? 'Ship gate open' : 'Ship gate blocked' }}</p>
            <p v-for="c in shipState.checks || []" :key="c.check" class="tiny" :class="c.passed ? 'good' : 'warn'">{{ c.passed ? 'PASS' : 'BLOCK' }} · {{ c.check }} — {{ c.detail }}</p>
          </div>
          <input v-model="approvalNote" placeholder="CEO ship approval note" />
          <button class="btn primary" @click="approveShip">CEO approve ship</button>
        </section>
        <section class="card attention">
          <h2>Attention queue</h2>
          <div class="row"><button class="btn" @click="autoAccept">Auto-accept reversible · 15m TTL</button><span class="muted tiny">{{ attention.length }} pending · {{ digest.length }} digest cluster(s)</span></div>
          <article v-for="item in attention" :key="item.id" class="attention-item">
            <div><strong>{{ item.title }}</strong><p class="muted tiny">{{ item.urgencyLabel }} · {{ item.ageBucket }} · {{ item.reversibility }} · score {{ item.priorityScore.toFixed(1) }}</p></div>
            <div class="row"><button class="btn ghost" @click="answerAttention(item, 'approved')">Approve</button><button class="btn ghost" @click="answerAttention(item, 'rejected')">Reject</button></div>
          </article>
          <p v-if="attention.length === 0" class="muted tiny">No pending questions or approvals.</p>
        </section>
        <section class="card memory">
          <h2>Team memory</h2>
          <div class="task-form"><input v-model="memoryQuery" placeholder="Keyword search" /><button class="btn" @click="searchMemory">Search</button></div>
          <div v-for="row in memoryResults" :key="row.entry.id" class="memory-row"><strong>{{ row.entry.title }}</strong><p class="muted tiny">{{ row.entry.learnedFrom }} · score {{ row.score.toFixed(2) }} · tags {{ (row.entry.tags || []).join(', ') }}</p></div>
          <div class="task-form"><input v-model="memoryTitle" placeholder="New memory title" /></div>
          <textarea v-model="memoryBody" rows="2" placeholder="Append-only team lesson" />
          <div class="task-form"><input v-model="memoryTags" placeholder="tags comma-separated" /><button class="btn" @click="writeMemory">Append memory</button></div>
        </section>
      </main>
      <div v-else class="card empty muted">Create a sprint to begin.</div>
    </section>
  </div>
</template>
<style scoped>
.team-page { height: 100%; overflow-y: auto; padding: 22px; box-sizing: border-box; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; max-width: var(--content-max); margin: 0 auto 12px; }
.eyebrow { font-size: 9px; letter-spacing: .16em; color: var(--primary); font-weight: 700; margin: 0 0 4px; }
h1 { font-family: var(--font-display); margin: 0 0 4px; font-size: 30px; }
.grid { display: grid; grid-template-columns: 220px 1fr; gap: 12px; max-width: var(--content-max); margin: 0 auto; }
.list { padding: 10px; display: flex; flex-direction: column; gap: 6px; align-self: start; }
.list input { border: 1px solid var(--input); border-radius: var(--r-8); padding: 7px; background: var(--background); }
.list button { text-align: left; border: 1px solid var(--border); border-radius: var(--r-8); background: var(--card); padding: 7px; display: flex; flex-direction: column; gap: 2px; cursor: pointer; font-size: var(--fs-11); }
.list button.on { border-color: var(--primary); background: var(--accent); }
.main { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.phase-rail { display: flex; gap: 5px; padding: 9px; align-items: center; flex-wrap: wrap; }
.phase { font-size: 9px; text-transform: uppercase; padding: 3px 7px; border-radius: 99px; border: 1px solid var(--border); color: var(--muted-foreground); }
.phase.done { background: var(--accent); }
.phase.now { border-color: var(--primary); color: var(--primary); font-weight: 700; }
.grow { flex: 1; }
.card { padding: 12px; }
h2 { font-size: var(--fs-13); margin: 0 0 8px; }
.chips { display: flex; gap: 5px; flex-wrap: wrap; }
.chip.on { border-color: var(--primary); color: var(--primary); }
.task-form { display: flex; gap: 6px; margin-bottom: 8px; }
.task-form input, .say input, .evidence-row input { flex: 1; min-width: 0; border: 1px solid var(--input); border-radius: var(--r-8); padding: 7px; background: var(--background); }
.task-form select { border: 1px solid var(--input); border-radius: var(--r-8); background: var(--background); }
.task { display: flex; justify-content: space-between; align-items: center; gap: 8px; border-top: 1px solid var(--border); padding: 7px 0; }
.evidence-row { margin-top: 7px; }
.evidence textarea, .evidence > input { width: 100%; box-sizing: border-box; border: 1px solid var(--input); border-radius: var(--r-8); padding: 7px; margin: 5px 0; background: var(--background); font: inherit; }
.thread { max-height: 220px; overflow-y: auto; display: flex; flex-direction: column; gap: 7px; margin-bottom: 8px; }
.msg { background: var(--secondary); border-radius: var(--r-8); padding: 7px 9px; }
.msg p { margin: 2px 0; font-size: var(--fs-12); }
.msg .reasoning { opacity: .7; font-style: italic; }
.msg .tool { font-family: var(--font-mono); font-size: var(--fs-10); color: var(--primary); }
.say { display: flex; gap: 6px; }
.error { color: var(--destructive); font-size: var(--fs-11); }
.empty { padding: 40px; text-align: center; }
.review textarea, .memory textarea { width: 100%; box-sizing: border-box; border: 1px solid var(--input); border-radius: var(--r-8); padding: 7px; margin: 5px 0; background: var(--background); font: inherit; }
.review > button, .ship > button { margin-top: 6px; }
.ship input { width: 100%; box-sizing: border-box; border: 1px solid var(--input); border-radius: var(--r-8); padding: 7px; margin: 5px 0; background: var(--background); }
.row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.attention-item { display: flex; justify-content: space-between; gap: 8px; border-top: 1px solid var(--border); padding: 7px 0; }
.memory-row { border-top: 1px solid var(--border); padding: 6px 0; }
.good { color: var(--chart-3); }
.warn { color: var(--destructive); }
@media (max-width: 760px) { .grid { grid-template-columns: 1fr; } .head { flex-direction: column; } .team-page { padding: 12px; } }
</style>
