// Build the note content (YAML frontmatter + body) for a markdown clip.
// Notes' markdown->tiptap converter parses the frontmatter block into a
// Frontmatter node.

import type { ClipFrontmatter, MarkdownPayload } from './handlers/types';

const CLIPPER_ID = 'sanqian-notes-clipper/0.0.1';
const CLIPPED_TAG = 'clipped';

// Quote values that would otherwise break YAML flow scalars. Conservative:
// only a small set of plainly-safe characters stay unquoted; anything with a
// colon, hash, bracket, quote, etc. is double-quoted (JSON encoding is valid
// YAML). This avoids "title: a: b" being parsed as a nested mapping.
function yamlScalar(value: string): string {
  const safe = /^[\w .,/()+-]+$/.test(value);
  return safe ? value : JSON.stringify(value);
}

export function buildFrontmatter(fm: ClipFrontmatter, clippedAt: string): string {
  const lines = ['---', `title: ${yamlScalar(fm.title)}`, `source: ${yamlScalar(fm.source)}`];
  if (fm.author) lines.push(`author: ${yamlScalar(fm.author)}`);
  if (fm.published) lines.push(`published: ${yamlScalar(fm.published)}`);
  if (fm.description) lines.push(`description: ${yamlScalar(fm.description)}`);
  if (fm.fallback) lines.push(`fallback: ${yamlScalar(fm.fallback)}`);
  if (fm.fallbackReason) lines.push(`fallback_reason: ${yamlScalar(fm.fallbackReason)}`);
  lines.push(`clipped: ${clippedAt}`, `clipper: ${CLIPPER_ID}`, `tags: [${CLIPPED_TAG}]`, '---', '');
  return lines.join('\n');
}

export function buildNoteContent(payload: MarkdownPayload, clippedAt: string): string {
  return `${buildFrontmatter(payload.frontmatter, clippedAt)}${payload.markdown}\n`;
}
