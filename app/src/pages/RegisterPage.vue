<script setup>
import { navigate } from '../lib/router.js';
import AuthForm from '../components/AuthForm.vue';

const props = defineProps({ referralCode: { type: String, default: '' } });
function done() {
  navigate('/auto-discovery', { replace: true });
}
</script>

<template>
  <div class="page">
    <header class="top">
      <button class="brand" @click="navigate('/')"><span class="mark">N</span> Novix <span class="open">OPEN</span></button>
      <button class="btn ghost" @click="navigate('/chat')">Continue as guest</button>
    </header>
    <main>
      <section class="pitch">
        <p class="eyebrow">Join the workspace</p>
        <h1>Research agents that show their work.</h1>
        <p class="muted">Run literature surveys, idea generation, method design, experiments, notebook analysis and reproduction in one inspectable workspace.</p>
        <ul>
          <li>Live trajectory and tool-call trace</li>
          <li>Workspace files, previews and downloads</li>
          <li>Share, publish, fork and feedback controls</li>
          <li>Six account tabs with real API data or honest empty states</li>
        </ul>
        <p v-if="props.referralCode" class="ref">Referral code applied: <strong>{{ props.referralCode }}</strong></p>
      </section>
      <section class="form card">
        <AuthForm initial-mode="signup" :referral-code="props.referralCode" @success="done" />
        <button class="btn ghost back" @click="navigate('/')">← Back to landing</button>
      </section>
    </main>
  </div>
</template>

<style scoped>
.page { min-height: 100%; overflow-y: auto; }
.top { max-width: 1040px; margin: 0 auto; padding: 18px 22px; display: flex; align-items: center; justify-content: space-between; }
.brand { border: 0; background: transparent; display: inline-flex; align-items: center; gap: 8px; font-weight: 700; cursor: pointer; }
.mark { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--primary); color: var(--primary-foreground); font-family: var(--font-display); }
.open { font-size: 9px; letter-spacing: .12em; color: var(--muted-foreground); border: 1px solid var(--border); border-radius: var(--r-pill); padding: 1px 5px; }
main { max-width: 1040px; margin: 0 auto; padding: 56px 22px 80px; display: grid; grid-template-columns: 1.1fr .9fr; gap: 60px; align-items: center; }
.eyebrow { text-transform: uppercase; letter-spacing: .15em; font-size: var(--fs-10); color: var(--primary); font-weight: 700; }
h1 { font-family: var(--font-display); font-size: clamp(34px, 5vw, 56px); line-height: 1.08; margin: 8px 0 18px; }
.pitch p { font-size: 15px; max-width: 520px; }
ul { padding-left: 20px; color: var(--muted-foreground); font-size: var(--fs-13); line-height: 2; }
.ref { font-size: var(--fs-12); padding: 8px 10px; border-radius: var(--r-8); background: var(--accent); }
.form { padding: 26px; box-shadow: var(--shadow-md); }
.back { margin-top: 12px; }
@media (max-width: 800px) { main { grid-template-columns: 1fr; gap: 28px; padding-top: 24px; } }
</style>
