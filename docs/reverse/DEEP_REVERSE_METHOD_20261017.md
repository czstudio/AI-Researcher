# Novix deep reverse method and evidence log (2026-10-17)

## Objective and authorization boundary

This work refreshed public, non-invasive evidence for `novix.science` and reconciled it against the open-source implementation in this worktree. The observation boundary was strict:

- public pages only;
- no login, no auth bypass, no credential use;
- no task submission, upload submission, payment or paid-task action;
- no response-body streaming handlers;
- no proprietary prompt or brand-asset copying.

## Tool chain

- Playwright Chromium from `/Users/cz/code/code/codex/idea2paper_product-dev-v4.0/web/node_modules/playwright`.
- Script: `docs/reverse/live-20261017/capture_public_routes.mjs`.
- Navigation: `waitUntil: "domcontentloaded"` with an 18 s navigation timeout and a bounded 1.5 s settle.
- Network observation: request/response metadata only (method, pathname, status). The script deliberately does **not** attach a `response.body()` handler; this avoids hanging on SSE/streaming endpoints.
- Browser: headless Chromium, viewport 1280x900, locale en-US, timezone UTC, service workers blocked.
- Bundle capture: `curl` of the public asset referenced by `/index.html`; no generated 1.5 MB bundle is committed.
- Contract reconciliation: JSON inspection plus `node --check` and comparison of contract paths against route registrations in `server/routes/api.mjs` and `server/routes/gpu.js`.

## Capture log

The capture loop visited 27 route probes and saved one viewport screenshot per probe:

- Product/mode routes: `/`, `/chat`, `/deepsurvey`, `/ideaspark`, `/methoddesign`, `/autoexperiment`, `/notebook`, `/reproduce`, `/auto-discovery`.
- Account routes: `/account`, `/account/upgrade`, `/account/credit`, `/account/billing`, `/account/referrals`, `/account/info`, `/account/version-history`, `/account/community`, `/upgrade`.
- Static/utility routes: `/privacy`, `/terms`, `/contact`, `/user-manual`, `/register`, `/debug/markdown`.
- Parameter probes: `/search-v1/capture-probe`, `/published/revision/capture-probe`.
- Catch-all probe: `/definitely-not-a-real-route`.

Observed HTTP results: 13 responses with status 200 and 14 host/CDN responses with status 404. The 404 probes still rendered SPA DOM, titles and redirects; the capture stores both the actual HTTP status and the final client URL. This is why the parity matrix labels several account/SPA routes PARTIAL rather than MISSING.

Representative observed redirects:

- `/` final URL `/`; title `Novix - The AI Agentic Co-Scientist for Scientific Research`.
- `/chat` final URL `/chat`; title `AI Research Chat - Talk to Your AI Co-Scientist | Novix`.
- `/auto-discovery` redirects to `/chat`; title is the chat title.
- `/account` redirects to `/account/upgrade`; public DOM shows the login gate.
- `/account/community` redirects to `/account/info`.
- `/upgrade` redirects to `/account/upgrade`.
- Unknown route redirects to `/chat`.

## Bundle evidence

- Asset: `https://novix.science/static/js/index-ykYPt_W7.js`.
- SHA-256: `c647c1aa806f6788b6936ede0b29915a3827989de93eb3257834c0a626c74382`.
- Size observed during download: 1,474,986 bytes.
- Saved summary excerpt: `docs/reverse/live-20261017/bundle_agent_configs_excerpt.txt`.
- The bundle exposes nine `AGENT_CONFIGS`: Auto Pilot, Deep Survey, Idea Spark, Method Design, Auto Experiment, Data Analysis, Reproduce Paper, Deep Tutor (coming soon), Draw Plot (coming soon).
- Poll constants observed: `TASK_STATUS_POLL_INTERVAL_MS=2000`, `TASK_STATUS_POLL_INTERVAL_INITIAL_MS=500`, terminal statuses `finish` and `error`.
- The bundle route table exposes the `:id(auto-discovery|chat|deepsurvey|methoddesign|ideaspark|autoexperiment|notebook|reproduce)` pattern, `search-v1/:sessionId`, `published/revision/:revisionId`, account children, static pages and a catch-all.
- API endpoint strings were reconciled into `contracts/api.json`; each entry now carries `evidence: live-public-bundle-2026-10-17` or `evidence: repo-implementation-only`.

## Findings and contract deltas

1. The live bundle changed to `index-ykYPt_W7.js`; prior comments referenced `index-Dk9cCEgm.js` and are now stale.
2. `AGENT_CONFIGS` confirms seven enabled agent modes and two coming-soon entries. Descriptions, mention values and credit-cost labels were corrected in `contracts/modes.json`.
3. `Deep Tutor` is described as `Interactive tutor for research papers`; `Draw Plot` as `Generate publication-ready plots`. Both have `comingSoon: true` and null mention values.
4. Speculative `suspect` fields were removed from `contracts/api.json`. The contract now distinguishes 69 live-observed endpoints from 22 repo-only implementation extensions.
5. The live public bundle contains no public `/gallery`, `/models`, `/search`, `/referral/me`, `/likeTask` or `/getTaskFeedback` call. Those local endpoints remain exact repo behavior but are marked `repo-implementation-only`, not upstream observations.
6. Account routes are host-404 under unauthenticated direct navigation but still mount the SPA route and login gate. The open implementation renders local account tabs; parity is therefore PARTIAL until an authenticated session is captured.
7. Local `/auto-discovery` has a dedicated page while the public probe redirected to `/chat`; this is a local product extension, not claimed live parity.
8. The server route table and contract now both contain 91 endpoint rows (including GPU and repo-only extensions), and `contracts/api.json` parses as valid JSON.

## Evidence files

| File | Contents |
|---|---|
| `docs/reverse/live-20261017/capture_public_routes.mjs` | Robust Playwright capture script; no response-body handlers, bounded waits. |
| `docs/reverse/live-20261017/public_routes.json` | Full per-route evidence: status, final URL, title, visible text, links, buttons, inputs, network metadata, screenshot path. |
| `docs/reverse/live-20261017/public_routes_summary.json` | Compact 27-row route summary. |
| `docs/reverse/live-20261017/capture.log` | Capture console log and per-route timing/status lines. |
| `docs/reverse/live-20261017/screenshots/*.png` | One 1280x900 viewport screenshot per route probe. |
| `docs/reverse/live-20261017/bundle_agent_configs_excerpt.txt` | Non-brand, non-prompt AGENT_CONFIGS excerpt from the public bundle. |
| `docs/reverse/NOVIX_FULL_PARITY_MATRIX_20261017.md` | Full route/component/control/endpoint parity matrix with status and acceptance. |
| `contracts/api.json` | Reconciled 91-entry HTTP/API contract with provenance. |
| `contracts/routes.json` | Reconciled client route contract plus 27 live observations. |
| `contracts/modes.json` | Reconciled mode registry plus exact `liveAgentConfigs`. |

Raw index HTML and the 1.5 MB generated bundle are working artifacts only and are excluded from the commit.

## Acceptance commands

```bash
python3 -m json.tool contracts/api.json >/dev/null
python3 -m json.tool contracts/routes.json >/dev/null
python3 -m json.tool contracts/modes.json >/dev/null
node --check app/src/lib/router.js
node --check server/routes/api.mjs
node --check server/routes/gpu.js
node ops/smoke.mjs
```

## Limitations

- Authenticated surfaces were not observed: live task execution, process trajectory, workspace canvas, uploads, sharing, publishing, billing and referrals are inferred from local code and prior evidence.
- The Playwright capture used one desktop viewport and one browser engine; responsive/mobile parity is not assessed.
- HTTP 404 for account/SPA routes is a host/CDN status and does not by itself prove the client route is missing; DOM/title/redirect evidence is recorded separately.
- Network capture stores request metadata only. Live response envelopes, error shapes and SSE frames were not re-collected here.
- `/user-manual` exposes a document viewer shell; its content parity was not judged.
- Status labels are engineering judgments. They separate observed truth (capture/bundle strings/server route registrations) from inference (whether local behavior is functionally equivalent).
- No claim is made that local agent behavior, prompts, model routing or paid-plan enforcement match upstream internals.
