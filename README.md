# Sanqian Notes Web Clipper

A Chrome/Edge (MV3) browser extension that clips web pages into [Sanqian
Notes](../sanqian-notes).

Design doc: [docs/design.md](docs/design.md).

## Architecture (short version)

```
Extension (MV3)  --Native Messaging-->  Go host  --HTTP 127.0.0.1-->  Sanqian Notes
  popup + bg                          com.sanqian-notes.native        MCP bridge (create_note)
```

The extension speaks only Native Messaging. The Go host holds the app's bridge
token (read from `<userData>/runtime/mcp-api.json`) and proxies tool calls to
the local MCP HTTP bridge. This keeps the token out of the browser and avoids
CORS entirely.

## Repo layout

- `native-host/` — Go native messaging host (`main.go`, `build.sh`).
- `entrypoints/` — WXT extension entrypoints (`background.ts`, `popup/`).
- `lib/` — shared client code (`native.ts`, `clip.ts`, `messages.ts`).
- `scripts/install-host-dev.sh` — dev-only host manifest installer.

## Development setup (M0)

Prereqs: Node 20+, Go 1.22+, a Chromium-based browser, and Sanqian Notes
running locally.

1. Install deps and build the extension:

   ```sh
   npm install
   npm run build      # outputs output/chrome-mv3
   ```

2. Build the native host:

   ```sh
   ./native-host/build.sh   # or: cd native-host && go build -o bin/native-host-darwin-arm64 .
   ```

3. Load the extension: open `chrome://extensions`, enable Developer mode,
   "Load unpacked" → select `output/chrome-mv3`. Copy the extension ID shown
   on the card.

4. Register the native host (uses that ID):

   ```sh
   ./scripts/install-host-dev.sh <extension-id>
   ```

5. Make sure Sanqian Notes is running, then click the toolbar icon and
   "Clip this page". A new note appears in the app.

To remove the host manifest:
`rm "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.sanqian-notes.native.json"`

## Testing the host without the browser

```sh
cd native-host && python3 test-host.py
```

This frames `ping` / `get_connection` / `create_note` requests over stdio and
prints the host's replies (requires Sanqian Notes running).

## Development log

### M0 — minimal link (2026-06-08)

End-to-end path proven: extension popup → native host → MCP bridge `create_note`
→ note created in Sanqian Notes.

- Go native host: stdio framing, one-shot dispatch, actions `get_connection`
  (availability probe, token withheld from browser), `proxy_tool` (forwards to
  `POST /mcp/tool-call` with the bridge Bearer token), `ping`. Locates the app
  across prod (`Sanqian Notes`) and dev (`sanqian-notes`) userData dirs plus a
  `SANQIAN_NOTES_USER_DATA` override; verifies liveness via `/mcp/health`.
- WXT + React extension: popup with connection status + "Clip this page"
  (title + URL + current selection → minimal frontmatter note), background
  service worker hosting the native client.
- Verified: `test-host.py` created a real note via the live bridge; `tsc`
  clean; `wxt build` clean. Notes side untouched (uses the existing bridge);
  host manifest installed manually via `scripts/install-host-dev.sh`.
- Deliberate M0 simplifications: no app auto-launch (requires Notes running);
  one process per tool call; generic extraction, image localization, notebook
  picker and arxiv routing are later milestones.

### M1/M2/M4/M5 — extraction, notebook picker, handler chain (2026-06-08)

Extension-side milestones built; notes repo still untouched.

- M1 generic extraction: `lib/extract/chain.ts` runs Defuddle (`defuddle/full`,
  `parseAsync`, `markdown: true`) on the page → Markdown + metadata; frontmatter
  (`source/author/published/description/clipped/clipper/tags`) built in
  `lib/frontmatter.ts`. Validated end-to-end against the live bridge: a clipped
  markdown note (frontmatter + heading + list + `$math$` + remote image) created
  and round-tripped cleanly through `create_note` / `get_note`.
- M2 notebook picker: popup loads writable notebooks via `get_notebooks`,
  remembers the last choice in `storage.local`.
- M4 handler chain + arxiv: ordered chain (arxiv → generic). arxiv URLs produce
  a `delegate` payload for `import_arxiv`; since that bridge tool does not exist
  yet, the background falls back to a generic article clip of the same page
  (the designed degradation).
- M5 selection mode: selection-range HTML → Markdown via Turndown + GFM.
- Architecture: extractor is a `registration: 'runtime'` content script (NOT in
  the manifest, no per-page cost); the background injects it on demand
  (activeTab) only when clipping. The Defuddle bundle (~675 kB) loads only on a
  clipped tab.
- Fixed a YAML-escaping bug: values containing `:` (e.g. `Title: Subtitle`) are
  now double-quoted so frontmatter doesn't parse as a nested mapping.
- Not yet (blocked on notes-side tools, see below): clip-time image download
  (`save_attachment`) — mitigated because Notes localizes remote images on open;
  real arxiv structured import (`import_arxiv`); production host auto-registration.
  Highlight-collection UX is a later sub-task on top of selection mode.

### Higher-resolution image capture (2026-06-09)

Images clipped from sites that serve downscaled thumbnails (Wikipedia being the
motivating case — its article `<img>`s are 250px `/thumb/` variants) now reach
for the full-resolution original. Two-layer design, chosen for long-term
maintainability over per-site hacks (mirrors the yt-dlp/Imagus "generic
resolution + declarative CDN registry" pattern):

- General resolution. Article mode already gets this from Defuddle (largest
  srcset candidate, noscript/lazy fallbacks, dedup-by-resolution). Selection
  mode previously dropped `srcset` wholesale before Turndown, keeping only the
  (often placeholder) `src`; `resolveResponsiveImages()` in `lib/extract/chain.ts`
  now picks the largest `srcset`/`<picture>` candidate, or a `data-src` lazy URL
  when `src` is a placeholder, before Markdown conversion.
- CDN original upgrade (`lib/extract/image-cdn.ts`). A declarative rule table
  maps a known CDN's thumbnail URL to its original; `upgradeImageUrl()` applies
  the first matching rule or returns the URL unchanged. Ships with one rule —
  Wikimedia: strip `/thumb/` + the trailing `NNNpx-` variant, which also recovers
  `.svg` vector originals (verified to render inline in Notes). Adding a CDN is
  one table entry; a remote-refreshable table is a deliberate later option, not
  built yet.
- Fallback chain in `imageReplacement` (`entrypoints/background.ts`): fetch the
  upgraded original, fall back to the in-page URL, and if every candidate fails
  keep the remote `![](url)` rather than silently dropping the image (Wikimedia
  refuses raster upscaling with a 400, so blindly requesting a larger thumbnail
  is not viable — only the true original is).
- Tests: `lib/extract/image-cdn.test.ts` covers Wikimedia raster/SVG upgrades,
  already-original and unknown-host passthrough, and data:/relative URLs.

### Durable clip jobs (2026-06-09)

Clip progress/result used to live only in the popup's React state, so closing
the popup mid-clip lost all feedback and a reopen could trigger a duplicate
clip of the same page. The state of record now lives where the work runs.

- `lib/clip-jobs.ts`: per-tab clip job (`running`/`succeeded`/`failed`) stored in
  `storage.session` — survives popup close/reopen and service-worker eviction
  (in-memory across SW restarts, never on disk), and drives the popup reactively
  via `storage.onChanged` (no polling). `runClipJob()` dedups: a fresh running
  job for a tab is returned instead of starting a second clip, so no duplicate
  notes. TTLs treat a running record older than 5 min as stale (MV3 caps worker
  lifetime, so it can only be a dead job) and let a finished record linger 5 min
  (from completion) so a reopened popup still shows the outcome.
- `entrypoints/background.ts`: `handleClip` splits into `doClip` (the work) +
  `runClipJob` wrapper; awaiting the job keeps the worker alive for the whole
  clip even after the popup closes (pending-handler-promise keepalive, not a
  detached promise). Tab `onRemoved`/`onUpdated`(url) listeners clear the job so
  a reopened popup never shows a stale "Saved" for a closed/navigated page.
- `entrypoints/popup/App.tsx`: now a pure subscriber — resolves the active tab,
  reads its job on mount, and listens to `storage.onChanged`. The button mirrors
  the job (`Clipping…` / `Saved: <title>` / normal with a `Failed: …` line);
  re-hover acknowledges a finished job (clears the record) and re-arms the button.
- Tests: `lib/clip-jobs.test.ts` covers succeeded/failed/throw recording, dedup
  against a running job, stale-running restart, terminal-TTL expiry, and clear.

### Review follow-ups (2026-06-09)

A long-term review of the above turned up three real issues, now fixed:

- Service-worker keepalive (`withKeepalive` in `entrypoints/background.ts`). MV3
  terminates an idle worker after ~30s of no extension-API activity; a large
  original-image download (a bare `fetch`) can sit in that gap and be killed
  mid-clip. While a clip runs we now ping `runtime.getPlatformInfo` every 25s to
  reset the idle timer. The separate ~5-min hard lifetime cap can't be extended
  (a documented MV3 limit); a clip that exceeds it is abandoned and its stale
  `running` record is reclaimed by `RUNNING_TTL_MS`, so the user can retry. (A
  prior comment claiming an awaited handler promise keeps the worker alive was
  wrong and has been corrected.)
- Per-URL image dedup (`localizeMedia`). Localization mapped each `![](…)`
  occurrence independently, so an image used twice was downloaded, uploaded, and
  stored as a duplicate attachment twice — worse now that originals are larger.
  `imageReplacement` is split into a memoizable per-URL `localizeImageUrl` +
  alt-only `formatImage`; `localizeMedia` resolves through a per-clip cache so a
  repeated image is fetched/uploaded once.
- Robust srcset parsing (`lib/extract/srcset.ts`). `largestSrcsetUrl` used
  `split(',')`, which corrupts URLs containing commas (e.g. `data:` URIs); it is
  now a spec-shaped tokenizer (URL up to whitespace, descriptor up to comma),
  extracted to a DOM-free module with unit tests (`srcset.test.ts`).

Deferred (noted so they aren't rediscovered): clips silently drop/keep-remote
failed images with no surfaced count (observability); article vs selection use
two different Layer-1 image resolvers (Defuddle vs ours) that could drift;
`image-cdn.ts` lives under `extract/` though it's a localization concern;
`isPlaceholderSrc` can false-positive on filenames containing "transparent"
etc.; the per-tab dedup has a benign TOCTOU window (irrelevant for single-user
clicking); `upgradeImageUrl` is wired to images only, not `<video>`/`<audio>`.

### Notes install/run detection + macOS auto-launch (2026-06-09)

Clipping now copes with Notes being absent or not running, so the user isn't
stuck at a dead "Connected" check. Three states drive three behaviours:
not installed → prompt to download; installed but not running → launch it
(macOS) or prompt to open it (Windows), then clip; running → clip directly.

- Native host (`native-host/main.go`): `appInstalled()` locates the app
  (macOS `/Applications` + `~/Applications`, `mdfind` fallback; Windows known
  Program dirs + the install-dir-independent Start-menu/desktop shortcut), so
  "not running" and "not installed" are distinguishable. New `ensure_running`
  action: returns running, else launches (macOS `open -b com.sanqian.notes -g`,
  detached via LaunchServices so it outlives this one-shot host) and polls the
  bridge up to 15s, else reports `NOT_RUNNING`/`NOT_INSTALLED`. `get_connection`
  now reports running / installed / not-installed (probe only, never launches —
  opening the popup must not start the app). Windows/Linux do not auto-launch
  (no reliable mechanism — matches the app's own MCP server); they prompt the
  user to open it.
- `lib/native.ts`: `ensureRunning()` (20s timeout to cover the host's launch
  poll). `entrypoints/background.ts`: `handleClip` calls it first inside the
  keepalive, before extracting, and aborts with the reason on failure. An
  `UNKNOWN_ACTION` reply (older host that predates `ensure_running`) is treated
  as "skip the gate and clip anyway", so an extension update ahead of an app
  update does not break every clip.
- `entrypoints/popup/App.tsx`: four-state connection (adds `not-installed`);
  reads `runtime.getPlatformInfo()` so only macOS shows "Open Notes & Clip"
  (auto-launch) while other platforms show a "open Notes first" hint; a
  not-installed state shows a Download button → https://sanqian.ai/notes.
- Deploy note: the Go host source lives here but ships as prebuilt binaries in
  the Notes app's `resources/native-host/`. After changing `main.go`, run
  `native-host/build.sh` (cross-compiles all platforms to `native-host/bin/`,
  gitignored) and sync those into the Notes repo's resources; native-host
  registration is production-only (`is.dev` returns early).

### Video clip handlers — YouTube + Bilibili transcripts (2026-06-11)

Clipping a YouTube/Bilibili video page now produces a video note — embed
player + metadata + description + the full transcript organized by chapters,
every paragraph deep-linking back into the video (`&t=` / `?t=`) — instead of
the generic-extraction junk those pages used to yield. Design §7.5; the core
value is the transcript being searchable in Notes.

- Long-term architecture (`lib/extract/video/`): platform providers
  (`youtube.ts`, `bilibili.ts`) fill a platform-neutral `VideoClip` model
  (`types.ts`); `transcript.ts` merges caption cues into timestamped
  paragraphs (chapter/gap/length breaks, CJK-aware joining); `render.ts`
  defines the note format once for all platforms. Adding a platform = one
  provider + one branch in `index.ts`.
- Fetch-first, no DOM scraping (industry research, design §7.5.6): YouTube
  re-fetches the watch page HTML and brace-scans `ytInitialPlayerResponse`
  (fresh data, immune to SPA-stale page globals; captions via
  `timedtext&fmt=json3`, manual over asr, lang pref navigator→zh→en; chapters
  parsed from description timestamp lines with YouTube's own validity rules).
  Bilibili uses `x/web-interface/view` (meta + per-part cid) and
  `x/player/wbi/v2` (subtitles + view_points chapters in one call, verified
  unsigned in-browser 2026-06), handling the known traps: login-only subtitles
  (`need_login_subtitle`), http/protocol-relative `subtitle_url`, placeholder
  entries, short-lived auth_key, v_voucher risk-control responses.
- Degradation ladder (§7.5.3): transcript failure still yields a video note
  with `fallback: video-transcript-missing` + reason in frontmatter; total
  provider failure falls back to generic extraction tagged
  `<platform>-video-failed`. All requests run in the content script with the
  user's cookies — no new host_permissions, no server-side scraping exposure.
- Frontmatter gains `duration`; Bilibili embeds use `player.bilibili.com`
  (verified present in Notes' embed CSP frame-src whitelist). Multi-part
  videos clip the current part (`?p=`, part title appended). Bangumi/cheese
  pages, AI summaries/cleanup and keyframe capture are explicitly out of
  scope for now (§7.5.5).
- Verified: 74 unit tests green (URL detection, JSON brace-scan, track
  selection, json3/chapter parsing, cue merging, rendering); `tsc` and
  `wxt build` clean; live smoke against the real sites confirmed watch-page
  parsing, both Bilibili APIs, and surfaced that cookie-less timedtext
  requests answer empty 200 — handled as a clear transcript-missing reason.
  In-browser end-to-end (logged-in Bilibili AI subtitles, YouTube timedtext
  with a real session) still needs a manual pass.

### YouTube transcript fix (PO token) + WeChat article handler (2026-06-11)

- **YouTube transcript fix**: first real-world test produced video notes
  without transcripts. Root cause (matches the empty-200 seen in the earlier
  smoke test): since 2025 YouTube gates caption baseUrls from WEB-context
  player responses behind a per-video PO token — without it timedtext answers
  an empty 200 body, logged in or not. Fix: caption sources now waterfall
  InnerTube IOS client → InnerTube WEB → watch-page HTML (the ladder
  Defuddle/Obsidian Clipper converged on in 2026-04); IOS-sourced baseUrls
  carry no token requirement. Caption URLs are fetched as-is (no fmt
  override, no custom headers — a UA header triggers an unanswerable CORS
  preflight) and parsed from both srv3 and srv1 XML; an empty body fails over
  to the next source. Verified live from Node (cookie-less, stricter than the
  extension context): IOS track list + full transcript parse OK.
- **WeChat handler** (`lib/extract/wechat.ts`, design §7.6): mp.weixin.qq.com
  articles bypass Defuddle (whose hidden-element removal and lazy-image
  handling break on this site) — `#js_content` is cloned, repaired
  (`data-src`→`src` for all images incl. carousel slides; formatter code
  blocks normalized to real newlines; channels-video/voice/iframe replaced
  with a link back to the article) and converted with Turndown. Metadata from
  og:title/og:url, `#js_name` (account name, not og:article:author),
  inline-script `var ct` for the publish date. New mmbiz.qpic.cn image-cdn
  rule upgrades size-capped URLs (`/640`) to the `/0` original and strips
  `tp=webp`; hotlink protection passes referer-less background fetches
  (verified), placeholder-image detection left as a known edge.
- Notion assessment (researched, no code): generic Defuddle extraction is
  adequate on notion.site pages (~98% text in a live test; no block
  virtualization; images eager + same-site proxy URLs that our clip-time
  download handles well). Known losses: collapsed toggles (children absent
  from the DOM), database views, list numbering. Revisit only if those hurt
  in practice.
- 85 unit tests green; tsc/build/zip clean.

### Feedback round: transcript granularity, description, frontmatter slimming (2026-06-11)

- Transcript paragraphs were walls of text for Chinese (600-char/90s caps
  tuned for latin scripts). Now CJK-weighted: a CJK glyph counts double, cap
  360 weight (~180 CJK chars / ~360 latin chars) and 45s — Chinese paragraphs
  land at 3-4 lines with a timestamp anchor each.
- Frontmatter `description` no longer takes the first description line (often
  boilerplate like membership links); the whole description is flattened to
  one line and capped at 200 chars.
- Removed `clipped` / `clipper` / `tags: [clipped]` from all clip frontmatter
  (owner decision: noise; clip time ~= note creation time).
- 87 unit tests green; tsc/build/zip clean.

### Transcript shaping refinements + transcript kind field (2026-06-11)

- Cue boundaries are now preserved as a space when merging (they are the only
  sentence-ish hint in unpunctuated auto captions; previously CJK cues were
  concatenated seamlessly). No space added after fullwidth punctuation.
- Paragraph caps are soft for punctuated captions: the break waits for the
  sentence to end (up to a 1.5x hard cap), so paragraphs no longer cut
  sentences mid-way. Unpunctuated ASR keeps breaking at the caps on a cue
  boundary.
- New frontmatter field `transcript: auto | manual` (asr/ai-* vs human
  captions) — groundwork for a future notes-side AI cleanup pass that needs
  to select exactly the notes with machine transcripts.
- 89 unit tests green; tsc/build/zip clean.

### Transcript paragraphing v2: 15-30s window, largest-pause, speaker turns (2026-06-11)

Rewrote mergeIntoParagraphs around the industry break-priority ladder
(researched: Defuddle sentence-grouping + 30s ASR cap, Glasp 30s windows,
transcription-industry 15/30/60s guidance):
- Target span 15-30s (was up to 45s): no length break before 15s; from 30s
  (or the 360-weight cap) split at the best natural point.
- Punctuated captions split at the last sentence end past 15s — sentences
  are never cut below the 1.5x hard cap; beyond it, largest pause.
- Unpunctuated ASR splits at the largest inter-cue pause past 15s instead of
  an arbitrary cue boundary.
- Speaker-change markers force a break: ">>" (CEA-608/708 captioning
  convention, used by YouTube) and leading "- " (subtitle dialogue
  convention); markers are stripped from the text.
- 91 unit tests green; tsc/build/zip clean.

### Fix: decimal dots defeated the punctuation detection (2026-06-11)

Real-video report (_4EyT2qar4U): paragraphs ran to the 45s hard cap instead
of the 15-30s target. The track is a creator-uploaded zh subtitle with no
sentence punctuation, but cues containing "USB 3.0" / "11.5瓦时" made the
naive some()-based punctuation check flag the whole track as punctuated, so
every break waited for a sentence end that never came. The flag now counts
cues ENDING with sentence punctuation (>=3 and >=5% of cues) — the exact
signal the splitter uses. Verified against the reported video: spans now
19-30s (one 76s span is a real 72s captionless stretch). 93 tests green.

### Fix: Bilibili subtitle fetch blocked by credentialed CORS (2026-06-11)

Real-world Bilibili clips degraded with fallback_reason "Failed to fetch".
api.bilibili.com echoes the origin with allow-credentials (verified), so the
metadata/player calls pass — the failing hop was the subtitle file on
aisubtitle.hdslb.com, fetched with credentials:'include' against a CDN that
answers wildcard CORS; the browser rejects credentialed wildcard reads. The
subtitle URL carries its own short-lived auth_key, so the fetch now uses
credentials:'omit' (matching the player's own cookie-less fetch). Every
bilibili fetch hop now labels its errors, so a future fallback_reason names
the exact failing endpoint instead of a bare "Failed to fetch".

### Long-term review round: 7-angle code review, 13 fixes (2026-06-11)

Pre-commit review (7 parallel finder angles, verified findings) surfaced and
fixed, most severe first:
- WeChat images were never localized: mmbiz.qpic.cn only answers CORS for
  qq-family origins (verified live), so the background worker's fetch could
  not read the bytes — added the extension's first host_permission
  (https://mmbiz.qpic.cn/*) and corrected design §7.6.
- UTC date off-by-one: bilibili/wechat epoch timestamps formatted via
  toISOString() recorded the previous day for anything published before
  08:00 CST — new shared epochToLocalDate (lib/extract/epoch-date.ts).
- Video description was injected into the note as raw markdown ('-----'
  separator lines turned the line above into a giant setext heading) — new
  escapePlainTextBlock defuses line-level markdown triggers; summary
  truncation is now code-point-safe (no split surrogate pairs).
- "- " speaker-change marker now only applies when dashes are the exception
  (<=50% of cues), so dash-styled subtitle tracks no longer explode into
  one paragraph per cue.
- WeChat: nickname fallback now HTML-entity-decodes and unescapes the inline
  script string; body goes through normalizeBlockMath (the 8542a22
  invariant); empty/missing #js_content now degrades visibly with
  fallback: wechat-article-failed instead of silently falling to Defuddle.
- Deduped: lazy-image + URL-absolutization helpers unified in
  lib/extract/fragment.ts (chain selection path + wechat share one
  implementation, data-lazy-src added); entity decoding shared in
  entities.ts; YouTube watch-page fetch now runs concurrently with InnerTube
  (it stays: IOS responses carry no microformat, verified live); transcript
  cue weights computed once; bilibili deep links derive from meta.url;
  chain's degraded-article fallback extracted into one helper used by both
  video and wechat; i18n resolution unified at the chain boundary (handler
  pipelines stay pure); frontmatter transcript field goes through yamlScalar.
- 101 unit tests green; tsc/build/zip clean.

### Release prep: v0.1.0 (2026-06-11)

Second review pass (fix-round delta + release-readiness) before the store
upload:
- Fixed: decodeHtmlEntities threw RangeError on out-of-range numeric
  references (&#x110000;) — could fail a whole wechat clip or drop a whole
  YouTube transcript; now left undecoded.
- Corrected a premise from the previous round: WXT auto-injects <all_urls>
  host_permissions for the runtime-registered content script (shipped since
  0.0.1), which is what exempts background media downloads from CORS — the
  mmbiz.qpic.cn host permission added earlier was redundant and is removed
  (manifest permissions unchanged vs 0.0.1: no new install warning).
- Release prep: version 0.1.0; store listing (summary, descriptions,
  single-purpose statement) now covers video transcripts + WeChat articles;
  PRIVACY.md documents the credentialed transcript fetches to the video
  sites (nothing leaves the device) and gets a new date.
- 102 unit tests green; manifest verified: version 0.1.0, permissions
  identical to the released 0.0.1.
- Upload artifact: output/sanqian-notes-clipper-0.1.0-chrome.zip. Remaining
  manual dashboard steps per docs/PUBLISHING.md: paste updated listing
  texts, re-certify data-use disclosures, submit for review.
