<script setup>
import { computed, ref } from 'vue';
import { api } from '../lib/api.js';
import { toast } from '../stores/app.js';

const props = defineProps({ sessionId: { type: String, required: true } });
const emit = defineEmits(['close']);
const busy = ref(false);
const created = ref(false);
const copied = ref(false);
const error = ref('');
const link = computed(() => `${location.origin}/search-v1/${props.sessionId}`);

async function createLink() {
  busy.value = true;
  error.value = '';
  try {
    await api.share(props.sessionId);
    created.value = true;
    await copy();
  } catch (e) {
    error.value = String(e.message || e);
  } finally {
    busy.value = false;
  }
}
async function copy() {
  try {
    await navigator.clipboard.writeText(link.value);
    copied.value = true;
    toast('Share link copied');
    setTimeout(() => { copied.value = false; }, 1600);
  } catch {
    toast('Clipboard unavailable — copy the selected URL manually', 'error');
  }
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="modal card">
      <div class="head"><h2>Share this session</h2><button class="x" @click="emit('close')">×</button></div>
      <p class="muted">Anyone with the link can view this session's tasks and agent work trajectory. The session stays read-only for visitors.</p>
      <div class="link-row">
        <input :value="link" readonly />
        <button class="btn" @click="copy">{{ copied ? 'Copied' : 'Copy' }}</button>
      </div>
      <p v-if="created" class="ok">Sharing is enabled for this session.</p>
      <p v-if="error" class="error">{{ error }}</p>
      <div class="actions">
        <button class="btn ghost" @click="emit('close')">Cancel</button>
        <button class="btn primary" :disabled="busy" @click="createLink">{{ busy ? 'Creating…' : (created ? 'Refresh share link' : 'Create shareable link') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; z-index: 120; display: grid; place-items: center; padding: 20px; background: rgba(20,22,28,.4); }
.modal { width: 500px; max-width: 100%; padding: 20px; box-shadow: var(--shadow-lg); }
.head { display: flex; justify-content: space-between; align-items: center; }
h2 { margin: 0; font-size: 18px; }
.x { border: 0; background: transparent; font-size: 24px; color: var(--muted-foreground); cursor: pointer; }
p { font-size: var(--fs-12); line-height: 1.65; }
.link-row { display: flex; gap: 6px; margin: 14px 0 8px; }
input { flex: 1; min-width: 0; height: 31px; border: 1px solid var(--input); border-radius: var(--r-8); padding: 0 8px; background: var(--background); font-size: var(--fs-11); }
.ok { color: var(--chart-3); }
.error { color: var(--destructive); }
.actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 16px; }
</style>
