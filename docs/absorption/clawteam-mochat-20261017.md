# ClawTeam-gstack + MoChat absorption (2026-10-17)

## Source identity and licenses

- `novix-science/ClawTeam-gstack` `main` @ `bc69bc0c5925a0740ad068d06dcd1f12a7aad151`.
- Read-only feature source `origin/gstack-integration` @ `48c717f97cd2153f54db6d398828ca35bad58b6f` (2026-04-27).
- `novix-science/tailchat_by_chad` @ `591df5b895606e5fd2d166ca5b559d737c2ce32f` ("style: mochat redesign", 2026-02-04).
- ClawTeam-gstack is MIT, copyright 2025 HKUDS (`LICENSE`, copied wording not vendored).
- Tailchat root is Apache-2.0 with mixed plugin sub-licenses. Only interaction/layout ideas were referenced; no Tailchat files or assets are vendored.

## Evidence inspected

- `clawteam/templates/gstack/prompts/ceo.md:1-45` declares ceo as the only phase advancer and the four `/plan-ceo-review` modes.
- `.../prompts/pm.md:1-36` defines six office-hours forcing questions and the per-turn PM envelope.
- `.../templates/gstack/envelope_personas.py:1-260` defines all eleven persona envelopes.
- `clawteam/harness/gstack_review_router.py:42-143` defines globstar matching, accumulated rule reviewers and the mandatory `reviewer` floor.
- `clawteam/harness/ship_approval_gate.py:37-104` requires `approved_by`, `approved_at`, `sha_at_approval` and SHA pinning.
- `clawteam/harness/forced_progress_gate.py:49-160` defines two-turn per-agent theater detection.
- `clawteam/memory/entry.py:35-112`, `store.py:40-220`, `search.py:66-190`, `decay.py:65-115` define append-only JSONL memory, provenance/tag TTL ranking and tombstones.
- `clawteam/attention/queue.py:49-170`, `digest.py:17-95`, `auto_accept.py:20-100` define priority, age buckets, digest and easy/reversible 15-minute TTL auto-accept.
- `clawteam/templates/gstack/schemas/*.py` and `phase_contracts.py:1-70` define the artifact schemas and the seven phase artifact names.
- MoChat `client/web/src/components/ChatBox/ChatMessageList/Item.tsx` and `ChatMessageHeader.tsx` were used only as interaction references for threaded text/reasoning/tool and approval surfaces.

## Ported into novix-open

| GAP | Upstream capability | Destination | Status |
|---|---|---|---|
| GAP-026 | 11 roles and 7-phase sprint | `ROLE_DEFINITIONS`, `PHASES`, `TeamSprintStore` in `server/lib/team-sprint.mjs` | ADAPTED |
| GAP-027 | Review router globstar + first-match accumulation + reviewer floor | `matchGlob`, `GstackReviewRouter`, `routeReview` | PORTED |
| GAP-028 | Ship approval gate with approved review, green tests, ceo signature and SHA pin | `evaluateShipApproval`, `approveShip`, `advancePhase` test→ship gate | PORTED |
| GAP-029 | Append-only team memory / provenance / tag decay / keyword search | `writeMemory`, `listMemory`, `searchMemory`, `pruneMemory`, `rankMemoryEntry` | PORTED |
| GAP-030 | Attention priority, age buckets, digest, reversible TTL auto-accept | `addAttention`, `allAttention`, `attentionDigest`, `autoAcceptReversible` | PORTED |
| GAP-031 | Per-role forced-progress / theater detection | `registerTurn`, `theaterStatus`, `assertSubstantiveEvidence` | PORTED |
| GAP-032 | Extended evidence schemas | `ARTIFACT_SCHEMAS`, `validateArtifactSchema`, `validateExtendedArtifact` | PORTED |
| GAP-033 | HTTP controls and agent-native UI | `server/routes/team-sprint.mjs`, `app/src/pages/TeamPage.vue` | ADAPTED |

### Runtime behavior

- `POST /api/team/sprints/:id/review/route` stores diff paths, matched rules and the sorted reviewer union with floor.
- `POST /api/team/sprints/:id/ship/approve` is ceo-only; `advancePhase("test","ship")` re-evaluates approvals and refuses missing/invalid evidence.
- `POST /api/team/sprints/:id/memory` appends one JSON object per line to `<team>.memory.jsonl`; search uses literal keyword matching plus `recency × provenance × decay`.
- `GET /api/team/sprints/:id/attention` derives both explicit attention items and pending chat approval parts; `POST .../attention/:attentionId/answer` handles either.
- `POST .../attention/auto-accept` answers only `reversibility: easy` items and records `ttlMinutes` plus `expiresAt`.
- `POST .../progress/turn` deduplicates turn IDs per role; two no-progress turns create a blocking theater attention item, while artifact-byte growth or task completion resets the role counter.
- Chat parts persist as `text`, `reasoning`, `tool` and `approval`; approval parts flow into the attention queue.
- TeamPage exposes phase rail, roster, task board, evidence submission, review routing, ship gate, attention queue and memory search/write controls.

## Not ported / honest limits

- No Python CLI, MCP server, tmux/wsh subprocess backends, P2P transport, browser skill runtime, `gh`/deploy execution or live canary/benchmark probes.
- Review verification is structural and queue-based; it does not spawn independent reviewer processes or detect sycophancy cascades.
- Ship approval validates the artifact and SHA pin but does not perform a real push/deploy. Deploy notes and canary reports are evidence schemas, not deployment drivers.
- Test-command execution remains opt-in via `TEAM_ALLOW_TEST_EXEC=1`; the parity suite never runs shell commands and reports `network_calls=0`.
- Team memory is one `<team>.memory.jsonl` file with scope metadata rather than separate month buckets and per-role directories.
- Attention approval identity is the authenticated team owner. Role assertions are request fields, not cryptographically bound per-agent credentials.
- Tailchat is reference-only; no IM server, plugin runtime, design files or CSS were copied.

## Acceptance commands

```bash
node --check server/lib/team-sprint.mjs
node --check server/routes/team-sprint.mjs
node server/tests/parity-official-team.mjs
cd app && npm run build
```

Expected parity summary: `checks=81 passed=81 failed=0 network_calls=0`.
