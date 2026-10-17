# Licenses and Attribution — Official Novix OSS Absorption (2026-10-17)

**Audit owner:** `official-ledger`
**Snapshot:** 2026-10-17T06:33:05-07:00 (America/Los_Angeles)
**Companion ledger:** `docs/absorption/NOVIX_OFFICIAL_OSS_LEDGER_20261017.md`

This document records the license basis for every official novix-science repository and
special branch audited by this team, what was copied or adapted into `novix-open`, the
notice obligations that follow, and what was deliberately **not** copied.

---

## 1. Legal posture of this absorption

The novix-open repository is a mixed-origin product:

1. It already bundles the MIT-licensed `AI-Researcher` upstream under the paths listed
   in the root `NOTICE.md`.
2. The web application layer (`app/`, `server/`, `contracts/`) is an independent
   implementation written from a structural reverse-engineering specification.
3. The official-OSS absorption work adds **independent Node/Vue reimplementations of
   selected behavioral contracts** from six novix-science repositories.

At the audit snapshot, **no upstream source file from the six official repositories is
vendored, translated line-for-line, or retained as a source file in novix-open.** The
absorption is behavioral/architectural. That distinction matters for the exact notice
obligations below.

If a future change copies a substantial portion of upstream source, the MIT/Apache/ISC
obligations in section 4 become mandatory for the copied file, and this document plus
the root `NOTICE.md` must be updated in the same change.

---

## 2. License inventory

| Source ref | Exact commit | License found at commit | Evidence | Root license file? | Copyright / attribution line |
|---|---|---|---|---|---|
| `agent-sandbox` `main` | `1e1c435174c9fc1dae01f091d50cfa44ac01e315` | Apache-2.0 | `LICENSE` | Yes | Kubernetes Authors; headers say Apache-2.0. SHA-256 `b40930bbcf80744c86c46a12bc9da056641d722716c378f5659b9e555ef833e1` |
| `agent-sandbox` `origin/novix` | `f64ec82164b514269220767a8f0fe2206a7fd788` | Apache-2.0 | `LICENSE`; changed files retain `Copyright 2025 The Kubernetes Authors` headers | Yes | Same as main |
| `autoresearch` `master` | `29a5846ba40f25c24ce316c50fe99e376d1dff8f` | MIT (declared) | `README.md:116-118` (`## License` / `MIT`) | **No** | No copyright holder line. Upstream lineage: karpathy/autoresearch; fork owner `AutoResearcher` |
| 8 `autoresearch` GPU branches | see ledger table | MIT (declared) | Branch `README.md` License section | **No** | Same as master |
| `ClawTeam-gstack` `main` | `bc69bc0c5925a0740ad068d06dcd1f12a7aad151` | MIT | `LICENSE`; `pyproject.toml` `license = {text = "MIT"}` | Yes | `Copyright (c) 2025 HKUDS`. SHA-256 `804ee173a7f604efd7d4932d94f1c7fdbac7f2f2770aa3007ecc7670ea76fd35` |
| `ClawTeam-gstack` `origin/gstack-integration` | `48c717f97cd2153f54db6d398828ca35bad58b6f` | MIT | Same `LICENSE`; package metadata unchanged | Yes | Same as main. Bundled `.agents/skills/frontend-design/LICENSE.txt` is Apache-2.0 and is a separate subcomponent |
| `mlx-sim` `main` | `a7d4e2b84e36e1601438b08e7a1d6c973e95e16a` | MIT (declared) | `README.md:3,127-129`; `pyproject.toml:10,16` | **No** | "mlx-sim contributors"; no copyright line |
| `OpenNova` `main` | `c7a3f465da52f1fa10f74e4e24d065c4a7b89d5e` | MIT | `LICENSE`; `setup.py` MIT classifier | Yes | `Copyright (c) 2025 manna_and_poem`. SHA-256 `79e3e521bf15d45421cdb731ed66ea66ff56c429e02a18a20e9f8958a3d1efcc` |
| `tailchat_by_chad` `master` | `591df5b895606e5fd2d166ca5b559d737c2ce32f` | Apache-2.0 root; mixed app licenses | Root `LICENSE`; manifests declare `Apache-2.0` | Yes | No root copyright line (Apache appendix is unparameterized). SHA-256 `2657adff2e827c622c2791db290a98d274e38021a6c1700f4dd19593e719a697` |
| `tailchat_by_chad` sub-apps | same | MIT / ISC / MIT | `apps/cli/LICENSE` MIT (MsgByte), `apps/github-app/LICENSE` ISC (moonrailgun), `client/desktop/LICENSE` MIT (electron-react-boilerplate) | Yes per app | These are separate subcomponents and were not copied |

### 2.1 Declared-MIT repositories without a root `LICENSE` file

`autoresearch` and `mlx-sim` both declare MIT in their README and project metadata but
do **not** ship the full MIT license text at the sampled commits. This is a provenance
gap, not a permission to ignore attribution:

- The declared license is recorded here and in `NOTICE.md`.
- No source code from either repository was copied into novix-open.
- Before any future code copy from these repositories, the full license text and
  copyright holder should be obtained from the upstream repository or the owners.
- The audit treats their protocol/contract material as reference-only unless and until
  that license file is captured.

### 2.2 Apache-2.0 sources

`agent-sandbox` and `tailchat_by_chad` are Apache-2.0. Relevant obligations if a
substantial portion is ever copied or modified:

1. Provide a copy of the Apache License 2.0 to recipients.
2. Retain all copyright, patent, trademark, and attribution notices from the source.
3. State significant changes made to the copied files.
4. If the upstream tree contains a `NOTICE` file, retain its attribution notices.
   Neither sampled repository has a root `NOTICE` file.
5. Preserve the patent grant and any defensive termination terms.
6. Do not use upstream trademarks as a product brand. No Novix, Kubernetes, Tailchat,
   or MoChat logos/brand assets are copied.

### 2.3 MIT sources

`ClawTeam-gstack` and `OpenNova` ship the MIT license. `autoresearch` and `mlx-sim`
declare MIT. If a substantial portion is copied, the standard MIT permission notice
must be included:

```text
MIT License

Copyright (c) <year> <copyright holders>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

For `ClawTeam-gstack` the holder is `Copyright (c) 2025 HKUDS`; for `OpenNova` it is
`Copyright (c) 2025 manna_and_poem`. For `autoresearch` and `mlx-sim`, the holder and
full text must be confirmed before copying.

### 2.4 ISC / mixed-license note

If any Tailchat `apps/github-app` code is ever copied, the ISC notice
(`Copyright (c) 2022, moonrailgun`) must be retained. If `apps/cli` or
`client/desktop` code is copied, their MIT notices must be retained. At this audit,
none of these subcomponents were copied.

---

## 3. Copied / adapted provenance by novix-open destination

Statuses now refer to the state recorded in the ledger at the audit snapshot.

| novix-open destination | Upstream evidence | Nature of use | Required attribution |
|---|---|---|---|
| `server/lib/sandbox-router.mjs` | `agent-sandbox@f64ec82` sandbox-router path-prefix/HTTP behavior, Apache-2.0 | Behavioral reimplementation: path parsing, header hygiene, target resolution, 302 Location rewrite, health semantics; no Python/FastAPI code copied | Attribute the Kubernetes Authors `agent-sandbox` project and Apache-2.0; state that the Node router is an independent reimplementation |
| `server/lib/open-nova-tools.mjs` | `OpenNova@c7a3f46` tool semantics, MIT | Behavioral reimplementation of tool descriptors/executors (PythonExecute, BrowserUse, StrReplaceEditor, FileSaver, Terminate); no Python code copied | Attribute OpenNova / OpenManus, `Copyright (c) 2025 manna_and_poem`, MIT |
| `server/lib/autoresearch-lab.mjs` | `autoresearch@29a5846` protocol, MIT declared; `mlx-sim@a7d4e2b` vectorized-env contract, MIT declared | Protocol/contract reimplementation with deterministic offline evaluator; no training code, tokenizer, or physics code copied | Attribute autoresearch (karpathy/autoresearch lineage) and mlx-sim contributors; record MIT declaration; resolve missing license-file gap before any code copy |
| `server/routes/autoresearch-lab.mjs` | same | API wrapper around the independent lab implementation | Same as above |
| `app/src/components/AutoResearchLab.vue` | same | Independent UI for keep/discard/crash results | Same as above |
| `server/lib/team-sprint.mjs` | `ClawTeam-gstack@48c717f` gstack 11-role/7-phase protocol, MIT | Behavioral reimplementation of roles, phases, ceo gate, envelope validation, evidence gates, tasks/mailbox | Attribute HKUDS ClawTeam, `Copyright (c) 2025 HKUDS`, MIT; note independent Node implementation and summarized prompts |
| `server/routes/team-sprint.mjs` | same | API wrapper | Same as above |
| `app/src/pages/TeamPage.vue`, `app/src/components/team/**` | ClawTeam team workflow + Tailchat IM presentation (MIT/Apache-2.0), reference only | Independent Vue implementation of team workspace/chat parts; no Tailchat source, plugin code, CSS, images, or `.pen` design file copied | Attribute Tailchat / MsgByte as a visual/interaction reference under Apache-2.0 if any protectable expression is reused; otherwise reference-only acknowledgement |
| `server/tests/parity-official-*.mjs` | all of the above | New tests, no upstream test code copied | Same attribution as the module under test |

No destination file is currently a verbatim upstream file. If that changes, add a
file-level header naming the upstream source, commit, license, copyright holder, and
a description of modifications.

---

## 4. Required notices

The following is the minimum notice set for the official-OSS absorption. The root
`NOTICE.md` has been updated with a concise version of this attribution.

### 4.1 `agent-sandbox` (Apache-2.0)

> Portions of the sandbox routing design are adapted from kubernetes-sigs/agent-sandbox
> (novix-science fork), commit f64ec82164b514269220767a8f0fe2206a7fd788, licensed under
> the Apache License, Version 2.0. Copyright 2025 The Kubernetes Authors. The Node
> implementation is an independent reimplementation; no upstream source file is copied.

### 4.2 `autoresearch` (MIT declared)

> The AutoResearch experiment protocol is adapted from autoresearch (karpathy/autoresearch
> lineage; novix-science fork), commit 29a5846ba40f25c24ce316c50fe99e376d1dff8f.
> The upstream repository declares the MIT License in its README; no root LICENSE file
> was present at that commit. The novix-open implementation is independent and does not
> include upstream training code or data.

### 4.3 `ClawTeam-gstack` (MIT)

> The team sprint protocol is adapted from HKUDS/ClawTeam (novix-science fork),
> commit 48c717f97cd2153f54db6d398828ca35bad58b6f, licensed under the MIT License.
> Copyright (c) 2025 HKUDS. The novix-open implementation is an independent Node
> reimplementation; upstream prompt text and Python runtime are not copied.

### 4.4 `mlx-sim` (MIT declared)

> The vectorized environment contract shape is referenced from mlx-sim, commit
> a7d4e2b84e36e1601438b08e7a1d6c973e95e16a. The upstream repository declares the MIT
> License in README/pyproject; no root LICENSE file was present at that commit. No
> physics, rendering, sensor, or Metal source is copied.

### 4.5 `OpenNova` (MIT)

> Tool semantics are adapted from OpenNova, commit c7a3f465da52f1fa10f74e4e24d065c4a7b89d5e,
> licensed under the MIT License. Copyright (c) 2025 manna_and_poem. The upstream agent
> framework and Python tool code are not copied.

### 4.6 `tailchat_by_chad` (Apache-2.0; reference only)

> Team chat presentation was informed by Tailchat / MoChat, commit
> 591df5b895606e5fd2d166ca5b559d737c2ce32f, licensed under the Apache License, Version
> 2.0. No Tailchat source, plugin, asset, or design file is included. Attribution is
> provided for architectural/UX reference.

### 4.7 Existing project notices

The root `NOTICE.md` already attributes the MIT-licensed `AI-Researcher` upstream and
the Vue/Vite dependencies and fonts. This absorption adds the official-OSS reference
block; it does not remove or weaken existing notices.

---

## 5. What is not copied

The following upstream material is explicitly **not** included in novix-open:

- **No source code** from `agent-sandbox` (Go controllers, CRDs, Python client,
  FastAPI router code, manifests).
- **No source code** from `autoresearch` (`train.py`, `prepare.py`, `program.md`,
  notebooks, plotting code, lockfile, progress image, results data).
- **No source code** from `ClawTeam-gstack` (Python team manager, harness, sprint,
  MCP server, prompts, schemas, skills, tests, `.planning` corpus, package assets).
- **No source code** from `mlx-sim` (C++/Metal physics, renderer, sensors, Python
  environments, distributed RL, contracts as files).
- **No source code** from `OpenNova` (agent framework, tools, sandbox daemon, prompts,
  MCP server, config).
- **No source code, plugin code, CSS, images, icons, `.pen` file, or brand assets**
  from `tailchat_by_chad`.
- **No upstream prompt bodies or rubric text** copied verbatim. Prompts are summarized
  by role, phase, required fields, and gate purpose.
- **No upstream datasets, model weights, experiment outputs, logos, screenshots, or
  marketing copy.**
- **No third-party dependencies** from the upstream repositories are added to the
  novix-open server; absorption modules are zero-dependency Node where stated.

Transitive dependencies of the upstream repositories (PyTorch, FastAPI, Docker SDK,
browser-use, React, Moleculer, etc.) are not inherited because the repositories are
not vendored. If a support executable from one of those ecosystems is invoked at
runtime, its own license and installation obligations apply to the operator.

---

## 6. Attribution hygiene checklist

Before merging any future official-OSS absorption change:

- [ ] Confirm the exact upstream commit and file path in the module header or doc.
- [ ] Confirm the upstream license at that commit; do not rely on the repository's
      current default branch.
- [ ] If a root `LICENSE`/`NOTICE` is absent (as with `autoresearch` and `mlx-sim`),
      record the declaration and do not copy code until the license text is captured.
- [ ] If copying Apache-2.0 source, retain notices, include the license, state changes,
      and check for a `NOTICE` file.
- [ ] If copying MIT/ISC source, include the copyright and permission notice in the
      distribution.
- [ ] Do not copy upstream prompt text, brand assets, or proprietary UI expression.
- [ ] Update `NOTICE.md` and this document in the same commit as the copy.
- [ ] Add or update tests that demonstrate the independent implementation.

---

## 7. Evidence commands

```bash
# License presence and type
for r in agent-sandbox autoresearch ClawTeam-gstack mlx-sim OpenNova tailchat_by_chad; do
  echo "== $r =="
  git -C /Users/cz/code/novix-science-org/$r ls-tree -r --name-only HEAD \
    | grep -iE '(^|/)(LICENSE|LICENCE|COPYING|NOTICE)(\.|/|$)'
done

# License declarations without a root file
git -C /Users/cz/code/novix-science-org/autoresearch grep -n 'MIT' HEAD -- README.md
git -C /Users/cz/code/novix-science-org/mlx-sim grep -n 'MIT' HEAD -- README.md pyproject.toml

# Notice text and hashes
git -C /Users/cz/code/novix-science-org/agent-sandbox show HEAD:LICENSE | shasum -a 256
git -C /Users/cz/code/novix-science-org/ClawTeam-gstack show HEAD:LICENSE | shasum -a 256
git -C /Users/cz/code/novix-science-org/OpenNova show HEAD:LICENSE | shasum -a 256
git -C /Users/cz/code/novix-science-org/tailchat_by_chad show HEAD:LICENSE | shasum -a 256
```
