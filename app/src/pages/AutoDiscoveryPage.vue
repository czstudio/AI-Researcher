<script setup>
import { computed, onMounted, ref } from 'vue';
import { store, toast, refreshSessions } from '../stores/app.js';
import { api, getToken } from '../lib/api.js';
import { navigate } from '../lib/router.js';

const loading = ref(true);
const ideaError = ref('');
const rawIdeas = ref(null);
const treeData = ref(null);
const sessionId = ref(store.currentSessionId || '');
const workspaceTree = ref(null);
const showHistory = ref(false);
const quickOpen = ref(false);
const query = ref('');
const searchBusy = ref(false);
const searchResults = ref([]);
const searchError = ref('');
const view = ref('Pilot');
const cardIndex = ref(0);
const dismissed = ref([]);
const approved = ref([]);
const fileInput = ref(null);
const uploading = ref(false);
const introOpen = ref(localStorage.getItem('novix.discovery.intro') !== 'dismissed');

const fileSummary = computed(() => {
  const rows = [];
  function walk(node) {
    if (node == null) return;
    if (node.type === 'file') rows.push(node);
    for (const child of node.children || []) walk(child);
  }
  walk(workspaceTree.value);
  const week = Date.now() - 7 * 86400000;
  const projects = new Set();
  for (const f of rows) {
    const root = String(f.path || '').split('/')[0];
    if (root) projects.add(root);
  }
  return {
    total: rows.length,
    week: rows.filter((f) => Number(f.updatedAt || 0) > week).length,
    projects: projects.size,
    days: rows.length ? Math.max(1, Math.ceil((Date.now() - Math.min(...rows.map((f) => Number(f.mtimeMs || f.updatedAt || Date.now())))) / 86400000)) : 0,
  };
});

const graph = computed(() => {
  const nodes = [];
  const edges = [];
  const tree = treeData.value;
  if (tree && typeof tree === 'object') {
    const root = tree['auto-ideaspark-root'] || Object.values(tree)[0];
    const seen = new Set();
    let row = 0;
    function visit(node, depth) {
      if (node == null || seen.has(node.id)) return;
      seen.add(node.id);
      const item = {
        id: String(node.id || `node-${nodes.length}`),
        label: String(node.summary || node.id || 'Research direction').slice(0, 72),
        description: String(node.description || ''),
        refs: node.references || [],
        depth,
        x: 62 + depth * 205,
        y: 54 + row * 68,
      };
      row += 1;
      nodes.push(item);
      for (const childId of node.children || []) {
        const child = tree[childId] || { id: childId, summary: String(childId), children: [] };
        visit(child, depth + 1);
        edges.push({ id: `${node.id}-${childId}`, from: item.id, to: String(child.id || childId) });
      }
    }
    if (root) visit(root, 0);
  }
  return { nodes: nodes.slice(0, 36), edges, refs: nodes.reduce((n, x) => n + (x.refs?.length || 0), 0) };
});

const approvalCards = computed(() => {
  const source = graph.value.nodes.length ? graph.value.nodes.filter((n) => n.depth > 0) : [];
  const items = source.length ? source : (rawIdeas.value?.items || []).map((it) => ({
    id: String(it.id), label: it.title || it.mode || 'Proposed research task', description: it.summary || '', refs: [],
  }));
  return items.filter((x) => dismissed.value.includes(x.id) === false && approved.value.includes(x.id) === false);
});
const currentCard = computed(() => approvalCards.value[cardIndex.value % Math.max(1, approvalCards.value.length)] || null);
const nodeById = computed(() => Object.fromEntries(graph.value.nodes.map((n) => [n.id, n])));

async function ensureWorkspace() {
  if (sessionId.value) return sessionId.value;
  try {
    const sessions = await api.listSessions();
    if (sessions?.items?.length) {
      sessionId.value = sessions.items[0].id;
    } else {
      const created = getToken() ? await api.createSession('auto-discovery') : await api.createAnonymousSession('auto-discovery');
      sessionId.value = created.id;
    }
    store.currentSessionId = sessionId.value;
    return sessionId.value;
  } catch (e) {
    ideaError.value = String(e.message || e);
    return '';
  }
}

async function loadIdeas() {
  loading.value = true;
  ideaError.value = '';
  try {
    const r = await api.autoIdeas();
    rawIdeas.value = r || null;
    treeData.value = r?.tree || null;
  } catch (e) {
    rawIdeas.value = null;
    treeData.value = null;
    ideaError.value = String(e.message || e);
  } finally {
    loading.value = false;
  }
}

async function loadWorkspace() {
  const sid = await ensureWorkspace();
  if (sid === '') return;
  try {
    const r = await api.subtree(sid, '.');
    workspaceTree.value = r?.workspaceTreeJson || null;
  } catch {
    workspaceTree.value = null;
  }
}

async function uploadFiles(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;
  const sid = await ensureWorkspace();
  if (sid === '') {
    toast('Open a session before uploading files', 'error');
    return;
  }
  uploading.value = true;
  try {
    const ids = await api.uploadFiles(files, sid);
    toast(`Uploaded ${ids.fileIds.length} file(s)`);
    await loadWorkspace();
  } catch (e) {
    toast(String(e.message || e), 'error');
  } finally {
    uploading.value = false;
    event.target.value = '';
  }
}

async function mine() {
  try {
    await api.triggerIdeas();
  } catch (e) {
    toast(`Auto trigger is unavailable; reloading existing ideas. ${e.message || e}`, 'info');
  }
  await loadIdeas();
}
async function quickSearch() {
  if (query.value.trim() === '') return;
  searchBusy.value = true;
  searchError.value = '';
  try {
    const r = await api.search(query.value.trim());
    searchResults.value = r.items || r.results || [];
    if (searchResults.value.length === 0) searchError.value = 'No results returned by the configured literature sources.';
  } catch (e) {
    searchResults.value = [];
    searchError.value = String(e.message || e);
  } finally {
    searchBusy.value = false;
  }
}
function openResult(item) {
  const url = item.url || item.link || item.pdfUrl;
  if (url) window.open(url, '_blank', 'noopener');
}

async function dismissCard() {
  if (currentCard.value == null) return;
  const id = currentCard.value.id;
  dismissed.value.push(id);
  try { await api.modifyIdea({ ideaId: id, action: 'not_now', status: 'dismissed' }); } catch { /* local state is still honest */ }
  if (cardIndex.value >= approvalCards.value.length) cardIndex.value = 0;
}
async function approveCard() {
  if (currentCard.value == null) return;
  const card = currentCard.value;
  approved.value.push(card.id);
  try { await api.modifyIdea({ ideaId: card.id, action: 'go_ahead', status: 'approved' }); } catch { /* fall through to a real task */ }
  store.composer.text = `Develop this research direction as a scoped proposal: ${card.label}${card.description ? `\n\nContext: ${card.description}` : ''}`;
  navigate('/ideaspark');
}
function openManual() {
  store.workspaceMode = 'manual';
  navigate('/chat');
}
function closeIntro() {
  introOpen.value = false;
  localStorage.setItem('novix.discovery.intro', 'dismissed');
}
function openHistory() {
  refreshSessions();
  showHistory.value = true;
}
async function onMountedLoad() {
  await Promise.all([loadIdeas(), loadWorkspace()]);
}
onMounted(onMountedLoad);

</script>

<template>
  <div class="discovery">
    <header class="head">
      <div>
        <div class="mode-tabs">
          <button class="on">Auto-Discovery <span class="new">New</span></button>
          <button @click="openManual">Manual task</button>
        </div>
        <h1>Research Exploration Space</h1>
        <p class="muted">A live map of ideas derived from your recent sessions, with concrete next actions.</p>
      </div>
      <div class="head-actions">
        <button class="btn" @click="navigate('/chat')">Open workspace</button>
        <button class="btn primary" @click="navigate('/ideaspark')">New Idea Spark</button>
      </div>
    </header>

    <div v-if="introOpen" class="intro-banner card">
      <div>
        <strong>Your questions just grew a tree</strong>
        <p class="muted">Auto-Discovery connects what you have explored into a knowledge graph. Start by running a session or approving a proposed direction.</p>
      </div>
      <div class="row">
        <button class="btn" @click="closeIntro">Maybe later</button>
        <button class="btn primary" @click="closeIntro(); navigate('/ideaspark')">Explore my tree</button>
      </div>
    </div>

    <div class="top-grid">
      <section class="files card">
        <div class="panel-head"><strong>File Space</strong><span class="muted small">Files summary</span></div>
        <div class="stats">
          <div><b>{{ fileSummary.total }}</b><span>TOTAL</span></div>
          <div><b>{{ fileSummary.week }}</b><span>THIS WEEK</span></div>
          <div><b>{{ fileSummary.projects }}</b><span>PROJECTS</span></div>
          <div><b>{{ fileSummary.days }}</b><span>DAYS</span></div>
        </div>
        <div class="actions">
          <button class="btn" :disabled="uploading" @click="fileInput.click()">{{ uploading ? 'Uploading…' : 'Upload Files' }}</button>
          <input ref="fileInput" type="file" multiple hidden @change="uploadFiles" />
          <button class="btn" @click="mine">Mind Mining</button>
          <button class="btn" @click="openHistory">Omni-AI History</button>
          <button class="btn" @click="quickOpen = true">Quick Collection</button>
        </div>
        <div v-if="sessionId" class="muted tiny mono">session {{ sessionId }}</div>
      </section>

      <section class="approval card">
        <div class="panel-head">
          <span class="eyebrow">For your approval · discovered</span>
          <div class="pager" v-if="approvalCards.length">
            <button @click="cardIndex = (cardIndex - 1 + approvalCards.length) % approvalCards.length">‹</button>
            <span>{{ cardIndex + 1 }} / {{ approvalCards.length }}</span>
            <button @click="cardIndex = (cardIndex + 1) % approvalCards.length">›</button>
          </div>
        </div>
        <template v-if="currentCard">
          <h3>Proposed task</h3>
          <p class="proposal">{{ currentCard.label }}</p>
          <p class="muted">{{ currentCard.description || 'Generated from your research space. Open it in Idea Spark to refine the scope.' }}</p>
          <div class="row">
            <button class="btn" @click="dismissCard">× Not now</button>
            <button class="btn primary" @click="approveCard">✓ Go ahead</button>
          </div>
        </template>
        <div v-else class="empty">
          <p class="muted">No approval cards yet. Run an Idea Spark session or use Mind Mining after your first research task.</p>
          <button class="btn primary" @click="navigate('/ideaspark')">Start Idea Spark</button>
        </div>
      </section>
    </div>

    <section class="graph-card card">
      <div class="panel-head">
        <div>
          <strong>Research Exploration Space</strong>
          <span class="live"><i class="dot-pulse" /> Live</span>
        </div>
        <div class="graph-meta">
          <span class="chip">NODES {{ graph.nodes.length }}</span>
          <span class="chip">EDGES {{ graph.edges.length }}</span>
          <span class="chip">REFS {{ graph.refs }}</span>
          <div class="seg">
            <button :class="{ on: view === 'Pilot' }" @click="view = 'Pilot'">Pilot</button>
            <button :class="{ on: view === 'Roam' }" @click="view = 'Roam'">Roam</button>
          </div>
        </div>
      </div>
      <div v-if="loading" class="muted pad">Loading knowledge graph…</div>
      <div v-else-if="ideaError" class="empty">
        <p class="muted">{{ ideaError }}</p>
        <p class="muted small">The graph endpoint requires an authenticated account and at least one generated idea tree.</p>
        <button class="btn" @click="navigate('/register')">Sign in / create account</button>
      </div>
      <div v-else-if="graph.nodes.length === 0" class="empty">
        <p class="muted">No ideas discovered yet. Run Idea Spark to grow the graph.</p>
        <button class="btn primary" @click="navigate('/ideaspark')">Create an idea tree</button>
      </div>
      <div v-else class="graph-scroll">
        <svg class="graph" :viewBox="`0 0 ${Math.max(760, graph.nodes.length ? Math.max(...graph.nodes.map((n) => n.x)) + 230 : 760)} ${Math.max(260, graph.nodes.length ? Math.max(...graph.nodes.map((n) => n.y)) + 90 : 260)}`" role="img" aria-label="Knowledge graph of research ideas">
          <line v-for="e in graph.edges" :key="e.id" :x1="nodeById[e.from]?.x + 82" :y1="nodeById[e.from]?.y" :x2="nodeById[e.to]?.x" :y2="nodeById[e.to]?.y" />
          <g v-for="n in graph.nodes" :key="n.id" :transform="`translate(${n.x - 82} ${n.y - 22})`">
            <rect width="164" height="44" rx="9" :class="{ root: n.depth === 0 }" />
            <text x="10" y="18">{{ n.label.slice(0, 36) }}</text>
            <text x="10" y="33" class="sub">{{ n.label.length > 36 ? n.label.slice(36, 66) : `${n.refs.length} references` }}</text>
          </g>
        </svg>
      </div>
    </section>

    <section class="kanban card">
      <div class="panel-head"><strong>Done</strong><span class="chip">{{ approved.length }} approved</span></div>
      <div v-if="approved.length" class="chips"><span v-for="id in approved" :key="id" class="chip">{{ id }}</span></div>
      <p v-else class="muted small">Approved directions will appear here after you choose Go ahead.</p>
    </section>

    <div v-if="showHistory" class="overlay" @click.self="showHistory = false">
      <div class="drawer card">
        <div class="panel-head"><strong>Omni-AI History</strong><button class="btn ghost" @click="showHistory = false">×</button></div>
        <button v-for="s in store.sessions" :key="s.id" class="history-row" @click="navigate(`/search-v1/${s.id}`); showHistory = false">
          <strong>{{ s.title || 'Untitled session' }}</strong><span class="muted small">{{ s.id }}</span>
        </button>
        <div v-if="store.sessions.length === 0" class="muted pad">No sessions yet.</div>
      </div>
    </div>

    <div v-if="quickOpen" class="overlay" @click.self="quickOpen = false">
      <div class="drawer card">
        <div class="panel-head"><strong>Quick Collection</strong><button class="btn ghost" @click="quickOpen = false">×</button></div>
        <div class="copy-row">
          <input v-model="query" placeholder="Search papers and the web…" @keydown.enter="quickSearch" />
          <button class="btn primary" :disabled="searchBusy" @click="quickSearch">{{ searchBusy ? 'Searching…' : 'Search' }}</button>
        </div>
        <p v-if="searchError" class="muted small pad">{{ searchError }}</p>
        <button v-for="(r, i) in searchResults" :key="r.id || r.url || i" class="history-row" @click="openResult(r)">
          <strong>{{ r.title || r.name || 'Result' }}</strong>
          <span class="muted small">{{ r.abstract || r.snippet || r.url || '' }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.discovery { height: 100%; overflow-y: auto; padding: 22px 26px 60px; max-width: 1180px; margin: 0 auto; box-sizing: border-box; }
.head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 18px; }
.mode-tabs { display: inline-flex; gap: 4px; background: var(--muted); border: 1px solid var(--border); border-radius: var(--r-8); padding: 3px; margin-bottom: 14px; }
.mode-tabs button { border: 0; background: transparent; border-radius: var(--r-5); padding: 5px 10px; font-size: var(--fs-11); cursor: pointer; color: var(--muted-foreground); }
.mode-tabs button.on { background: var(--card); color: var(--foreground); box-shadow: var(--shadow-sm); font-weight: 600; }
.new { font-size: 9px; color: var(--primary); border: 1px solid var(--primary); border-radius: var(--r-pill); padding: 0 4px; }
h1 { margin: 0; font-family: var(--font-display); font-size: 32px; line-height: 1.2; }
.head p { margin: 5px 0 0; font-size: var(--fs-12); }
.head-actions { display: flex; gap: 7px; flex-wrap: wrap; }
.intro-banner { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 16px; margin-bottom: 14px; background: linear-gradient(110deg, var(--card), var(--accent)); }
.intro-banner p { margin: 4px 0 0; font-size: var(--fs-12); }
.row { display: flex; gap: 6px; flex-wrap: wrap; }
.top-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
.card { border-radius: var(--r-12); }
.files, .approval { padding: 14px; }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.panel-head strong { font-size: var(--fs-13); }
.small { font-size: var(--fs-11); }
.tiny { font-size: var(--fs-10); }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin: 14px 0; }
.stats div { display: flex; flex-direction: column; border-right: 1px solid var(--border); }
.stats div:last-child { border-right: 0; }
.stats b { font-size: 21px; line-height: 1.2; }
.stats span { font-size: 9px; letter-spacing: .08em; color: var(--muted-foreground); }
.actions { display: flex; gap: 6px; flex-wrap: wrap; }
.actions .btn { font-size: var(--fs-11); }
.eyebrow { text-transform: uppercase; letter-spacing: .12em; font-size: var(--fs-9, 9px); color: var(--primary); font-weight: 700; }
.pager { display: flex; gap: 5px; align-items: center; font-size: var(--fs-11); }
.pager button { border: 0; background: transparent; cursor: pointer; color: var(--muted-foreground); }
h3 { font-size: var(--fs-10); text-transform: uppercase; letter-spacing: .12em; color: var(--muted-foreground); margin: 14px 0 4px; }
.proposal { font-size: 16px; line-height: 1.45; margin: 0 0 6px; font-weight: 600; }
.approval .muted { font-size: var(--fs-12); margin: 0 0 12px; }
.empty { padding: 18px 4px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.empty p { margin: 0; font-size: var(--fs-12); }
.graph-card { margin-bottom: 12px; padding: 14px; }
.graph-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.graph-meta .chip { cursor: default; height: 22px; font-size: var(--fs-10); }
.live { display: inline-flex; align-items: center; gap: 5px; margin-left: 8px; font-size: var(--fs-10); color: var(--muted-foreground); }
.graph-scroll { overflow: auto; margin-top: 10px; border: 1px solid var(--border); border-radius: var(--r-8); background: radial-gradient(circle at 20% 20%, var(--accent), var(--card)); }
.graph { display: block; min-width: 760px; width: 100%; height: 340px; }
.graph line { stroke: var(--border); stroke-width: 1.2; }
.graph rect { fill: var(--card); stroke: var(--border); stroke-width: 1; }
.graph rect.root { fill: var(--primary); stroke: var(--primary); }
.graph text { fill: var(--foreground); font-family: var(--font-body); font-size: 10.5px; }
.graph text.sub { fill: var(--muted-foreground); font-size: 8.5px; }
.graph rect.root + text { fill: var(--primary-foreground); }
.kanban { padding: 14px; }
.kanban .muted { margin-bottom: 0; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.chip { cursor: default; }
.overlay { position: fixed; inset: 0; background: rgba(20, 22, 28, .36); z-index: 100; display: flex; justify-content: flex-end; }
.drawer { width: 420px; max-width: 92vw; height: 100%; border-radius: 0; padding: 16px; overflow-y: auto; }
.history-row { width: 100%; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; border: 0; border-bottom: 1px solid var(--border); background: transparent; padding: 10px 2px; cursor: pointer; text-align: left; color: var(--foreground); }
.history-row:hover { background: var(--secondary); }
.history-row strong { font-size: var(--fs-12); }
.copy-row { display: flex; gap: 6px; margin: 12px 0; }
.copy-row input { flex: 1; min-width: 0; height: 32px; border: 1px solid var(--input); border-radius: var(--r-8); padding: 0 8px; background: var(--background); }
.pad { padding: 12px; }
@media (max-width: 800px) { .discovery { padding: 16px 14px 50px; } .head { flex-direction: column; align-items: flex-start; } .top-grid { grid-template-columns: 1fr; } h1 { font-size: 26px; } }
</style>
