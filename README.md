# novix-open

**An open, self-hostable replication of an "agentic workspace for research": nine agent modes, a live trajectory view, and an artifact workspace (file tree, code viewer, PDF viewer, ANSI terminal).**

Built by completing the open-source [`AI-Researcher`](https://github.com/HKUDS/AI-Researcher) kernel — which ships the research agents but only a Gradio benchmark UI — with the product shell the hosted version exposes: the REST contract, the SSE stream, the workspace canvas and the mode registry.

The original upstream README is preserved at [`docs/UPSTREAM_AI_RESEARCHER.md`](./UPSTREAM_AI_RESEARCHER.md).

> **What this is:** an independent implementation written from a structural reverse-engineering spec (routes, API contract, mode registry, SSE protocol, data shapes, measured design tokens). No brand assets, copy, prompts or third-party code from the hosted product are included.
>
> **What this is not:** not affiliated with, endorsed by, or derived from the source code of the hosted product. See [`NOTICE.md`](../NOTICE.md).

---

## One-click replication

```bash
git clone --depth 1 <this-repo> novix-open
cd novix-open
./install.sh            # installs UI deps, builds the bundle, starts the server
# open http://127.0.0.1:8081
```

That's it — no database, no external services. To run for real:

```bash
cp .env.example .env    # install.sh already does this
# edit .env: set LLM_API_BASE + LLM_API_KEY (any OpenAI-compatible endpoint)
node server/serve.mjs
```

Docker:

```bash
docker compose up --build
```

Without a key the site still runs end-to-end: literature search and code execution are real, and text generation returns a clearly-labelled offline sketch.

---

## What you get

### The nine modes

| key | UI name | Kernel | Entry price | Extra controls |
|---|---|---|---|---|
| `auto` | Auto Pilot | router | 1 cr | Try chips |
| `deepsurvey` | Deep Survey | literature review | 5 cr | Years · Focus · Format |
| `ideaspark` | Idea Spark | idea generation | 3 cr | From Topic / Dataset / Paper |
| `methoddesign` | Method Design | proposal | 3 cr | Field · Constraints · Output |
| `autoexperiment` | Auto Experiment | ML experiment | 10 cr | Data · Metric |
| `notebook` | Data Analysis | notebook | 5 cr | Data · Library · Output |
| `reproduce` | Reproduce Paper | reproduce | 10 cr | Scope · Framework |
| `deeptutor` | Deep Tutor | — | — | coming soon |
| `drawplot` | Draw Plot | — | — | coming soon |

Each mode writes **real artifacts** into `data/workspaces/<sessionId>/workspace/` — papers, bibtex, idea trees, experiment code, metrics, figures, reproduction reports.

### The interface

- **Left rail (44px)** — new session, gallery, notifications, theme, upgrade, avatar/account.
- **Workspace home** — serif hero, `Auto-Discovery | Manual task` tabs, mode list, composer, Try chips, **CASE GALLERY**.
- **Composer** — `@mention` agent assignment, per-mode popover controls, `CPU | GPU` segmented control (forced to CPU when files are attached), `Task mode | Discuss mode`, model selector, file upload.
- **Session page** — left: live trajectory with `Live / Analyze / Operate / Extract / Fault` phase timer; right: workspace canvas (file tree → code/PDF viewer → ANSI terminal → env picker), plus *secondary tool submit* to keep giving instructions in the context of the artifact you are looking at.
- **Share / Publish** — share flips the session to public-read; publish puts it in the Case Gallery.
- Light/dark dual theme, 390px mobile layout.

### The contract

Everything both sides agree on lives in `contracts/`:

| file | contents |
|---|---|
| `modes.json` | 9 modes, 5 models, 3 plans — source of truth, synced into the UI at build time |
| `api.json` | 60 endpoints, SSE events, task-create body, polling cadence |
| `routes.json` | 13 client routes + session layout |
| `errors.json` | `ResultEnum` business codes |
| `design-tokens.json` | measured colour / radius / type / shadow / layout values |

---

## Architecture

```
contracts/            single source of truth (JSON)
server/               zero-dependency Node HTTP server
  serve.mjs           static UI + /api routing
  routes/api.mjs      the whole REST surface + SSE endpoint
  lib/llm.mjs         OpenAI-compatible streaming, multi-gateway
  lib/literature.mjs  arXiv + Crossref + Semantic Scholar (keyless)
  lib/sandbox.mjs     docker -> local subprocess, hard timeout
  lib/kernels.mjs     the six agent kernels
  lib/executor.mjs    runs a kernel, persists trajectory, broadcasts events
  store/db.mjs        atomic JSON-file persistence
app/                  Vue 3 + Vite UI (3 npm packages, no UI framework)
agent/                adapter seam for the Python kernel
research_agent/       upstream AI-Researcher research agents (kept as-is)
paper_agent/          upstream AI-Researcher paper pipeline (kept as-is)
ops/sync-contracts.mjs contracts -> app/src/lib/modes.generated.js
```

Data lives in `data/` (git-ignored): `users/`, `sessions/`, `tasks/`, `files/`, `gallery/`, `ledger/`, `notifications/`, `workspaces/`.

### Request flow

```
Composer  -> POST /api/task/create_task
          -> executor runs the mode kernel
               |- real literature search (arXiv / Crossref / S2)
               |- real LLM streaming (or offline sketch)
               '- real code execution (docker / subprocess)
          -> events published to GET /api/chat/ (SSE: message / response / complete)
          -> artifacts written to the session workspace
          -> GET /api/chat_session/workspace/subtree surfaces them in the canvas
          -> task polls GET /api/task/get_task (500ms -> 2000ms) as the no-SSE fallback
```

---

## Upstream kernel

`research_agent/` and `paper_agent/` are the NeurIPS 2025 **AI-Researcher** code — the literature, idea, code and paper-writing agents — kept verbatim in this repo. The Node kernels in `server/lib/kernels.mjs` are the ones wired to the UI today; `agent/` is the seam where you swap in the Python agents (see `docs/COMPLETION_GAPS.md`).

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r docker/requirements.txt
```

---

## Verification

```bash
node ops/smoke.mjs          # boots the server and exercises the contract
cd app && npm run build     # UI build
```

---

## License

MIT — see `LICENSE`. Upstream `research_agent/` and `paper_agent/` retain their own upstream terms; see `NOTICE.md`.

## Full parity verification (2026-10-17)

- Live reverse evidence and route/API matrix: `docs/reverse/NOVIX_FULL_PARITY_MATRIX_20261017.md`
- Method, scope and limitations: `docs/reverse/DEEP_REVERSE_METHOD_20261017.md`
- Contract: 91 HTTP endpoints, 9 documented agent modes, 27 public route probes.
- Backend checks: `node server/tests/parity-backend-http.mjs`
- End-to-end smoke: `node ops/smoke.mjs`
- UI build: `cd app && npm run build`
