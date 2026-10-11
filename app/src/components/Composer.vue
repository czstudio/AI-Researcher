<script setup>
import { computed, ref, watch, nextTick } from 'vue';
import { store, toast } from '../stores/app.js';
import { api } from '../lib/api.js';

const props = defineProps({
  modeKey: { type: String, default: 'auto' },
  placeholder: { type: String, default: 'Ask anything about your research…' },
});
const emit = defineEmits(['submit', 'pick-mode']);

const ta = ref(null);
const mention = ref({ open: false, items: [], q: '' });
const fileInput = ref(null);

const FALLBACK = { key: 'auto', label: 'Auto Pilot', controls: [], tryChips: [], agentName: '' };
const mode = computed(() => store.modes.find((m) => m.key === props.modeKey) || store.modes[0] || FALLBACK);
const controls = computed(() => mode.value?.controls || []);
const canGpu = computed(() => store.composer.files.length === 0);

function controlValue(id) {
  if (store.composer.controls[`${props.modeKey}:${id}`] === undefined) {
    const c = controls.value.find((x) => x.id === id);
    store.composer.controls[`${props.modeKey}:${id}`] = c?.default ?? c?.options?.[0] ?? null;
  }
  return store.composer.controls[`${props.modeKey}:${id}`];
}
function setControl(c, v) {
  store.composer.controls[`${props.modeKey}:${c.id}`] = v;
}

const popovers = ref({});
function togglePopover(id) {
  popovers.value = { ...popovers.value, [id]: !popovers.value[id] };
}

function autoGrow() {
  const el = ta.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 220) + 'px';
}
watch(() => store.composer.text, () => nextTick(autoGrow));

function onInput(e) {
  store.composer.text = e.target.value;
  const m = /@([A-Za-z ]{0,20})$/.exec(store.composer.text);
  if (m) {
    mention.value = {
      open: true,
      q: m[1].trim().toLowerCase(),
      items: store.modes.filter((x) => !x.comingSoon && x.label.toLowerCase().includes(m[1].trim().toLowerCase())),
    };
  } else {
    mention.value.open = false;
  }
}

function pickMention(m) {
  store.composer.text = store.composer.text.replace(/@([A-Za-z ]{0,20})$/, `${m.mentionValue || ''} `).trimStart();
  mention.value.open = false;
  emit('pick-mode', m.key);
  nextTick(() => ta.value?.focus());
}

function onKeydown(e) {
  if (e.key === 'Enter' && !e.shiftKey && !mention.value.open) {
    e.preventDefault();
    submit();
  }
}

async function pickFiles(e) {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const sid = store.currentSessionId;
  if (!sid) {
    store.composer.files = files;
    toast(`${files.length} file(s) attached — will upload with the task`);
    return;
  }
  try {
    const uploadPromises = files.map((f) => api.upload(f, sid));
    const results = await Promise.all(uploadPromises);
    const ids = results.map((r) => r.result?.fileId).filter(Boolean);
    store.composer.files = [...store.composer.files, ...files];
    await api.uploadComplete(ids);
    toast(`Uploaded ${files.length} file(s)`);
  } catch (err) {
    toast(String(err.message || err), 'error');
  }
}

function submit() {
  const text = store.composer.text.trim();
  if (!text) return;
  const payload = {
    mode: props.modeKey,
    agentName: mode.value?.agentName || '',
    query: text,
    queryContent: text,
    enableGpu: canGpu.value && store.composer.enableGpu,
    enableBrainstorming: store.composer.enableBrainstorming,
    questionMode: store.composer.enableBrainstorming ? 'discuss' : 'task',
    modelOverride: store.composer.enableBrainstorming ? 'novix_proxy__gpt-5.6-sol' : store.composer.model,
    writeUpType: ['deepsurvey', 'methoddesign'].includes(props.modeKey) ? store.composer.writeUpType : undefined,
    controls: controls.value.map((c) => ({ id: c.id, value: controlValue(c.id) })),
    fileIds: [],
  };
  emit('submit', payload);
}
</script>

<template>
  <div class="composer card">
    <div v-if="mode.controls?.length" class="controls">
      <div v-for="c in controls" :key="c.id" class="popover-button-wrap">
        <button v-if="c.type === 'select'" class="popover-trigger" @click="togglePopover(c.id)">
          <span class="muted">{{ c.label }}:</span> {{ controlValue(c.id) }}
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        </button>
        <div v-if="popovers[c.id]" class="menu">
          <button v-for="o in c.options" :key="o" :class="{ on: controlValue(c.id) === o }" @click="setControl(c, o); togglePopover(c.id)">
            {{ o }}
          </button>
        </div>

        <div v-if="c.type === 'segmented'" class="seg">
          <button v-for="o in c.options" :key="o" :class="{ on: controlValue(c.id) === o }" @click="setControl(c, o)">{{ o }}</button>
        </div>
      </div>
    </div>

    <div class="input-wrap">
      <textarea
        ref="ta"
        class="input"
        rows="2"
        :placeholder="placeholder"
        :value="store.composer.text"
        @input="onInput"
        @keydown="onKeydown"
      />
      <div v-if="mention.open && mention.items.length" class="mention card">
        <button v-for="m in mention.items" :key="m.key" @click="pickMention(m)">
          <span class="mt-name">{{ m.mentionValue || m.label }}</span>
          <span class="muted">{{ m.description }}</span>
          <span v-if="m.avgCost" class="mt-cost">~{{ m.avgCost }} cr</span>
        </button>
      </div>
    </div>

    <div v-if="store.composer.files.length" class="files">
      <span v-for="f in store.composer.files" :key="f.name" class="chip">📎 {{ f.name }}</span>
    </div>

    <div class="bar">
      <button class="btn ghost" @click="fileInput.click()">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M8 11V3M5 6l3-3 3 3M3 12v1.5h10V12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Upload file
      </button>
      <input ref="fileInput" type="file" multiple hidden @change="pickFiles" />

      <div class="seg" :title="canGpu ? '' : 'Attachments force CPU'">
        <button :class="{ on: !store.composer.enableGpu }" @click="store.composer.enableGpu = false">CPU</button>
        <button :class="{ on: store.composer.enableGpu }" :disabled="!canGpu" @click="canGpu && (store.composer.enableGpu = true)">GPU</button>
      </div>

      <div class="seg">
        <button :class="{ on: !store.composer.enableBrainstorming }" @click="store.composer.enableBrainstorming = false">Task mode</button>
        <button :class="{ on: store.composer.enableBrainstorming }" @click="store.composer.enableBrainstorming = true">Discuss mode</button>
      </div>

      <div class="grow" />

      <div class="popover-button-wrap">
        <button class="popover-trigger" @click="togglePopover('model')">
          <span class="muted">Model:</span>
          {{ (store.models.find((m) => m.value === store.composer.model) || {}).label || 'default' }}
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        </button>
        <div v-if="popovers.model" class="menu right">
          <button v-for="m in store.models" :key="m.value" :class="{ on: store.composer.model === m.value }" @click="store.composer.model = m.value; togglePopover('model')">
            {{ m.label }}
          </button>
        </div>
      </div>

      <button class="send" :disabled="!store.composer.text.trim()" @click="submit" title="Send">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2.5 8h11M9 3.5L13.5 8 9 12.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.composer {
  border-radius: var(--r-18);
  padding: 12px 14px;
  box-shadow: var(--shadow-md);
}
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.input-wrap {
  position: relative;
}
.input {
  width: 100%;
  border: 0;
  outline: none;
  resize: none;
  background: transparent;
  font-size: var(--fs-14);
  line-height: 1.6;
  max-height: 220px;
  padding: 4px 0;
}
.files {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin: 6px 0;
}
.bar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  border-top: 1px solid var(--border);
  padding-top: 10px;
  margin-top: 6px;
}
.grow {
  flex: 1;
}
.send {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 1px solid var(--primary);
  background: var(--primary);
  color: var(--primary-foreground);
  display: grid;
  place-items: center;
  cursor: pointer;
}
.send:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.menu {
  position: absolute;
  z-index: 40;
  top: calc(100% + 6px);
  left: 0;
  min-width: 150px;
  background: var(--popover);
  border: 1px solid var(--border);
  border-radius: var(--r-12);
  box-shadow: var(--shadow-lg);
  padding: 4px;
  display: flex;
  flex-direction: column;
}
.menu.right {
  left: auto;
  right: 0;
}
.menu button {
  border: 0;
  background: transparent;
  text-align: left;
  padding: 6px 8px;
  border-radius: var(--r-8);
  font-size: var(--fs-12);
  cursor: pointer;
  color: var(--foreground);
}
.menu button:hover {
  background: var(--secondary);
}
.menu button.on {
  color: var(--primary);
  font-weight: 600;
}
.mention {
  position: absolute;
  z-index: 40;
  bottom: calc(100% + 6px);
  left: 0;
  width: 320px;
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
}
.mention button {
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 8px;
  align-items: center;
  border: 0;
  background: transparent;
  padding: 7px 8px;
  border-radius: var(--r-8);
  text-align: left;
  cursor: pointer;
  font-size: var(--fs-12);
}
.mention button:hover {
  background: var(--secondary);
}
.mt-name {
  font-weight: 600;
}
.mt-cost {
  font-size: var(--fs-10);
  color: var(--muted-foreground);
}
</style>
