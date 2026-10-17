<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { store, toast } from '../stores/app.js';
import { api, getToken } from '../lib/api.js';
import MODES from '../lib/modes.generated.js';

const props = defineProps({
  modeKey: { type: String, default: 'auto' },
  placeholder: { type: String, default: 'Ask anything about your research…' },
});
const emit = defineEmits(['submit', 'pick-mode', 'upgrade']);

const ta = ref(null);
const fileInput = ref(null);
const popover = ref('');
const mention = ref({ open: false, q: '', items: [] });
const error = ref('');
const uploading = ref(false);
const customFocus = ref('');

const FALLBACK = { key: 'auto', label: 'Auto Pilot', controls: [], tryChips: [], agentName: '', mentionValue: null };
const mode = computed(() => store.modes.find((m) => m.key === props.modeKey) || store.modes[0] || FALLBACK);
const controls = computed(() => mode.value?.controls || []);
const hasFiles = computed(() => store.composer.files.length > 0);
const gpuLocked = computed(() => store.user == null || (store.user.level || 'free') === 'free');
const gpuAvailable = computed(() => hasFiles.value === false && gpuLocked.value === false);
const busy = computed(() => uploading.value || store.composer.uploading);
const canSend = computed(() => store.composer.text.trim() !== '' && busy.value === false && error.value === '');
const modelLabel = computed(() => (store.models.find((m) => m.value === store.composer.model) || {}).label || 'default');
const controlKeys = computed(() => Object.fromEntries(controls.value.map((c) => [c.id, `${props.modeKey}:${c.id}`])));

function defaultFor(c) {
  return c.default ?? c.options?.[0] ?? (c.type === 'tabs' ? c.options?.[0] : null);
}
function controlValue(c) {
  const key = controlKeys.value[c.id];
  if (store.composer.controls[key] === undefined) store.composer.controls[key] = defaultFor(c);
  return store.composer.controls[key];
}
function setControl(c, value) {
  store.composer.controls[controlKeys.value[c.id]] = value;
}
function options(c) {
  if (c.options) return c.options;
  if (c.groups) return Object.values(c.groups).flat();
  return [];
}
function groups(c) {
  if (c.groups) return Object.entries(c.groups);
  return [['Options', c.options || []]];
}
function togglePopover(id) {
  popover.value = popover.value === id ? '' : id;
}
function setCustomFocus(c) {
  if (customFocus.value.trim() === '') return;
  setControl(c, customFocus.value.trim());
  customFocus.value = '';
  popover.value = '';
}
function axisValue(c, index) {
  const key = `${controlKeys.value[c.id]}:axis${index}`;
  if (store.composer.controls[key] === undefined) store.composer.controls[key] = 50;
  return store.composer.controls[key];
}
function setAxis(c, index, event) {
  store.composer.controls[`${controlKeys.value[c.id]}:axis${index}`] = Number(event.target.value);
}
function dialLabel(c) {
  return `${c.axes?.[0]?.a || 'Novel'} ${axisValue(c, 0)} / ${c.axes?.[0]?.b || 'Feasible'} ${100 - axisValue(c, 0)}`;
}
watch(() => props.modeKey, () => {
  popover.value = '';
  mention.value.open = false;
  error.value = '';
});

function autoGrow() {
  const el = ta.value;
  if (el == null) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
}
watch(() => store.composer.text, () => nextTick(autoGrow));
function onInput(e) {
  store.composer.text = e.target.value;
  error.value = '';
  const m = /@([A-Za-z ]{0,20})$/.exec(store.composer.text);
  if (m) {
    const q = m[1].trim().toLowerCase();
    mention.value = {
      open: true,
      q,
      items: store.modes.filter((x) => x.comingSoon === false && x.mentionValue && x.label.toLowerCase().includes(q)),
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
  if (e.key === 'Enter' && e.shiftKey === false && mention.value.open === false) {
    e.preventDefault();
    submit();
  }
}

async function ensureSessionId() {
  if (store.currentSessionId) return store.currentSessionId;
  const created = getToken() ? await api.createSession(props.modeKey) : await api.createAnonymousSession(props.modeKey);
  store.currentSessionId = created.id;
  return created.id;
}
function validFile(file) {
  const ext = String(file.name || '').split('.').pop().toLowerCase();
  const allowed = MODES.constants?.SUPPORTED_EXTENSIONS || [];
  if (allowed.includes(ext) === false) return `Unsupported file type: .${ext}`;
  if (file.size > (MODES.constants?.MAX_SINGLE_FILE_SIZE_MB || 100) * 1024 * 1024) return `${file.name} exceeds the 100 MB limit`;
  return '';
}
async function pickFiles(e) {
  const chosen = Array.from(e.target.files || []);
  e.target.value = '';
  if (chosen.length === 0) return;
  error.value = '';
  if (store.composer.files.length + chosen.length > (MODES.constants?.MAX_FILE_COUNT || 100)) {
    error.value = 'At most 100 files can be attached.';
    return;
  }
  for (const f of chosen) {
    const problem = validFile(f);
    if (problem) { error.value = problem; return; }
  }
  uploading.value = true;
  store.composer.uploading = true;
  try {
    const sid = await ensureSessionId();
    const result = await api.uploadFiles(chosen, sid);
    store.composer.files = [...store.composer.files, ...chosen.map((f, i) => ({ name: f.name, size: f.size, fileId: result.fileIds[i] || '' }))];
    store.composer.fileIds = [...store.composer.fileIds, ...result.fileIds];
    if (result.fileIds.length !== chosen.length) {
      error.value = 'Some files uploaded without a file ID. Remove them and retry.';
    } else {
      toast(`Uploaded ${result.fileIds.length} file(s)`);
    }
  } catch (err) {
    error.value = String(err.message || err);
  } finally {
    uploading.value = false;
    store.composer.uploading = false;
  }
}
function removeFile(index) {
  store.composer.files.splice(index, 1);
  store.composer.fileIds.splice(index, 1);
}
function formatSize(bytes) {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function setGpu(value) {
  if (value && gpuAvailable.value === false) {
    toast(hasFiles.value ? 'Attachments force CPU mode' : 'GPU is locked on the free plan', 'error');
    return;
  }
  store.composer.enableGpu = value;
}
function submit() {
  error.value = '';
  const text = store.composer.text.trim();
  if (text === '') { error.value = 'Write a question before sending.'; return; }
  if (busy.value) return;
  const writeUp = controls.value.find((c) => c.id === 'writeUpType');
  const payloadControls = controls.value.map((c) => {
    if (c.type === 'twoAxisDial') {
      return {
        id: c.id,
        value: {
          label: dialLabel(c),
          axes: (c.axes || []).map((axis, i) => ({ a: axis.a, b: axis.b, value: axisValue(c, i) })),
        },
      };
    }
    return { id: c.id, value: controlValue(c) };
  });
  const payload = {
    mode: props.modeKey,
    agentName: mode.value?.agentName || '',
    query: `${mode.value?.mentionValue || ''} ${text}`.trim(),
    queryContent: text,
    enableGpu: gpuAvailable.value && store.composer.enableGpu === true,
    enableBrainstorming: store.composer.enableBrainstorming === true,
    questionMode: store.composer.enableBrainstorming ? 'discuss' : 'task',
    modelOverride: store.composer.enableBrainstorming ? MODES.discussModelOverride : store.composer.model,
    writeUpType: writeUp ? controlValue(writeUp) : undefined,
    controls: payloadControls,
    fileIds: [...store.composer.fileIds],
    tempUrl: null,
  };
  emit('submit', payload);
}

</script>

<template>
  <div class="composer card">
    <div v-if="controls.length" class="controls">
      <template v-for="c in controls" :key="c.id">
        <div v-if="c.type === 'popover' || c.type === 'select'" class="popover-wrap">
          <button class="popover-trigger" @click="togglePopover(c.id)">
            <span class="muted">{{ c.label }}:</span> {{ controlValue(c) || 'Any' }}
            <svg width="10" height="10" viewBox="0 0 10 10"><path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
          </button>
          <div v-if="popover === c.id" class="menu card">
            <template v-for="[group, groupOptions] in groups(c)" :key="group">
              <div class="group-label">{{ group }}</div>
              <button v-for="o in groupOptions" :key="o" :class="{ on: controlValue(c) === o }" @click="setControl(c, o); togglePopover(c.id)">{{ o }}</button>
            </template>
            <div v-if="c.customInput" class="custom-row">
              <input v-model="customFocus" :placeholder="c.customInput" @keydown.enter.prevent="setCustomFocus(c)" />
              <button class="btn" @click="setCustomFocus(c)">Add</button>
            </div>
          </div>
        </div>

        <div v-else-if="c.type === 'chips'" class="chip-control">
          <span class="muted control-label">{{ c.label }}</span>
          <button v-for="o in c.options" :key="o" class="chip" :class="{ on: controlValue(c) === o }" :title="c.tooltips?.[o] || ''" @click="setControl(c, o)">{{ o }}</button>
        </div>

        <div v-else-if="c.type === 'tabs'" class="seg">
          <button v-for="o in c.options" :key="o" :class="{ on: controlValue(c) === o }" @click="setControl(c, o)">{{ c.label }} {{ o }}</button>
        </div>

        <div v-else-if="c.type === 'twoAxisDial'" class="dial">
          <span class="muted control-label">{{ c.label }} · {{ dialLabel(c) }}</span>
          <div v-for="(axis, i) in c.axes" :key="i" class="axis">
            <span>{{ axis.a }}</span>
            <input type="range" min="0" max="100" :value="axisValue(c, i)" @input="setAxis(c, i, $event)" />
            <span>{{ axis.b }}</span>
          </div>
        </div>

        <label v-else-if="c.type === 'freetext'" class="freetext">
          <span class="muted control-label">{{ c.label }}</span>
          <input :placeholder="c.hint || c.label" :value="controlValue(c) || ''" @input="setControl(c, $event.target.value)" />
        </label>

        <div v-else-if="c.type === 'segmented'" class="seg">
          <button v-for="o in c.options" :key="o" :class="{ on: controlValue(c) === o }" @click="setControl(c, o)">{{ o }}</button>
        </div>
      </template>
    </div>

    <div class="input-wrap">
      <textarea ref="ta" class="input" rows="2" :placeholder="placeholder" :value="store.composer.text" @input="onInput" @keydown="onKeydown" />
      <div v-if="mention.open && mention.items.length" class="mention card">
        <button v-for="m in mention.items" :key="m.key" @click="pickMention(m)">
          <span class="mt-name">{{ m.mentionValue }}</span>
          <span class="muted">{{ m.description }}</span>
          <span class="mt-cost">{{ m.creditCost }} cr</span>
        </button>
      </div>
    </div>

    <div v-if="store.composer.files.length" class="files">
      <span v-for="(f, i) in store.composer.files" :key="`${f.name}-${i}`" class="file-chip">
        <span>📎 {{ f.name }}</span><span class="muted">{{ formatSize(f.size) }}</span><button title="Remove" @click="removeFile(i)">×</button>
      </span>
    </div>
    <p v-if="error || store.composer.error" class="composer-error" role="alert">{{ error || store.composer.error }}</p>

    <div class="bar">
      <button class="btn ghost" :disabled="busy" @click="fileInput.click()">{{ uploading ? 'Uploading…' : 'Upload file' }}</button>
      <input ref="fileInput" type="file" multiple hidden @change="pickFiles" />

      <div class="seg" :title="hasFiles ? 'Attachments force CPU' : (gpuLocked ? 'GPU locked on the free plan' : '')">
        <button :class="{ on: store.composer.enableGpu === false }" @click="setGpu(false)">CPU</button>
        <button :class="{ on: store.composer.enableGpu }" :disabled="gpuAvailable === false" @click="setGpu(true)">GPU<span v-if="gpuLocked" class="lock">🔒</span></button>
      </div>
      <button v-if="gpuLocked" class="upgrade-hint" @click="emit('upgrade')">Upgrade for GPU</button>

      <div class="seg">
        <button :class="{ on: store.composer.enableBrainstorming === false }" @click="store.composer.enableBrainstorming = false">Task mode</button>
        <button :class="{ on: store.composer.enableBrainstorming }" @click="store.composer.enableBrainstorming = true">Discuss mode</button>
      </div>

      <div class="grow" />

      <div class="popover-wrap">
        <button class="popover-trigger" @click="togglePopover('model')"><span class="muted">Model:</span> {{ modelLabel }} <span>⌄</span></button>
        <div v-if="popover === 'model'" class="menu right card">
          <button v-for="m in store.models" :key="m.value" :class="{ on: store.composer.model === m.value }" @click="store.composer.model = m.value; togglePopover('model')">{{ m.label }}</button>
        </div>
      </div>

      <button class="send" :disabled="canSend === false" title="Send" @click="submit">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M2.5 8h11M9 3.5L13.5 8 9 12.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </div>
    <p class="hint muted">Enter to send · Shift+Enter for a new line · type @ to pick an agent</p>
  </div>
</template>

<style scoped>
.composer { border-radius: var(--r-18); padding: 12px 14px; box-shadow: var(--shadow-md); }
.controls { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 9px; align-items: center; }
.control-label { font-size: var(--fs-11); }
.popover-wrap { position: relative; }
.menu { position: absolute; z-index: 50; top: calc(100% + 6px); left: 0; min-width: 190px; max-height: 330px; overflow-y: auto; padding: 5px; display: flex; flex-direction: column; box-shadow: var(--shadow-lg); }
.menu.right { left: auto; right: 0; }
.menu button { border: 0; background: transparent; text-align: left; padding: 6px 8px; border-radius: var(--r-8); font-size: var(--fs-12); cursor: pointer; color: var(--foreground); }
.menu button:hover { background: var(--secondary); }
.menu button.on { color: var(--primary); font-weight: 600; }
.group-label { font-size: 9px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted-foreground); padding: 7px 8px 3px; font-weight: 700; }
.custom-row { display: flex; gap: 5px; padding: 6px 4px 2px; border-top: 1px solid var(--border); margin-top: 4px; }
.custom-row input { flex: 1; min-width: 0; height: 27px; border: 1px solid var(--input); border-radius: var(--r-5); background: var(--background); padding: 0 7px; font-size: var(--fs-11); }
.chip-control { display: inline-flex; align-items: center; gap: 4px; }
.chip-control .chip { height: 27px; color: var(--muted-foreground); }
.chip-control .chip.on { color: var(--primary); border-color: var(--primary); background: var(--accent); font-weight: 600; }
.dial { display: flex; flex-direction: column; gap: 1px; padding: 0 7px; min-width: 210px; }
.dial .control-label { font-size: var(--fs-10); }
.axis { display: flex; align-items: center; gap: 6px; font-size: 9px; color: var(--muted-foreground); }
.axis input { flex: 1; min-width: 70px; accent-color: var(--primary); }
.freetext { display: inline-flex; align-items: center; gap: 5px; }
.freetext input { height: 27px; width: 190px; border: 1px solid var(--input); border-radius: var(--r-8); padding: 0 8px; background: var(--background); font-size: var(--fs-11); }
.input-wrap { position: relative; }
.input { width: 100%; border: 0; outline: none; resize: none; background: transparent; font-size: var(--fs-14); line-height: 1.6; max-height: 220px; padding: 4px 0; }
.mention { position: absolute; z-index: 50; bottom: calc(100% + 6px); left: 0; width: 330px; max-height: 260px; overflow-y: auto; padding: 4px; box-shadow: var(--shadow-lg); }
.mention button { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; border: 0; background: transparent; padding: 7px 8px; border-radius: var(--r-8); text-align: left; cursor: pointer; font-size: var(--fs-12); }
.mention button:hover { background: var(--secondary); }
.mt-name { font-weight: 600; }
.mt-cost { font-size: var(--fs-10); color: var(--muted-foreground); }
.files { display: flex; gap: 6px; flex-wrap: wrap; margin: 6px 0; }
.file-chip { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--border); border-radius: var(--r-pill); padding: 2px 4px 2px 9px; font-size: var(--fs-11); background: var(--secondary); max-width: 100%; }
.file-chip > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
.file-chip button { border: 0; background: transparent; cursor: pointer; color: var(--muted-foreground); line-height: 1; }
.composer-error { color: var(--destructive); font-size: var(--fs-11); margin: 4px 0; }
.bar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; border-top: 1px solid var(--border); padding-top: 10px; margin-top: 6px; }
.grow { flex: 1; }
.lock { font-size: 8px; margin-left: 3px; }
.upgrade-hint { border: 0; background: transparent; color: var(--primary); cursor: pointer; font-size: 9px; padding: 0; }
.send { width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--primary); background: var(--primary); color: var(--primary-foreground); display: grid; place-items: center; cursor: pointer; }
.send:disabled { opacity: .45; cursor: not-allowed; }
.hint { font-size: 9px; margin: 6px 0 0; }
@media (max-width: 620px) { .freetext input { width: 130px; } .dial { min-width: 180px; } .hint { display: none; } }
</style>
