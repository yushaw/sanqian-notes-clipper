// HTML fragment -> Markdown, used for selection-mode clips where we hold an
// HTML fragment rather than a full document (generic mode uses Defuddle's own
// Markdown output). Configured to match Sanqian Notes' Markdown conventions.

import TurndownService from 'turndown';
import { gfm } from '@joplin/turndown-plugin-gfm';

let service: TurndownService | null = null;

function getService(): TurndownService {
  if (service) {
    return service;
  }
  const s = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    hr: '---',
    linkStyle: 'inlined',
  });
  s.use(gfm);
  service = s;
  return s;
}

export function htmlFragmentToMarkdown(html: string): string {
  return getService().turndown(html).trim();
}
