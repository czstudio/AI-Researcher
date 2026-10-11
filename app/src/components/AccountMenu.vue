<script setup>
import { ref, computed } from 'vue';
import { store, toast, refreshUser } from '../stores/app.js';
import { api, setToken, getToken } from '../lib/api.js';

const emit = defineEmits(['close']);
const tab = ref('Subscription');
const tabs = ['Subscription', 'Credit & Usage', 'Billing & Invoices', 'Referrals', 'Profile', 'Version'];
const version = ref([]);
const usage = ref(null);
const referral = ref(null);
const email = ref('');
const password = ref('');
const mode = ref('login');

const credits = computed(() => store.user?.credits ?? 0);

async function loadTab(t) {
  tab.value = t;
  if (t === 'Version' && !version.value.length) version.value = (await api.versionHistory()).items || [];
  if (t === 'Credit & Usage') usage.value = (await api.creditUsage()) || { rows: [] };
  if (t === 'Referrals') referral.value = await api.referral();
}

async function auth() {
  try {
    const r = mode.value === 'login' ? await api.login(email.value, password.value) : await api.signUp(email.value, password.value);
    setToken(r.token);
    await refreshUser();
    toast(mode.value === 'login' ? 'Signed in' : 'Account created');
    emit('close');
  } catch (e) {
    toast(String(e.message || e), 'error');
  }
}

async function upgrade(level) {
  try {
    await api.upgradePlan(level);
    await refreshUser();
    toast(`Plan set to ${level}`);
  } catch (e) {
    toast(String(e.message || e), 'error');
  }
}

function logout() {
  setToken('');
  store.user = null;
  emit('close');
}
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="panel card">
      <div v-if="!getToken()" class="auth">
        <h2>{{ mode === 'login' ? 'Sign in' : 'Create account' }}</h2>
        <input v-model="email" placeholder="you@example.com" />
        <input v-model="password" type="password" placeholder="password" @keydown.enter="auth" />
        <div class="row">
          <button class="btn primary" @click="auth">{{ mode === 'login' ? 'Sign in' : 'Sign up' }}</button>
          <button class="btn" @click="mode = mode === 'login' ? 'signup' : 'login'">
            {{ mode === 'login' ? 'Create account' : 'Have an account?' }}
          </button>
        </div>
        <p class="muted small">Anonymous mode works without an account — sessions are bound to your browser fingerprint.</p>
      </div>

      <template v-else>
        <aside class="side">
          <button v-for="t in tabs" :key="t" :class="{ on: tab === t }" @click="loadTab(t)">{{ t }}</button>
        </aside>
        <div class="content">
          <div class="chead">
            <strong>{{ tab }}</strong>
            <div class="grow" />
            <button class="btn ghost" @click="logout">Log out</button>
            <button class="btn ghost" @click="emit('close')">✕</button>
          </div>

          <div v-if="tab === 'Subscription'" class="body">
            <div class="kv"><span>Plan</span><strong>{{ store.user?.level }}</strong></div>
            <div class="kv"><span>Status</span><strong>{{ store.user?.subscriptionStatus }}</strong></div>
            <div class="kv"><span>Credits</span><strong>{{ credits }}</strong></div>
            <div class="row">
              <button class="btn" @click="upgrade('free')">Free · 50/mo</button>
              <button class="btn primary" @click="upgrade('pro')">Pro · 500/mo</button>
              <button class="btn" @click="upgrade('lab')">Ultra · 5000/mo</button>
            </div>
            <p class="muted small">Self-hosted: plans are local tiers, no payment processor is wired.</p>
          </div>

          <div v-else-if="tab === 'Credit & Usage'" class="body">
            <div v-for="r in (usage?.rows || []).slice(-20)" :key="r.id" class="kv">
              <span>{{ r.kind }} · {{ r.mode || '' }}</span><strong>{{ r.delta }}</strong>
            </div>
            <div v-if="!(usage?.rows || []).length" class="muted small">No usage recorded yet.</div>
          </div>

          <div v-else-if="tab === 'Billing & Invoices'" class="body">
            <p class="muted small">No invoices — self-hosted instance. Stripe is intentionally not bundled.</p>
          </div>

          <div v-else-if="tab === 'Referrals'" class="body">
            <div class="kv"><span>Your code</span><strong>{{ referral?.code }}</strong></div>
            <div class="kv"><span>Invited</span><strong>{{ referral?.invited }}</strong></div>
          </div>

          <div v-else-if="tab === 'Profile'" class="body">
            <div class="kv"><span>Name</span><strong>{{ store.user?.name }}</strong></div>
            <div class="kv"><span>Email</span><strong>{{ store.user?.email }}</strong></div>
          </div>

          <div v-else class="body">
            <div v-for="v in version" :key="v.version" class="ver">
              <span class="badge">{{ v.version }}</span>
              <span class="muted">{{ v.date }}</span>
              <strong>{{ v.title }}</strong>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(20, 22, 28, 0.35);
  display: grid;
  place-items: center;
  z-index: 80;
  padding: 20px;
}
.panel {
  width: 720px;
  max-width: 100%;
  height: 600px;
  max-height: 90vh;
  display: flex;
  overflow: hidden;
}
.auth {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
}
.auth input {
  height: 34px;
  border: 1px solid var(--input);
  border-radius: var(--r-8);
  padding: 0 10px;
  background: var(--background);
}
.side {
  width: 200px;
  border-right: 1px solid var(--border);
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.side button {
  border: 0;
  background: transparent;
  text-align: left;
  padding: 7px 9px;
  border-radius: var(--r-8);
  font-size: var(--fs-13);
  cursor: pointer;
  color: var(--muted-foreground);
}
.side button.on {
  background: var(--accent);
  color: var(--foreground);
  font-weight: 600;
}
.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.chead {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
}
.grow {
  flex: 1;
}
.body {
  padding: 14px;
  overflow-y: auto;
}
.kv {
  display: flex;
  justify-content: space-between;
  padding: 7px 0;
  border-bottom: 1px dashed var(--border);
  font-size: var(--fs-13);
}
.row {
  display: flex;
  gap: 6px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.small {
  font-size: var(--fs-11);
  margin-top: 10px;
}
.ver {
  display: flex;
  gap: 8px;
  align-items: center;
  padding: 7px 0;
  border-bottom: 1px dashed var(--border);
  font-size: var(--fs-12);
}
.badge {
  font-size: var(--fs-10);
  border: 1px solid var(--border);
  border-radius: var(--r-pill);
  padding: 0 6px;
}
</style>
