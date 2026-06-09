// The clip handler chain. Runs inside the page (content script).
//
// Order (auto mode): arxiv (delegate) -> generic article (Defuddle).
// Selection mode bypasses the chain. PDF detection (design §7.3, plan C) and
// future handlers (YouTube, X, ...) slot in here.

import Defuddle from 'defuddle/full';
import type { ClipMode, ClipPayload } from '@/lib/handlers/types';
import { isArxivUrl } from './arxiv';
import { htmlFragmentToMarkdown } from './turndown';
import { normalizeBlockMath } from './normalize-block-math';
import { largestSrcsetUrl, isPlaceholderSrc } from './srcset';

export async function runChain(mode: ClipMode): Promise<ClipPayload> {
  const url = location.href;

  if (mode === 'selection') {
    return extractSelection(url);
  }

  // 'article' forces generic extraction (also used as the arxiv fallback).
  if (mode === 'auto' && isArxivUrl(url)) {
    return { kind: 'delegate', tool: 'import_arxiv', args: { id_or_url: url } };
  }

  return extractArticle(url);
}

async function extractArticle(url: string): Promise<ClipPayload> {
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

// Selections carry no <base> and bypass Defuddle's image handling, so resolve
// responsive/lazy-loaded images to the best candidate the page references
// before converting to Markdown: prefer the largest srcset candidate (from the
// <img> or its <picture> sources), else a lazy-load data-src when the visible
// src is just a placeholder. Then drop srcset so absolutize/Turndown use src.
function resolveResponsiveImages(root: HTMLElement): void {
  root.querySelectorAll('img').forEach((img) => {
    const srcset =
      img.getAttribute('srcset') ||
      img.getAttribute('data-srcset') ||
      img.closest('picture')?.querySelector('source[srcset]')?.getAttribute('srcset') ||
      '';
    const lazy = img.getAttribute('data-src') || img.getAttribute('data-original');

    let chosen = srcset ? largestSrcsetUrl(srcset) : null;
    if (!chosen && lazy && isPlaceholderSrc(img.getAttribute('src') || '')) {
      chosen = lazy;
    }
    if (chosen) img.setAttribute('src', chosen);
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
  });
  root.querySelectorAll('source[srcset]').forEach((el) => el.removeAttribute('srcset'));
}

// Resolve relative src/href in a cloned fragment to absolute URLs (selections
// carry no <base>, so relative image/link URLs would otherwise break / not
// localize).
function absolutizeUrls(root: HTMLElement): void {
  const fix = (el: Element, attr: string): void => {
    const value = el.getAttribute(attr);
    if (!value || /^(?:data|blob|mailto|javascript):/i.test(value)) return;
    try {
      el.setAttribute(attr, new URL(value, location.href).href);
    } catch {
      // leave as-is
    }
  };
  root.querySelectorAll('[src]').forEach((el) => fix(el, 'src'));
  root.querySelectorAll('a[href]').forEach((el) => fix(el, 'href'));
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
  absolutizeUrls(container);

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
