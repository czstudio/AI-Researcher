<script setup>
import { ref } from 'vue';
const props = defineProps({
  node: { type: Object, default: null },
  depth: { type: Number, default: 0 },
  selected: { type: String, default: '' },
});
const emit = defineEmits(['open']);
const closed = ref({});
function isOpen(path) {
  return closed.value[path] !== true;
}
function toggle(path) {
  closed.value = { ...closed.value, [path]: isOpen(path) };
}
</script>

<template>
  <ul v-if="node" class="tree" :style="{ paddingLeft: depth ? '12px' : '0' }">
    <li v-for="c in node.children || []" :key="c.path">
      <div class="item" :class="{ on: selected === c.path, dir: c.type === 'directory' }" @click="c.type === 'file' ? emit('open', c) : toggle(c.path)">
        <span class="ico">{{ c.type === 'directory' ? (isOpen(c.path) ? '▾' : '▸') : '·' }}</span>
        <span class="name">{{ c.name }}</span>
        <span v-if="c.type === 'file'" class="size muted">{{ c.size }}b</span>
      </div>
      <FileTree v-if="c.type === 'directory' && c.children?.length && isOpen(c.path)" :node="c" :depth="depth + 1" :selected="selected" @open="(x) => emit('open', x)" />
    </li>
  </ul>
</template>

<style scoped>
.tree { list-style: none; margin: 0; padding: 0; }
.item { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border-radius: var(--r-5); font-size: var(--fs-12); cursor: pointer; white-space: nowrap; }
.item:hover { background: var(--secondary); }
.item.on { background: var(--accent); color: var(--foreground); }
.item.dir { font-weight: 600; }
.ico { width: 10px; color: var(--muted-foreground); }
.size { font-size: var(--fs-10); margin-left: auto; }
</style>
