<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { store, toast, refreshUser, logout } from '../stores/app.js';
import { api } from '../lib/api.js';
import { navigate } from '../lib/router.js';
import MODES from '../lib/modes.generated.js';
import AuthForm from '../components/AuthForm.vue';

const props = defineProps({ tab: { type: String, default: 'upgrade' } });
const loading = ref(false);
const error = ref('');
const creditInfo = ref(null);
const usage = ref({ rows: [], total: 0 });
const statements = ref([]);
const billingError = ref('');
const referral = ref(null);
const referralError = ref('');
const oneTime = ref([]);
const oneTimeError = ref('');
const versions = ref([]);
const interest = ref(null);
const copied = ref(false);
const authMode = ref('login');

const tabs = [
  { id: 'upgrade', label: 'Subscription' },
  { id: 'credit', label: 'Credit & Usage' },
  { id: 'billing', label: 'Billing & Invoices' },
  { id: 'referrals', label: 'Referrals' },
  { id: 'info', label: 'Profile' },
  { id: 'version-history', label: 'Version History' },
];
const activeTab = computed(() => tabs.find((t) => t.id === props.tab) || tabs[0]);
const signedIn = computed(() => store.user !== null);
const availableCredits = computed(() => creditInfo.value?.credits ?? store.user?.credits ?? 0);
const planLabel = computed(() => store.plan?.label || store.user?.level || 'free');
const referralLink = computed(() => {
  if (referral.value?.code == null) return '';
  return `${location.origin}/register?referralCode=${encodeURIComponent(referral.value.code)}`;
});
const fallbackOneTime = computed(() => {
  const out = [];
  for (const [level, terms] of Object.entries(MODES.oneTimeTerms || {})) {
    for (const term of terms) out.push({ level, label: term.label, price: term.price, sku: term.sku });
  }
  return out;
});
const oneTimeRows = computed(() => (oneTime.value.length ? oneTime.value : fallbackOneTime.value));

function asItems(r) {
  if (Array.isArray(r)) return r;
  return r?.items || r?.records || r?.rows || r?.statements || [];
}

async function load() {
  if (signedIn.value === false) return;
  loading.value = true;
  error.value = '';
  try {
    await refreshUser();
    if (props.tab === 'upgrade') {
      try {
        oneTime.value = asItems(await api.oneTimePlans());
        oneTimeError.value = '';
      } catch (e) {
        oneTime.value = [];
        oneTimeError.value = String(e.message || e);
      }
    } else if (props.tab === 'credit') {
      const info = await api.creditInfo();
      creditInfo.value = info || null;
      usage.value = (await api.creditUsage()) || { rows: [], total: 0 };
    } else if (props.tab === 'billing') {
      try {
        statements.value = asItems(await api.billingStatements());
        billingError.value = '';
      } catch (e) {
        statements.value = [];
        billingError.value = String(e.message || e);
      }
    } else if (props.tab === 'referrals') {
      try {
        referral.value = await api.referral();
        referralError.value = '';
      } catch (e) {
        referral.value = null;
        referralError.value = String(e.message || e);
      }
    } else if (props.tab === 'info') {
      creditInfo.value = await api.creditInfo();
      try { interest.value = await api.workspaceInterest(); } catch { interest.value = null; }
    } else if (props.tab === 'version-history') {
      versions.value = asItems(await api.versionHistory());
    }
  } catch (e) {
    error.value = String(e.message || e);
  } finally {
    loading.value = false;
  }
}

async function choosePlan(level) {
  try {
    await api.upgradePlan(level);
    await refreshUser();
    toast(`Plan updated to ${level}`);
  } catch (e) {
    toast(String(e.message || e), 'error');
  }
}
async function chooseOneTime(row) {
  const level = row.level || String(row.sku || '').toLowerCase().split('_')[0];
  try {
    await api.upgradePlan(level);
    await refreshUser();
    toast(`One-time term recorded: ${row.label || row.sku || level}`);
  } catch (e) {
    toast(String(e.message || e), 'error');
  }
}

async function copyInvite() {
  if (referralLink.value === '') return;
  try {
    await navigator.clipboard.writeText(referralLink.value);
    copied.value = true;
    toast('Invite link copied');
    setTimeout(() => { copied.value = false; }, 1600);
  } catch {
    toast('Clipboard unavailable — select the link manually', 'error');
  }
}
async function cancelPlan() {
  try {
    await api.cancelSubscription();
    await refreshUser();
    toast('Cancellation scheduled');
  } catch (e) {
    toast(String(e.message || e), 'error');
  }
}
async function resetPassword() {
  try {
    const r = await api.resetPassword(store.user?.email || '');
    toast(r?.note || 'Password reset request recorded');
  } catch (e) {
    toast(String(e.message || e), 'error');
  }
}
function signOut() {
  logout();
  navigate('/');
}
function openRegister() {
  navigate('/register');
}
async function onAuth() {
  await refreshUser();
  await load();
}
watch(() => props.tab, load);
onMounted(load);

</script>

<template>
  <div class="account">
    <header class="topbar">
      <button class="brand" @click="navigate('/')"><span class="mark">N</span> Novix <span class="open">OPEN</span></button>
      <button class="btn ghost" @click="navigate('/chat')">Back to workspace</button>
    </header>
    <div class="layout">
      <aside class="side card">
        <div class="profile-mini">
          <span class="avatar">{{ store.user?.avatarInitial || 'G' }}</span>
          <div>
            <strong>{{ store.user?.name || 'Guest' }}</strong>
            <div class="muted small">{{ store.user?.email || 'Not signed in' }}</div>
          </div>
        </div>
        <nav>
          <button v-for="t in tabs" :key="t.id" :class="{ on: activeTab.id === t.id }" @click="navigate(`/account/${t.id}`)">{{ t.label }}</button>
        </nav>
        <div class="side-foot">
          <button v-if="signedIn" class="btn ghost" @click="signOut">Log out</button>
          <button v-else class="btn primary" @click="openRegister">Create account</button>
        </div>
      </aside>

      <main class="content">
        <div class="title-row">
          <div>
            <p class="eyebrow">Account</p>
            <h1>{{ activeTab.label }}</h1>
          </div>
          <button class="btn" @click="load" :disabled="loading">Refresh</button>
        </div>

        <div v-if="signedIn === false" class="auth-gate card">
          <AuthForm initial-mode="login" @success="onAuth" />
        </div>
        <div v-else-if="loading" class="muted pad">Loading account data…</div>
        <div v-else-if="error" class="notice error">{{ error }}</div>

        <template v-else>
          <section v-if="activeTab.id === 'upgrade'" class="panel-stack">
            <div class="summary card">
              <div><span class="muted small">Current plan</span><strong class="big">{{ planLabel }}</strong></div>
              <div><span class="muted small">Status</span><strong>{{ store.user?.subscriptionStatus || 'free' }}</strong></div>
              <div><span class="muted small">Credits</span><strong>{{ availableCredits }}</strong></div>
              <button v-if="store.user?.subscriptionStatus === 'active' && store.user?.level !== 'free'" class="btn" @click="cancelPlan">Cancel subscription</button>
            </div>
            <h2>Monthly plans</h2>
            <div class="plans">
              <article v-for="p in store.plans" :key="p.level" class="plan card" :class="{ current: (store.user?.level || 'free') === p.level }">
                <div class="plan-head"><strong>{{ p.label }}</strong><span v-if="(store.user?.level || 'free') === p.level" class="chip">Current</span></div>
                <div class="price">${{ p.monthlyPriceUsd ?? 0 }}<span class="muted">/mo</span></div>
                <p v-if="p.originalPriceUsd" class="strike">was ${{ p.originalPriceUsd }}/mo</p>
                <p class="credits">{{ p.monthlyCredits }} credits / month</p>
                <button class="btn primary" :disabled="(store.user?.level || 'free') === p.level" @click="choosePlan(p.level)">Choose {{ p.label }}</button>
              </article>
            </div>
            <div class="section-head-row">
              <h2>Pay once</h2>
              <span v-if="oneTimeError" class="muted small">Live plan endpoint unavailable; showing contract terms. {{ oneTimeError }}</span>
            </div>
            <div class="terms">
              <div v-for="row in oneTimeRows" :key="row.sku || `${row.level}-${row.label}`" class="term card">
                <strong>{{ row.level || 'plan' }} · {{ row.label }}</strong>
                <span class="muted">${{ row.price }}</span>
                <button class="btn" @click="chooseOneTime(row)">Select term</button>
              </div>
            </div>
            <p class="fine">Plan changes use the local credit endpoint. No card is charged by this open build.</p>
          </section>

          <section v-else-if="activeTab.id === 'credit'" class="panel-stack">
            <div class="summary card">
              <div><span class="muted small">Remaining</span><strong class="big">{{ availableCredits }}</strong></div>
              <div><span class="muted small">Monthly allowance</span><strong>{{ creditInfo?.monthlyCredits ?? store.plan?.monthlyCredits ?? 0 }}</strong></div>
              <div><span class="muted small">Renews</span><strong>{{ creditInfo?.nextMonthCredit ? 'Monthly' : '—' }}</strong></div>
            </div>
            <h2>Usage ledger</h2>
            <div class="table-wrap card">
              <table>
                <thead><tr><th>When</th><th>Kind / mode</th><th>Delta</th><th>Balance</th></tr></thead>
                <tbody>
                  <tr v-for="r in (usage.rows || []).slice().reverse()" :key="r.id">
                    <td>{{ r.at ? new Date(r.at).toLocaleString() : '—' }}</td>
                    <td>{{ r.kind || 'task' }}<span v-if="r.mode" class="muted"> · {{ r.mode }}</span></td>
                    <td :class="{ neg: Number(r.delta) < 0, pos: Number(r.delta) > 0 }">{{ Number(r.delta) > 0 ? '+' : '' }}{{ r.delta }}</td>
                    <td>{{ r.balance ?? '—' }}</td>
                  </tr>
                </tbody>
              </table>
              <div v-if="(usage.rows || []).length === 0" class="muted pad">No usage recorded yet.</div>
            </div>
          </section>

          <section v-else-if="activeTab.id === 'billing'" class="panel-stack">
            <div v-if="billingError" class="notice">
              Billing statements are not available from this backend yet. {{ billingError }}
            </div>
            <h2>Statements</h2>
            <div class="table-wrap card">
              <table>
                <thead><tr><th>Date</th><th>Type / SKU</th><th>Amount</th><th>Invoice</th></tr></thead>
                <tbody>
                  <tr v-for="s in statements" :key="s.id">
                    <td>{{ s.paidAt ? new Date(s.paidAt).toLocaleDateString() : '—' }}</td>
                    <td>{{ s.statementType || 'statement' }}<span v-if="s.sku" class="muted"> · {{ s.sku }}</span></td>
                    <td>{{ s.currency ? s.currency.toUpperCase() : 'USD' }} {{ s.amount ?? '—' }}</td>
                    <td><a v-if="s.hostedInvoiceUrl" :href="s.hostedInvoiceUrl" target="_blank" rel="noreferrer">Hosted invoice</a><span v-else class="muted">Contact operator</span></td>
                  </tr>
                </tbody>
              </table>
              <div v-if="statements.length === 0" class="muted pad">No billing statements are available on this self-hosted instance.</div>
            </div>
          </section>

          <section v-else-if="activeTab.id === 'referrals'" class="panel-stack">
            <div v-if="referralError" class="notice">Referral data is unavailable: {{ referralError }}</div>
            <div v-else class="summary card">
              <div><span class="muted small">Your code</span><strong class="big">{{ referral?.code || '—' }}</strong></div>
              <div><span class="muted small">Invited</span><strong>{{ referral?.invited ?? 0 }}</strong></div>
              <div><span class="muted small">Signup bonus</span><strong>{{ referral?.bonus ?? 30 }} credits</strong></div>
            </div>
            <h2>Invite link</h2>
            <div class="copy-row card">
              <input :value="referralLink" readonly placeholder="Sign in to generate an invite link" />
              <button class="btn primary" :disabled="referralLink === ''" @click="copyInvite">{{ copied ? 'Copied' : 'Copy link' }}</button>
            </div>
            <p class="fine">A referred account receives the signup bonus when the backend applies it. This deployment does not fabricate invites.</p>
          </section>

          <section v-else-if="activeTab.id === 'info'" class="panel-stack">
            <div class="summary card">
              <div><span class="muted small">Name</span><strong>{{ store.user?.name || '—' }}</strong></div>
              <div><span class="muted small">Email</span><strong>{{ store.user?.email || '—' }}</strong></div>
              <div><span class="muted small">User ID</span><strong class="mono">{{ store.user?.id || '—' }}</strong></div>
            </div>
            <h2>Account controls</h2>
            <div class="actions card">
              <button class="btn" @click="resetPassword">Reset password</button>
              <button class="btn" @click="signOut">Log out</button>
              <button class="btn" @click="navigate('/contact')">Contact support</button>
            </div>
            <h2>Research interests</h2>
            <div v-if="interest?.topics?.length" class="chips">
              <span v-for="topic in interest.topics" :key="topic" class="chip">{{ topic }}</span>
            </div>
            <p v-else class="muted small">No interest profile is available yet. It is derived from recent session titles by the backend.</p>
          </section>

          <section v-else class="panel-stack">
            <div class="version card">
              <div v-for="v in versions" :key="v.version" class="version-row">
                <span class="badge">{{ v.version }}</span>
                <span class="muted">{{ v.date }}</span>
                <span>{{ v.title }}</span>
              </div>
              <div v-if="versions.length === 0" class="muted pad">No version history returned.</div>
            </div>
          </section>
        </template>
      </main>
    </div>
  </div>
</template>

<style scoped>
.account { height: 100%; overflow-y: auto; background: var(--background); }
.topbar { max-width: 1180px; margin: 0 auto; padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.brand { border: 0; background: transparent; display: inline-flex; align-items: center; gap: 8px; font-weight: 700; cursor: pointer; }
.mark { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--primary); color: var(--primary-foreground); font-family: var(--font-display); }
.open { font-size: 9px; letter-spacing: .12em; color: var(--muted-foreground); border: 1px solid var(--border); border-radius: var(--r-pill); padding: 1px 5px; }
.layout { max-width: 1180px; margin: 0 auto; padding: 8px 20px 60px; display: grid; grid-template-columns: 220px minmax(0, 1fr); gap: 20px; align-items: start; }
.side { position: sticky; top: 14px; padding: 12px; }
.profile-mini { display: flex; gap: 9px; align-items: center; padding: 4px 4px 14px; border-bottom: 1px solid var(--border); }
.avatar { width: 34px; height: 34px; border-radius: 50%; background: var(--primary); color: var(--primary-foreground); display: grid; place-items: center; font-weight: 700; flex: 0 0 auto; }
.small { font-size: var(--fs-10); overflow: hidden; text-overflow: ellipsis; }
nav { display: flex; flex-direction: column; gap: 2px; padding-top: 10px; }
nav button { border: 0; background: transparent; text-align: left; padding: 7px 9px; border-radius: var(--r-8); color: var(--muted-foreground); cursor: pointer; font-size: var(--fs-13); }
nav button:hover { background: var(--secondary); color: var(--foreground); }
nav button.on { background: var(--accent); color: var(--foreground); font-weight: 600; }
.side-foot { padding-top: 14px; margin-top: 14px; border-top: 1px solid var(--border); }
.content { min-width: 0; padding-top: 8px; }
.title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.eyebrow { margin: 0 0 2px; text-transform: uppercase; letter-spacing: .14em; font-size: var(--fs-10); color: var(--primary); font-weight: 700; }
h1 { margin: 0; font-family: var(--font-display); font-size: 30px; }
h2 { font-size: 14px; margin: 22px 0 9px; }
.panel-stack { display: flex; flex-direction: column; }
.summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; align-items: center; padding: 16px; }
.summary > div { display: flex; flex-direction: column; gap: 2px; }
.big { font-size: 24px; line-height: 1.2; }
.plans { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; }
.plan { padding: 15px; display: flex; flex-direction: column; gap: 7px; }
.plan.current { border-color: var(--primary); box-shadow: 0 0 0 1px var(--primary); }
.plan-head { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.price { font-family: var(--font-display); font-size: 28px; }
.price .muted { font-size: var(--fs-11); font-family: var(--font-body); }
.strike { text-decoration: line-through; color: var(--muted-foreground); font-size: var(--fs-11); margin: 0; }
.credits { font-size: var(--fs-12); margin: 0 0 4px; }
.section-head-row { display: flex; justify-content: space-between; gap: 12px; align-items: baseline; flex-wrap: wrap; }
.terms { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px; }
.term { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; font-size: var(--fs-12); }
.term .btn { margin-left: auto; }
.fine { font-size: var(--fs-11); color: var(--muted-foreground); margin-top: 12px; }
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: var(--fs-12); }
th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--border); white-space: nowrap; }
th { color: var(--muted-foreground); font-weight: 500; background: var(--muted); }
td.neg { color: var(--destructive); }
td.pos { color: var(--chart-3); }
.pad { padding: 16px; }
.copy-row { display: flex; gap: 8px; padding: 10px; }
.copy-row input { flex: 1; min-width: 0; height: 32px; border: 1px solid var(--input); border-radius: var(--r-8); background: var(--background); padding: 0 9px; font-size: var(--fs-12); }
.actions { display: flex; gap: 8px; flex-wrap: wrap; padding: 12px; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.version { padding: 6px 14px; }
.version-row { display: grid; grid-template-columns: 72px 92px 1fr; gap: 10px; align-items: center; padding: 10px 0; border-bottom: 1px dashed var(--border); font-size: var(--fs-12); }
.version-row:last-child { border-bottom: 0; }
.badge { font-family: var(--font-mono); font-size: var(--fs-10); border: 1px solid var(--border); border-radius: var(--r-pill); padding: 1px 7px; width: fit-content; }
.auth-gate { max-width: 460px; padding: 24px; }
.notice { margin-bottom: 14px; padding: 10px 12px; border: 1px solid var(--border); border-radius: var(--r-8); background: var(--accent); font-size: var(--fs-12); }
.notice.error { color: var(--destructive); }
.btn:disabled { opacity: .5; cursor: not-allowed; }
@media (max-width: 760px) { .layout { grid-template-columns: 1fr; } .side { position: static; } nav { flex-direction: row; overflow-x: auto; } nav button { white-space: nowrap; } .version-row { grid-template-columns: 1fr; gap: 3px; } }
</style>
