import { browser } from 'wxt/browser';
import { callTool, getConnection, ensureRunning, type NativeResponse } from '@/lib/native';
import { listNotebooks } from '@/lib/notebooks';
import { buildNoteContent } from '@/lib/frontmatter';
import type { CreateNoteResult } from '@/lib/clip';
import type { ClipMode, ClipPayload } from '@/lib/handlers/types';
import type { ClipRequest, ExtractRequest, PopupRequest } from '@/lib/messages';
import { upgradeImageUrl } from '@/lib/extract/image-cdn';
import { runClipJob, clearClipJob } from '@/lib/clip-jobs';

const EXTRACTOR_FILE = 'content-scripts/extractor.js';

// Ask the page's content script to extract; inject it first for tabs that
// predate the extension load (no receiver -> sendMessage throws).
async function extract(tabId: number, mode: ClipMode): Promise<ClipPayload> {
  const request: ExtractRequest = { type: 'EXTRACT', mode };
  try {
    return (await browser.tabs.sendMessage(tabId, request)) as ClipPayload;
  } catch {
    await browser.scripting.executeScript({
      target: { tabId },
      // WXT narrows `files` to known public paths; the built content script is
      // a valid extension-relative path to inject at runtime.
      // @ts-expect-error -- runtime-valid path outside WXT's PublicPath union
      files: [EXTRACTOR_FILE],
    });
    return (await browser.tabs.sendMessage(tabId, request)) as ClipPayload;
  }
}

// Notes does NOT localize remote media for notes created via create_note (its
// RemoteImagePaste only fires on paste). So we download every image/video at
// clip time and store it as an attachment (uploaded in <1MB chunks to clear the
// bridge body cap), rewriting to attachment://. YouTube/Vimeo become <iframe>
// (Notes renders an embed block). Failed image fetches are dropped; failed video
// fetches fall back to a link rather than being lost.
// Image URL grammar: an optional <...> wrap, a bare URL allowing balanced
// single-level parens (e.g. wikipedia Foo_(bar).png), and an optional "title".
const IMAGE_RE = /!\[([^\]]*)\]\(\s*(<[^>]*>|[^\s()]+(?:\([^\s()]*\)[^\s()]*)*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const DATA_IMAGE_RE = /^data:([^;,]+);base64,(.+)$/s;
const MEDIA_TAG_RE = /<(video|audio)\b[^>]*>[\s\S]*?<\/\1>/gi;

// Per-chunk raw bytes; base64 (~1.37x) + JSON stays under the bridge's 1MB cap.
const CHUNK_BYTES = 500_000;
// Skip absurdly large media to avoid multi-minute uploads.
const MAX_MEDIA_BYTES = 80 * 1024 * 1024;
// Localize images/videos concurrently (most are small; peak memory ~= this x the
// largest in-flight item). Retry each chunk a few times to survive transient blips.
const LOCALIZE_CONCURRENCY = 5;
const CHUNK_RETRIES = 2;

function unwrapUrl(raw: string): string {
  const t = raw.trim();
  return t.startsWith('<') && t.endsWith('>') ? t.slice(1, -1).trim() : t;
}

// Run async tasks with bounded concurrency, preserving input order.
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

interface Binary {
  bytes: Uint8Array;
  mime: string;
}

async function fetchBinary(url: string): Promise<Binary | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    const buf = await res.arrayBuffer();
    if (buf.byteLength === 0 || buf.byteLength > MAX_MEDIA_BYTES) return null;
    return { bytes: new Uint8Array(buf), mime };
  } catch {
    return null;
  }
}

// Upload bytes as an attachment in <1MB chunks; returns its attachment:// URL.
// Each chunk is retried a few times (chunk writes are idempotent server-side).
async function uploadBinary(bytes: Uint8Array, mime: string, filename?: string): Promise<string | null> {
  if (bytes.length === 0 || bytes.length > MAX_MEDIA_BYTES) return null;
  const transferId = crypto.randomUUID();
  const total = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));
  let url: string | null = null;
  for (let seq = 0; seq < total; seq++) {
    const data_base64 = bytesToBase64(bytes.subarray(seq * CHUNK_BYTES, (seq + 1) * CHUNK_BYTES));
    let resp: NativeResponse<{ url?: string }> | undefined;
    for (let attempt = 0; attempt <= CHUNK_RETRIES; attempt++) {
      resp = await callTool<{ url?: string }>('save_attachment_chunk', {
        transfer_id: transferId,
        seq,
        total_chunks: total,
        data_base64,
        filename,
        mime,
      });
      if (resp.ok) break;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
    if (!resp?.ok) return null;
    if (resp.result?.url) url = resp.result.url;
  }
  return url;
}

function filenameFromUrl(url: string): string | undefined {
  try {
    const name = new URL(url).pathname.split('/').pop();
    return name && name.includes('.') ? name : undefined;
  } catch {
    return undefined;
  }
}

// A youtube/vimeo URL -> embeddable <iframe> (Notes turns it into an embed block).
function toEmbedIframe(url: string): string | null {
  const yt = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/)|youtu\.be\/)([\w-]{11})/i.exec(url);
  if (yt) return `<iframe src="https://www.youtube.com/embed/${yt[1]}"></iframe>`;
  const vimeo = /vimeo\.com\/(?:video\/)?(\d+)/i.exec(url);
  if (vimeo) return `<iframe src="https://player.vimeo.com/video/${vimeo[1]}"></iframe>`;
  return null;
}

interface Replacement {
  full: string;
  // string -> replace; '' -> drop; null -> leave untouched
  value: string | null;
}

// Apply computed replacements. Function replacer inserts the value literally
// ($$, $&, etc. in a string replacement would be reinterpreted). Each op targets
// the first remaining occurrence of its match, so duplicates are handled in order.
function applyReplacements(markdown: string, ops: Replacement[]): string {
  let result = markdown;
  for (const { full, value } of ops) {
    if (value === null) continue;
    result = result.replace(full, () => value);
  }
  return result;
}

// One <video>/<audio> tag -> a Notes media node (downloaded), or a link on failure.
async function mediaTagReplacement(block: string, rawTag: string): Promise<string> {
  const tag = rawTag.toLowerCase();
  const src = /\bsrc=["']([^"']+)["']/i.exec(block)?.[1];
  if (!src) return '';
  if (/^https?:\/\//i.test(src)) {
    const fetched = await fetchBinary(src);
    if (fetched) {
      const url = await uploadBinary(fetched.bytes, fetched.mime, filenameFromUrl(src));
      if (url) return `\n\n<${tag} src="${url}"></${tag}>\n\n`;
    }
  }
  return `[${tag === 'video' ? 'Video' : 'Audio'}](${src})`;
}

// How one image URL resolves, independent of any alt text. Computed once per
// unique URL (see localizeMedia's cache) so a repeated image is fetched and
// uploaded a single time rather than once per occurrence.
type ImageResult =
  | { kind: 'embed'; html: string }
  | { kind: 'replace'; url: string } // attachment:// (localized) or kept-remote
  | { kind: 'drop' }
  | { kind: 'untouched' };

async function localizeImageUrl(url: string): Promise<ImageResult> {
  const embed = toEmbedIframe(url);
  if (embed) return { kind: 'embed', html: embed };

  // data: URI -> decode + upload. There is no remote to fall back to, so a
  // decode/upload failure drops it.
  const dataMatch = DATA_IMAGE_RE.exec(url);
  if (dataMatch) {
    let bytes: Uint8Array | undefined;
    try {
      bytes = Uint8Array.from(atob(dataMatch[2]), (c) => c.charCodeAt(0));
    } catch {
      return { kind: 'drop' };
    }
    const localized = await uploadBinary(bytes, dataMatch[1], filenameFromUrl(url));
    return localized ? { kind: 'replace', url: localized } : { kind: 'drop' };
  }

  // Remote image: try the CDN-upgraded original first, then the in-page URL.
  // If every candidate fails to download/upload, keep the remote URL rather
  // than dropping the image.
  if (/^https?:\/\//i.test(url)) {
    const upgraded = upgradeImageUrl(url);
    const candidates = upgraded !== url ? [upgraded, url] : [url];
    for (const candidate of candidates) {
      const fetched = await fetchBinary(candidate);
      if (fetched && fetched.mime.startsWith('image/')) {
        const localized = await uploadBinary(fetched.bytes, fetched.mime, filenameFromUrl(candidate));
        if (localized) return { kind: 'replace', url: localized };
      }
    }
    return { kind: 'replace', url };
  }

  return { kind: 'untouched' }; // relative/unknown scheme: leave alone
}

// Render one ![alt](...) occurrence from its resolved image. null leaves the
// match untouched; '' drops it.
function formatImage(alt: string, result: ImageResult): string | null {
  switch (result.kind) {
    case 'embed':
      return `\n\n${result.html}\n\n`;
    case 'replace':
      return `![${alt}](${result.url})`;
    case 'drop':
      return '';
    case 'untouched':
      return null;
    default: {
      // Exhaustiveness guard: a new ImageResult kind must be handled here.
      const _exhaustive: never = result;
      return _exhaustive;
    }
  }
}

// Localize all media: <video>/<audio> tags first, then ![](...) images/embeds.
// Each pass computes replacements concurrently (bounded), then applies them.
// Images are resolved through a per-URL cache so duplicates download/upload once.
async function localizeMedia(markdown: string): Promise<string> {
  const tagMatches = [...markdown.matchAll(MEDIA_TAG_RE)];
  const tagOps = await mapPool(tagMatches, LOCALIZE_CONCURRENCY, async (m) => ({
    full: m[0],
    value: await mediaTagReplacement(m[0], m[1]),
  }));
  let result = applyReplacements(markdown, tagOps);

  const cache = new Map<string, Promise<ImageResult>>();
  const localize = (rawUrl: string): Promise<ImageResult> => {
    const key = unwrapUrl(rawUrl);
    let pending = cache.get(key);
    if (!pending) {
      pending = localizeImageUrl(key);
      cache.set(key, pending);
    }
    return pending;
  };

  const imgMatches = [...result.matchAll(IMAGE_RE)];
  const imgOps = await mapPool(imgMatches, LOCALIZE_CONCURRENCY, async (m) => ({
    full: m[0],
    value: formatImage(m[1], await localize(m[2])),
  }));
  return applyReplacements(result, imgOps);
}

async function createNoteFromPayload(
  payload: Extract<ClipPayload, { kind: 'markdown' }>,
  notebookId: string | undefined,
): Promise<NativeResponse<CreateNoteResult>> {
  const markdown = await localizeMedia(payload.markdown);
  const content = buildNoteContent({ ...payload, markdown }, new Date().toISOString());
  const args: Record<string, unknown> = { title: payload.title, content };
  if (notebookId) {
    args.notebook_id = notebookId;
  }
  return callTool<CreateNoteResult>('create_note', args);
}

// The clip itself, against a known tab. Wrapped by handleClip in a durable job.
async function doClip(req: ClipRequest, tabId: number): Promise<NativeResponse<CreateNoteResult>> {
  let payload = await extract(tabId, req.mode);

  if (payload.kind === 'delegate') {
    // Hand off to a notes-side importer (e.g. import_arxiv). If the tool is not
    // available yet, or the import fails, fall back to a generic article clip
    // of the same page (design §7.2).
    const { tool } = payload;
    const delegated = await callTool<CreateNoteResult>(tool, {
      ...payload.args,
      notebook_id: req.notebookId,
    });
    if (delegated.ok) {
      return delegated;
    }
    // Record the degradation in the fallback note's frontmatter so it is visible
    // (delegated import failures are usually transient — the note can be
    // re-imported for the richer specialized result).
    const reason = ('error' in delegated && delegated.error) || 'unknown error';
    payload = await extract(tabId, 'article');
    if (payload.kind === 'markdown') {
      payload.frontmatter.fallback = `${tool}-failed`;
      payload.frontmatter.fallbackReason = reason;
    }
  }

  if (payload.kind === 'error') {
    return { ok: false, error: payload.message, code: 'NO_CONTENT' };
  }
  if (payload.kind !== 'markdown') {
    return { ok: false, error: 'Extraction produced no content', code: 'EMPTY' };
  }
  return createNoteFromPayload(payload, req.notebookId);
}

// MV3 terminates the service worker after ~30s with no extension-API activity,
// and a long image download (a plain fetch, no API call in between) can fall in
// that gap and be killed mid-clip. Ping a trivial API periodically while a clip
// runs to keep resetting the idle timer. (The separate ~5-minute hard cap on
// worker lifetime cannot be extended; a clip that exceeds it is abandoned and
// its stale 'running' record is reclaimed by RUNNING_TTL_MS so the user can
// retry — see clip-jobs.ts.)
const KEEPALIVE_INTERVAL_MS = 25_000;
async function withKeepalive<T>(fn: () => Promise<T>): Promise<T> {
  const timer = setInterval(() => {
    void browser.runtime.getPlatformInfo().catch(() => {});
  }, KEEPALIVE_INTERVAL_MS);
  try {
    return await fn();
  } finally {
    clearInterval(timer);
  }
}

async function handleClip(req: ClipRequest): Promise<NativeResponse<CreateNoteResult>> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { ok: false, error: 'No active tab', code: 'NO_TAB' };
  }
  const tabId = tab.id;

  // Run as a durable, deduped per-tab job, kept alive against idle termination.
  let response: NativeResponse<CreateNoteResult> | null = null;
  await runClipJob(tabId, () =>
    withKeepalive(async () => {
      // Make sure Notes is up first: launches it where supported (macOS) and
      // waits for the bridge. On failure (not installed / not running / launch
      // timeout) abort before extracting; the popup surfaces the reason.
      // UNKNOWN_ACTION means an older native host predates ensure_running — skip
      // the gate and let the tool call itself report if Notes is unreachable, so
      // updating the extension ahead of the app does not break every clip.
      const ready = await ensureRunning();
      const readyCode = !ready.ok && 'code' in ready ? ready.code : undefined;
      if (!ready.ok && readyCode !== 'UNKNOWN_ACTION') {
        response = { ok: false, error: ready.error, code: readyCode };
        return { ok: false, error: ready.error };
      }
      const resp = await doClip(req, tabId);
      response = resp;
      return resp.ok
        ? { ok: true, title: resp.result?.title }
        : { ok: false, error: ('error' in resp && resp.error) || 'Unknown error' };
    }),
  );

  // response is null only when the job deduped against an in-flight clip.
  return (
    response ?? { ok: false, error: 'A clip is already in progress for this tab', code: 'ALREADY_RUNNING' }
  );
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message): Promise<unknown> | undefined => {
    const req = message as PopupRequest;

    switch (req?.type) {
      case 'CHECK_CONNECTION':
        return getConnection();
      case 'LIST_NOTEBOOKS':
        return listNotebooks();
      case 'CLIP':
        return handleClip(req);
      default:
        return undefined;
    }
  });

  // A clip job belongs to the page that was open when it ran. Drop it when the
  // tab is closed or navigates to a new URL, so a reopened popup never shows a
  // stale "Saved" for a page that is no longer there.
  browser.tabs.onRemoved.addListener((tabId) => void clearClipJob(tabId));
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.url) void clearClipJob(tabId);
  });
});
