# Sanqian Notes Web Clipper 设计文档

状态：草案 v2.1（2026-06-08，长期主义 review + 源码核实通过）
关联仓库：
- 扩展：`~/dev/sanqian-notes-clipper`（本仓库，全新）
- 桌面端：`~/dev/sanqian-notes`（Electron 笔记 app，需少量改动）
- 复用参考：`~/dev/sanqian-browser`（通讯层）、`~/dev/sanqian`（Go native host 模式）

## 0. 修订记录

- v1 → v2（长期主义 review）：
  1. 引入**处理器链（handler chain）**抽象，特殊场景不再硬编码 if-else（§7）。
  2. 明确特殊逻辑的归属原则——按"能力在谁手里"切成 capture-side（扩展）与 import-side（notes bridge）两类（§7.1）。
  3. 新增 arxiv 系列路由：识别在扩展、重活复用 notes 现成的 arxiv importer，经新 bridge 工具 `import_arxiv` 代理（§7.2）。
  4. PDF 提取单列为**待解决章节（挖坑）**，记录三个已知的雷（§7.3）。
  5. 新增提取库选型与质量评估，定 Defuddle 为主、Readability 兜底、Turndown 仅片段场景（§9）。
- v2 → v2.1（源码核实 + 决策补充）：
  1. 已逐文件核实 notes 集成点（bridge 鉴权/路由/端口文件、工具机制、create_note、saveAttachmentBuffer、arxivImporter 单例 + parseArxivInput），结论无偏，见 §14。
  2. 决策：arxiv 经 `import_arxiv` 失败时**退回 generic 剪藏**，兜底归属在扩展编排层（§7.2）。
  3. 决策：PDF 一期走 **C 方案**——识别到 PDF 即提示用户改用 notes 内置「导入 PDF」，不在 clipper 处理（§7.3）。

## 1. 目标与边界

### 目标
- 一个 Chrome/Edge MV3 扩展，把当前网页剪藏成 Sanqian Notes 的一篇笔记。
- 支持多种粒度：正文提取（Defuddle 提取文章主体）、选区剪藏、高亮/摘录。
- 对特定站点走更优路径（arxiv 系列复用 notes 自带 importer）。
- 图片下载到本地，落库为 `attachment://` 附件；下载失败时降级保留远程 URL，不阻断剪藏。
- 写入 frontmatter（来源 URL、剪藏时间、作者等元数据）。
- 剪藏落点：用户在扩展 popup 里从笔记本列表中选择。

### 非目标（一期不做）
- Firefox / Safari（仅 Chromium 系 MV3）。
- 整页快照（SingleFile 式）。后续可作为处理器链里的一个 handler 扩展。
- 剪藏到 local-folder 笔记本（当前 Quick Capture 也不支持写 local-folder，留待 NoteSource 1b 统一 create 路径后再说）。
- 离线队列 / app 未启动时缓存重试（一期：app 没起就由 host 拉起，失败则提示）。

### 待解决（已挖坑，后续单独立项）
- **PDF URL 提取**（§7.3）：importer 只吃本地文件、强依赖 TextIn 云服务、PDF 谁来下载，三个雷未解。

## 2. 关键设计决策（已与 owner 确认）

1. 给 notes 做**独立的新 native host**（id `com.sanqian-notes.native`），与 sanqian 的 `com.sanqian.native` 互不干扰。
2. **host 代理 HTTP**：浏览器扩展只说 Native Messaging，所有对 notes 本地 HTTP bridge 的调用发生在 host 进程内。好处：浏览器零 CORS、token 不进入浏览器环境。
3. 提取引擎用 **Defuddle**（Obsidian Web Clipper 同款，比 Mozilla Readability 更干净，且直接产出 Markdown）。Readability 仅兜底，Turndown 仅用于选区/片段场景。
4. **图片由扩展下载**（带页面 session/cookie，绕过防盗链/登录墙），再经 host 存入 notes 附件库。下载失败降级保留远程 URL。
5. notebook 由扩展 popup 选择，数据来自 notes 现成的 `get_notebooks` 工具。
6. **特殊场景用处理器链**：识别尽量轻放在扩展，重型 importer 复用 notes 主进程已有实现，不在扩展里重写。

## 3. 总体架构

```
┌─ Chrome/Edge MV3 扩展（本仓库）────────────────────────────┐
│  popup          : get_notebooks 渲染下拉 → 选落点/模式 → 触发剪藏
│  content script : 处理器链(§7) 决定路径；Defuddle 提正文 /
│                   getSelection 取选区 / 高亮采集 / 收集 img URL
│  service worker : 图片 fetch(带 cookie)；Native Messaging 客户端；编排
└──────────── chrome.runtime.connectNative('com.sanqian-notes.native') ──┘
                          │ Native Messaging（stdio，4 字节小端长度前缀 + JSON，单条 1MB 上限）
┌─ Go native host（新，随 notes app 分发）──────────────────┐
│  get_connection : 读 <userData>/runtime/mcp-api.json → {port, token}
│                   探活 GET /mcp/health；没起就拉起 notes app 并轮询
│  proxy_tool     : 进程内 POST /mcp/tool-call（Bearer token）
│                   转发 get_notebooks / save_attachment / create_note / import_arxiv
│  save_attachment_chunk : 大图分块接收后再代理
└──────────────────────────────────────────────────────────┘
                          │ HTTP 127.0.0.1（已存在，无需新建）
┌─ Sanqian Notes（Electron，~/dev/sanqian-notes）───────────┐
│  已有：MCP HTTP bridge + create_note(吃 markdown) + get_notebooks
│  已有但仅 IPC：arxivImporter / pdfImporter（需新开 bridge 工具才能外部触发）
│  新增 1：主进程自注册 NativeMessagingHosts manifest（照搬 sanqian）
│  新增 2：打包 Go host 二进制进 resources/
│  新增 3：bridge 暴露 save_attachment 工具（复用 saveAttachmentBuffer）
│  新增 4：bridge 暴露 import_arxiv 工具（代理 arxivImporter.import）
└──────────────────────────────────────────────────────────┘
```

## 4. notes 侧改动

### 4.1 Native Messaging host 注册
照搬 `~/dev/sanqian/src/main/native-messaging.ts` 的 `registerNativeMessagingHost()`：
- host id 改为 `com.sanqian-notes.native`；`allowed_origins` 填本扩展的 chrome-extension ID（开发态 + Web Store 态各一个）。
- manifest `path` 指向打包进 `resources/` 的平台二进制；开发态从 repo `resources/`、生产态从 `process.resourcesPath` 解析。
- 主进程 app ready 时注册；提供 `unregister` 供卸载清理。
- macOS Chrome 路径：`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.sanqian-notes.native.json`。

### 4.2 打包 Go 二进制
- `electron-builder.yml` 的 `extraResources`/`files` 带上 `resources/native-host-*`（darwin-arm64/amd64、win-amd64、linux-amd64）。

### 4.3 bridge 新增 `save_attachment` 工具
- 位置：`src/main/sanqian-sdk/tools/mutations.ts`，并加入 `NOTE_TOOL_NAMES`（`src/main/mcp/contracts/note-tools.ts`）。
- 入参：`{ data_base64, filename?, mime? }`（单块）或分块变体。
- 实现：`Buffer.from(base64)` → 已有 `saveAttachmentBuffer(buffer, ...)` → 返回 `{ relativePath, name }`，复用现成去重/命名/年月目录逻辑。
- 大小：Native Messaging 单条 1MB、HTTP body 当前 1MB 上限。一期单块 ≤ ~750KB 直传，超限走分块或降级远程 URL。

### 4.4 bridge 新增 `import_arxiv` 工具（见 §7.2）
- 位置：同上。入参：`{ id_or_url: string, notebook_id?: string }`。
- 实现（已核实可直接调）：`import { arxivImporter, parseArxivInput } from '../../import-export/arxiv'`；`parseArxivInput(id_or_url)` 权威判定，非 arxiv 抛错；调单例 `arxivImporter.import({ inputs:[id_or_url], notebookId, preferHtml:true })`；取 `result.results[0]`，有 `noteId` 返回 `{ id, title, source:'html'|'pdf' }`，否则抛出其 `error`（让扩展退回 generic）。
- 复用全部现成逻辑：metadata 抓取、ar5iv HTML 解析、figure 下载、HTML→PDF 兜底。**扩展侧零重写。**
- 注意：importer 自带的兜底链是 HTML→PDF（PDF 步依赖 TextIn 配置）；HTML 与 PDF 都失败时 importer 不产 noteId，此时由扩展退回 generic（§7.2）。

bridge router、create_note、get_notebooks 本身零改动。

## 5. Native Messaging 协议（host actions）

Chrome 标准帧（4 字节小端长度 + JSON）。host 单次连接处理一个 action 后退出（与 sanqian host 一致）。

| action | 请求 | 响应 |
|---|---|---|
| `get_connection` | `{action:'get_connection'}` | `{ok, port, token, version}` 或 `{error, code}` |
| `proxy_tool` | `{action:'proxy_tool', tool, args}` | `{ok, result}` 或 `{error, code}` |
| `save_attachment_chunk` | `{action:'save_attachment_chunk', transferId, seq, total, data_base64, filename, mime}` | `{ok, relativePath}`（末块返回） |
| `ping` | `{action:'ping'}` | `{ok, version, capabilities}` |

发现与鉴权：host 读 `<userData>/runtime/mcp-api.json`，探 `GET /mcp/health`；app 未起则拉起并轮询（超时 2 分钟）。token 仅在 host 进程内使用，不返回给浏览器。错误码沿用 sanqian host：`NOT_RUNNING`/`EXECUTABLE_NOT_FOUND`/`STARTUP_TIMEOUT`/`LAUNCH_FAILED`/`PERMISSION_DENIED`。

协议带 `version` 字段，后续新增 action 向后兼容；host `ping` 返回 `capabilities` 让扩展按能力降级。

## 6. 扩展结构（MV3）

```
src/
  content/
    handlers/         # 处理器链(§7)，每个站点/模式一个文件
      index.ts        # 注册表 + 有序匹配
      arxiv.ts        # 识别 arxiv → 委托 import_arxiv
      selection.ts    # 选区模式
      generic.ts      # 默认：Defuddle 提正文 + 收集 img
    highlight.ts      # 划重点交互（注入页面）
  background/
    service-worker.ts
    native.ts         # connectNative 客户端（抄 sanqian-browser native-messaging.ts，改 host id）
    clip.ts           # 编排：handler → 图片下载 → markdown 重写 → create_note / import_arxiv
    markdown.ts       # Defuddle markdown 后处理 + sanqian 扩展语法；选区片段走 Turndown
  popup/
    Popup.tsx         # 笔记本下拉 + 模式选择 + 剪藏按钮 + 结果提示
manifest.config.ts    # MV3：permissions: nativeMessaging, activeTab, scripting, storage
```

权限：`nativeMessaging`、`activeTab`、`scripting`、`storage`、`host_permissions: <all_urls>`（图片跨域 fetch 需要）。通讯层复用 `~/dev/sanqian-browser/.../native-messaging.ts` 的 `getConnectionViaNativeMessaging()`，仅改 `HOST_NAME` 和消息 action。

## 7. 特殊场景：处理器链

### 7.1 设计原则
特殊场景只增不减，必须可扩展。定义一个**有序处理器链**，泛化 HTML 提取是链尾的默认 handler：

```ts
interface ClipHandler {
  id: string
  // 轻量识别：能否处理当前页（看 URL / DOM 特征）
  match(ctx: { url: URL; mode: ClipMode; document: Document }): boolean
  // 产出统一 payload；两类产物之一
  run(ctx): Promise<ClipPayload>
}

type ClipPayload =
  | { kind: 'markdown'; title: string; markdown: string; images: ImgRef[]; frontmatter: Meta }   // 通用剪藏，走 create_note
  | { kind: 'delegate'; tool: 'import_arxiv'; args: Record<string, unknown> }                      // 委托 notes importer
```

按能力归属切两类：
- **capture-side（扩展内 run）**：依赖活 DOM / 页面 cookie——选区、高亮、带 cookie 下图、（后续）X 长推展开、YouTube 字幕。
- **import-side（委托 notes bridge）**：依赖 notes 已有重型 importer——arxiv、（待解决）PDF。扩展只识别 + 递交，**不在 JS 里重写解析**。

链的匹配顺序（前者优先）：`arxiv → (pdf, 待解决) → selection(用户选了选区) → generic`。

### 7.2 arxiv 系列（一期实现）
- **识别（扩展，轻量）**：URL host 命中 `arxiv.org / export.arxiv.org / ar5iv.labs.arxiv.org`，或路径含 `/abs//pdf//html/` 等。命中即产出 `{ kind:'delegate', tool:'import_arxiv', args:{ id_or_url: location.href, notebook_id } }`。识别只是路由提示。
- **权威判定 + 重活（notes，复用现成）**：bridge `import_arxiv` 服务端用 `parseArxivInput` 取规范 id（含旧式 `hep-th/9901001`、`arxiv:`、DOI `10.48550/arXiv.*` 等），调 `arxivImporter.import`：抓 metadata（标题/作者/摘要/分类/DOI）→ 优先 arxiv `/html/` 再退 ar5iv → LaTeXML 解析出 sections/figures/tables/references → 下载图片为附件 → 组装含元数据头的 markdown → 建笔记。HTML 失败再走 PDF 兜底（TextIn）。
- **落点**：沿用用户在 popup 选的 `notebook_id`（importer 的 `writeImportedNote` 支持 internal；local-folder 一期不涉及）。
- **注意**：此路径**不经过** clipper 自己的 frontmatter/图片管线（importer 自带），扩展拿到 `{noteId, title}` 直接提示成功即可，避免双重处理。
- **HTML 失败退回 generic（决策，扩展编排层）**：`import_arxiv` 抛错或无 noteId（即 ar5iv/HTML 解析失败、且 PDF 兜底因 TextIn 未配或失败）时，扩展不报死，而是对**同一个还在的页面 DOM** 改跑 generic handler（Defuddle 提正文）建普通笔记，并提示"arxiv 结构化导入失败，已按普通网页剪藏"。保证 arxiv 体验下限不低于普通网页。

### 7.3 PDF 提取（待解决，挖坑）
PDF URL 在学术/资料场景很常见，但 notes 现有 PDF importer 有三个未解的雷，先记录，后续单独立项：
1. **只吃本地文件**：`pdf:import` / `executeImport` 接收的是本地路径，**没有 URL 下载路径**（全仓库唯一 URL→PDF 下载在 arxiv 的 `fetchPdf` 里）。要么扩展下载字节、要么 host/notes 落临时文件。
2. **强依赖 TextIn 云服务**：PDF→Markdown 走 `https://api.textin.com/...`，需用户配置 `appId/secretCode`，否则抛 "PDF service not configured"。大量用户不会配。需要本地兜底（pdf.js 纯文本，质量低）或明确提示去配置。
3. **谁下载 + cookie**：付费墙/登录后的 PDF 需要浏览器 cookie，应由扩展下载字节；公开 PDF 可由 notes 服务端下载。需要一个能接收 PDF 字节并落临时文件再喂 `executeImport` 的新 bridge 工具（类似 `save_attachment` 的分块思路）。

**一期决策：走 C 方案。** 处理器链识别到 PDF（URL 以 `.pdf` 结尾或 `Content-Type: application/pdf`，且非 arxiv——arxiv 优先级在前已拦截）时，**不剪藏**，popup 提示用户改用 notes 内置的「导入 PDF」。成本最低，不引入未解的雷。后续单独立项时再评估 A/B。

后续备选（独立立项时评估）：
- A. 扩展下载 PDF 字节 → host 分块 → 新 bridge 工具 `import_pdf_bytes` 落临时文件 → `executeImport`。复用 TextIn，质量最好但依赖云服务配置。
- B. 扩展本地用 pdf.js 抽纯文本 + 截图 → 当普通 markdown 剪藏。无需云服务，质量差、无版面。
- C.（一期采用）暂不处理 PDF，遇到 PDF URL 提示用户走 notes 内的「导入 PDF」。

### 7.4 后续可加的 handler（占位）
YouTube（字幕/transcript）、X/Twitter（长推串展开）、GitHub（README/代码）、微信公众号（防盗链图）。均以新 `ClipHandler` 插入链中，不改主流程。

## 8. 剪藏流水线（generic 路径）

1. popup 触发 → 处理器链选中 handler。若为 `delegate`（如 arxiv）→ 直接经 host 调对应 bridge 工具，结束。
2. generic：content script 用 `new Defuddle(document)` 取正文（Markdown）+ 元数据 + 所有 img 真实 src；选区模式取 `getSelection` 片段。
3. service worker 对每个 img `fetch`（`credentials:'include'`，带页面 cookie）：
   - 成功 → host `save_attachment` 存库 → 拿 `attachment://relativePath` → 重写 markdown 该 img src。
   - 失败（CORS/403/超时）→ 保留原远程 URL，记入"未下载列表"。
4. markdown 后处理：补 sanqian 扩展语法（`$...$`、`$$...$$`、`==高亮==`、`++下划线++`）；选区片段用 Turndown+gfm 转。
5. 拼 frontmatter（§9 之外，见下 §10）。
6. host `proxy_tool` → `create_note({ title, content, notebook_id })`。
7. popup 反馈成功；有图未下载则提示"N 张图保留为远程链接"。

## 9. 提取库选型与质量评估

| 库 | 角色 | 维护质量（2026-06 查证） | 结论 |
|---|---|---|---|
| **Defuddle**（kepano/Obsidian） | 主提取引擎 | 活跃，2026-03 已到 0.14；多趟检测可在初次失败时恢复；专治 MathJax/KaTeX 公式、带高亮代码块、嵌套脚注、X/ChatGPT 等 JS 渲染内容；直接产出 Markdown | **主选**。与 sanqian 公式重的笔记对味；产 markdown 省掉大半 Turndown 工作。风险：相对年轻、社区小，但它正是 Obsidian Web Clipper 在用、最久经考验的 clipper 实现 |
| Mozilla Readability | 兜底提取 | Mozilla 仍更新，但启发式路子被公认过时，对现代站点掉链子 | 仅作 Defuddle 失败兜底 |
| **Turndown** + turndown-plugin-gfm | 片段 HTML→MD | 事实标准，浏览器+node 可用、可插件化；维护偏慢但稳定 | 仅用于**选区/片段**场景（手里是 HTML 片段、非整页） |
| rehype-remark（unified） | 备选片段转换 | 活跃，AST 管线更严谨 | 复杂结构若 Turndown 出问题时再评估；偏 node、较重，一期不引入 |

Defuddle 在 MV3 content script 内对**活的渲染后 DOM** 运行，天然处理 SPA；另有 `defuddle/node`（linkedom）供服务端，本项目用不到。

## 10. Frontmatter 规范（generic 路径）

create_note 的 markdown→tiptap 支持 frontmatter 节点。默认写入：

```yaml
---
title: <页面标题>
source: <页面 URL>
author: <Defuddle 提取的作者，可空>
published: <原文发布时间，可空>
clipped: <剪藏时间 ISO8601>
clipper: sanqian-notes-clipper/<version>
tags: [clipped]
---
```

标题来源优先级：`og:title` → `document.title` → 正文首个 `h1`。arxiv 委托路径的 frontmatter/元数据由 importer 负责，不在此处。

## 11. 安全

- `allowed_origins` 锁定具体扩展 ID（Chrome 不允许通配），仅本扩展能拉起 host。
- token 仅在 host 进程内用于 Bearer 鉴权，不进入浏览器；host 绑定 `127.0.0.1`。
- 附件写入复用 notes 现成 `saveAttachmentBuffer`，路径受控、无穿越风险。
- 图片/PDF 字节 fetch 在扩展内进行，host 不主动 fetch 任意外部 URL（arxiv importer 的服务端抓取是 notes 既有行为，限于 arxiv/ar5iv 域名），不引入额外 SSRF 面。

## 12. 里程碑

- [x] M0 打通最小链路：popup 按钮 → host get_connection → create_note。已实测建出笔记。
- [x] M1 generic 提取（Defuddle）+ markdown + frontmatter（图片留远程 URL，notes 打开时本地化）。已端到端验证内容形态。
- [x] M2 notebook 选择器（get_notebooks）+ 记住上次选择。
- [x] M4 处理器链 + arxiv 识别 + 降级（`import_arxiv` 缺失时回退 generic）。扩展侧完成；bridge 工具待 notes 侧。
- [x] M5 选区模式（Turndown+gfm）。高亮采集 UX 为后续子任务。
- [ ] M3 图片本地化（扩展下载 + `save_attachment` + 分块 + 失败降级）。**降为后续增强**：notes 打开时已自动本地化远程图（RemoteImagePaste），非阻塞。
- [ ] M6 打包分发：notes app 自注册 host、二进制随包、扩展提交 Web Store。
- 待解决（独立立项）：PDF URL 提取（§7.3，一期走 C 方案：识别到 PDF 提示用户用 notes 内置导入）。

### notes 侧待办（在独立 worktree `~/dev/sanqian-notes-clipper-bridge`，分支 feat/clipper-bridge-tools，基于 main）

1. [x] bridge 暴露 `save_attachment`（§4.3）— 点亮 M3 剪藏时下载图片。已加（mutations.ts + NOTE_TOOL_NAMES/ANNOTATIONS + buildNoteTools），含 parity/http-adapter 测试。
2. [x] bridge 暴露 `import_arxiv`（§4.4）— 点亮 arxiv 结构化导入。已加（薄封装 arxivImporter.import + parseArxivInput 权威判定）。
3. [x] 主进程自注册 NativeMessagingHosts manifest + 打包 Go 二进制（§4.1/4.2）。已加 `src/main/native-messaging.ts`（仅 app.isPackaged 生产态注册，dev 用 install 脚本避免覆盖）、electron-builder 打包 `resources/native-host/`（二进制 gitignore，从 clipper build.sh 构建拷入）。扩展 ID 为占位常量 + 环境变量覆盖，发布前填 Web Store id。

1/2 的 sdk+mcp 测试 240 全过、tsc 0 错。扩展侧已对 1/2 做优雅降级，工具上线即自动生效，无需改扩展。
注意：worktree 软链了主 checkout 的 node_modules，直接 new Database() 的 DB 原生测试因 better-sqlite3 ABI(145 vs 115) 失败 11 个——环境产物非回归，独立 npm install 后可绿。

## 13. 风险

- HTTP bridge / Native Messaging body 1MB 上限：大图、PDF 字节需分块。
- 扩展 ID 与 notes `allowed_origins` 硬耦合：开发态固定 key 取稳定 ID，生产态用 Web Store ID，两者都进 allowlist。
- Defuddle 对部分站点（强 SPA、付费墙）提取质量；保留选区模式兜底。
- create_note / arxiv importer 一期仅落 internal 笔记本。
- arxiv importer 的 PDF 兜底与 PDF 提取同样受 TextIn 配置约束。

## 14. 源码核实记录（2026-06-08，逐文件确认）

落地前已对 notes 真实源码逐一核实，结论与设计一致：

- **Bridge**（`src/main/mcp/http-api/router.ts`、`shared/constants.ts`、`shared/port-discovery.ts`）：
  - 鉴权 `Authorization: Bearer <token>`，需与启动 token 全等，否则 401。
  - 路由 `GET /mcp/health`、`POST /mcp/tool-call`，body `{ tool, args }`，成功 `{ ok:true, result }`、失败 `{ ok:false, error:{code,message} }`。
  - body 上限 `MCP_HTTP_MAX_BODY_BYTES = 1MB`；绑 `127.0.0.1`。
  - 发现文件 `<userData>/runtime/mcp-api.json`，schema `{ port, token, pid, startedAt }`；`readLiveMcpPortFile` 用 `process.kill(pid,0)` 探活。host 照抄此发现逻辑。
- **工具机制**（`src/main/mcp/contracts/note-tools.ts`）：router 只派发 `pickNoteTools` 选出的工具——新工具必须 ① 是 `AppToolDefinition {name,description,parameters,handler}` ② name 进 `NOTE_TOOL_NAMES` ③ 注册进 `buildTools`（`src/main/sanqian-sdk/tools/index.ts`） ④ 在 `NOTE_TOOL_ANNOTATIONS` 补一项。
- **create_note**（`tools/mutations.ts:198`）：`required:['title']`，`content` 为 markdown；internal 走 `markdownToTiptapString(content)`→`addNote`，返回 `{ id, title, source_type, revision, etag }`。
- **save_attachment 依赖**（`attachment.ts:461`）：`saveAttachmentBuffer(buffer, ext, originalName?, options?) → { relativePath, fullPath, name, size, type }`；笔记内引用写 `attachment://${relativePath}`。
- **arxiv**（`import-export/arxiv/index.ts`、`arxiv-importer.ts:77`、`types.ts`）：`arxivImporter` 为导出单例、`parseArxivInput` 由 barrel 导出；`import({ inputs:string[], notebookId?, preferHtml? }) → { success, imported, failed, results:[{ noteId?, title?, error?, source:'html'|'pdf' }] }`；内部 HTML→PDF 兜底，PDF 步依赖 TextIn。
- **未变更**：bridge router / create_note / get_notebooks 零改动；notes 侧仅 §4 的 4 处新增。

## 15. 媒体本地化：工程债与架构决策（robustness review 2026-06-08）

剪藏时下载所有图片/视频本地化为 `attachment://`（notes 不在 create_note 路径本地化远程图）。一轮长期主义复核，逐条核实标记项、属实者已修：

**已核实属实并修复：**
- 图片 URL 含 `)` 被正则截断（维基百科式 `Foo_(bar).png`）—— `IMAGE_RE` 改为支持 `<url>` 尖括号、平衡单层括号、可选 `"title"`，已单测覆盖。
- 串行本地化慢 —— 改为 `mapPool` 有界并发（默认 5）+「并行计算替换、再统一应用」（顺带消除 `result.replace` 的顺序竞态）。
- 单块失败即整张丢、无重试 —— `uploadBinary` 每块重试（块写入服务端幂等）。
- markdown `<video>` 块级扩展误伤散文（句中 `<video>` 提及会把段落劈碎）—— 去掉 marked 扩展的 `start()`（只在块边界触发）+ 要求有 `src` 才识别；已单测覆盖（`media-tag.test.ts`）。
- `String.replace` 的 `$` 注入（alt 含 `$&` 等损坏输出）—— 全改函数替换。
- 分块累积无上限 —— `MAX_CHUNK_TRANSFER_PARTS=256` 封顶 + saveAttachmentBuffer 100MB 终检；中断传输首块时清理残留。

**核实后修正/保留（非疏忽）：**
- 内存「~2x」是我先前的误述，实为**每项 ~1x**（持有 bytes，base64 按块瞬时生成）；并发下峰值 ≈ 并发数 × 最大在飞项。图片小、视频罕见，峰值可控，保留并发=5。
- `save_attachment`（单发）非死代码 —— 它是 bridge 暴露的通用单发附件工具，任何 MCP 客户端可用；扩展统一走 chunk（chunk 单块等价单发，无额外收益），故 save_attachment 有意保留作通用 API。

**架构决策（ADR）：分块走 bridge-tool vs 新开二进制流式上传端点**
- 决策：复用现有 tool/proxy 契约做分块上传，**不**为媒体新开独立的二进制流式 HTTP 端点。
- 理由：剪藏的媒体是偶发图片 + 少量视频；分块方案零新增对外面、零 host 改动（host 的 `proxy_tool` 原样转发），契约稳定。流式端点是更优解但属过度设计（YAGNI）。
- 触发条件（何时重评）：若视频成为高频/大体量场景（如批量视频剪藏），分块的多次 base64 编解码 + 临时文件拼接 + 多轮往返成本会显著，届时改为流式上传端点（host 直传二进制 body 给一个非 tool 路由）。在此之前维持现状。
- 已知残留债（量级可接受，未修，明确标记）：并发下多个大视频同时在飞的峰值内存；分块"拼接前落临时文件"的双倍磁盘 churn。
