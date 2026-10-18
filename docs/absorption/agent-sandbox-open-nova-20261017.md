# agent-sandbox + OpenNova absorption (2026-10-17)

## Sources

- `novix-science/agent-sandbox` `main` @ `1e1c435174c9fc1dae01f091d50cfa44ac01e315`
- `novix-science/agent-sandbox` `origin/novix` @ `f64ec82164b514269220767a8f0fe2206a7fd788`
- `novix-science/OpenNova` @ `c7a3f465da52f1fa10f74e4e24d065c4a7b89d5e`
- Licenses: Apache-2.0 (agent-sandbox, Kubernetes Authors); MIT (OpenNova, manna_and_poem).

## Inspected evidence

- `origin/novix` changes six sandbox-router files: path-prefix routing,
  WebSocket proxy, header/port routing, Location rewrite, and tests. Main adds
  Sandbox / SandboxClaim / WarmPool controllers, pod/PVC/service lifecycle and
  provider SDKs.
- OpenNova tools: `app/tool/python_execute.py`, `browser_use_tool.py`,
  `str_replace_editor.py`, `file_saver.py`, `terminate.py`,
  `app/sandbox/client.py`, `app/sandbox/core/{sandbox,manager,terminal}.py`,
  plus agent and planning modules.

## Ported behavior

| Upstream capability | novix-open destination | Status |
|---|---|---|
| `/<namespace>/<sandbox>/<rest>` routing | `server/lib/sandbox-router.mjs` `parseSandboxPath` | ADAPTED |
| Decoded traversal / encoded separator / control-character rejection | `parseSandboxPath`, `validateHostHeader` | ADAPTED |
| Location header prefix rewrite | `rewriteLocation` | ADAPTED |
| Header hygiene / hop-by-hop stripping | `filterRequestHeaders`, `filterResponseHeaders` | ADAPTED |
| Sandbox provider abstraction | `LocalSandboxProvider` + `createSandboxProvider` | ADAPTED |
| Docker provider | `DockerSandboxProvider` spawns the Docker CLI with workspace bind, network-none default, memory/CPU/PID limits; returns `SANDBOX_DOCKER_UNAVAILABLE` when CLI/daemon is absent | ADAPTED |
| Kubernetes target resolution | `KubernetesTargetProvider` resolves `sandbox.namespace.svc.cluster.local:port` from config/env | ADAPTED (target resolution only; no control plane) |
| Unknown provider rejection | `createSandboxProvider` throws `SANDBOX_PROVIDER_UNKNOWN` | ADAPTED |
| Workspace-isolated exec/read/write | local/docker provider methods | ADAPTED |
| Raw WebSocket proxy | `proxyWebSocketUpgrade`; zero-dependency `node:net`/`node:tls` tunnel, prefix-aware target path, upgrade-header allowlist, Host rewrite, forwarding of initial `head`, upstream status/error relay, connect/handshake/idle timeouts | ADAPTED (remote target proxy only) |
| `PythonExecute` | `server/lib/open-nova-tools.mjs` `runPython`; real `python3 -I -c` execution, timeout, output cap | ADAPTED |
| Python Docker isolation | enabled by `NOVIX_PYTHON_DOCKER_IMAGE` (alias `PYTHON_EXECUTE_DOCKER_IMAGE`) or `NOVIX_PYTHON_DOCKER=1`; network-none, workspace bind, honest unavailable result | ADAPTED (optional) |
| `BrowserUse` | external `BROWSER_AUTOMATION_CMD` adapter with argv-array spawn (no shell), action validation, timeout and JSON output parsing | ADAPTED (external runtime required) |
| `StrReplaceEditor` | `view` (files/directories, `view_range`), `create`, `insert`, `str_replace`; 16 KB truncation notice | ADAPTED |
| `StrReplaceEditor` undo | explicit `TOOL_UNDO_UNSUPPORTED` error | INTENTIONALLY UNSUPPORTED |
| `FileSaver` | workspace-contained write/append with `w`/`a` mode | ADAPTED |
| `Terminate` | run termination flag | ADAPTED |

## Environment / invocation contracts

- `BROWSER_AUTOMATION_CMD`: executable plus optional argv, parsed without a
  shell. The adapter invokes:
  `<cmd...> --tool BrowserUse --action <action> --payload <json>`.
- `NOVIX_PYTHON_DOCKER_IMAGE` or `PYTHON_EXECUTE_DOCKER_IMAGE`: non-empty value
  enables Docker isolation for `PythonExecute`; `PYTHON_EXECUTE_DOCKER=1` uses
  `python:3.12-alpine`. `DOCKER_CMD` can override the Docker executable.
- `SANDBOX_PROVIDER=local|docker|kubernetes` selects the default provider.
- `NOVIX_K8S_NAMESPACE`, `NOVIX_K8S_SERVICE_DOMAIN`,
  `NOVIX_K8S_SANDBOX_PORT` configure `KubernetesTargetProvider`.
- `DockerSandboxProvider` and the Kubernetes provider never claim controller
  support. The Kubernetes adapter only resolves a DNS target URL.

## Remaining limits

- The local and Docker providers do not host a WebSocket server. A local
  WebSocket upgrade is rejected with
  `SANDBOX_WEBSOCKET_LOCAL_UNSUPPORTED` (HTTP 501). Real WebSocket tunneling
  works when a remote `targetBase`/Kubernetes target is supplied.
- Kubernetes CRD, Pod, Service, PVC, WarmPool and RBAC reconciliation are not
  implemented; no control-plane behavior is claimed.
- Docker isolation depends on an installed Docker CLI/daemon and a locally
  available image. The provider fails honestly instead of pretending isolation.
- Browser automation is an external-CLI adapter; the browser runtime/Python
  framework itself is not bundled.
- `StrReplaceEditor.undo_edit` has no in-process file history and returns an
  explicit unsupported error. Callers should keep their own snapshots.
- The upstream FastAPI/httpx/websockets application is not copied. This is an
  independent Node behavioral reimplementation.

## Acceptance

```bash
node --check server/lib/sandbox-router.mjs
node --check server/lib/open-nova-tools.mjs
node --check server/tests/parity-official-sandbox.mjs
node server/tests/parity-official-sandbox.mjs
```

Test result: **76/76 checks passing** (`SUMMARY parity_official_sandbox
rows=76 pass=76 fail=0`). The raw WebSocket test uses a real local HTTP upgrade
server and a raw `node:net` client, including prefix routing, header hygiene and
frame forwarding. The unreachable-target test asserts a bounded 502 response.
