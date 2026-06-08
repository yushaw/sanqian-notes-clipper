import { browser } from 'wxt/browser';
import { callTool, getConnection, type NativeResponse } from '@/lib/native';
import { listNotebooks } from '@/lib/notebooks';
import { buildNoteContent } from '@/lib/frontmatter';
import type { CreateNoteResult } from '@/lib/clip';
import type { ClipMode, ClipPayload } from '@/lib/handlers/types';
import type { ClipRequest, ExtractRequest, PopupRequest } from '@/lib/messages';

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
const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
const DATA_IMAGE_RE = /^data:([^;,]+);base64,(.+)$/s;
const MEDIA_TAG_RE = /<(video|audio)\b[^>]*>[\s\S]*?<\/\1>/gi;

// Per-chunk raw bytes; base64 (~1.37x) + JSON stays under the bridge's 1MB cap.
const CHUNK_BYTES = 500_000;
// Skip absurdly large media to avoid multi-minute uploads.
const MAX_MEDIA_BYTES = 80 * 1024 * 1024;

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
async function uploadBinary(bytes: Uint8Array, mime: string, filename?: string): Promise<string | null> {
  if (bytes.length === 0 || bytes.length > MAX_MEDIA_BYTES) return null;
  const transferId = crypto.randomUUID();
  const total = Math.max(1, Math.ceil(bytes.length / CHUNK_BYTES));
  let url: string | null = null;
  for (let seq = 0; seq < total; seq++) {
    const slice = bytes.subarray(seq * CHUNK_BYTES, (seq + 1) * CHUNK_BYTES);
    const resp = await callTool<{ url?: string }>('save_attachment_chunk', {
      transfer_id: transferId,
      seq,
      total_chunks: total,
      data_base64: bytesToBase64(slice),
      filename,
      mime,
    });
    if (!resp.ok) return null;
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

// <video>/<audio> tags -> download + embed as a Notes media node; link on failure.
async function localizeMediaTags(markdown: string): Promise<string> {
  const blocks = [...markdown.matchAll(MEDIA_TAG_RE)];
  let result = markdown;
  for (const [block, rawTag] of blocks) {
    const tag = rawTag.toLowerCase();
    const src = /\bsrc=["']([^"']+)["']/i.exec(block)?.[1];
    if (!src) {
      result = result.replace(block, '');
      continue;
    }
    let replacement = `[${tag === 'video' ? 'Video' : 'Audio'}](${src})`;
    if (/^https?:\/\//i.test(src)) {
      const fetched = await fetchBinary(src);
      if (fetched) {
        const url = await uploadBinary(fetched.bytes, fetched.mime, filenameFromUrl(src));
        if (url) replacement = `\n\n<${tag} src="${url}"></${tag}>\n\n`;
      }
    }
    // Function replacer: value is inserted literally (string replacements would
    // interpret $$, $&, etc. in alt/URL text).
    result = result.replace(block, () => replacement);
  }
  return result;
}

async function localizeImages(markdown: string): Promise<string> {
  const matches = [...markdown.matchAll(IMAGE_RE)];
  let result = markdown;
  for (const match of matches) {
    const [full, alt, url] = match;

    const embed = toEmbedIframe(url);
    if (embed) {
      result = result.replace(full, () => `\n\n${embed}\n\n`);
      continue;
    }

    let bytes: Uint8Array | undefined;
    let mime: string | undefined;

    const dataMatch = DATA_IMAGE_RE.exec(url);
    if (dataMatch) {
      mime = dataMatch[1];
      try {
        bytes = Uint8Array.from(atob(dataMatch[2]), (c) => c.charCodeAt(0));
      } catch {
        bytes = undefined;
      }
    } else if (/^https?:\/\//i.test(url)) {
      const fetched = await fetchBinary(url);
      if (fetched && fetched.mime.startsWith('image/')) {
        bytes = fetched.bytes;
        mime = fetched.mime;
      }
    } else {
      continue; // relative/unknown scheme: leave untouched
    }

    if (!bytes || !mime) {
      result = result.replace(full, ''); // non-image / failed -> drop
      continue;
    }
    const localized = await uploadBinary(bytes, mime, filenameFromUrl(url));
    result = localized ? result.replace(full, () => `![${alt}](${localized})`) : result.replace(full, () => '');
  }
  return result;
}

async function createNoteFromPayload(
  payload: Extract<ClipPayload, { kind: 'markdown' }>,
  notebookId: string | undefined,
): Promise<NativeResponse<CreateNoteResult>> {
  let markdown = await localizeMediaTags(payload.markdown);
  markdown = await localizeImages(markdown);
  const content = buildNoteContent({ ...payload, markdown }, new Date().toISOString());
  const args: Record<string, unknown> = { title: payload.title, content };
  if (notebookId) {
    args.notebook_id = notebookId;
  }
  return callTool<CreateNoteResult>('create_note', args);
}

async function handleClip(req: ClipRequest): Promise<NativeResponse<CreateNoteResult>> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { ok: false, error: 'No active tab', code: 'NO_TAB' };
  }

  let payload = await extract(tab.id, req.mode);

  if (payload.kind === 'delegate') {
    // Hand off to a notes-side importer (e.g. import_arxiv). If the tool is not
    // available yet, or the import fails, fall back to a generic article clip
    // of the same page (design §7.2).
    const delegated = await callTool<CreateNoteResult>(payload.tool, {
      ...payload.args,
      notebook_id: req.notebookId,
    });
    if (delegated.ok) {
      return delegated;
    }
    payload = await extract(tab.id, 'article');
  }

  if (payload.kind !== 'markdown') {
    return { ok: false, error: 'Extraction produced no content', code: 'EMPTY' };
  }
  return createNoteFromPayload(payload, req.notebookId);
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
});
