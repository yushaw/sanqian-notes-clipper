import { describe, expect, it } from 'vitest';
import { parseBilibiliVideoUrl, normalizeSubtitleUrl, pickSubtitleTrack } from './bilibili';

describe('parseBilibiliVideoUrl', () => {
  it('parses BV and av video URLs', () => {
    expect(parseBilibiliVideoUrl('https://www.bilibili.com/video/BV1GJ411x7h7')).toEqual({
      bvid: 'BV1GJ411x7h7',
      page: 1,
    });
    expect(parseBilibiliVideoUrl('https://www.bilibili.com/video/BV1GJ411x7h7/?vd_source=abc')).toEqual({
      bvid: 'BV1GJ411x7h7',
      page: 1,
    });
    expect(parseBilibiliVideoUrl('https://www.bilibili.com/video/av170001')).toEqual({ aid: 170001, page: 1 });
  });

  it('parses the part number', () => {
    expect(parseBilibiliVideoUrl('https://www.bilibili.com/video/BV1GJ411x7h7?p=3')).toEqual({
      bvid: 'BV1GJ411x7h7',
      page: 3,
    });
    expect(parseBilibiliVideoUrl('https://www.bilibili.com/video/BV1GJ411x7h7?p=bogus')).toEqual({
      bvid: 'BV1GJ411x7h7',
      page: 1,
    });
  });

  it('rejects non-video bilibili pages and other hosts', () => {
    expect(parseBilibiliVideoUrl('https://www.bilibili.com/')).toBeNull();
    expect(parseBilibiliVideoUrl('https://www.bilibili.com/bangumi/play/ep123')).toBeNull();
    expect(parseBilibiliVideoUrl('https://space.bilibili.com/123')).toBeNull();
    expect(parseBilibiliVideoUrl('https://evil.com/video/BV1GJ411x7h7')).toBeNull();
    expect(parseBilibiliVideoUrl('https://notbilibili.com/video/BV1GJ411x7h7')).toBeNull();
  });
});

describe('normalizeSubtitleUrl', () => {
  it('upgrades http and protocol-relative URLs to https', () => {
    expect(normalizeSubtitleUrl('http://aisubtitle.hdslb.com/x.json')).toBe('https://aisubtitle.hdslb.com/x.json');
    expect(normalizeSubtitleUrl('//aisubtitle.hdslb.com/x.json')).toBe('https://aisubtitle.hdslb.com/x.json');
    expect(normalizeSubtitleUrl('https://aisubtitle.hdslb.com/x.json')).toBe('https://aisubtitle.hdslb.com/x.json');
  });
});

describe('pickSubtitleTrack', () => {
  const manualZh = { lan: 'zh-CN', subtitle_url: 'u1' };
  const manualEn = { lan: 'en-US', subtitle_url: 'u2' };
  const aiZh = { lan: 'ai-zh', subtitle_url: 'u3' };
  const placeholder = { lan: 'zh-CN', subtitle_url: '' };

  it('prefers manual zh over everything', () => {
    expect(pickSubtitleTrack([aiZh, manualEn, manualZh])).toBe(manualZh);
  });

  it('prefers any manual track over AI tracks', () => {
    expect(pickSubtitleTrack([aiZh, manualEn])).toBe(manualEn);
  });

  it('falls back to AI zh, then to anything usable', () => {
    expect(pickSubtitleTrack([aiZh])).toBe(aiZh);
    const aiEn = { lan: 'ai-en', subtitle_url: 'u4' };
    expect(pickSubtitleTrack([aiEn])).toBe(aiEn);
  });

  it('skips placeholder entries without a subtitle_url', () => {
    expect(pickSubtitleTrack([placeholder])).toBeNull();
    expect(pickSubtitleTrack([placeholder, aiZh])).toBe(aiZh);
  });
});
