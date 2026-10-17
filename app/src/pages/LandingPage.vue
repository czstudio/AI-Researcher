<script setup>
import { computed } from 'vue';
import { store } from '../stores/app.js';
import { navigate } from '../lib/router.js';

const availableModes = computed(() => store.modes.filter((m) => m.comingSoon === false));
const signedIn = computed(() => store.user !== null);

function start() {
  store.workspaceMode = 'auto-discovery';
  navigate('/auto-discovery');
}
function modeRoute(mode) {
  const ids = { auto: 'chat', 'auto-discovery': 'auto-discovery' };
  navigate(`/${ids[mode.key] || mode.routeId || mode.key}`);
}
function account() {
  navigate(signedIn.value ? '/account/upgrade' : '/register');
}
function openLogin() {
  store.overlays.login = true;
}
</script>

<template>
  <div class="landing">
    <header class="nav">
      <button class="brand" @click="navigate('/')"><span class="mark">N</span> Novix <span class="open">OPEN</span></button>
      <nav class="links">
        <button @click="navigate('/user-manual')">User manual</button>
        <button @click="navigate('/contact')">Contact</button>
        <button v-if="signedIn === false" class="btn" @click="openLogin">Sign in</button>
        <button class="btn primary" @click="account">{{ signedIn ? 'Account' : 'Get started' }}</button>
      </nav>
    </header>

    <main>
      <section class="hero">
        <p class="eyebrow">The AI agentic co-scientist</p>
        <h1>Explore the frontier with intelligence that evolves.</h1>
        <p class="lede">Your agentic research lab learns from your judgment, discovers new directions, and evolves with every research cycle. This is an independent, self-hosted open replication.</p>
        <div class="actions">
          <button class="btn primary large" @click="start">Start exploring →</button>
          <button class="btn large" @click="navigate('/user-manual')">Read the manual</button>
        </div>
        <p class="tiny muted">No payment processor is bundled. Running tasks requires an LLM gateway configured by the operator.</p>
      </section>

      <section class="section">
        <div class="section-head">
          <h2>One workspace, every research move</h2>
          <p>Choose an agent, describe the outcome, and watch the trajectory. Files and artifacts stay in the session workspace.</p>
        </div>
        <div class="mode-grid">
          <button v-for="m in availableModes" :key="m.key" class="mode-card card" @click="modeRoute(m)">
            <span class="mode-top"><strong>{{ m.label }}</strong><span v-if="m.creditCost" class="chip">{{ m.creditCost }} cr</span></span>
            <span class="muted">{{ m.description }}</span>
          </button>
        </div>
      </section>

      <section class="section split">
        <div>
          <p class="eyebrow">Live, inspectable work</p>
          <h2>From question to artifact</h2>
          <p class="muted">Poll the task trajectory, follow tool calls, inspect the workspace tree, preview text and PDFs, and download the full workspace. Share a read-only link when you are ready.</p>
        </div>
        <div class="steps">
          <div><b>01</b><span>Auto-Discovery surfaces research directions and approval cards.</span></div>
          <div><b>02</b><span>An agent runs with mode-specific controls, CPU/GPU and task/discuss settings.</span></div>
          <div><b>03</b><span>Publish a revision, fork it, or continue with a follow-up question.</span></div>
        </div>
      </section>

      <section class="section cta card">
        <div>
          <h2>Bring your own model gateway</h2>
          <p class="muted">The UI and API contract are ready. The operator supplies LLM credentials; unavailable capabilities are labelled honestly rather than simulated.</p>
        </div>
        <button class="btn primary large" @click="start">Open the workspace</button>
      </section>
    </main>

    <footer>
      <span>Novix Open · independent research workspace replication</span>
      <nav>
        <button @click="navigate('/privacy')">Privacy</button>
        <button @click="navigate('/terms')">Terms</button>
        <button @click="navigate('/contact')">Contact</button>
        <button @click="navigate('/user-manual')">Manual</button>
      </nav>
    </footer>
  </div>
</template>

<style scoped>
.landing { min-height: 100%; overflow-y: auto; background: var(--background); }
.nav { max-width: 1120px; margin: 0 auto; padding: 18px 22px; display: flex; align-items: center; gap: 18px; }
.brand { border: 0; background: transparent; display: inline-flex; align-items: center; gap: 8px; font-weight: 700; font-size: 16px; cursor: pointer; }
.mark { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--primary); color: var(--primary-foreground); font-family: var(--font-display); }
.open { font-size: 9px; letter-spacing: .12em; color: var(--muted-foreground); border: 1px solid var(--border); border-radius: var(--r-pill); padding: 1px 5px; }
.links { margin-left: auto; display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.links > button:not(.btn) { border: 0; background: transparent; padding: 6px 8px; color: var(--muted-foreground); cursor: pointer; font-size: var(--fs-12); }
.links > button:not(.btn):hover { color: var(--foreground); }
main { max-width: 1120px; margin: 0 auto; padding: 30px 22px 60px; }
.hero { padding: 72px 0 64px; max-width: 850px; }
.eyebrow { text-transform: uppercase; letter-spacing: .16em; font-size: var(--fs-10); font-weight: 700; color: var(--primary); margin: 0 0 14px; }
h1 { font-family: var(--font-display); font-size: clamp(38px, 6.5vw, 70px); line-height: 1.06; letter-spacing: -.03em; margin: 0; max-width: 900px; }
.lede { font-size: 18px; line-height: 1.65; color: var(--muted-foreground); max-width: 670px; margin: 22px 0; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.btn.large { height: 38px; padding: 0 16px; font-size: var(--fs-13); }
.tiny { font-size: var(--fs-11); margin-top: 16px; }
.section { padding: 52px 0; border-top: 1px solid var(--border); }
.section-head { display: flex; align-items: end; gap: 24px; justify-content: space-between; margin-bottom: 22px; }
.section h2 { font-family: var(--font-display); font-size: clamp(26px, 3.4vw, 38px); margin: 0; }
.section-head p { max-width: 460px; color: var(--muted-foreground); font-size: var(--fs-13); margin: 0; }
.mode-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; }
.mode-card { display: flex; flex-direction: column; gap: 8px; padding: 17px; text-align: left; cursor: pointer; transition: transform .15s, box-shadow .15s; }
.mode-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); }
.mode-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.mode-top .chip { cursor: default; height: 20px; font-size: var(--fs-10); }
.mode-card .muted { font-size: var(--fs-12); line-height: 1.55; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; align-items: start; }
.steps { display: flex; flex-direction: column; gap: 8px; }
.steps div { display: flex; gap: 14px; padding: 12px 14px; background: var(--card); border: 1px solid var(--border); border-radius: var(--r-12); font-size: var(--fs-12); }
.steps b { color: var(--primary); font-family: var(--font-mono); font-size: var(--fs-11); }
.cta { margin: 24px 0 8px; padding: 28px; display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.cta h2 { font-size: 26px; }
.cta p { max-width: 650px; font-size: var(--fs-12); }
footer { max-width: 1120px; margin: 0 auto; padding: 20px 22px 32px; display: flex; gap: 16px; align-items: center; justify-content: space-between; color: var(--muted-foreground); font-size: var(--fs-11); border-top: 1px solid var(--border); }
footer nav { display: flex; gap: 10px; flex-wrap: wrap; }
footer button { border: 0; background: transparent; color: inherit; cursor: pointer; padding: 0; font-size: inherit; }
@media (max-width: 760px) { .hero { padding: 44px 0; } .split { grid-template-columns: 1fr; gap: 20px; } .section-head, .cta { flex-direction: column; align-items: flex-start; } footer { flex-direction: column; align-items: flex-start; } }
</style>
