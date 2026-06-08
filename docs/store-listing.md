# Chrome Web Store listing — Sanqian Clipper

Paste-ready material for the Web Store dashboard, one section per form field.
Keep this in sync when re-submitting. Store item id: `laalgfbnbddjohobhaibbiafcjpkojef`.

## Product details

### Title (from package)
Sanqian Clipper

### Summary / Category
- Summary (en, ≤132): `Clip web pages, articles, selections, and arXiv papers straight into your local Sanqian Notes app.`
- Summary (zh): `将网页、文章、选区和 arXiv 论文一键剪藏到三千笔记。`
- Category: **Tools** (Chrome has no "Productivity"; Tools or Workflow & Planning fit).

### Description (English)
```
Sanqian Clipper saves what you're reading on the web straight into your own Sanqian Notes desktop app — as clean, editable Markdown. No cloud, no account: everything goes to the app running on your own computer.

WHAT YOU CAN CLIP
- Article: extracts the main content of a page into tidy Markdown, keeping the title, author, source URL, and date (and dropping the ads, nav, and clutter).
- Selection: clip just the text you've highlighted, with a link back to the source.
- arXiv: open an arXiv paper and import it as a structured note — abstract, sections, figures, and references.

BUILT FOR NOTES THAT LAST
- Images and videos are downloaded and stored locally in your notes, so clips don't break when the original page changes.
- Choose which notebook to save into, or drop it straight in your Inbox.
- Math, code blocks, lists, and tables are preserved.
- Interface available in English and Chinese.

PRIVATE BY DESIGN
The extension has no servers of its own. Clipped content is sent only to your local Sanqian Notes app over your computer's loopback connection. There is no analytics, no tracking, and nothing is sent to the developer or any third party.

REQUIREMENT
Sanqian Clipper works together with the Sanqian Notes desktop app, which provides the local connection the extension talks to. Install the desktop app, then clip from any page with one click.
```

### Description (Chinese)
```
三千剪藏把你正在看的网页内容，一键存进你自己的三千笔记桌面应用——干净、可编辑的 Markdown。无需云端、无需账号，所有内容都只发到你本机运行的应用里。

能剪什么
- 正文：自动提取页面主体内容，转成整洁的 Markdown，保留标题、作者、来源链接和日期，去掉广告、导航和杂物。
- 选区：只剪你选中的那段文字，并附带回原文的链接。
- arXiv：打开一篇 arXiv 论文，导入为结构化笔记——摘要、章节、配图、参考文献一应俱全。

为长期保存而做
- 图片和视频会被下载并存到你本地的笔记里，原网页改动或失效也不会让你的剪藏变成破图。
- 可以选择存进哪个笔记本，或直接丢进收集箱。
- 公式、代码块、列表、表格都完整保留。
- 界面支持中文和英文。

隐私优先
扩展没有任何自己的服务器。剪藏内容只通过本机回环连接发给你的三千笔记应用，没有任何统计、追踪，不会把数据发给开发者或任何第三方。

使用要求
三千剪藏需要配合三千笔记桌面应用使用（应用提供扩展所连接的本地通道）。装好桌面应用后，任意网页一键剪藏。
```

## Privacy practices

### Single purpose description
```
Sanqian Clipper saves web content — a full article, a text selection, or an arXiv paper — from the current page into the user's local Sanqian Notes desktop app as a Markdown note.
```

### Permission justifications (one box each)
- **nativeMessaging**
```
Sends the clipped content to the user's locally-installed Sanqian Notes desktop app through its native messaging host. This is the only channel used to deliver the clip to the local app; nothing is sent to any remote server.
```
- **activeTab**
```
When the user clicks the extension to clip, activeTab grants temporary access to the current tab so the extension can read its content (title, text, selection) for that single clip. It is not used to access tabs in the background.
```
- **scripting**
```
Injects a content script into the current tab, only when the user clicks to clip, to extract the page's main content or selection and convert it to Markdown. No script is injected unless the user initiates a clip.
```
- **storage**
```
Stores a single preference — the user's last-selected notebook — so the extension can default to it on the next clip. No other data is stored.
```
- **Host permission (`<all_urls>`)**
```
Users clip from arbitrary websites, so the extension needs access to any site to read the page being clipped, and to download that page's images and videos so they can be saved locally with the note. Access is exercised only when the user clicks to clip.
```

### Are you using remote code?
**No, I am not using remote code.** All code (including Defuddle/Turndown) is
bundled in the package; nothing is loaded or executed from a remote source.
Downloading images/videos is data, not code.

> Note: the `<all_urls>` host permission triggers an "in-depth review" warning.
> This is expected and acceptable — it's needed to clip any site and to download
> the clipped page's media for local storage (a background cross-origin fetch
> that activeTab cannot do). It lengthens review, it does not block it.

### Data usage
- "What user data do you plan to collect?" → check **Website content** only.
  (Do NOT check Web history — only the single clicked page is read, not browsing
  history; no PII, location, user activity, etc.)
- Certify all three disclosures (all true): no sell/transfer to third parties;
  no use for purposes unrelated to the single purpose; not for creditworthiness.
  Rationale: clipped content is sent only to the user's own local app, never
  off-device, never to a third party.

### Privacy policy URL
https://github.com/yushaw/sanqian-notes-clipper/blob/main/PRIVACY.md

### Support URL
https://github.com/yushaw/sanqian-notes-clipper/issues

## Assets (store-compliant copies in ~/Desktop/clipper-store)
- Icon 128×128 — `public/icon/128.png`.
- Screenshots (Global, ≥1; 1280×800, JPEG, no alpha):
  `01-clip-arxiv.jpg` (popup over an arXiv page), `02-clipped-result.jpg`
  (the structured clip open in Sanqian Notes).
- Small promo tile (optional, 440×280): `promo-tile-440x280.jpg`.
