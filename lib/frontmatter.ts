// Build the note content (YAML frontmatter + body) for a markdown clip.
// Notes' markdown->tiptap converter parses the frontmatter block into a
// Frontmatter node.

import type { ClipFrontmatter, MarkdownPayload } from './handlers/types';

// Quote values that would otherwise break YAML flow scalars. Conservative:
// only a small set of plainly-safe characters stay unquoted; anything with a
// colon, hash, bracket, quote, etc. is double-quoted (JSON encoding is valid
// YAML). This avoids "title: a: b" being parsed as a nested mapping.
function yamlScalar(value: string): string {
  const safe = /^[\w .,/()+-]+$/.test(value);
  return safe ? value : JSON.stringify(value);
}

export function buildFrontmatter(fm: ClipFrontmatter): string {
  const lines = ['---', `title: ${yamlScalar(fm.title)}`, `source: ${yamlScalar(fm.source)}`];
  if (fm.author) lines.push(`author: ${yamlScalar(fm.author)}`);
  if (fm.published) lines.push(`published: ${yamlScalar(fm.published)}`);
  if (fm.description) lines.push(`description: ${yamlScalar(fm.description)}`);
  if (fm.duration) lines.push(`duration: ${yamlScalar(fm.duration)}`);
  if (fm.transcript) lines.push(`transcript: ${yamlScalar(fm.transcript)}`);
  if (fm.fallback) lines.push(`fallback: ${yamlScalar(fm.fallback)}`);
  if (fm.fallbackReason) lines.push(`fallback_reason: ${yamlScalar(fm.fallbackReason)}`);
  lines.push('---', '');
  return lines.join('\n');
}

export function buildNoteContent(payload: MarkdownPayload): string {
  return `${buildFrontmatter(payload.frontmatter)}${payload.markdown}\n`;
}
