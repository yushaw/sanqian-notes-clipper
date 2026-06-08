// The clip handler chain. Runs inside the page (content script).
//
// Order (auto mode): arxiv (delegate) -> generic article (Defuddle).
// Selection mode bypasses the chain. PDF detection (design §7.3, plan C) and
// future handlers (YouTube, X, ...) slot in here.

import Defuddle from 'defuddle/full';
import type { ClipMode, ClipPayload } from '@/lib/handlers/types';
import { isArxivUrl } from './arxiv';
import { htmlFragmentToMarkdown } from './turndown';

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
  const markdown = (result.content || '').trim();

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

function extractSelection(url: string): ClipPayload {
  const selection = window.getSelection();
  let markdown = '';

  if (selection && selection.rangeCount > 0 && !selection.isCollapsed) {
    const container = document.createElement('div');
    for (let i = 0; i < selection.rangeCount; i++) {
      container.appendChild(selection.getRangeAt(i).cloneContents());
    }
    markdown = htmlFragmentToMarkdown(container.innerHTML);
  }

  const title = document.title || 'Untitled';
  return {
    kind: 'markdown',
    title,
    markdown: markdown || `Clipped from [${url}](${url})`,
    frontmatter: { title, source: url },
  };
}
