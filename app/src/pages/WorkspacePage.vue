<script setup>
import { computed, onMounted } from 'vue';
import { store, toast } from '../stores/app.js';
import { navigate } from '../lib/router.js';
import ModeList from '../components/ModeList.vue';
import Composer from '../components/Composer.vue';
import CaseGallery from '../components/CaseGallery.vue';

const props = defineProps({ mode: { type: String, default: 'auto' } });
const emit = defineEmits(['submit']);

const mode = computed(
  () => store.modes.find((m) => m.key === props.mode) || store.modes[0] || { key: 'auto', label: 'Auto Pilot', tryChips: [] }
);
const chips = computed(() => mode.value?.tryChips || ['Survey the last five years of sparse attention', 'Turn my dataset into a research idea', 'Design an evaluation protocol']);

function useChip(c) {
  store.composer.text = c;
}
</script>

<template>
  <div class="wrap">
    <div class="tabs">
      <div class="seg">
        <button :class="{ on: store.workspaceMode === 'auto-discovery' }" @click="store.workspaceMode = 'auto-discovery'">
          Auto-Discovery <span class="new">New</span>
        </button>
        <button :class="{ on: store.workspaceMode === 'manual' }" @click="store.workspaceMode = 'manual'">Manual task</button>
      </div>
    </div>

    <h1 class="hero">Agentic Workspace for Research</h1>

    <div class="grid">
      <ModeList :value="props.mode" @select="(k) => navigate(`/${k}`)" />
      <div class="right">
        <Composer :mode-key="props.mode" @submit="(p) => emit('submit', p)" />
        <div class="chips">
          <span class="muted try">Try:</span>
          <button v-for="c in chips" :key="c" class="chip" @click="useChip(c)">{{ c }}</button>
        </div>
      </div>
    </div>

    <CaseGallery :mode="props.mode" />
  </div>
</template>

<style scoped>
.wrap {
  max-width: var(--content-max);
  margin: 0 auto;
  padding: 26px 20px 60px;
}
.tabs {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 10px;
}
.new {
  font-size: var(--fs-10);
  border: 1px solid var(--primary);
  color: var(--primary);
  border-radius: var(--r-pill);
  padding: 0 4px;
  margin-left: 4px;
}
.hero {
  font-family: var(--font-display);
  font-size: var(--fs-32);
  font-weight: 700;
  line-height: 1.25;
  margin: 8px 0 20px;
  text-align: center;
}
.grid {
  display: flex;
  border: 1px solid var(--border);
  border-radius: var(--r-18);
  background: var(--card);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
}
.right {
  flex: 1;
  min-width: 0;
  padding: 14px;
}
.chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 12px;
  align-items: center;
}
.try {
  font-size: var(--fs-12);
}
@media (max-width: 760px) {
  .grid {
    flex-direction: column;
  }
  .hero {
    font-size: var(--fs-24);
  }
}
</style>
