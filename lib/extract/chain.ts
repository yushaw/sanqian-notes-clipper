// The clip handler chain. Runs inside the page (content script).
//
// Order (auto mode): arxiv (delegate) -> video (YouTube/Bilibili, §7.5) ->
// wechat article (§7.6) -> generic article (Defuddle). Selection mode
// bypasses the chain. PDF detection (design §7.3, plan C) and future
// handlers (X, ...) slot in here.

import { i18n } from '#i18n';
import Defuddle from 'defuddle/full';
import type { ClipMode, ClipPayload, MarkdownPayload } from '@/lib/handlers/types';
import { isArxivUrl } from './arxiv';
import { tryVideoClip } from './video';
import { isWeChatArticleUrl, extractWeChatArticle } from './wechat';
import { htmlFragmentToMarkdown } from './turndown';
import { normalizeBlockMath } from './normalize-block-math';
import { resolveResponsiveImages, absolutizeUrls } from './fragment';

export async function runChain(mode: ClipMode): Promise<ClipPayload> {
  const url = location.href;

  if (mode === 'selection') {
    return extractSelection(url);
  }

  // 'article' forces generic extraction (also the arxiv/video/wechat fallback).
  if (mode === 'auto') {
    if (isArxivUrl(url)) {
      return { kind: 'delegate', tool: 'import_arxiv', args: { id_or_url: url } };
    }
    const video = await tryVideoClip(url, {
      transcript: i18n.t('note.transcript'),
      chapters: i18n.t('note.chapters'),
    });
    if (video.kind === 'video') {
      return video.payload;
    }
    if (video.kind === 'failed') {
      return degradedArticle(url, `${video.platform}-video-failed`, video.reason);
    }
    if (isWeChatArticleUrl(url)) {
      const wechat = extractWeChatArticle({ originalMedia: i18n.t('note.originalMedia') });
      if (wechat.kind === 'markdown') return wechat;
      return degradedArticle(url, 'wechat-article-failed', wechat.reason);
    }
  }

  return extractArticle(url);
}

// A specialized handler matched the URL but broke (site/API change): keep the
// clip via generic extraction and record the degradation in the frontmatter,
// the same visibility mechanism as the arxiv delegate fallback (design §7.5.3
// step 3). `code` follows the `<handler>-failed` grammar.
async function degradedArticle(url: string, code: string, reason: string): Promise<MarkdownPayload> {
  const payload = await extractArticle(url);
  payload.frontmatter.fallback = code;
  payload.frontmatter.fallbackReason = reason;
  return payload;
}

async function extractArticle(url: string): Promise<MarkdownPayload> {
  const result = await new Defuddle(document, { url, markdown: true }).parseAsync();
  const title = result.title || document.title || 'Untitled';
  const markdown = normalizeBlockMath((result.content || '').trim());

  return {
    kind: 'markdown',
    title,
    markdown: markdown || `Clipped from [${url}](${url})`,
    frontmatter: {
      title,
      source: url,
      author: result.author || undefined,
      published: result.published || undefined,
      description: result.description || undefined,
    },
  };
}

// Title for a selection: prefer a heading inside it, else its first line of
// text, else the page title.
function selectionTitle(root: HTMLElement, body: string, pageTitle: string): string {
  const heading = root.querySelector('h1, h2, h3, h4, h5, h6');
  const headingText = heading?.textContent?.trim();
  if (headingText) return headingText.slice(0, 120);

  const firstLine = body
    .split('\n')
    .map((line) => line.replace(/^[#>\-*+\s]+/, '').trim())
    .find((line) => line.length > 0);
  return firstLine ? firstLine.slice(0, 120) : pageTitle;
}

function extractSelection(url: string): ClipPayload {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !selection.toString().trim()) {
    return { kind: 'error', message: 'No text selected. Select something on the page, then clip.' };
  }

  const container = document.createElement('div');
  for (let i = 0; i < selection.rangeCount; i++) {
    container.appendChild(selection.getRangeAt(i).cloneContents());
  }
  resolveResponsiveImages(container);
  absolutizeUrls(container, location.href);

  const body = normalizeBlockMath(htmlFragmentToMarkdown(container.innerHTML).trim());
  if (!body) {
    return { kind: 'error', message: 'The selection has no extractable text.' };
  }

  const pageTitle = document.title || 'Untitled';
  const title = selectionTitle(container, body, pageTitle);
  // Source banner (a one-line quote with the original link) above the excerpt.
  const markdown = `> Clipped from [${pageTitle}](${url})\n\n${body}`;

  return {
    kind: 'markdown',
    title,
    markdown,
    frontmatter: { title, source: url },
  };
}
