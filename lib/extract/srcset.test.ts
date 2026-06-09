import { describe, it, expect } from 'vitest';
import { largestSrcsetUrl, isPlaceholderSrc } from './srcset';

describe('largestSrcsetUrl', () => {
  it('picks the largest width descriptor', () => {
    expect(largestSrcsetUrl('a.jpg 320w, b.jpg 640w, c.jpg 480w')).toBe('b.jpg');
  });

  it('picks the highest density descriptor', () => {
    expect(largestSrcsetUrl('a.jpg 1x, b.jpg 2x')).toBe('b.jpg');
  });

  it('handles a single candidate with no descriptor', () => {
    expect(largestSrcsetUrl('only.jpg')).toBe('only.jpg');
  });

  it('keeps the first on a tie (no descriptors)', () => {
    expect(largestSrcsetUrl('a.jpg, b.jpg')).toBe('a.jpg');
  });

  it('does not split on commas inside a data: URI', () => {
    expect(largestSrcsetUrl('data:image/png;base64,AAA 1x, https://x/y.jpg 2x')).toBe(
      'https://x/y.jpg',
    );
  });

  it('handles commas inside a regular URL', () => {
    expect(largestSrcsetUrl('https://cdn/img,w_300 300w, https://cdn/img,w_900 900w')).toBe(
      'https://cdn/img,w_900',
    );
  });

  it('tolerates extra whitespace', () => {
    expect(largestSrcsetUrl('  a.jpg   320w ,  b.jpg   640w  ')).toBe('b.jpg');
  });

  it('returns null for an empty set', () => {
    expect(largestSrcsetUrl('')).toBeNull();
    expect(largestSrcsetUrl('   ')).toBeNull();
  });
});

describe('isPlaceholderSrc', () => {
  it('flags empty, data:, and known placeholder tokens', () => {
    expect(isPlaceholderSrc('')).toBe(true);
    expect(isPlaceholderSrc('data:image/gif;base64,R0lGOD')).toBe(true);
    expect(isPlaceholderSrc('https://x/spacer.gif')).toBe(true);
    expect(isPlaceholderSrc('https://x/1x1.png')).toBe(true);
  });

  it('does not flag a normal image URL', () => {
    expect(isPlaceholderSrc('https://x/photo-large.jpg')).toBe(false);
  });
});
