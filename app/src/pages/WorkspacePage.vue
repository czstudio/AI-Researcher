<script setup>
import { computed, onMounted, watch } from 'vue';
import { store } from '../stores/app.js';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import ModeList from '../components/ModeList.vue';
import Composer from '../components/Composer.vue';
import CaseGallery from '../components/CaseGallery.vue';

const props = defineProps({ mode: { type: String, default: 'auto' } });
const emit = defineEmits(['submit']);

const mode = computed(() => store.modes.find((m) => m.key === props.mode) || store.modes[0] || { key: 'auto', label: 'Auto Pilot', tryChips: [] });
const chips = computed(() => mode.value?.tryChips || ['Survey the last five years of sparse attention', 'Turn my dataset into a research idea', 'Design an evaluation protocol']);
const placeholder = computed(() => {
  const map = {
    auto: 'Ask anything about your research…',
    deepsurvey: 'Describe the literature survey you need…',
    ideaspark: 'e.g. "Liquid neural networks for time-series forecasting"',
    methoddesign: 'Describe the method or experimental plan to design…',
    autoexperiment: 'Describe the algorithm or experiment to build and test…',
    notebook: 'Describe the data analysis you need…',
    reproduce: 'Paste a paper URL or describe the results to reproduce…',
  };
  return map[props.mode] || 'Ask anything about your research…';
});

function useChip(c) {
  store.composer.text = c;
}
function pickMode(key) {
  const m = store.modes.find((x) => x.key === key);
  const routeId = m?.routeId || key;
  navigate(`/${routeId}`);
}
async function loadGallery() {
  try {
    const r = await api.gallery(props.mode);
    store.gallery = r.items || [];
  } catch {
    store.gallery = [];
  }
}
watch(() => props.mode, loadGallery);
onMounted(loadGallery);
</script>

<template>
  <div class="wrap">
    <div class="tabs">
      <div class="seg">
        <button :class="{ on: store.workspaceMode === 'auto-discovery' }" @click="navigate('/auto-discovery')">Auto-Discovery <span class="new">New</span></button>
        <button :class="{ on: store.workspaceMode === 'manual' }" @click="store.workspaceMode = 'manual'">Manual task</button>
      </div>
    </div>

    <h1 class="hero">Agentic Workspace for Research</h1>
    <p class="sub muted">{{ mode.description || 'Route any research question to the right agent.' }}</p>

    <div class="grid">
      <ModeList :value="props.mode" @select="(k) => navigate(`/${(store.modes.find((m) => m.key === k) || {}).routeId || k}`)" />
      <div class="right">
        <Composer :mode-key="props.mode" :placeholder="placeholder" @submit="(p) => emit('submit', p)" @pick-mode="pickMode" @upgrade="navigate('/account/upgrade')" />
        <div class="chips">
          <span class="muted try">Try:</span>
          <button v-for="c in chips" :key="c" class="chip" @click="useChip(c)">{{ c }}</button>
        </div>
        <div class="mode-facts">
          <span v-if="mode.creditCost" class="chip">Base {{ mode.creditCost }} credits</span>
          <span v-if="mode.agentName" class="chip">{{ mode.agentName }}</span>
          <span class="chip">Files stay in this session</span>
        </div>
      </div>
    </div>

    <CaseGallery :mode="props.mode" />
  </div>
</template>

<style scoped>
.wrap { max-width: var(--content-max); margin: 0 auto; padding: 26px 20px 60px; width: 100%; overflow-y: auto; box-sizing: border-box; }
.tabs { display: flex; justify-content: flex-end; margin-bottom: 10px; }
.new { font-size: var(--fs-10); border: 1px solid var(--primary); color: var(--primary); border-radius: var(--r-pill); padding: 0 4px; margin-left: 4px; }
.hero { font-family: var(--font-display); font-size: var(--fs-32); font-weight: 700; line-height: 1.25; margin: 8px 0 4px; text-align: center; }
.sub { text-align: center; font-size: var(--fs-12); margin: 0 0 20px; }
.grid { display: flex; border: 1px solid var(--border); border-radius: var(--r-18); background: var(--card); overflow: hidden; box-shadow: var(--shadow-sm); }
.right { flex: 1; min-width: 0; padding: 14px; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; align-items: center; }
.try { font-size: var(--fs-12); }
.mode-facts { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 9px; }
.mode-facts .chip { cursor: default; height: 21px; font-size: var(--fs-10); }
@media (max-width: 760px) { .grid { flex-direction: column; } .hero { font-size: var(--fs-24); } .wrap { padding: 18px 12px 40px; } }
</style>
