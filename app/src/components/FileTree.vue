<script setup>
const props = defineProps({
  node: { type: Object, default: null },
  depth: { type: Number, default: 0 },
  selected: { type: String, default: '' },
});
const emit = defineEmits(['open']);

function isText(p = '') {
  return /\.(md|txt|json|py|js|ts|mjs|sh|tex|bib|csv|yaml|yml|html|css|log)$/i.test(p);
}
</script>

<template>
  <ul v-if="node" class="tree" :style="{ paddingLeft: depth ? '12px' : '0' }">
    <li v-for="c in node.children || []" :key="c.path">
      <div
        class="item"
        :class="{ on: selected === c.path, dir: c.type === 'directory' }"
        @click="c.type === 'file' ? emit('open', c) : null"
      >
        <span class="ico">{{ c.type === 'directory' ? '▸' : '·' }}</span>
        <span class="name">{{ c.name }}</span>
        <span v-if="c.type === 'file'" class="size muted">{{ c.size }}b</span>
      </div>
      <FileTree v-if="c.type === 'directory' && c.children?.length" :node="c" :depth="depth + 1" :selected="selected" @open="(x) => emit('open', x)" />
    </li>
  </ul>
</template>

<style scoped>
.tree {
  list-style: none;
  margin: 0;
  padding: 0;
}
.item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: var(--r-5);
  font-size: var(--fs-12);
  cursor: pointer;
  white-space: nowrap;
}
.item:hover {
  background: var(--secondary);
}
.item.on {
  background: var(--accent);
  color: var(--foreground);
}
.item.dir {
  cursor: default;
  font-weight: 600;
}
.ico {
  width: 10px;
  color: var(--muted-foreground);
}
.size {
  font-size: var(--fs-10);
  margin-left: auto;
}
</style>
