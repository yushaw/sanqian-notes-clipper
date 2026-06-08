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

async function createNoteFromPayload(
  payload: Extract<ClipPayload, { kind: 'markdown' }>,
  notebookId: string | undefined,
): Promise<NativeResponse<CreateNoteResult>> {
  const content = buildNoteContent(payload, new Date().toISOString());
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
