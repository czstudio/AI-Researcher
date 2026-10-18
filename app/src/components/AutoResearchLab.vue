<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api, authHeaders } from '../lib/api.js';
import { toast } from '../stores/app.js';

const runs = ref([]);
const active = ref(null);
const busy = ref(false);
const contract = ref(null);
const error = ref('');
const numEnvs = ref(3);
const batchBudgetSec = ref(120);
let pollTimer = null;

const isActive = computed(() => Boolean(active.value && ['queued', 'running', 'cancelling'].includes(active.value.status)));
const isBatch = computed(() => Boolean(active.value && active.value.kind === 'batch'));
const rows = computed(() => (active.value && active.value.results) || []);
const aggregate = computed(() => (active.value && active.value.aggregate) || null);
const best = computed(() => active.value && active.value.bestMetric != null ? Number(active.value.bestMetric).toFixed(6) : '—');
const baseline = computed(() => active.value && active.value.baseline ? Number(active.value.baseline.val_bpb).toFixed(6) : '—');
const evidence = computed(() => (active.value && active.value.evidence) || {});

function stopPolling() { clearInterval(pollTimer); pollTimer = null; }
function startPolling(id) {
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      const run = await api.labGet(id);
      active.value = run;
      if (['queued', 'running', 'cancelling'].includes(run.status) === false) { stopPolling(); await load(); }
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
async function request(method, path, body) {
  const init = { method, headers: authHeaders() };
  if (body != null) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch('/api' + path, init);
  const json = await res.json();
  if (json.code !== '0') throw new Error(json.message || ('error ' + json.code));
  return json.result;
}
async function createSingle() {
  busy.value = true; error.value = '';
  try {
    const run = await api.labCreate({ name: 'Auto Experiment lab', maxExperiments: 8, timeBudgetMs: 300000 });
    active.value = run;
    await api.labStart(run.id);
    startPolling(run.id);
    toast('Single AutoResearch run started');
  } catch (e) { error.value = String(e.message || e); }
  finally { busy.value = false; }
}
async function createBatch() {
  busy.value = true; error.value = '';
  try {
    const seconds = Math.max(1, Number(batchBudgetSec.value) || 120);
    const run = await request('POST', '/autoresearch/lab/batches', {
      name: 'Vectorized Auto Experiment batch',
      numEnvs: Math.max(1, Number(numEnvs.value) || 3),
      batchBudgetMs: Math.round(seconds * 1000),
      timeBudgetMs: 300000,
      maxExperiments: 6,
    });
    active.value = run;
    await request('POST', '/autoresearch/lab/runs/' + encodeURIComponent(run.id) + '/start', {});
    startPolling(run.id);
    toast('Simulated vectorized batch started');
  } catch (e) { error.value = String(e.message || e); }
  finally { busy.value = false; }
}
async function refresh() {
  await load();
  if (active.value) {
    try { active.value = await api.labGet(active.value.id); } catch (e) { error.value = String(e.message || e); }
  }
}
async function cancel() {
  if (active.value == null) return;
  try { active.value = await api.labCancel(active.value.id); startPolling(active.value.id); toast('Cancellation requested'); }
  catch (e) { error.value = String(e.message || e); }
}
async function copyTsv() {
  if (active.value == null) return;
  try { const r = await api.labResults(active.value.id); await navigator.clipboard?.writeText(r.tsv || ''); toast('results.tsv copied'); }
  catch (e) { error.value = String(e.message || e); }
}
async function downloadTsv() {
  if (active.value == null) return;
  try {
    const res = await fetch('/api/autoresearch/lab/runs/' + encodeURIComponent(active.value.id) + '/results.tsv?download=1', { headers: authHeaders() });
    if (res.ok === false) throw new Error('download failed (' + res.status + ')');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = active.value.id + '.results.tsv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch (e) { error.value = String(e.message || e); }
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
        <p class="eyebrow">AUTORESEARCH LAB · OFFLINE DETERMINISTIC</p>
        <h2>Keep / discard / crash</h2>
        <p class="muted">Baseline-first, fixed-budget experiments with isolated temp workspaces and atomic on-disk <code>results.tsv</code> evidence.</p>
      </div>
      <div class="actions">
        <button class="btn ghost" :disabled="busy" @click="refresh">Refresh</button>
        <button class="btn primary" :disabled="busy" @click="createSingle">{{ busy ? 'Starting…' : 'New single run' }}</button>
        <button class="btn ghost" :disabled="busy" @click="createBatch">Batch run</button>
      </div>
    </header>
    <div class="controls">
      <label>Envs <input v-model.number="numEnvs" type="number" min="1" max="32" /></label>
      <label>Shared batch budget (s) <input v-model.number="batchBudgetSec" type="number" min="1" max="7200" /></label>
      <span class="muted tiny">Batch runs are independent child runs with a shared wall-clock budget, not a Metal physics engine.</span>
    </div>
    <p v-if="error" class="error">{{ error }}</p>
    <p v-if="contract" class="notice">
      {{ contract.evaluator.default }}. Real GPU training requires an external evaluator worker ({{ contract.evaluator.envVars.join(' / ') }}). Vectorized marker: {{ contract.batch.simulatedVectorized ? 'simulated' : 'real' }}.
    </p>
    <div class="body">
      <aside>
        <button v-for="r in runs" :key="r.id" :class="{ on: active && active.id === r.id }" @click="active = r">
          <strong>{{ r.name }}</strong>
          <span class="muted">{{ r.kind || 'single' }} · {{ r.status }} · {{ r.results?.length || 0 }} rows</span>
        </button>
        <p v-if="runs.length === 0" class="muted">No runs yet. Start one to establish a baseline.</p>
      </aside>
      <div v-if="active" class="results">
        <div class="stats">
          <span>Status <strong>{{ active.status }}</strong></span>
          <span>Baseline <strong>{{ baseline }}</strong></span>
          <span>Best val_bpb <strong>{{ best }}</strong></span>
          <span>Per-run budget <strong>{{ Math.round((active.timeBudgetMs || 0) / 1000) }}s</strong></span>
          <span>Workspace <strong>{{ active.workspace?.mode || 'pending' }}</strong> / {{ active.workspace?.cleanup || 'pending' }}</span>
          <span>TSV <strong>{{ evidence.tsvRows ?? 0 }} rows</strong></span>
          <button class="btn ghost" @click="copyTsv">Copy results.tsv</button>
          <button class="btn ghost" @click="downloadTsv">Download</button>
          <button v-if="isActive" class="btn ghost" @click="cancel">Cancel</button>
        </div>
        <p class="tiny mono">sha256 {{ evidence.tsvSha256 || 'pending' }}</p>
        <div v-if="isBatch && aggregate" class="aggregate">
          <h3>Vectorized aggregate <span class="chip">simulated</span></h3>
          <p class="muted">envs={{ aggregate.numEnvs }} · sharedBudget={{ aggregate.sharedBudgetMs }}ms · rows={{ aggregate.totals?.rows }} · keep={{ aggregate.totals?.keep }} · discard={{ aggregate.totals?.discard }} · crash={{ aggregate.totals?.crash }}</p>
          <p v-if="aggregate.best" class="muted">best child={{ aggregate.best.childIndex }} · commit={{ aggregate.best.commit }} · val_bpb={{ aggregate.best.val_bpb }}</p>
          <table class="children">
            <thead><tr><th>env</th><th>status</th><th>best</th><th>keep</th><th>discard</th><th>crash</th><th>cleanup</th></tr></thead>
            <tbody>
              <tr v-for="c in aggregate.children || []" :key="c.runId">
                <td>{{ c.index }}</td><td>{{ c.status }}</td><td>{{ c.bestMetric ?? '—' }}</td>
                <td>{{ c.counts?.keep || 0 }}</td><td>{{ c.counts?.discard || 0 }}</td><td>{{ c.counts?.crash || 0 }}</td><td>{{ c.workspace?.cleanup }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <table>
          <thead><tr><th>commit</th><th>val_bpb</th><th>memory_gb</th><th>status</th><th>description</th></tr></thead>
          <tbody>
            <tr v-for="r in rows" :key="r.commit + r.description + r.at">
              <td class="mono">{{ r.commit }}</td><td>{{ r.val_bpb }}</td><td>{{ r.memory_gb }}</td>
              <td><span class="status" :class="r.status">{{ r.status }}</span></td><td>{{ r.description }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="rows.length === 0" class="muted">Baseline will appear here after start.</p>
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
h3 { font-size: var(--fs-12); margin: 12px 0 4px; }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-top: 10px; font-size: var(--fs-11); }
.controls input { width: 70px; margin-left: 5px; border: 1px solid var(--border); border-radius: var(--r-5); padding: 3px 5px; background: var(--background); color: var(--foreground); }
.notice { font-size: var(--fs-10); color: var(--muted-foreground); background: var(--secondary); border-radius: var(--r-8); padding: 7px 9px; }
.body { display: grid; grid-template-columns: 230px 1fr; gap: 12px; margin-top: 12px; min-width: 0; }
aside { display: flex; flex-direction: column; gap: 5px; }
aside button { text-align: left; border: 1px solid var(--border); background: var(--card); border-radius: var(--r-8); padding: 7px 8px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; font-size: var(--fs-11); }
aside button.on { border-color: var(--primary); background: var(--accent); }
.results { min-width: 0; }
.stats { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; font-size: var(--fs-11); margin-bottom: 5px; }
table { width: 100%; border-collapse: collapse; font-size: var(--fs-11); margin-top: 6px; }
th, td { text-align: left; border-bottom: 1px solid var(--border); padding: 5px 6px; vertical-align: top; }
table.children { font-size: var(--fs-10); }
.status { font-size: 9px; padding: 1px 5px; border-radius: 99px; background: var(--secondary); text-transform: uppercase; }
.status.keep { background: color-mix(in oklch, var(--primary) 15%, transparent); color: var(--primary); }
.status.crash { color: var(--destructive); }
.chip { font-size: 8px; text-transform: uppercase; background: var(--secondary); border-radius: 99px; padding: 1px 5px; }
.aggregate { border: 1px dashed var(--border); border-radius: var(--r-8); padding: 7px 9px; margin: 8px 0; }
.error { color: var(--destructive); font-size: var(--fs-11); }
.tiny { font-size: var(--fs-10); overflow-wrap: anywhere; }
.mono { font-family: var(--font-mono); }
.empty { padding: 30px; text-align: center; }
@media (max-width: 760px) { .body { grid-template-columns: 1fr; } header { flex-direction: column; } }
</style>
