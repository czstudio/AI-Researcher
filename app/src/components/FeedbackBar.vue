<script setup>
import { onMounted, ref } from 'vue';
import { api } from '../lib/api.js';
import { toast } from '../stores/app.js';

const props = defineProps({ taskId: { type: [String, Number], required: true } });
const liked = ref(null);
const counts = ref({ likes: 0, dislikes: 0 });
const busy = ref(false);

async function load() {
  try {
    const f = await api.taskFeedback(props.taskId);
    const rows = f?.items || [];
    const row = rows.find((x) => String(x.taskId) === String(props.taskId)) || f || {};
    counts.value = {
      likes: row.taskLikeCount ?? row.likes ?? f?.taskLikeCount ?? 0,
      dislikes: row.taskDislikeCount ?? row.dislikes ?? f?.taskDislikeCount ?? 0,
    };
    if (row.taskLike === true || row.liked === true) liked.value = true;
    if (row.taskLike === false || row.disliked === true) liked.value = false;
  } catch {
    /* feedback is optional */
  }
}
async function vote(value) {
  if (busy.value) return;
  busy.value = true;
  try {
    const r = await api.likeTask(props.taskId, value);
    liked.value = r?.liked ?? r?.taskLike ?? value;
    counts.value = {
      likes: r?.taskLikeCount ?? counts.value.likes,
      dislikes: r?.taskDislikeCount ?? counts.value.dislikes,
    };
    toast(value ? 'Feedback recorded: helpful' : 'Feedback recorded: needs work');
  } catch (e) {
    toast(String(e.message || e), 'error');
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div class="feedback">
    <button class="thumb" :class="{ on: liked === true }" :disabled="busy" title="Helpful" @click="vote(true)">👍 <span>{{ counts.likes }}</span></button>
    <button class="thumb" :class="{ on: liked === false }" :disabled="busy" title="Needs work" @click="vote(false)">👎 <span>{{ counts.dislikes }}</span></button>
    <span v-if="liked !== null" class="muted">Thanks — feedback is recorded.</span>
  </div>
</template>

<style scoped>
.feedback { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.thumb { display: inline-flex; align-items: center; gap: 4px; height: 24px; border: 1px solid var(--border); background: var(--card); border-radius: var(--r-pill); padding: 0 8px; cursor: pointer; font-size: var(--fs-10); color: var(--muted-foreground); }
.thumb:hover { background: var(--secondary); }
.thumb.on { border-color: var(--primary); color: var(--primary); background: var(--accent); }
.muted { font-size: var(--fs-10); }
</style>
