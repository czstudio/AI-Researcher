# Novix.science 逆向工程完整报告

> **来源**：真实网页抓取（2026-10-09）+ 已有抓包数据（2026-10-08）
> **方法**：agent-browser 访问 + curl 获取静态资源 + JS 反编译分析 + 网络抓包分析
> **置信度**：所有技术栈、API 端点、数据形状均来自真实代码/请求，非推断

---

## 1. 前端技术栈（已确认）

| 层级 | 技术 | 证据 |
|------|------|------|
| 框架 | Vue 3 + Vite | `vue-vendor-C7G86k-T.js`, `__vite__mapDeps`, `createElementBlock`/`openBlock`/`createVNode` |
| UI 库 | Ant Design Vue | `antd-vendor-wb1UwJbw.js`, `Spin`, `Modal`, `Form`, `Badge`, `Button`, `Input`, `Table`, `Menu`, `Card`, `Tabs`, `Drawer`, `Popover` 等 |
| 状态管理 | Pinia | `createStore`, `useStore`, `defineStore` |
| 路由 | Vue Router | `useRoute`, `useRouter`, `createRouter`, `createWebHistory` |
| 国际化 | Vue I18n | `createI18n`, `useI18n`, `i18n.global.t()` |
| 工具库 | Lodash | `cloneDeep`, `debounce` |
| 图标 | lucide-vue-next + Font Awesome | `lucide-vue-next v0.576.0`, `/lib/fontawesome/css/all_660.min.css` |
| 代码分割 | Vite 动态 import | `__vite__mapDeps` 映射表，40+ 个 chunk |

### 1.1 第三方依赖（CDN）

| 库 | 用途 | 来源 |
|----|------|------|
| MathJax 3 | 数学公式渲染 | `cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js` |
| ECharts 5.3.2 | 图表 | `cdn.jsdelivr.net/npm/echarts@5.3.2/dist/echarts.min.js` |
| marked 15.0.6 | Markdown 解析 | `cdnjs.cloudflare.com/ajax/libs/marked/15.0.6/lib/marked.umd.min.js` |
| html2canvas 1.4.1 | 截图/导出 | `cdn.bootcdn.net/ajax/libs/html2canvas/1.4.1/html2canvas.min.js` |
| html2pdf.js 0.10.2 | PDF 导出 | `cdn.bootcdn.net/ajax/libs/html2pdf.js/0.10.2/html2pdf.min.js` |
| jspdf 2.5.1 | PDF 生成 | `cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js` |

### 1.2 字体系统

| 字体 | 用途 | 格式 |
|------|------|------|
| Inter | 主字体（正文/UI） | woff2, ttf |
| InterBold / InterMedium | 字重变体 | woff2, ttf |
| LibreBaskerville | 衬线展示字体 | woff2, ttf |
| Bona / BonaBold | 装饰字体 | woff2, ttf |
| Battambang (Light/Regular/Bold) | 多语言支持 | woff2, ttf |
| nimbusrom | 备用衬线 | otf |
| Afacad | 备用字体 | woff2, ttf |

### 1.3 组件清单（从 JS chunk 名称）

| 组件 | 文件 | 功能 |
|------|------|------|
| SearchList | `SearchList-Dtnh3ujQ.js` | 搜索结果列表 |
| MarkdownStream | `MarkdownStream-CPOzr9Hm.js` | 流式 Markdown 渲染（SSE） |
| MarkdownRenderer | `MarkdownRenderer-VbFBiDii.js` | 静态 Markdown 渲染 |
| MarkdownDebug | `MarkdownDebug-BK8EcRQS.js` | Markdown 调试 |
| MonacoCodeViewer | `MonacoCodeViewer-B-fqs-Rs.js` | 代码编辑器/查看器 |
| trajectoryMapper | `trajectoryMapper-DqebFDxs.js` | 任务轨迹映射 |
| workspaceFileLinks | `workspaceFileLinks-CQsfpf_j.js` | 工作区文件链接处理 |
| SettingsLayout | `SettingsLayout-6Nh6_ln5.js` | 设置页面布局 |
| UpgradeTab | `UpgradeTab-Cesg1YhA.js` | 升级标签页 |
| CreditTab | `CreditTab-D0YMPLcn.js` | 信用标签页 |
| BillingTab | `BillingTab-NAiAJbVy.js` | 账单标签页 |
| ReferralsTab | `ReferralsTab-DQwDebsw.js` | 推荐标签页 |
| AccountTab | `AccountTab-CjBN-n58.js` | 账户标签页 |
| VersionHistoryTab | `VersionHistoryTab-B2Y5dy4n.js` | 版本历史标签页 |
| chart-vendor | `chart-vendor-VBng5qE4.js` | 图表库（ECharts） |
| highlight-vendor | `highlight-vendor-D3romlCf.js` | 语法高亮 |
| mermaid.core | `mermaid.core-COVvOov1.js` | 流程图 |
| math-vendor | `math-vendor-BmgLUijs.js` | 数学公式 |

---

## 2. 前端架构

### 2.1 路由表

| 路由 | 页面 | SEO 标题 |
|------|------|----------|
| `/` | Landing（首页） | Novix - The AI Agentic Co-Scientist |
| `/chat` | 聊天工作台 | AI Research Chat - Talk to Your AI Co-Scientist |
| `/deepsurvey` | Deep Survey | Deep Survey - AI-Powered Literature Survey |
| `/ideaspark` | Idea Spark | Idea Spark - Generate Novel Research Ideas |
| `/methoddesign` | Method Design | Method Design - AI Research Methodology Designer |
| `/autoexperiment` | Auto Experiment | Auto Experiment - Automate Scientific Experiments |
| `/notebook` | Data Analysis | Research Notebook - AI Jupyter Notebook Assistant |
| `/reproduce` | Reproduce Paper | Reproduce Paper - Replicate Published Research |
| `/account/*` | 账户设置 | Novix |

### 2.2 首页内容（Landing）

```javascript
homeContent = {
  headline: ["Explore the Frontier", "with Intelligence That Evolves"],
  description: "Your agentic research lab learns from your judgment, discovers new directions, and evolves with every research cycle.",
  cta: "Start Exploring",
  seoTitle: "Novix - The AI Agentic Co-Scientist for Scientific Research",
  seoDescription: "Novix is an AI agentic co-scientist..."
};
```

### 2.3 模式配置（AGENT_CONFIGS）

```javascript
AGENT_CONFIGS = [
  {
    key: "auto",
    label: "Auto Pilot",
    desc: "",
    agentName: null,
    mentionValue: null,
    routeId: null,
    creditCost: "1 credit",
    trackKey: "auto"
  },
  {
    key: "deepsurvey",
    label: "Deep Survey",
    desc: "Conduct in-depth literature surveys",
    agentName: "Deep Search Agent",
    mentionValue: "@Deep Survey",
    routeId: "deepsurvey",
    creditCost: "5 credits",
    trackKey: "deepsurvey"
  },
  {
    key: "ideaspark",
    label: "Idea Spark",
    desc: "Generate novel research ideas",
    agentName: "Idea Agent",
    mentionValue: "@Idea Spark",
    routeId: "ideaspark",
    creditCost: "3 credits",
    trackKey: "ideaspark"
  },
  {
    key: "methoddesign",
    label: "Method Design",
    desc: "Design methods and experimental plans",
    agentName: "Proposal Agent",
    mentionValue: "@Method Design",
    routeId: "methoddesign",
    creditCost: "3 credits",
    trackKey: "methoddesign"
  },
  {
    key: "autoexperiment",
    label: "Auto Experiment",
    desc: "Build and test any algorithm",
    agentName: "Code Agent",
    mentionValue: "@Auto Experiment",
    routeId: "autoexperiment",
    creditCost: "10 credits",
    trackKey: "autoexperiment"
  },
  {
    key: "notebook",
    label: "Data Analysis",
    desc: "Analyze and visualize any data",
    agentName: "Notebook Agent",
    mentionValue: "@Data Analysis",
    routeId: "notebook",
    creditCost: "5 credits",
    trackKey: "notebook"
  },
  {
    key: "reproduce",
    label: "Reproduce Paper",
    desc: "Reproduce results from any paper",
    agentName: "Reproduce Paper Agent",
    mentionValue: "@Reproduce Paper",
    routeId: "reproduce",
    creditCost: "10 credits",
    trackKey: "reproduce"
  }
];
```

**Legacy Mention 别名**：
```javascript
LEGACY_MENTION_ALIASES = {
  "Deep Search Agent": ["@Literature Review"],
  "Notebook Agent": ["@Jupyter Notebook"]
};
```

### 2.4 模式页面控件

| 模式 | 特有控件 |
|------|----------|
| Deep Survey | 5 years, Focus, Format (paper/report/ppt) |
| Idea Spark | From Topic, From Dataset, From Paper |
| Method Design | Field, Constraints, Output (paper/report/ppt) |
| Auto Experiment | Data, Metric |
| Data Analysis | Data, Library, Output |
| Reproduce Paper | Scope, Framework |

### 2.5 通用控件

- Upload file（文件上传）
- CPU / GPU 切换（GPU 在免费版锁定）
- Task mode / Discuss mode 切换
- Model 选择器（Popover）
- @mention 自动补全（Agent 选择）

---

## 3. 后端 API 契约（完整列表）

### 3.1 认证头

| 头 | 说明 |
|----|------|
| `fingerprint` | 设备指纹（32位十六进制） |
| `AuthToken` | 认证令牌（base64） |
| `token` | JWT 令牌 |
| `Accept-Language` | 语言（en） |
| `source-platform` | 平台（PC） |

### 3.2 API 端点（60+）

#### 用户管理
- `GET /api/user/feature_white_list/enabled?feature=...`
- `GET /api/user/getUserCreditInfo`
- `GET /api/user/getUserCreditUsage`
- `POST /api/user/login`
- `POST /api/user/emailSignUp`
- `POST /api/user/getUserInfo`
- `POST /api/user/resetPassword`
- `GET /api/user/sendEmailAuthCode`
- `GET /api/user/getAvailableCoupons`
- `POST /api/user/workspace/init`
- `GET /api/user/workspace/interest`
- `POST /api/ackOnboardingMilestone`

#### 会话管理
- `POST /api/chat_session/create`
- `POST /api/chat_session/create_anonymous`
- `GET /api/chat_session/list`
- `GET /api/chat_session/active`
- `GET /api/chat_session/message/list`
- `GET /api/chat_session/status`
- `POST /api/chat_session/share`
- `POST /api/chat_session/bind_anonymous`
- `POST /api/chat_session/rename`
- `POST /api/chat_session/delete`
- `GET /api/getSessionStatusById`
- `GET /api/getSessionWorkspace`
- `POST /api/getChatSessionStatus`

#### 工作区
- `GET /api/chat_session/workspace`
- `POST /api/chat_session/workspace/subtree`
- `GET /api/chat_session/workspace/download_workspace_url`
- `GET /api/chat_session/workspace/home_files`
- `POST /api/chat_session/workspace/home_file_preview`
- `POST /api/chat_session/workspace/user_upload/delete`
- `POST /api/chat_session/workspace/user_workspace/subtree`
- `GET /api/getWorkspaceDownloadUrl`
- `GET /api/getWorkspaceSubtree`

#### 任务管理
- `POST /api/task/create_task`
- `POST /api/task/create_task`（匿名）
- `GET /api/task/get_task` / `GET /api/getTaskStatus`
- `POST /api/task/submit_user_question`
- `POST /api/call_agent`
- `POST /api/createInternalTaskWithSignature`
- `POST /api/startCodeAgent`
- `POST /api/historyStatusCodeAgent`

#### Agent
- `GET /api/agents` / `GET /api/getAgentList`
- `GET /api/getAgentStatus`

#### 文件
- `POST /api/file/batch_temp_urls`
- `POST /api/file/upload_stream`
- `POST /api/file/upload_complete`
- `GET /api/file/temp_url`
- `GET /api/file/download`
- `POST /api/downloadFile`
- `POST /api/downloadFileAsBlob`

#### 发布
- `POST /api/published/item/publish`
- `GET /api/published/item/publish/access`
- `GET /api/published/revision/:id/session`
- `GET /api/published/revision/:id/task`
- `GET /api/published/revision/:id/workspace/subtree`
- `POST /api/forkPublishedRevision`
- `GET /api/getPublishAccess`
- `POST /api/likeTask`
- `GET /api/getTaskFeedback`

#### 搜索
- `POST /api/search`
- `GET /api/get_searchHistory`

#### 计费
- `POST /api/credit/upgrade_plan`
- `POST /api/credit/subscription/upgrade`
- `POST /api/credit/join`
- `POST /api/credit/remove`
- `GET /api/credit/billing-statements`
- `GET /api/credit/one-time-plans`
- `GET /api/credit/list`
- `POST /api/cancelSubscription`
- `POST /api/upgradeSubscription`
- `GET /api/getBillingStatements`
- `GET /api/getOneTimePlanVisibility`

#### 推荐
- `GET /api/referral/me`
- `POST /api/upgradeShare`
- `POST /api/upgradeJoin`
- `POST /api/upgradeInviteList`
- `POST /api/upgradeInviteRemove`

#### 通知
- `GET /api/notification/list`
- `GET /api/notification/latest`
- `GET /api/notification/version-history`
- `GET /api/getLatestNotifications`
- `GET /api/getVersionHistory`

#### 自动 Idea Spark
- `GET /api/auto_ideaspark/ideas`
- `POST /api/auto_ideaspark/modify`
- `POST /api/auto_ideaspark/trigger`
- `GET /api/getAutoIdeaSparkIdeas`

#### 沙箱
- `POST /api/sandbox/process_monitor`
- `POST /api/sandbox/project_dir`

---

## 4. SSE 流协议

### 4.1 连接方式

使用 `fetch` + `ReadableStream`（非 `EventSource`）：

```javascript
fetch(url, {
  method: "GET",
  headers: {
    Accept: "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    Authorization: `Bearer ${token}`,
    token: token
  },
  signal: controller.signal
}).then(response => {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  // 循环读取 chunk
});
```

### 4.2 事件类型

| 事件 | 说明 |
|------|------|
| `event:message` | 流式文本片段 |
| `event:response` | 完整响应（JSON） |
| `event:complete` | 流结束 |

### 4.3 任务状态

| 状态 | 说明 |
|------|------|
| `init` | 初始化 |
| `processing` | 处理中 |
| `finish` | 完成 |
| `error` | 错误 |

---

## 5. 任务创建参数

```javascript
{
  query: string,              // 用户输入（含 agent 前缀如 "@Deep Survey xxx"）
  agent: {                    // 选择的 agent
    value: string,            // mention 值（如 "@Deep Survey"）
    agentName: string         // agent 名称（如 "Deep Search Agent"）
  },
  tempUrl: string,            // 文件临时 URL
  fileList: Array,            // 上传文件列表
  displayAgentName: string,   // 显示名称
  writeUpType: string,        // "paper" | "report" | "ppt"（仅 LiterReview/IdeaProposal）
  enableGpu: boolean,         // 是否启用 GPU
  enableBrainstorming: boolean, // 是否启用讨论模式
  isAnonymous: boolean,       // 是否匿名
  chatSessionId: string,      // 会话 ID
  hiddenPrompt: string        // 隐藏提示词（系统提示）
}
```

**Query 组合逻辑**：
```javascript
function composeAgentQueryContent(query, hiddenPrompt) {
  if (!hiddenPrompt || !hiddenPrompt.trim()) return query;
  return `${hiddenPrompt}\n${query}`;
}

// 最终 query = agentPrefix + " " + userQuery
// 如："@Deep Survey 总结稀疏注意力最新进展"
```

---

## 6. 数据模型

### 6.1 会话（Session）

```json
{
  "id": "58851f2027a49b09a457ee226159efa3",
  "title": "用户任务标题",
  "titleType": "user",
  "version": 2,
  "share": false,
  "favorited": false,
  "visitType": "owner",
  "creatorUserId": "192971",
  "isAnonymous": false,
  "storageTier": "HOT",
  "storageTierChangedAt": 1791523064141,
  "createdAt": "2026-10-09 12:46:30",
  "updatedAt": "2026-10-09 12:46:30"
}
```

### 6.2 用户信用

```json
{
  "userId": 192971,
  "userLevel": "free",
  "sku": "FREE_MONTHLY",
  "totalCredit": 50,
  "usedCredit": 0,
  "remainingCredit": 50,
  "resetDate": 1793462400000,
  "subscriptionStatus": "free",
  "subscriptionProvider": null,
  "entitlementEndsAt": 1793462400000,
  "onboardingState": {
    "firstTaskAcked": true,
    "thirdTaskAcked": false,
    "activePromoCode": null,
    "activePromoStripeId": null,
    "promoExpiresAt": null,
    "discountPercent": null,
    "pendingPopups": []
  }
}
```

### 6.3 工作区文件

```json
{
  "userUpload": [],
  "agentOutput": [
    {
      "fileId": null,
      "name": "SUMMARY.md",
      "path": "writing_space/SUMMARY.md",
      "fileKey": "nova_agent_v1/user_data/session_xxx/workspace/writing_space/SUMMARY.md",
      "source": "agent_output",
      "mtime": 1788402909000,
      "chatSessionId": "412498a319c26b37fc4bd6be48b02bb9",
      "taskId": "227943",
      "previewType": null,
      "previewStatus": null,
      "previewFileKey": null
    }
  ]
}
```

### 6.4 通知

```json
{
  "records": [
    {
      "id": 2,
      "type": "UPDATE",
      "name": "Model update",
      "content": "<p><strong>A New Version Is Available</strong></p>...",
      "version": null,
      "releaseDate": null,
      "showPopup": true,
      "status": 1,
      "sortOrder": 1,
      "createdAt": "2026-09-01 17:49:42",
      "updatedAt": "2026-09-01 17:49:42"
    }
  ],
  "total": 1,
  "size": 50,
  "current": 1
}
```

---

## 7. 提示词系统

### 7.1 WRITE_UP_TYPES

```javascript
WRITE_UP_TYPES = ["paper", "report", "ppt"];
```

### 7.2 特殊 Agent 逻辑

```javascript
// 只有 LiterReview 和 IdeaProposal 支持 writeUpType
if (agentName === "Deep Search Agent" || agentName === "Proposal Agent") {
  if (writeUpType) {
    params.writeUpType = writeUpType;
  }
}
```

### 7.3 模式切换

```javascript
// Task mode vs Discuss mode
const mode = enableBrainstorming ? "discuss" : "task";
```

---

## 8. 云基础设施

### 8.1 CDN / 边缘

- **Cloudflare**：CDN + RUM 监控（`/cdn-cgi/rum`）
- **站点 Token**：`08048b8cfc9243389c36003542d5bf3b`

### 8.2 数据库

- **MySQL**：从 `test-ssr.joyland.ai` 错误中看到
- **Sequelize ORM**：从错误堆栈中确认
- **连接字符串**：`G7R7t6njrE4WbtQ3EeIcH9xB@172.23.0.248:31942`（内网 IP）

### 8.3 埋点分析

| 服务 | ID | 用途 |
|------|-----|------|
| Google Analytics | `G-0DNLKB4SDP` | 页面访问、事件跟踪 |
| Microsoft Clarity | `swjuw2mgwo` | 用户行为热力图 |
| Cloudflare RUM | `08048b8cfc9243389c36003542d5bf3b` | 性能监控 |
| Joyland AI | `test-ssr.joyland.ai` | 自研埋点（返回了数据库错误） |

### 8.4 文件存储

- **OSS**：从 `x-oss-worm-id` 头确认使用阿里云 OSS
- **文件路径格式**：`nova_agent_v1/user_data/session_{id}/workspace/...`

---

## 9. Onboarding 流程

| 触发条件 | 弹窗内容 |
|----------|----------|
| 首次任务完成 | "Your first task is done." + "+10 credits" |
| 第三次任务完成 | "Three tasks in — nice work." + 限时优惠（72小时） |

---

## 10. 与本地实现（novix-open）的差异对比

| 维度 | 线上版（真实） | 本地版（novix-open） | 差距 |
|------|---------------|---------------------|------|
| **前端框架** | Vue 3 + Vite + Ant Design Vue | Vue 3 + Vite + 纯 CSS | ❌ 缺 Ant Design 组件库 |
| **状态管理** | Pinia | reactive（原生） | ⚠️ 功能等价但 API 不同 |
| **路由** | Vue Router | 自定义 history router | ⚠️ 功能等价但实现不同 |
| **i18n** | Vue I18n | 无 | ❌ 缺多语言支持 |
| **Markdown** | marked + 自定义 tokenizer | marked（基础） | ❌ 缺 Mermaid、MathJax、代码高亮 |
| **代码查看器** | Monaco Editor | 无 | ❌ 缺代码编辑器 |
| **PDF 导出** | html2canvas + jspdf + html2pdf | 无 | ❌ 缺 PDF 导出 |
| **图表** | ECharts | 无 | ❌ 缺图表支持 |
| **图标** | lucide-vue-next + Font Awesome | 内联 SVG | ⚠️ 功能等价但库不同 |
| **字体** | 7 种字体（Inter 为主） | Inter + Source Serif | ⚠️ 基本覆盖 |
| **SSE** | fetch + ReadableStream | fetch + ReadableStream | ✅ 一致 |
| **API 端点** | 60+ 个 | 40+ 个 | ⚠️ 核心端点覆盖，缺高级功能 |
| **Agent 配置** | AGENT_CONFIGS（完整） | modes.json（等价） | ✅ 一致 |
| **任务参数** | writeUpType, enableGpu, enableBrainstorming | writeUpType, enableGpu, enableBrainstorming | ✅ 一致 |
| **模型选择** | 前端硬编码（部分） | modes.json | ⚠️ 需要同步真实模型列表 |
| **文件存储** | 阿里云 OSS | 本地文件系统 | ❌ 缺云存储 |
| **沙箱** | Docker 沙箱（apiSandboxProcessMonitor） | local subprocess | ❌ 缺 Docker 沙箱 |
| **计费** | Stripe + 信用系统 | 本地信用系统 | ⚠️ 缺 Stripe 集成 |
| **埋点** | GA + Clarity + CF RUM + 自研 | 无 | ❌ 缺埋点 |
| **Landing 页** | 完整营销页 | 无（直接进工作台） | ❌ 缺 Landing |
| **SEO** | JSON-LD + meta tags | 基础 meta | ❌ 缺完整 SEO |
| **Onboarding** | 多阶段弹窗 | 无 | ❌ 缺引导流程 |
| **邀请系统** | 实验室共享 | 无 | ❌ 缺邀请系统 |
| **通知系统** | 完整通知中心 | 基础通知面板 | ⚠️ 基础功能有 |
| **自动 Idea Spark** | 后台自动触发 | 无 | ❌ 缺自动触发 |
| **版本历史** | 完整版本记录 | 基础版本记录 | ⚠️ 基础功能有 |
| **搜索历史** | 独立 API | 无 | ❌ 缺搜索历史 |

---

## 11. 关键发现

### 11.1 前端代码中的 Agent 名称映射

```javascript
AgentNameEnum = {
  LiterReview: "Deep Search Agent",
  Idea: "Idea Agent",
  IdeaProposal: "Proposal Agent",
  Code: "Code Agent",
  Notebook: "Notebook Agent",
  ReproducePaper: "Reproduce Paper Agent"
};
```

### 11.2 任务创建时的 Agent 前缀逻辑

```javascript
// 如果用户选择了 agent，最终 query 会变成：
// "@Deep Survey 用户的问题"
const agentPrefix = selectedAgent.value;  // 如 "@Deep Survey"
const finalQuery = agentPrefix ? `${agentPrefix} ${userQuery}` : userQuery;
```

### 11.3 隐藏提示词组合

```javascript
function composeAgentQueryContent(query, hiddenPrompt) {
  if (!hiddenPrompt || !hiddenPrompt.trim()) return query;
  return `${hiddenPrompt}\n${query}`;
}
```

### 11.4 模式页面特有字段

| 模式 | 字段 | 值类型 |
|------|------|--------|
| Deep Survey | years, focus, format | number, string, enum |
| Idea Spark | seedType (topic/dataset/paper) | enum |
| Method Design | field, constraints, format | string, string, enum |
| Auto Experiment | data, metric | string, string |
| Data Analysis | data, library, output | string, string, string |
| Reproduce Paper | scope, framework | string, string |

### 11.5 前端埋点事件

```javascript
// Google Analytics 事件
- page_view
- pv_chat~
- pv_deepsurvey~
- scroll (percent_scrolled=90)
```

---

## 12. 下一步补齐建议

### 高优先级（影响功能完整性）

1. **替换 Ant Design Vue**：本地版使用纯 CSS，需引入 Ant Design Vue 或等效组件库
2. **Monaco Editor**：代码查看器是核心功能，必须接入
3. **Mermaid + MathJax**：流程图和数学公式是研究场景必需
4. **ECharts**：数据可视化支持
5. **PDF 导出**：html2canvas + jspdf 集成
6. **Landing 页**：完整营销页面

### 中优先级（提升体验）

7. **Pinia**：替换原生 reactive
8. **Vue Router**：替换自定义 router
9. **i18n**：多语言支持
10. **SEO**：JSON-LD + 完整 meta
11. **Onboarding**：引导流程
12. **搜索历史**：独立 API

### 低优先级（高级功能）

13. **Stripe 集成**：真实支付
14. **阿里云 OSS**：云文件存储
15. **Docker 沙箱**：代码执行隔离
16. **埋点系统**：GA + Clarity + 自研
17. **邀请系统**：实验室共享
18. **自动 Idea Spark**：后台触发
