# novix 线上版复现主控方案（2026-10-10 · 红黑对抗深挖轮）

> 目标：本地 novix-open（基于 AI-Researcher 内核的旧复刻）→ 对齐 **今日线上版** 全部可见功能的实际实现。
> 证据：[A] ego-browser 登录态实测（czstudio 账号，任务 245455/245459 全程）· [B] 生产 bundle 字节 · [C] 本仓源码。
> 原始证据文件：`clawsgo-open/work/noviprod-sync/novix/live/`（轨迹 JSON/交付物/请求捕获）。

---

## 一、逐项深挖结论（线上证据 → 本仓现状 → 差距 → 状态）

### 1. 模块实现内核 —— 已对齐 ✅（本轮实施）
- **线上 [A]**：单自治 agent（`NovixWriterAgent`）+ 标准 OpenAI tools 循环；工具面 `Skill/Read/Write/Bash/Glob/Grep/TaskCreate/TaskUpdate + mcp__paper_search__* + mcp__web_search__{google_search,url2text}`；skill 经 `Skill` 工具按名加载；Deep Survey 245455 跑满 114 步（TaskCreate 三段计划 → MCP 检索/全文 → 大纲/bib/证据表 → xelatex 画图 → 两轮 LaTeX 草稿 → export_pdf → pdfinfo 质检 → PDF 转 PNG 逐页自审）。
- **宿主形态 [A]**：fileKey 泄漏内部路径 `nova_agent_v1/user_data/session_<id>/workspace/...`，宿主用户 `novix`，技能目录 `.claude_data/skills/` + `bundled-skills/2.1.221/`（其 Claude Code 基座版本号）。
- **本仓 [C]**：原 executor 为固定阶段脚本（STAGE_NAMES + 每阶段 LLM）。**本轮已实装** `server/lib/agent-loop.mjs`：真工具循环（9 工具 schema、workspace 沙箱、路径越界防护、60 轮上限、abort），MCP 工具以 arxiv/crossref/semanticscholar 真检索 + url2text 实装；executor LLM 配置时走循环、否则回退阶段脚本；轨迹按线上格式落步（数字 id + trajectory 包装 + agent_name）。
- **待办**：`mcp__web_search__google_search`（当前只有 url2text；需接搜索 API）；技能库只有 3 枚重建桩（线上技能正文不可得，按行为重建）；`mcp__paper_search__get_paper_fulltext`（可接 arxiv 全文 PDF 解析）。

### 2. 流式对话执行方式 —— 已判明，差 Discuss 实捕 🟡
- **线上 [A]**：Task 模式 = `POST create_task` 后**前端 1–2 秒轮询 `GET get_task`**（全量 steps 返回，version 字段乐观并发）；chat_session 事件另有 `GET-SSE + Bearer 双头 + 空格分帧 + event:complete`（bundle @163356/163683 实证）——推断用于 **Discuss 模式**，本轮未在线捕获（创建会话即整页跳转清探针）。
- **本仓 [C]**：hub.mjs 进程内 pub/sub + SSE 已有；get_task 轮询语义同构。
- **待办**：用 ego-browser 在 Discuss 模式发消息抓一次真实 SSE 帧序；验证分帧/心跳/complete 哨兵。

### 3. 多用户隔离 —— 已判明 ✅
- **线上 [A]**：token 为 44B 服务端不透明串（非 JWT → 服务端会话表）；任务/会话带 `createdBy:192971`；无鉴权读他者任务 → `{code:"5100",message:"not your task"}`；工作区按 `session_<id>` 物理分目录；`feature_white_list` 按用户放行功能（实测 auto_discovery_manual_switch）。
- **本仓 [C]**：sessions 带 `creatorUserId`、匿名会话 bind、per-session workspace 目录——同构。
- **待办**：把 5100 语义显式化（现仓缺省 401/403，补 `{code:"5100"}` 形状）。

### 4. 并发运行 —— 已判明 ✅
- **线上 [A]**：同账号多任务并行（本轮 245455 processing 期间又创建 245459/第二个会话，均独立轮询）；套餐定并发/规格上限（04 号调研）；`enableBrainstorming` 独立开关。
- **本仓 [C]**：executor `running` Set 按 task.id 防重入；无全局并发上限。
- **待办**：按套餐加并发闸（free=1 / pro=2 / lab=N，数值待线上实测标定）。

### 5. CPU/GPU 运行 —— 契约已证，GPU 实跑待做 🟡
- **线上 [A]**：`create_task.enableGpu` 布尔（实测 false 路径）；会话级 `enableGpu` 持久于 session；UI CPU/GPU 切换实时；clawsgo 侧同款字段 + GPU 专属主机队列。
- **本仓 [C]**：`newTask` 有 `enableGpu` 字段、session 有开关，executor 未按 GPU 分队列。
- **待办**：`enableGpu:true` 时走 GPU 队列语义（本地可为标记 + 定价倍率）；实跑一次 GPU 任务标定价差。

### 6. 端到端论文生成 —— 全流水线已取证 ✅
- **线上 [A]**：完整 7 步流水线（§7.3 of clawsgo-open 文档）+ **交付物实体已全部收割**（113KB survey PDF / v2_draft.tex 18.8KB / references.bib / evidence_extraction.md / progress.md）。
- **本仓 [C]**：kernels.mjs 的 literature_review 有等价六阶段但为脚本式；本轮 agent-loop 让「自主流水线」成为可能——LLM 自主用工具复现该流水线。
- **待办**：用同一题目（attention sinks）在本地仓端到端跑一遍，对照线上 PDF 做质量 diff——这是「完全复刻」的最终验收。

### 7. 补全的本仓改动（本轮提交 39744d5）
- `server/lib/agent-loop.mjs`（新增，真实自治循环）
- `server/lib/executor.mjs`（双模执行：循环优先/脚本回退；线上格式轨迹）
- `contracts/modes.json`（+ `novix_proxy__gpt-6.1-sol/-fast`）
- `skills/{novix-ideaspark,literature-review,awaken}/SKILL.md`（行为重建桩）

## 二、线上 vs 本仓 全量对照表

| 维度 | 线上 [A] | 本仓 [C] | 状态 |
|---|---|---|---|
| 模式注册 | 7 模式 + 2 Soon；agentName 空/Idea Agent/Proposal Agent/ML Agent/Deep Search Agent/Reproduce Paper Agent | modes.json 9 条同名单 | ✅ |
| 模型供给 | `novix_proxy__gpt-6.1-sol`（实测）+ 多网关 | 多网关解析已有；+6.1 线 | ✅ |
| 任务协议 | create→get_task 轮询→finish | 同构 | ✅ |
| 轨迹格式 | `{type:'trajectory',content:"[{role...}]"}`，数字 id，version | 本轮对齐 | ✅ |
| 工具面 | 8 原生 + 5 MCP | 8 原生 + 4 MCP（google_search 待接） | 🟡 |
| 技能系统 | Skill 工具 + .claude_data/skills | Skill 工具 + skills/ 桩 ×3 | 🟡（正文重建） |
| 文件面 | subtree{targets} + /file/download + upload_stream | 同名路由已有 | ✅ |
| 隔离/并发 | createdBy/5100/物理分目录；并行任务 | 同构；并发闸待补 | 🟡 |
| CPU/GPU | enableGpu → GPU 队列 | 字段有、分队列待补 | 🟡 |
| 支付/积分 | getUserCreditInfo/套餐 | credit/* 路由已有 | ✅ |
| 桌面/VNC | —（novix 无此面） | — | ✅ |

## 三、与 idea2paper 最新版对照（吸收建议）

| novix/clawsgo 能力 | idea2paper 现状 | 建议 |
|---|---|---|
| 任务轨迹面（get_task 全量 trajectory steps + 数字 id 轮询） | execution-visibility P0 已有 live 页（PR#2856） | 轨迹持久化形状可对齐（steps 原始消息流可回放） |
| Skill 工具 + 技能目录（.claude_data/skills） | 已有 Agent skills 体系（本会话技能列表即证） | 把科研技能（literature-review 等 12 项清单）正式化入库 |
| MCP paper_search/web_search 工具面 | Paper-KG-Pipeline 有文献管线 | 包一层 MCP 语义暴露给 agent，命名对齐线上 |
| 论文式包装提示词 + LaTeX/PDF 出稿 + 页级自审 | LaTeX/PDF 交付层 + Evidence Guard 已有 | 「PDF→PNG 逐页自审」环节可吸收进 figure/渲染 QA（render_qa 已有雏形） |
| idea-tree.json 树式产出（treejson CLI + 四道门） | Idea Studio 三入口（r9 PROPOSE） | 四道检查门（novelty/gap/feasibility/references）可吸收为 Idea Studio 出口门 |
| CPU/GPU 队列 + 套餐并发 | GPU 独立队列已有 | 套餐并发闸映射已有计费层 |

## 四、剩余任务（按优先级）

1. **P0 端到端验收**：本地以同一题目跑 agent-loop → 产出 PDF → 与线上 113KB PDF 结构对比。
2. P1 Discuss 模式 SSE 实捕（ego-browser，方法已备）。
3. P1 `mcp__web_search__google_search` 接搜索后端；`get_paper_fulltext` 接 arxiv PDF→text。
4. P2 套餐并发闸 + GPU 队列定价；5100 错误形状。
5. P2 strix 对本仓复刻的持续巡扫（本轮已起扫 clawsgo-open 复刻，报告落地后归档）。
6. P3 Auto Experiment / Data Analysis / Reproduce Paper 三模式小成本实跑标定（模板/额度）。
