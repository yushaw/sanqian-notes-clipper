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
