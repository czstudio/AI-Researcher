<script setup>
import { ref, onMounted } from 'vue';
import { store, toast } from '../stores/app.js';
import { api } from '../lib/api.js';

const tabs = ['Subscription', 'Credit & Usage', 'Billing', 'Profile', 'Version'];
const active = ref('Subscription');
const usage = ref({ used: 0, total: 0 });

onMounted(async () => {
  try {
    const r = await api.creditOverview();
    usage.value = { used: r.used || 0, total: r.total || 0 };
  } catch {
    usage.value = { used: 0, total: store.plan?.credits || 0 };
  }
});

function upgrade() {
  toast('Upgrade path: set NOVIX_STRIPE_PK in .env and restart', 'info');
}
</script>

<template>
  <div class="overlay" @click.self="store.overlays.settings = false">
    <div class="card">
      <div class="sidebar">
        <div v-for="t in tabs" :key="t" class="tab" :class="{ active: active === t }" @click="active = t">{{ t }}</div>
      </div>
      <div class="body">
        <button class="close" @click="store.overlays.settings = false">&times;</button>

        <div v-if="active === 'Subscription'">
          <h3>Subscription</h3>
          <p class="muted">Current plan: <strong>{{ store.plan?.level || 'free' }}</strong></p>
          <div class="plan-box">
            <div class="plan" :class="{ current: (store.plan?.level || 'free') === 'free' }">
              <b>Free</b>
              <div class="price">$0</div>
              <ul>
                <li>20 credits / day</li>
                <li>Standard models</li>
                <li>Community support</li>
              </ul>
            </div>
            <div class="plan" :class="{ current: store.plan?.level === 'pro' }">
              <b>Pro</b>
              <div class="price">$9</div>
              <ul>
                <li>500 credits / month</li>
                <li>All models</li>
                <li>Code agent</li>
                <li>Email support</li>
              </ul>
              <button v-if="(store.plan?.level || 'free') !== 'pro'" class="btn primary" @click="upgrade">Upgrade</button>
            </div>
            <div class="plan" :class="{ current: store.plan?.level === 'ultra' }">
              <b>Ultra</b>
              <div class="price">$29</div>
              <ul>
                <li>2000 credits / month</li>
                <li>All models + GPT-5</li>
                <li>Priority compute</li>
                <li>API access</li>
              </ul>
              <button v-if="(store.plan?.level || 'free') !== 'ultra'" class="btn primary" @click="upgrade">Upgrade</button>
            </div>
          </div>
        </div>

        <div v-if="active === 'Credit & Usage'">
          <h3>Credit & Usage</h3>
          <p class="muted">Used {{ usage.used }} / {{ usage.total }} credits</p>
          <div class="bar"><div class="fill" :style="{ width: Math.min(100, (usage.total ? (usage.used / usage.total) * 100 : 0)) + '%' }" /></div>
        </div>

        <div v-if="active === 'Billing'">
          <h3>Billing & Invoices</h3>
          <p class="muted">No invoices yet.</p>
        </div>

        <div v-if="active === 'Profile'">
          <h3>Profile</h3>
          <p class="muted">Name: {{ store.user?.name || '—' }}</p>
          <p class="muted">Email: {{ store.user?.email || '—' }}</p>
        </div>

        <div v-if="active === 'Version'">
          <h3>Version</h3>
          <p class="muted">Novix Open Replica v2.4.0</p>
          <p class="muted">Upstream: AI-Researcher (HKUDS)</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.35); display: grid; place-items: center; z-index: 120; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; width: 760px; max-width: 96vw; height: 520px; max-height: 90vh; display: flex; overflow: hidden; position: relative; }
.sidebar { width: 180px; border-right: 1px solid var(--border); padding: 18px 8px; }
.tab { padding: 8px 14px; border-radius: 8px; cursor: pointer; font-size: 13px; color: var(--muted); margin-bottom: 2px; }
.tab.active { background: var(--accent-weak); color: var(--accent); font-weight: 600; }
.body { flex: 1; padding: 22px 24px; overflow: auto; }
h3 { margin: 0 0 10px; font-size: 18px; }
.muted { color: var(--muted); font-size: 13px; margin: 0 0 14px; }
.plan-box { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
.plan { border: 1px solid var(--border); border-radius: 12px; padding: 14px; text-align: center; }
.plan.current { border-color: var(--accent); }
.price { font-size: 22px; font-weight: 700; margin: 6px 0; }
.plan ul { text-align: left; font-size: 12px; color: var(--muted); padding-left: 16px; margin: 8px 0; }
.btn { margin-top: 8px; padding: 8px 14px; border-radius: 8px; border: none; background: var(--accent); color: #fff; font-weight: 600; cursor: pointer; }
.bar { height: 10px; background: var(--border); border-radius: 5px; overflow: hidden; }
.fill { height: 100%; background: var(--accent); }
.close { position: absolute; top: 10px; right: 14px; background: none; border: none; font-size: 22px; color: var(--muted); cursor: pointer; }
</style>
