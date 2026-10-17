<script setup>
import { computed } from 'vue';
import { navigate } from '../lib/router.js';

const props = defineProps({ page: { type: String, required: true } });

const pages = {
  privacy: {
    title: 'Privacy',
    intro: 'This self-hosted instance stores the minimum data needed to run research sessions. It is not the upstream novix.science service.',
    sections: [
      ['Data we store', 'Account email, a salted password hash, browser fingerprint, chat sessions, task prompts and trajectories, uploaded files, workspace artifacts, credit ledger entries, and plan/subscription status.'],
      ['Where it is stored', 'Locally in the operator-managed data directory on this server. LLM prompts and tool outputs are sent to the model gateway configured by the operator, which may be a third party.'],
      ['Cookies and local storage', 'The browser stores an authentication token, an anonymous fingerprint, and a theme preference. There are no advertising or analytics cookies in this build.'],
      ['Sharing and publishing', 'Private sessions are visible only to their owner. Sharing or publishing creates a public read-only link. Anyone with that link can view the session and its workspace.'],
      ['Retention and deletion', 'Operators control backup and retention policies. Session deletion is available from the API; contact the operator for full account deletion.'],
      ['Contact', 'Use the Contact page for privacy questions. This is a self-hosted deployment, so response times depend on the operator.'],
    ],
  },
  terms: {
    title: 'Terms of use',
    intro: 'These are plain-language terms for this self-hosted, independently operated research workspace. They are not a copy of any third-party agreement.',
    sections: [
      ['Use of the service', 'You may use this instance for lawful research and educational work. Do not attempt to access other users’ private sessions or disrupt the service.'],
      ['Your content', 'You retain responsibility for prompts, documents and artifacts you upload or generate. Make sure you have the right to process the material you submit.'],
      ['Agent output', 'AI-generated plans, citations, code and results can be wrong. Verify claims and outputs before relying on them in publications or decisions.'],
      ['Credits and plans', 'This open build may expose local plan and credit controls without a payment processor. No real charge is made unless an operator explicitly configures billing.'],
      ['Availability', 'The software is provided as-is without warranties. Operators may restart, upgrade or remove the instance at any time.'],
      ['Acceptable use', 'Do not use the instance to violate privacy, intellectual property, export control, or other applicable laws.'],
    ],
  },
  contact: {
    title: 'Contact',
    intro: 'This is a self-hosted instance. The operator of this deployment is responsible for accounts, data and model configuration.',
    sections: [
      ['General and security', 'Send reports to the operator’s configured address. Include the session ID or task ID when reporting a specific issue.'],
      ['Billing and plans', 'No payment processor is bundled with this open build. Any billing questions should go to your deployment operator.'],
      ['Community', 'The original project ecosystem may have a public community. Links here are informational; this instance does not require joining an external service.'],
    ],
  },
  'user-manual': {
    title: 'User manual',
    intro: 'A practical map of the surfaces in this workspace.',
    sections: [
      ['Start a task', 'Open Auto-Discovery for an overview, or choose a mode from the left rail. Write a specific question, adjust mode controls, attach files, select CPU/GPU and task/discuss mode, then send.'],
      ['During a run', 'The session page shows a live process timeline. It polls task status, falls back to SSE when available, and exposes a cancel button. Workspace files refresh as artifacts appear.'],
      ['Workspace panel', 'Browse the tree, click a file to preview it, open PDFs, and use Download workspace to fetch a zip. The follow-up box submits a question with the selected file in context.'],
      ['Share, publish, fork', 'Share creates a read-only session link. Publish creates a revision page. A published page can be forked when the backend supports it.'],
      ['Account tabs', 'Subscription, Credit & Usage, Billing & Invoices, Referrals, Profile and Version History are separate routes under /account. Unavailable data is shown as an honest empty state.'],
      ['Limits', 'GPU may be locked on free plans. Uploads are checked against supported extensions and size limits. If a model gateway is not configured, tasks may fail with an operator-facing error.'],
    ],
  },
};

const data = computed(() => pages[props.page] || pages['user-manual']);
</script>

<template>
  <div class="page">
    <header>
      <button class="brand" @click="navigate('/')"><span class="mark">N</span> Novix <span class="open">OPEN</span></button>
      <nav>
        <button @click="navigate('/chat')">Workspace</button>
        <button @click="navigate('/user-manual')">Manual</button>
        <button @click="navigate('/privacy')">Privacy</button>
        <button @click="navigate('/terms')">Terms</button>
        <button @click="navigate('/contact')">Contact</button>
      </nav>
    </header>
    <main>
      <p class="eyebrow">Novix Open · self-hosted</p>
      <h1>{{ data.title }}</h1>
      <p class="intro">{{ data.intro }}</p>
      <div class="contents">
        <section v-for="[heading, body] in data.sections" :key="heading">
          <h2>{{ heading }}</h2>
          <p>{{ body }}</p>
        </section>
        <section v-if="props.page === 'contact'">
          <h2>Configured address</h2>
          <p>The API contract lists the upstream contact as <a href="mailto:yasmine_li@novix.science">yasmine_li@novix.science</a>. For a deployment-specific issue, contact that operator address only if they have confirmed it applies to this instance.</p>
        </section>
      </div>
      <footer>
        <button class="btn" @click="navigate('/')">← Landing</button>
        <button class="btn primary" @click="navigate('/auto-discovery')">Open workspace</button>
      </footer>
    </main>
  </div>
</template>

<style scoped>
.page { min-height: 100%; overflow-y: auto; }
header { max-width: 960px; margin: 0 auto; padding: 18px 22px; display: flex; align-items: center; gap: 18px; border-bottom: 1px solid var(--border); }
.brand { border: 0; background: transparent; display: inline-flex; align-items: center; gap: 8px; font-weight: 700; cursor: pointer; }
.mark { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; background: var(--primary); color: var(--primary-foreground); font-family: var(--font-display); }
.open { font-size: 9px; letter-spacing: .12em; color: var(--muted-foreground); border: 1px solid var(--border); border-radius: var(--r-pill); padding: 1px 5px; }
nav { margin-left: auto; display: flex; gap: 4px; flex-wrap: wrap; }
nav button { border: 0; background: transparent; color: var(--muted-foreground); cursor: pointer; font-size: var(--fs-12); padding: 5px 7px; }
nav button:hover { color: var(--foreground); }
main { max-width: 800px; margin: 0 auto; padding: 54px 22px 80px; }
.eyebrow { text-transform: uppercase; letter-spacing: .15em; color: var(--primary); font-size: var(--fs-10); font-weight: 700; }
h1 { font-family: var(--font-display); font-size: 46px; margin: 8px 0 12px; }
.intro { font-size: 17px; color: var(--muted-foreground); line-height: 1.7; max-width: 690px; }
.contents { margin-top: 34px; border-top: 1px solid var(--border); }
section { padding: 20px 0; border-bottom: 1px solid var(--border); }
h2 { font-size: 16px; margin: 0 0 6px; }
section p { margin: 0; color: var(--muted-foreground); font-size: var(--fs-13); line-height: 1.75; white-space: pre-wrap; }
a { color: var(--primary); text-decoration: underline; }
footer { display: flex; gap: 8px; margin-top: 28px; }
@media (max-width: 700px) { header { align-items: flex-start; flex-direction: column; } nav { margin-left: 0; } h1 { font-size: 36px; } }
</style>
