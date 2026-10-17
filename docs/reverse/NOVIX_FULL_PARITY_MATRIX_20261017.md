# Novix full parity matrix (2026-10-17)

Observed truth: Playwright public captures in `docs/reverse/live-20261017/public_routes.json` plus strings from live public bundle `index-ykYPt_W7.js`. Inference: status labels and local landing-file mapping below are engineering judgments based on repo inspection, not claims about upstream internals. No login, paid task, auth bypass, upload submit, or response-body streaming was used.

Evidence metadata: capture 2026-10-17; 27 route probes; bundle sha256 `c647c1aa806f6788b6936ede0b29915a3827989de93eb3257834c0a626c74382`; bundle excerpt `bundle_agent_configs_excerpt.txt`.

## Counts

| Area | Total | IMPLEMENTED | PARTIAL | MISSING | OUT_OF_SCOPE |
|---|---:|---:|---:|---:|---:|
| Frontend route probes | 27 | 8 | 19 | 0 | 0 |
| Components/pages/controls | 41 | 16 | 24 | 0 | 1 |
| Backend contract endpoints | 91 | 72 | 19 | 0 | 0 |
| SSE channel | 1 | 0 | 1 | 0 | 0 |

JSON parse status: all 27 public probes returned DOM (13 HTTP 200, 14 host/CDN 404); SPA client rendering and redirects were still observed where the host returned 404. This distinction is important: HTTP status is not the same as frontend route existence.

## Frontend routes

| Probe | Observed HTTP | Final URL | Title | Status | Landing file | Acceptance |
|---|---:|---|---|---|---|---|
| `/` | 200 | `https://novix.science/` | Novix - The AI Agentic Co-Scientist for Scientific Research | IMPLEMENTED | `app/src/pages/LandingPage.vue` | `test -f app/src/pages/LandingPage.vue` |
| `/chat` | 200 | `https://novix.science/chat` | AI Research Chat - Talk to Your AI Co-Scientist / Novix | IMPLEMENTED | `app/src/pages/WorkspacePage.vue` | `test -f app/src/pages/WorkspacePage.vue` |
| `/deepsurvey` | 200 | `https://novix.science/deepsurvey` | Deep Survey - AI-Powered Literature Survey / Novix | IMPLEMENTED | `app/src/pages/WorkspacePage.vue` | `test -f app/src/pages/WorkspacePage.vue` |
| `/ideaspark` | 200 | `https://novix.science/ideaspark` | Idea Spark - Generate Novel Research Ideas with AI / Novix | IMPLEMENTED | `app/src/pages/WorkspacePage.vue` | `test -f app/src/pages/WorkspacePage.vue` |
| `/methoddesign` | 200 | `https://novix.science/methoddesign` | Method Design - AI Research Methodology Designer / Novix | IMPLEMENTED | `app/src/pages/WorkspacePage.vue` | `test -f app/src/pages/WorkspacePage.vue` |
| `/autoexperiment` | 200 | `https://novix.science/autoexperiment` | Auto Experiment - Automate Scientific Experiments with AI / Novix | IMPLEMENTED | `app/src/pages/WorkspacePage.vue` | `test -f app/src/pages/WorkspacePage.vue` |
| `/notebook` | 200 | `https://novix.science/notebook` | Research Notebook - AI Jupyter Notebook Assistant / Novix | IMPLEMENTED | `app/src/pages/WorkspacePage.vue` | `test -f app/src/pages/WorkspacePage.vue` |
| `/reproduce` | 200 | `https://novix.science/reproduce` | Reproduce Paper - Replicate Published Research with AI / Novix | IMPLEMENTED | `app/src/pages/WorkspacePage.vue` | `test -f app/src/pages/WorkspacePage.vue` |
| `/auto-discovery` | 404 | `https://novix.science/chat` | AI Research Chat - Talk to Your AI Co-Scientist / Novix | PARTIAL | `app/src/App.vue` | `test -f app/src/App.vue` |
| `/account` | 404 | `https://novix.science/account/upgrade` | Novix | PARTIAL | `app/src/pages/AccountPage.vue` | `test -f app/src/pages/AccountPage.vue` |
| `/account/upgrade` | 404 | `https://novix.science/account/upgrade` | Novix | PARTIAL | `app/src/App.vue` | `test -f app/src/App.vue` |
| `/account/credit` | 404 | `https://novix.science/account/credit` | Novix | PARTIAL | `app/src/App.vue` | `test -f app/src/App.vue` |
| `/account/billing` | 404 | `https://novix.science/account/billing` | Novix | PARTIAL | `app/src/App.vue` | `test -f app/src/App.vue` |
| `/account/referrals` | 404 | `https://novix.science/account/referrals` | Novix | PARTIAL | `app/src/App.vue` | `test -f app/src/App.vue` |
| `/account/info` | 404 | `https://novix.science/account/info` | Novix | PARTIAL | `app/src/App.vue` | `test -f app/src/App.vue` |
| `/account/version-history` | 404 | `https://novix.science/account/version-history` | Novix | PARTIAL | `app/src/App.vue` | `test -f app/src/App.vue` |
| `/account/community` | 404 | `https://novix.science/account/info` | Novix | PARTIAL | `app/src/App.vue` | `test -f app/src/App.vue` |
| `/privacy` | 200 | `https://novix.science/privacy` | Privacy Policy / Novix | PARTIAL | `app/src/pages/StaticPage.vue` | `test -f app/src/pages/StaticPage.vue` |
| `/terms` | 200 | `https://novix.science/terms` | Terms of Service / Novix | PARTIAL | `app/src/pages/StaticPage.vue` | `test -f app/src/pages/StaticPage.vue` |
| `/contact` | 200 | `https://novix.science/contact` | Contact Us / Novix | PARTIAL | `app/src/pages/StaticPage.vue` | `test -f app/src/pages/StaticPage.vue` |
| `/user-manual` | 200 | `https://novix.science/user-manual` | Novix User Manual / Official Product Guide | PARTIAL | `app/src/pages/StaticPage.vue` | `test -f app/src/pages/StaticPage.vue` |
| `/register` | 200 | `https://novix.science/register` | Novix | PARTIAL | `app/src/pages/RegisterPage.vue` | `test -f app/src/pages/RegisterPage.vue` |
| `/debug/markdown` | 404 | `https://novix.science/debug/markdown` | Novix | PARTIAL | `app/src/pages/MarkdownDebugPage.vue` | `test -f app/src/pages/MarkdownDebugPage.vue` |
| `/upgrade` | 404 | `https://novix.science/account/upgrade` | Novix | PARTIAL | `app/src/App.vue` | `test -f app/src/App.vue` |
| `/search-v1/capture-probe` | 404 | `https://novix.science/search-v1/capture-probe` | Novix | PARTIAL | `app/src/App.vue` | `test -f app/src/App.vue` |
| `/published/revision/capture-probe` | 404 | `https://novix.science/published/revision/capture-probe` | Novix | PARTIAL | `app/src/App.vue` | `test -f app/src/App.vue` |
| `/definitely-not-a-real-route` | 404 | `https://novix.science/chat` | AI Research Chat - Talk to Your AI Co-Scientist / Novix | PARTIAL | `app/src/App.vue` | `test -f app/src/App.vue` |

## Components

| Item | Landing file | Status | Observed evidence / note | Acceptance |
|---|---|---|---|---|
| App shell | `app/src/App.vue` | IMPLEMENTED | routes rendered; public bundle route table observed | `test -f app/src/App.vue` |
| AppRail | `app/src/components/AppRail.vue` | PARTIAL | local home/auto-discovery/new/notifications/theme/account; live has richer rail | `test -f app/src/components/AppRail.vue` |
| Composer | `app/src/components/Composer.vue` | PARTIAL | textarea, files, CPU/GPU, task/discuss, submit; live composer is richer | `test -f app/src/components/Composer.vue` |
| ModeList | `app/src/components/ModeList.vue` | IMPLEMENTED | seven live mode entries plus two coming-soon entries observed | `test -f app/src/components/ModeList.vue` |
| CaseGallery | `app/src/components/CaseGallery.vue` | PARTIAL | live case rows render; local demo gallery is seeded | `test -f app/src/components/CaseGallery.vue` |
| WorkspaceCanvas | `app/src/components/WorkspaceCanvas.vue` | PARTIAL | tree/viewer/terminal shell; not exercised without auth | `test -f app/src/components/WorkspaceCanvas.vue` |
| FileTree | `app/src/components/FileTree.vue` | IMPLEMENTED | present in session workspace | `test -f app/src/components/FileTree.vue` |
| AuthForm | `app/src/components/AuthForm.vue` | PARTIAL | email/password only; live shows GitHub/Google/OTP | `test -f app/src/components/AuthForm.vue` |
| LoginOverlay | `app/src/components/LoginOverlay.vue` | PARTIAL | local modal; live login gate observed | `test -f app/src/components/LoginOverlay.vue` |
| AccountMenu | `app/src/components/AccountMenu.vue` | PARTIAL | legacy/alternate menu; account route is primary | `test -f app/src/components/AccountMenu.vue` |
| NotificationPanel | `app/src/components/NotificationPanel.vue` | PARTIAL | list shell present; API auth-gated | `test -f app/src/components/NotificationPanel.vue` |
| SettingsOverlay | `app/src/components/SettingsOverlay.vue` | PARTIAL | settings shell; live account tabs split by route | `test -f app/src/components/SettingsOverlay.vue` |
| ShareModal | `app/src/components/ShareModal.vue` | PARTIAL | share action present; not exercised | `test -f app/src/components/ShareModal.vue` |
| FeedbackBar | `app/src/components/FeedbackBar.vue` | PARTIAL | feedback action present; not exercised | `test -f app/src/components/FeedbackBar.vue` |
| MarkdownBlock | `app/src/components/MarkdownBlock.vue` | IMPLEMENTED | markdown renderer present | `test -f app/src/components/MarkdownBlock.vue` |
| ToastHost | `app/src/components/ToastHost.vue` | IMPLEMENTED | local notifications | `test -f app/src/components/ToastHost.vue` |

## Route components/pages

| Item | Landing file | Status | Observed evidence / note | Acceptance |
|---|---|---|---|---|
| LandingPage | `app/src/pages/LandingPage.vue` | IMPLEMENTED | / 200 rendered marketing landing | `test -f app/src/pages/LandingPage.vue` |
| WorkspacePage | `app/src/pages/WorkspacePage.vue` | IMPLEMENTED | /chat + six mode routes 200 rendered | `test -f app/src/pages/WorkspacePage.vue` |
| SessionPage | `app/src/pages/SessionPage.vue` | PARTIAL | /search-v1 probe auth gate observed; run state needs login | `test -f app/src/pages/SessionPage.vue` |
| PublishedPage | `app/src/pages/PublishedPage.vue` | PARTIAL | /published/revision probe returned client error state | `test -f app/src/pages/PublishedPage.vue` |
| AutoDiscoveryPage | `app/src/pages/AutoDiscoveryPage.vue` | PARTIAL | live /auto-discovery redirected to /chat (404 host) | `test -f app/src/pages/AutoDiscoveryPage.vue` |
| AccountPage | `app/src/pages/AccountPage.vue` | PARTIAL | account routes 404 host status but rendered nav/login gate | `test -f app/src/pages/AccountPage.vue` |
| RegisterPage | `app/src/pages/RegisterPage.vue` | PARTIAL | /register 200; live OAuth/OTP richer | `test -f app/src/pages/RegisterPage.vue` |
| StaticPage | `app/src/pages/StaticPage.vue` | PARTIAL | four static routes render; local copy is intentionally not upstream | `test -f app/src/pages/StaticPage.vue` |
| MarkdownDebugPage | `app/src/pages/MarkdownDebugPage.vue` | PARTIAL | live route 404; local debug page exists | `test -f app/src/pages/MarkdownDebugPage.vue` |
| GalleryPage | `app/src/pages/GalleryPage.vue` | OUT_OF_SCOPE | /gallery removed live; legacy local page | `test -f app/src/pages/GalleryPage.vue` |

## Controls

| Item | Landing file | Status | Observed evidence / note | Acceptance |
|---|---|---|---|---|
| Mode tabs (Auto Pilot, Deep Survey, Idea Spark, Method Design, Auto Experiment, Data Analysis, Reproduce Paper) | `` | IMPLEMENTED | observed /chat and mode captures | manual UI check |
| Coming-soon tabs (Deep Tutor, Draw Plot) | `` | IMPLEMENTED | observed Soon labels | manual UI check |
| Deep Survey Years / Focus / Format | `` | IMPLEMENTED | observed 5 years, Focus, paper/report/ppt | manual UI check |
| Idea Spark From / preference dial | `` | IMPLEMENTED | observed From Topic/Dataset/Paper, Balanced | manual UI check |
| Method Design Field / Constraints / Output | `` | IMPLEMENTED | observed Field, Constraints, paper/report/ppt | manual UI check |
| Auto Experiment Data / Metric | `` | IMPLEMENTED | observed Data, Metric | manual UI check |
| Notebook Data / Library / Output | `` | IMPLEMENTED | observed Data, Library, Output | manual UI check |
| Reproduce Scope / Framework | `` | IMPLEMENTED | observed Scope, Framework | manual UI check |
| CPU / GPU switch | `` | PARTIAL | observed; GPU plan gate not exercised | manual UI check |
| Task / Discuss mode | `` | PARTIAL | observed; execution needs login | manual UI check |
| Composer textarea + submit | `` | IMPLEMENTED | observed placeholders per mode | manual UI check |
| Upload file | `` | PARTIAL | control present; no upload submitted | manual UI check |
| Session cancel / follow-up question | `` | PARTIAL | local controls; not exercised | manual UI check |
| Workspace tree / file preview / ANSI terminal / download | `` | PARTIAL | local components; auth-gated | manual UI check |
| Share / publish / fork / feedback | `` | PARTIAL | local controls; not exercised | manual UI check |

## Backend endpoints

| Method | Path | Status | Landing file | Evidence | Acceptance |
|---|---|---|---|---|---|
| POST | `/user/login` | PARTIAL | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/user/emailSignUp` | PARTIAL | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/user/sendEmailAuthCode` | PARTIAL | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/user/resetPassword` | PARTIAL | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/user/getUserInfo` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/user/getUserCreditInfo` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/user/getUserCreditUsage` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/user/getAvailableCoupons` | PARTIAL | `server/routes/api.mjs` | repo implementation only | `node ops/smoke.mjs` |
| POST | `/user/workspace/init` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/user/workspace/interest` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/user/feature_white_list/enabled` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/site-config/public` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/account/info` | PARTIAL | `server/routes/api.mjs` | repo implementation only | `node ops/smoke.mjs` |
| POST | `/account/upgrade` | PARTIAL | `server/routes/api.mjs` | repo implementation only | `node ops/smoke.mjs` |
| POST | `/chat_session/create` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/chat_session/create_anonymous` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/chat_session/list` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/chat_session/active` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/chat_session/message/list` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/chat_session/status` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/chat_session/share` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/chat_session/bind_anonymous` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/chat_session/rename` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/chat_session/delete` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/chat_session/workspace` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/chat_session/workspace/subtree` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/chat_session/workspace/download_workspace_url` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/chat_session/workspace/home_files` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/chat_session/workspace/home_file_preview` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/chat_session/workspace/user_upload/delete` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/chat_session/workspace/user_workspace/subtree` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/home/novix/workspace` | PARTIAL | `server/routes/api.mjs` | repo implementation only | `node ops/smoke.mjs` |
| POST | `/task/create_task` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/task/create_anonymous_task` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/task/create_internal_task_with_signature` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/task/get_task` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/task/submit_user_question` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/call_agent` | PARTIAL | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/agents` | PARTIAL | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/file/batch_temp_urls` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/file/upload_stream` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/file/upload_complete` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/file/temp_url` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/file/download` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/oss/getSTSToken` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/published/item/publish` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/published/item/publish/access` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/published/revision/{revisionId}/session` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/published/revision/{revisionId}/task` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/published/revision/{revisionId}/workspace/subtree` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/published/revision/{revisionId}/fork` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/search` | PARTIAL | `server/routes/api.mjs` | repo implementation only | `node ops/smoke.mjs` |
| GET | `/get_searchHistory` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/referral/me` | PARTIAL | `server/routes/api.mjs` | repo implementation only | `node ops/smoke.mjs` |
| POST | `/likeTask` | PARTIAL | `server/routes/api.mjs` | repo implementation only | `node ops/smoke.mjs` |
| GET | `/getTaskFeedback` | PARTIAL | `server/routes/api.mjs` | repo implementation only | `node ops/smoke.mjs` |
| POST | `/credit/upgrade_plan` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/credit/subscription/upgrade` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/credit/list` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/credit/billing-statements` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/credit/cancel` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/credit/invite` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/credit/one-time-plans` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/credit/join` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/credit/remove` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/notification/list` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/notification/latest` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/notification/version-history` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/auto_ideaspark/ideas` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/auto_ideaspark/modify` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/gallery/list` | PARTIAL | `server/routes/api.mjs` | repo implementation only | `node ops/smoke.mjs` |
| GET | `/models` | PARTIAL | `server/routes/api.mjs` | repo implementation only | `node ops/smoke.mjs` |
| POST | `/login` | PARTIAL | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/auto_ideaspark/trigger` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/task/start_code_agent` | IMPLEMENTED | `server/routes/api.mjs` | repo implementation only | `node ops/smoke.mjs` |
| POST | `/task/cancel/:taskId` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/sandbox_processes/:user_id/:session_id` | PARTIAL | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/history_updates/:user_id/:session_id` | PARTIAL | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/user/ackOnboardingMilestone` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| POST | `/credit/list` | IMPLEMENTED | `server/routes/api.mjs` | live public bundle | `node ops/smoke.mjs` |
| GET | `/gpu/balance` | IMPLEMENTED | `server/routes/gpu.js` | repo implementation only | `node server/tests/gpu-http-dispatch-controls.mjs` |
| GET | `/gpu/byo/list` | IMPLEMENTED | `server/routes/gpu.js` | repo implementation only | `node server/tests/gpu-http-dispatch-controls.mjs` |
| GET | `/gpu/health` | IMPLEMENTED | `server/routes/gpu.js` | repo implementation only | `node server/tests/gpu-http-dispatch-controls.mjs` |
| GET | `/gpu/status/:taskId` | IMPLEMENTED | `server/routes/gpu.js` | repo implementation only | `node server/tests/gpu-http-dispatch-controls.mjs` |
| POST | `/gpu/byo/register` | IMPLEMENTED | `server/routes/gpu.js` | repo implementation only | `node server/tests/gpu-http-dispatch-controls.mjs` |
| POST | `/gpu/cancel/:taskId` | IMPLEMENTED | `server/routes/gpu.js` | repo implementation only | `node server/tests/gpu-http-dispatch-controls.mjs` |
| POST | `/gpu/estimate` | IMPLEMENTED | `server/routes/gpu.js` | repo implementation only | `node server/tests/gpu-http-dispatch-controls.mjs` |
| POST | `/gpu/rent` | IMPLEMENTED | `server/routes/gpu.js` | repo implementation only | `node server/tests/gpu-http-dispatch-controls.mjs` |
| POST | `/file/putToGcs` | IMPLEMENTED | `server/routes/api.mjs` | repo implementation only | `node ops/smoke.mjs` |
| POST | `/published/item/withdraw` | IMPLEMENTED | `server/routes/api.mjs` | repo implementation only | `node ops/smoke.mjs` |
| GET | `/published/revision/{revisionId}/workspace/subtree` | IMPLEMENTED | `server/routes/api.mjs` | repo implementation only | `node ops/smoke.mjs` |

SSE `GET /api/chat/` is handled by `handleSse` in `server/routes/api.mjs`; status PARTIAL because live capture did not open an authenticated stream and local framing is a compatibility implementation. Acceptance: `node ops/smoke.mjs`.


## Backend functions and ARTEX cross-reference

| Function/module | Status | Role | Acceptance |
|---|---|---|---|
| runTask / executor | PARTIAL | `server/lib/executor.mjs` | task execution loop, polling and cancellation | ``node ops/smoke.mjs`` |
| agent-loop | PARTIAL | `server/lib/agent-loop.mjs` | tool-call loop and pending questions | ``node --check server/lib/agent-loop.mjs`` |
| hub pub/sub | IMPLEMENTED | `server/lib/hub.mjs` | SSE fan-out | ``node --check server/lib/hub.mjs`` |
| kernels | PARTIAL | `server/lib/kernels.mjs` | local notebook/code execution | ``node --check server/lib/kernels.mjs`` |
| literature | PARTIAL | `server/lib/literature.mjs` | arXiv/Crossref search | ``node ops/smoke.mjs`` |
| sandbox | PARTIAL | `server/lib/sandbox.mjs` | bounded local command execution | ``node --check server/lib/sandbox.mjs`` |
| workspace | IMPLEMENTED | `server/lib/workspace.mjs` | tree, preview, path safety | ``node --check server/lib/workspace.mjs`` |
| parity helpers | PARTIAL | `server/lib/parity.mjs` | plans, billing, onboarding compatibility | ``node --check server/lib/parity.mjs`` |
| db store | IMPLEMENTED | `server/store/db.mjs` | JSON persistence | ``node --check server/store/db.mjs`` |

ARTEX reference: the live architecture shows agent configs feeding route/mention selection, SSE-driven trajectory updates, poll fallback constants (500 ms initial / 2000 ms interval), and a workspace artifact panel. The local implementation follows those patterns structurally; it does not copy upstream prompts or brand assets.


## Key deltas from prior contracts

- Bundle changed from `index-Dk9cCEgm.js` to `index-ykYPt_W7.js`; capture date refreshed to 2026-10-17.
- Live bundle exposes 9 agent configs including coming-soon Deep Tutor and Draw Plot; descriptions and mention values were corrected.
- Speculative `suspect` flags removed; 69 endpoints are marked live-observed and 22 as repo-only/contract extensions.
- `/account/*` routes are live routes but public unauthenticated probes return host 404 while rendering the SPA login gate; status is PARTIAL, not MISSING.
- `/auto-discovery` redirects to `/chat` in the public browser probe (host 404); local repo has a dedicated AutoDiscoveryPage, hence PARTIAL.


## Limitations

- No authenticated account/session surfaces were exercised; workspace canvas, task execution, upload, publish, fork and billing remain PARTIAL.
- One Playwright viewport (1280x900), headless Chromium; mobile and visual pixel parity were not assessed.
- Live statuses for account/SPA routes are CDN/host statuses; client rendering was confirmed by DOM/title/text evidence.
- `/user-manual` embeds viewer chrome only in the public capture; content parity was not judged.
- Inference statuses may change with login; they explicitly separate observed evidence from engineering judgment.

