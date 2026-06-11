// VideoClip -> note payload. The video note format is defined here, once, for
// every platform (design §7.5.4): embed iframe, description, then the
// transcript as timestamp-deep-linked paragraphs under chapter headings.
//
// Pure (heading labels are passed in) so it stays unit-testable without the
// extension i18n runtime.

import type { MarkdownPayload } from '@/lib/handlers/types';
import type { VideoClip } from './types';
import { formatTimestamp, mergeIntoParagraphs, sectionByChapters } from './transcript';

export interface VideoRenderLabels {
  // Heading over the transcript when the video has no chapters.
  transcript: string;
  // Heading over the chapter outline when there are chapters but no transcript.
  chapters: string;
}

// Frontmatter description: the whole description flattened to one line and
// capped (the first line alone is often boilerplate — membership links etc.).
// Truncation counts code points so an emoji is never cut into a lone
// surrogate (which would corrupt the YAML value).
const SUMMARY_MAX_CHARS = 200;

function summaryLine(description: string | undefined): string | undefined {
  const flat = description?.replace(/\s+/g, ' ').trim();
  if (!flat) return undefined;
  const points = [...flat];
  return points.length > SUMMARY_MAX_CHARS ? `${points.slice(0, SUMMARY_MAX_CHARS - 1).join('')}…` : flat;
}

// Descriptions are plain text, but the note body is markdown: a '------' line
// would turn the line above into a setext heading, list/heading/quote
// prefixes would reflow lines into structure, and '<' starts inline HTML.
// Escape just those line-level triggers; URLs and prose stay readable.
export function escapePlainTextBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (/^\s{0,3}\d+[.)]\s/.test(line)) return line.replace(/^(\s*\d+)([.)])/, '$1\\$2');
      if (/^\s{0,3}(?:[#>+*-]|=+\s*$|`{3}|~{3})/.test(line)) return line.replace(/^(\s*)(\S)/, '$1\\$2');
      return line;
    })
    .join('\n')
    .replace(/</g, '\\<');
}

export function renderVideoClip(clip: VideoClip, labels: VideoRenderLabels): MarkdownPayload {
  const { meta } = clip;
  const link = (sec: number): string => `[${formatTimestamp(sec)}](${clip.timestampUrl(sec)})`;

  const blocks: string[] = [`<iframe src="${meta.embedUrl}"></iframe>`];
  const description = meta.description?.trim();
  if (description) blocks.push(escapePlainTextBlock(description));

  const paragraphs = mergeIntoParagraphs(clip.transcript, clip.chapters);
  if (paragraphs.length > 0) {
    blocks.push(`## ${labels.transcript}`);
    for (const section of sectionByChapters(paragraphs, clip.chapters)) {
      if (section.chapter) blocks.push(`### ${link(section.chapter.startSec)} ${section.chapter.title}`);
      blocks.push(...section.paragraphs.map((p) => `${link(p.startSec)} ${p.text}`));
    }
  } else if (clip.chapters.length > 0) {
    // No transcript but the platform knows the chapters: keep the outline,
    // each entry deep-linking into the video.
    blocks.push(`## ${labels.chapters}`);
    blocks.push(clip.chapters.map((c) => `- ${link(c.startSec)} ${c.title}`).join('\n'));
  }

  const payload: MarkdownPayload = {
    kind: 'markdown',
    title: meta.title,
    markdown: blocks.join('\n\n'),
    frontmatter: {
      title: meta.title,
      source: meta.url,
      author: meta.author,
      published: meta.published,
      description: summaryLine(description),
      duration: meta.durationSec !== undefined ? formatTimestamp(meta.durationSec) : undefined,
      transcript: clip.transcript.length > 0 ? clip.transcriptKind : undefined,
    },
  };
  if (clip.transcript.length === 0) {
    payload.frontmatter.fallback = 'video-transcript-missing';
    payload.frontmatter.fallbackReason = clip.transcriptIssue ?? 'no transcript available';
  }
  return payload;
}
