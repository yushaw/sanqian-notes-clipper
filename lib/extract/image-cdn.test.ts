import { describe, it, expect } from 'vitest';
import { upgradeImageUrl } from './image-cdn';

describe('upgradeImageUrl', () => {
  describe('Wikimedia', () => {
    it('strips /thumb/ and the size variant for a raster thumbnail', () => {
      expect(
        upgradeImageUrl(
          'https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Transformer%2C_full_architecture.png/250px-Transformer%2C_full_architecture.png',
        ),
      ).toBe(
        'https://upload.wikimedia.org/wikipedia/commons/3/34/Transformer%2C_full_architecture.png',
      );
    });

    it('recovers the .svg vector original from an .svg.png thumbnail', () => {
      expect(
        upgradeImageUrl(
          'https://upload.wikimedia.org/wikipedia/en/thumb/f/f2/Edit-clear.svg/40px-Edit-clear.svg.png',
        ),
      ).toBe('https://upload.wikimedia.org/wikipedia/en/f/f2/Edit-clear.svg');
    });

    it('leaves an already-original (non-thumb) URL unchanged', () => {
      const original =
        'https://upload.wikimedia.org/wikipedia/commons/1/1b/Transformer%2C_attention_block_diagram.png';
      expect(upgradeImageUrl(original)).toBe(original);
    });
  });

  describe('WeChat mmbiz', () => {
    it('swaps the size cap for /0 and drops tp=webp', () => {
      expect(
        upgradeImageUrl('https://mmbiz.qpic.cn/sz_mmbiz_gif/abcDEF123/640?wx_fmt=gif&from=appmsg&tp=webp'),
      ).toBe('https://mmbiz.qpic.cn/sz_mmbiz_gif/abcDEF123/0?wx_fmt=gif&from=appmsg');
    });

    it('leaves an already-original /0 URL unchanged', () => {
      const original = 'https://mmbiz.qpic.cn/mmbiz_png/abc/0?wx_fmt=png';
      expect(upgradeImageUrl(original)).toBe(original);
    });

    it('drops tp=webp even when the size is already /0', () => {
      expect(upgradeImageUrl('https://mmbiz.qpic.cn/mmbiz_png/abc/0?wx_fmt=png&tp=webp')).toBe(
        'https://mmbiz.qpic.cn/mmbiz_png/abc/0?wx_fmt=png',
      );
    });

    it('leaves non-numeric trailing segments alone', () => {
      const odd = 'https://mmbiz.qpic.cn/mmbiz_png/abc/cover.png?wx_fmt=png';
      expect(upgradeImageUrl(odd)).toBe(odd);
    });
  });

  it('passes through URLs from unknown hosts', () => {
    const other = 'https://example.com/images/thumb/a/b/photo.jpg/250px-photo.jpg';
    expect(upgradeImageUrl(other)).toBe(other);
  });

  it('passes through data: and relative URLs untouched', () => {
    expect(upgradeImageUrl('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(upgradeImageUrl('/foo/bar.png')).toBe('/foo/bar.png');
  });
});
