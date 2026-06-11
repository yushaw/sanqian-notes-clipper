import { describe, expect, it } from 'vitest';
import { decodeHtmlEntities } from './entities';

describe('decodeHtmlEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeHtmlEntities('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x4e2d;')).toBe('a & b <c> "d" \'e\' 中');
  });

  it('leaves unknown entities and plain text untouched', () => {
    expect(decodeHtmlEntities('&unknown; plain')).toBe('&unknown; plain');
  });

  it('leaves out-of-range numeric references untouched instead of throwing', () => {
    expect(decodeHtmlEntities('&#x110000; and &#1234567890;')).toBe('&#x110000; and &#1234567890;');
  });
});
