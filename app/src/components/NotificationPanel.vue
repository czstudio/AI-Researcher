<script setup>
import { store } from '../stores/app.js';
</script>

<template>
  <div class="overlay" @click.self="store.overlays.notifications = false">
    <div class="card">
      <div class="head">
        <h3>Notifications</h3>
        <button class="close" @click="store.overlays.notifications = false">&times;</button>
      </div>
      <div class="list">
        <div v-if="!store.notifications.length" class="empty">No new notifications</div>
        <div v-for="n in store.notifications" :key="n.id" class="item">
          <div class="title">{{ n.title }}</div>
          <div class="meta">{{ n.body }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.25); display: flex; justify-content: flex-end; z-index: 110; }
.card { width: 340px; max-width: 90vw; height: 100%; background: var(--surface); border-left: 1px solid var(--border); padding: 18px; }
.head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
h3 { margin: 0; font-size: 16px; }
.close { background: none; border: none; font-size: 22px; color: var(--muted); cursor: pointer; }
.empty { color: var(--muted); font-size: 13px; padding: 20px 0; }
.item { padding: 10px 0; border-bottom: 1px solid var(--border); }
.title { font-weight: 600; font-size: 13px; }
.meta { color: var(--muted); font-size: 12px; margin-top: 2px; }
</style>
