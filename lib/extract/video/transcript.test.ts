import { describe, expect, it } from 'vitest';
import { formatTimestamp, mergeIntoParagraphs, sectionByChapters } from './transcript';

describe('formatTimestamp', () => {
  it('formats minutes and seconds', () => {
    expect(formatTimestamp(0)).toBe('0:00');
    expect(formatTimestamp(59)).toBe('0:59');
    expect(formatTimestamp(61.9)).toBe('1:01');
    expect(formatTimestamp(600)).toBe('10:00');
  });

  it('formats hours with padded minutes', () => {
    expect(formatTimestamp(3661)).toBe('1:01:01');
    expect(formatTimestamp(7200)).toBe('2:00:00');
  });
});

describe('mergeIntoParagraphs', () => {
  it('merges contiguous cues into one paragraph', () => {
    const paragraphs = mergeIntoParagraphs([
      { startSec: 0, endSec: 2, text: 'hello' },
      { startSec: 2, endSec: 4, text: 'world' },
    ]);
    expect(paragraphs).toEqual([{ startSec: 0, text: 'hello world' }]);
  });

  it('keeps cue boundaries as a space for unpunctuated CJK captions', () => {
    const paragraphs = mergeIntoParagraphs([
      { startSec: 0, endSec: 2, text: '你好' },
      { startSec: 2, endSec: 4, text: '世界' },
    ]);
    expect(paragraphs[0].text).toBe('你好 世界');
  });

  it('adds no separator after existing punctuation', () => {
    const paragraphs = mergeIntoParagraphs([
      { startSec: 0, endSec: 2, text: '你好。' },
      { startSec: 2, endSec: 4, text: '世界，' },
      { startSec: 4, endSec: 6, text: '再见' },
    ]);
    expect(paragraphs[0].text).toBe('你好。世界，再见');
  });

  it('breaks on a silence gap', () => {
    const paragraphs = mergeIntoParagraphs([
      { startSec: 0, endSec: 2, text: 'one' },
      { startSec: 10, endSec: 12, text: 'two' },
    ]);
    expect(paragraphs.map((p) => p.startSec)).toEqual([0, 10]);
  });

  it('breaks at chapter boundaries', () => {
    const paragraphs = mergeIntoParagraphs(
      [
        { startSec: 0, endSec: 5, text: 'intro' },
        { startSec: 5, endSec: 10, text: 'body' },
      ],
      [{ startSec: 5, title: 'Body' }],
    );
    expect(paragraphs.map((p) => p.startSec)).toEqual([0, 5]);
  });

  it('breaks when a paragraph grows past the length cap', () => {
    const cues = Array.from({ length: 30 }, (_, i) => ({
      startSec: i * 2,
      endSec: i * 2 + 2,
      text: 'twenty five characters!!!',
    }));
    const paragraphs = mergeIntoParagraphs(cues);
    expect(paragraphs.length).toBeGreaterThan(1);
    for (const p of paragraphs) expect(p.text.length).toBeLessThan(700);
  });

  it('delays the length break to a sentence boundary for punctuated captions', () => {
    const long = 'x'.repeat(120);
    const paragraphs = mergeIntoParagraphs([
      { startSec: 0, endSec: 6, text: `${long}.` },
      { startSec: 6, endSec: 12, text: `${long}.` },
      { startSec: 12, endSec: 18, text: `${long},` }, // over the soft cap, mid-sentence -> wait
      { startSec: 18, endSec: 24, text: `${long}.` }, // sentence ends here -> break after
      { startSec: 24, endSec: 26, text: 'done.' },
    ]);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].text.endsWith('.')).toBe(true);
    expect(paragraphs[1].text).toBe('done.');
  });

  it('ignores stray decimal dots when deciding the track is punctuated', () => {
    // Unpunctuated cues except numbers like "3.0" inside the text: must
    // split at the soft cap (largest pause), not wait for the hard cap.
    const text = '这里有个数字3.0但没有标点';
    const cues = Array.from({ length: 20 }, (_, i) => ({
      startSec: i * 3,
      endSec: i * 3 + 3,
      text,
    }));
    const paragraphs = mergeIntoParagraphs(cues);
    for (let i = 1; i < paragraphs.length; i++) {
      expect(paragraphs[i].startSec - paragraphs[i - 1].startSec).toBeLessThanOrEqual(33);
    }
  });

  it('breaks CJK text at roughly half the latin char cap', () => {
    // 60 cues x 10 CJK chars, 1.5s apart: 600 chars total, weighted x2.
    const cues = Array.from({ length: 60 }, (_, i) => ({
      startSec: i * 1.5,
      endSec: i * 1.5 + 1.5,
      text: '这是一段中文字幕内容',
    }));
    const paragraphs = mergeIntoParagraphs(cues);
    expect(paragraphs.length).toBeGreaterThanOrEqual(3);
    for (const p of paragraphs) expect(p.text.length).toBeLessThanOrEqual(200);
  });

  it('breaks at speaker-change markers and strips them', () => {
    const paragraphs = mergeIntoParagraphs([
      { startSec: 0, endSec: 2, text: '>> JOHN: hello there' },
      { startSec: 2, endSec: 4, text: 'more from john' },
      { startSec: 4, endSec: 6, text: '>> MARY: hi' },
    ]);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].text).toBe('JOHN: hello there more from john');
    expect(paragraphs[1].text).toBe('MARY: hi');
  });

  it('treats a leading dash as house style, not a speaker change, when most cues have it', () => {
    const cues = Array.from({ length: 6 }, (_, i) => ({
      startSec: i * 2,
      endSec: i * 2 + 2,
      text: `- line ${i}`,
    }));
    const paragraphs = mergeIntoParagraphs(cues);
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0].text).toBe('line 0 line 1 line 2 line 3 line 4 line 5');
  });

  it('splits unpunctuated text at the largest pause past the minimum span', () => {
    // 33s of cues with a 3s pause at 20s (below the 5s hard gap break).
    const text = '无标点中文内容';
    const paragraphs = mergeIntoParagraphs([
      { startSec: 0, endSec: 5, text },
      { startSec: 5, endSec: 10, text },
      { startSec: 10, endSec: 15, text },
      { startSec: 15, endSec: 20, text },
      { startSec: 23, endSec: 28, text },
      { startSec: 28, endSec: 33, text },
    ]);
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[1].startSec).toBe(23);
  });

  it('drops empty cues and collapses whitespace', () => {
    const paragraphs = mergeIntoParagraphs([
      { startSec: 0, endSec: 1, text: '  \n ' },
      { startSec: 1, endSec: 2, text: 'a  b\nc' },
    ]);
    expect(paragraphs).toEqual([{ startSec: 1, text: 'a b c' }]);
  });
});

describe('sectionByChapters', () => {
  const paragraphs = [
    { startSec: 0, text: 'lead' },
    { startSec: 30, text: 'one' },
    { startSec: 90, text: 'two' },
  ];

  it('returns a single untitled section without chapters', () => {
    expect(sectionByChapters(paragraphs, [])).toEqual([{ paragraphs }]);
  });

  it('returns nothing for an empty transcript without chapters', () => {
    expect(sectionByChapters([], [])).toEqual([]);
  });

  it('slices paragraphs into chapters with an untitled lead', () => {
    const chapters = [
      { startSec: 30, title: 'A' },
      { startSec: 60, title: 'B' },
    ];
    const sections = sectionByChapters(paragraphs, chapters);
    expect(sections).toHaveLength(3);
    expect(sections[0].chapter).toBeUndefined();
    expect(sections[0].paragraphs.map((p) => p.text)).toEqual(['lead']);
    expect(sections[1].chapter?.title).toBe('A');
    expect(sections[1].paragraphs.map((p) => p.text)).toEqual(['one']);
    expect(sections[2].chapter?.title).toBe('B');
    expect(sections[2].paragraphs.map((p) => p.text)).toEqual(['two']);
  });

  it('keeps a chapter with no paragraphs', () => {
    const sections = sectionByChapters([{ startSec: 0, text: 'x' }], [
      { startSec: 0, title: 'A' },
      { startSec: 100, title: 'B' },
    ]);
    expect(sections).toHaveLength(2);
    expect(sections[1].paragraphs).toEqual([]);
  });
});
