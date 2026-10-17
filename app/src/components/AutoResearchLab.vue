<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { api } from '../lib/api.js';
import { toast } from '../stores/app.js';
const runs = ref([]);
const active = ref(null);
const busy = ref(false);
const contract = ref(null);
const error = ref('');
let pollTimer = null;
function stopPolling() { clearInterval(pollTimer); pollTimer = null; }
function startPolling(id) {
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      const run = await api.labGet(id);
      active.value = run;
      if (['queued','running','cancelling'].includes(run.status) === false) stopPolling();
    } catch { stopPolling(); }
  }, 700);
}
async function load() {
  try {
    const r = await api.labList();
    runs.value = r.items || [];
    if (active.value == null && runs.value.length) active.value = runs.value[0];
  } catch (e) { error.value = String(e.message || e); }
}
async function create() {
  busy.value = true;
  try {
    const run = await api.labCreate({ name: 'Auto Experiment lab', maxExperiments: 8, timeBudgetMs: 300000 });
    active.value = run;
    await api.labStart(run.id);
    startPolling(run.id);
    await new Promise((r) => setTimeout(r, 400));
    active.value = await api.labGet(run.id);
    await load();
    toast('AutoResearch run started');
  } catch (e) { error.value = String(e.message || e); }
  finally { busy.value = false; }
}
async function refresh() {
  await load();
  if (active.value) active.value = await api.labGet(active.value.id);
}
async function cancel() {
  if (active.value == null) return;
  try { active.value = await api.labCancel(active.value.id); toast('Cancellation requested'); } catch (e) { error.value = String(e.message || e); }
}
async function tsv() {
  if (active.value == null) return;
  try { const r = await api.labResults(active.value.id); await navigator.clipboard?.writeText(r.tsv || ''); toast('results.tsv copied'); } catch (e) { error.value = String(e.message || e); }
}
onBeforeUnmount(stopPolling);
onMounted(async () => {
  try { contract.value = await api.labContract(); } catch { }
  await load();
});
</script>
<template>
  <section class="lab card">
    <header>
      <div>
        <p class="eyebrow">AUTORESEARCH LAB</p>
        <h2>Keep / discard / crash</h2>
        <p class="muted">Fixed-budget experiments with a baseline and persisted <code>results.tsv</code> evidence.</p>
      </div>
      <div class="actions">
        <button class="btn ghost" :disabled="busy" @click="refresh">Refresh</button>
        <button class="btn primary" :disabled="busy" @click="create">{{ busy ? 'Starting…' : 'New run' }}</button>
        <button v-if="active && ['running','queued'].includes(active.status)" class="btn ghost" @click="cancel">Cancel</button>
      </div>
    </header>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="contract" class="muted tiny">Offline evaluator is deterministic. Vectorized contract: {{ contract.vectorized.step }}</p>
    <div class="body">
      <aside>
        <button v-for="r in runs" :key="r.id" :class="{ on: active && active.id === r.id }" @click="active = r">
          <strong>{{ r.name }}</strong><span class="muted">{{ r.status }} · {{ r.results?.length || 0 }} rows</span>
        </button>
        <p v-if="runs.length === 0" class="muted">No runs yet. Create one to establish a baseline.</p>
      </aside>
      <div v-if="active" class="results">
        <div class="stats">
          <span>Status <strong>{{ active.status }}</strong></span>
          <span>Best val_bpb <strong>{{ active.bestMetric ?? '—' }}</strong></span>
          <span>Budget <strong>{{ Math.round(active.timeBudgetMs / 1000) }}s</strong></span>
          <button class="btn ghost" @click="tsv">Copy results.tsv</button>
        </div>
        <table>
          <thead><tr><th>commit</th><th>val_bpb</th><th>memory_gb</th><th>status</th><th>description</th></tr></thead>
          <tbody>
            <tr v-for="r in active.results || []" :key="r.commit + r.description">
              <td class="mono">{{ r.commit }}</td><td>{{ r.val_bpb }}</td><td>{{ r.memory_gb }}</td>
              <td><span class="status" :class="r.status">{{ r.status }}</span></td><td>{{ r.description }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="(active.results || []).length === 0" class="muted">Baseline will appear here after start/resume.</p>
      </div>
      <div v-else class="muted empty">Select a run.</div>
    </div>
  </section>
</template>
<style scoped>
.lab { padding: 14px; margin-top: 14px; }
header { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; }
.eyebrow { font-size: 9px; letter-spacing: .16em; color: var(--primary); font-weight: 700; margin: 0 0 4px; }
h2 { font-family: var(--font-display); font-size: 18px; margin: 0 0 4px; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.body { display: grid; grid-template-columns: 210px 1fr; gap: 12px; margin-top: 12px; }
aside { display: flex; flex-direction: column; gap: 5px; }
aside button { text-align: left; border: 1px solid var(--border); background: var(--card); border-radius: var(--r-8); padding: 7px 8px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; font-size: var(--fs-11); }
aside button.on { border-color: var(--primary); background: var(--accent); }
.stats { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; font-size: var(--fs-11); margin-bottom: 8px; }
table { width: 100%; border-collapse: collapse; font-size: var(--fs-11); }
th, td { text-align: left; border-bottom: 1px solid var(--border); padding: 5px 6px; vertical-align: top; }
.status { font-size: 9px; padding: 1px 5px; border-radius: 99px; background: var(--secondary); }
.status.keep { background: color-mix(in oklch, var(--primary) 15%, transparent); color: var(--primary); }
.status.crash { color: var(--destructive); }
.error { color: var(--destructive); font-size: var(--fs-11); }
.tiny { font-size: var(--fs-10); }
.empty { padding: 30px; text-align: center; }
@media (max-width: 760px) { .body { grid-template-columns: 1fr; } header { flex-direction: column; } }
</style>
