import { describe, expect, it } from 'vitest';
import { renderVideoClip, escapePlainTextBlock } from './render';
import type { VideoClip } from './types';

const LABELS = { transcript: 'Transcript', chapters: 'Chapters' };

function clip(overrides: Partial<VideoClip> = {}): VideoClip {
  return {
    meta: {
      platform: 'youtube',
      url: 'https://www.youtube.com/watch?v=abc12345678',
      embedUrl: 'https://www.youtube.com/embed/abc12345678',
      title: 'Test Video',
      author: 'Channel',
      published: '2026-01-02',
      durationSec: 125,
      description: 'First line of description.\nSecond line.',
    },
    chapters: [],
    transcript: [
      { startSec: 0, endSec: 2, text: 'hello' },
      { startSec: 2, endSec: 4, text: 'world' },
    ],
    transcriptKind: 'manual',
    timestampUrl: (sec) => `https://www.youtube.com/watch?v=abc12345678&t=${sec}s`,
    ...overrides,
  };
}

describe('renderVideoClip', () => {
  it('renders embed, description and a timestamped transcript', () => {
    const payload = renderVideoClip(clip(), LABELS);
    expect(payload.kind).toBe('markdown');
    expect(payload.markdown).toContain('<iframe src="https://www.youtube.com/embed/abc12345678"></iframe>');
    expect(payload.markdown).toContain('First line of description.');
    expect(payload.markdown).toContain('## Transcript');
    expect(payload.markdown).toContain('[0:00](https://www.youtube.com/watch?v=abc12345678&t=0s) hello world');
  });

  it('fills frontmatter with video metadata', () => {
    const fm = renderVideoClip(clip(), LABELS).frontmatter;
    expect(fm.title).toBe('Test Video');
    expect(fm.source).toBe('https://www.youtube.com/watch?v=abc12345678');
    expect(fm.author).toBe('Channel');
    expect(fm.published).toBe('2026-01-02');
    expect(fm.duration).toBe('2:05');
    expect(fm.description).toBe('First line of description. Second line.');
    expect(fm.transcript).toBe('manual');
    expect(fm.fallback).toBeUndefined();
  });

  it('renders chapter headings with deep links', () => {
    const payload = renderVideoClip(
      clip({
        chapters: [
          { startSec: 0, title: 'Intro' },
          { startSec: 2, title: 'Main' },
        ],
      }),
      LABELS,
    );
    expect(payload.markdown).toContain('### [0:00](https://www.youtube.com/watch?v=abc12345678&t=0s) Intro');
    expect(payload.markdown).toContain('### [0:02](https://www.youtube.com/watch?v=abc12345678&t=2s) Main');
  });

  it('records the missing transcript in frontmatter and keeps the chapter outline', () => {
    const payload = renderVideoClip(
      clip({
        transcript: [],
        transcriptIssue: 'bilibili subtitles require login',
        chapters: [{ startSec: 0, title: 'Intro' }],
      }),
      LABELS,
    );
    expect(payload.frontmatter.fallback).toBe('video-transcript-missing');
    expect(payload.frontmatter.fallbackReason).toBe('bilibili subtitles require login');
    expect(payload.frontmatter.transcript).toBeUndefined();
    expect(payload.markdown).toContain('## Chapters');
    expect(payload.markdown).toContain('- [0:00](https://www.youtube.com/watch?v=abc12345678&t=0s) Intro');
  });

  it('caps the frontmatter description summary', () => {
    const long = 'x'.repeat(300);
    const fm = renderVideoClip(clip({ meta: { ...clip().meta, description: long } }), LABELS).frontmatter;
    expect(fm.description?.length).toBe(200);
    expect(fm.description?.endsWith('…')).toBe(true);
  });

  it('never splits a surrogate pair when truncating the summary', () => {
    const emoji = '😀'.repeat(150); // 300 UTF-16 units, 150 code points
    const fm = renderVideoClip(clip({ meta: { ...clip().meta, description: emoji + 'tail'.repeat(20) } }), LABELS)
      .frontmatter;
    expect(fm.description).not.toMatch(/[\uD800-\uDBFF]…$/);
  });
});

describe('escapePlainTextBlock', () => {
  it('defuses setext underlines, lists, headings and fences', () => {
    expect(escapePlainTextBlock('Follow me:\n----------')).toBe('Follow me:\n\\----------');
    expect(escapePlainTextBlock('# not a heading')).toBe('\\# not a heading');
    expect(escapePlainTextBlock('- not a list')).toBe('\\- not a list');
    expect(escapePlainTextBlock('1. not a list')).toBe('1\\. not a list');
    expect(escapePlainTextBlock('```')).toBe('\\```');
  });

  it('escapes inline HTML openers and leaves prose alone', () => {
    expect(escapePlainTextBlock('use <enter> to submit')).toBe('use \\<enter> to submit');
    expect(escapePlainTextBlock('plain text https://a.b/c?d=1')).toBe('plain text https://a.b/c?d=1');
  });
});
