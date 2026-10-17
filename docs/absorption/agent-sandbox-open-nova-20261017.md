# agent-sandbox + OpenNova absorption (2026-10-17)

## Sources

- `novix-science/agent-sandbox` `main` @ `1e1c435174c9fc1dae01f091d50cfa44ac01e315`
- `novix-science/agent-sandbox` `origin/novix` @ `f64ec82164b514269220767a8f0fe2206a7fd788`
- `novix-science/OpenNova` @ `c7a3f465da52f1fa10f74e4e24d065c4a7b89d5e`
- Licenses: Apache-2.0 (agent-sandbox, Kubernetes Authors); MIT (OpenNova, manna_and_poem).

## Inspected evidence

- `origin/novix` changes six sandbox-router files: path-prefix routing,
  WebSocket proxy, Location rewrite, tests. Main adds Sandbox / SandboxClaim /
  WarmPool controllers, pod/PVC/service lifecycle and provider SDKs.
- OpenNova tools: `app/tool/python_execute.py`, `browser_use_tool.py`,
  `str_replace_editor.py`, `file_saver.py`, `terminate.py`,
  `app/sandbox/client.py`, plus agent and planning modules.

## Ported behavior

| Upstream capability | novix-open destination | Status |
|---|---|---|
| `/<namespace>/<sandbox>/<rest>` routing | `server/lib/sandbox-router.mjs` `parseSandboxPath` | ADAPTED |
| Location header prefix rewrite | `rewriteLocation` | ADAPTED |
| Header hygiene / hop-by-hop stripping | `filterRequestHeaders`, `filterResponseHeaders` | ADAPTED |
| Sandbox provider abstraction | `LocalSandboxProvider`, provider interface in `SandboxRouter` | ADAPTED |
| Workspace-isolated exec/read/write | local provider methods | ADAPTED |
| WebSocket proxy | explicit 501 `SANDBOX_WEBSOCKET_NOT_IMPLEMENTED` | PARTIAL |
| `PythonExecute` | `server/lib/open-nova-tools.mjs`, merged into agent loop | ADAPTED |
| `BrowserUse` | optional external adapter; honest `not_configured` state | PARTIAL |
| `StrReplaceEditor` | exact-single-occurrence replace with traversal guard | ADAPTED |
| `FileSaver` / `Terminate` | workspace write / run termination flag | ADAPTED |

## Not ported

- Kubernetes controller runtime, CRDs, RBAC, PVC/Sandbox reconciliation.
- Docker sandbox daemon and Python agent framework.
- Browser automation runtime itself (external CLI adapter only).

## Acceptance

```bash
node --check server/lib/sandbox-router.mjs
node --check server/lib/open-nova-tools.mjs
node server/tests/parity-official-sandbox.mjs
```

Test result: 15/15 passing checks. The WebSocket limitation is explicit and
intentional in the zero-dependency Node runtime.
