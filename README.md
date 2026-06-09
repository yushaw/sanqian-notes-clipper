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
