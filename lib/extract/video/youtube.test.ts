import { describe, expect, it } from 'vitest';
import {
  youTubeVideoId,
  extractAssignedJson,
  pickCaptionTrack,
  parseTimedTextXml,
  chaptersFromDescription,
} from './youtube';

describe('youTubeVideoId', () => {
  it('matches watch, shorts, live, embed and youtu.be URLs', () => {
    expect(youTubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youTubeVideoId('https://www.youtube.com/watch?app=desktop&v=dQw4w9WgXcQ&t=10s')).toBe('dQw4w9WgXcQ');
    expect(youTubeVideoId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(youTubeVideoId('https://www.youtube.com/live/dQw4w9WgXcQ?feature=share')).toBe('dQw4w9WgXcQ');
    expect(youTubeVideoId('https://youtu.be/dQw4w9WgXcQ?t=42')).toBe('dQw4w9WgXcQ');
    expect(youTubeVideoId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('rejects non-video pages and malformed ids', () => {
    expect(youTubeVideoId('https://www.youtube.com/')).toBeNull();
    expect(youTubeVideoId('https://www.youtube.com/@somechannel')).toBeNull();
    expect(youTubeVideoId('https://www.youtube.com/playlist?list=PL123')).toBeNull();
    expect(youTubeVideoId('https://www.youtube.com/watch?v=tooshort')).toBeNull();
    expect(youTubeVideoId('https://example.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(youTubeVideoId('not a url')).toBeNull();
  });
});

describe('extractAssignedJson', () => {
  it('extracts a JSON object with nested braces and brace-bearing strings', () => {
    const html = '<script>var ytInitialPlayerResponse = {"a":{"b":"}{"},"c":[1,2]};var other = 1;</script>';
    expect(extractAssignedJson(html, 'ytInitialPlayerResponse')).toEqual({ a: { b: '}{' }, c: [1, 2] });
  });

  it('handles escaped quotes inside strings', () => {
    const html = 'x = {"a":"say \\"hi\\" {now}"};';
    expect(extractAssignedJson(html, 'x')).toEqual({ a: 'say "hi" {now}' });
  });

  it('returns null when the marker is missing or the JSON is unterminated', () => {
    expect(extractAssignedJson('<html></html>', 'ytInitialPlayerResponse')).toBeNull();
    expect(extractAssignedJson('x = {"a":1', 'x')).toBeNull();
  });
});

describe('pickCaptionTrack', () => {
  const manualEn = { baseUrl: 'u1', languageCode: 'en', kind: undefined };
  const manualZh = { baseUrl: 'u2', languageCode: 'zh-Hans', kind: undefined };
  const asrEn = { baseUrl: 'u3', languageCode: 'en', kind: 'asr' };

  it('prefers manual over asr regardless of language rank', () => {
    expect(pickCaptionTrack([asrEn, manualZh], ['en', 'zh'])).toBe(manualZh);
  });

  it('follows the language preference within a tier', () => {
    expect(pickCaptionTrack([manualEn, manualZh], ['zh', 'en'])).toBe(manualZh);
    expect(pickCaptionTrack([manualEn, manualZh], ['en', 'zh'])).toBe(manualEn);
  });

  it('matches on the base language of a regioned preference', () => {
    expect(pickCaptionTrack([manualZh], ['zh-CN'])).toBe(manualZh);
  });

  it('falls back to asr when no manual track exists', () => {
    expect(pickCaptionTrack([asrEn], ['zh'])).toBe(asrEn);
  });

  it('ignores tracks without a baseUrl and handles empty input', () => {
    expect(pickCaptionTrack([{ languageCode: 'en' }], ['en'])).toBeNull();
    expect(pickCaptionTrack([], ['en'])).toBeNull();
  });
});

describe('parseTimedTextXml', () => {
  it('parses srv3 format with word-level <s> wrappers', () => {
    const xml =
      '<?xml version="1.0"?><timedtext format="3"><body>' +
      '<p t="0" d="2000"><s>hello</s><s> world</s></p>' +
      '<p t="2000" d="1500">plain text</p>' +
      '<p t="4000" d="100"></p>' + // empty cue
      '</body></timedtext>';
    expect(parseTimedTextXml(xml)).toEqual([
      { startSec: 0, endSec: 2, text: 'hello world' },
      { startSec: 2, endSec: 3.5, text: 'plain text' },
    ]);
  });

  it('parses legacy srv1 format with double-encoded entities', () => {
    const xml =
      '<transcript><text start="1.5" dur="2">don&amp;#39;t &amp;amp; do</text>' +
      '<text start="3.5" dur="1">next</text></transcript>';
    expect(parseTimedTextXml(xml)).toEqual([
      { startSec: 1.5, endSec: 3.5, text: "don't & do" },
      { startSec: 3.5, endSec: 4.5, text: 'next' },
    ]);
  });

  it('returns nothing for an empty or non-cue body', () => {
    expect(parseTimedTextXml('')).toEqual([]);
    expect(parseTimedTextXml('<timedtext><head></head></timedtext>')).toEqual([]);
  });
});

describe('chaptersFromDescription', () => {
  it('parses valid chapter lists', () => {
    const chapters = chaptersFromDescription(
      'Great video.\n0:00 Intro\n1:30 - Setup\n01:02:03 | Wrap up\nthanks for watching',
    );
    expect(chapters).toEqual([
      { startSec: 0, title: 'Intro' },
      { startSec: 90, title: 'Setup' },
      { startSec: 3723, title: 'Wrap up' },
    ]);
  });

  it('rejects fewer than 3 chapters', () => {
    expect(chaptersFromDescription('0:00 A\n1:00 B')).toEqual([]);
  });

  it('rejects lists not starting at 0:00', () => {
    expect(chaptersFromDescription('0:10 A\n1:00 B\n2:00 C')).toEqual([]);
  });

  it('rejects non-ascending lists', () => {
    expect(chaptersFromDescription('0:00 A\n2:00 B\n1:00 C')).toEqual([]);
  });

  it('handles missing description', () => {
    expect(chaptersFromDescription(undefined)).toEqual([]);
  });
});
