// Pure helpers for resolving responsive/lazy <img> sources. Kept DOM-free so
// they can be unit-tested without a browser environment (chain.ts wires them
// into the live/cloned DOM).

const isWhitespace = (c: string): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

// Pick the highest-resolution URL from a srcset attribute value.
//
// Candidates are comma-separated `url [descriptor]` pairs, but a URL may itself
// contain commas (notably `data:` URIs), so we tokenize per the HTML spec's
// shape rather than naively splitting on commas: read a URL up to whitespace,
// then (unless the URL carried trailing commas, i.e. had no descriptor) read a
// descriptor up to the next comma. Width 'NNNw' and density 'Nx' descriptors
// both reduce to a numeric score; a valid srcset uses a single kind, so plain
// max ordering is correct. Ties keep the first candidate. Returns null for an
// empty/unparseable set.
//
// Known limitation: candidates separated by a bare comma with no following
// whitespace AND a URL that itself contains commas are inherently ambiguous and
// may misparse — this does not occur in well-formed srcset values.
export function largestSrcsetUrl(srcset: string): string | null {
  let best: string | null = null;
  let bestScore = -1;
  let i = 0;
  const n = srcset.length;

  while (i < n) {
    while (i < n && (isWhitespace(srcset[i]) || srcset[i] === ',')) i++;
    if (i >= n) break;

    const start = i;
    while (i < n && !isWhitespace(srcset[i])) i++;
    let url = srcset.slice(start, i);
    const hadTrailingComma = /,+$/.test(url);
    url = url.replace(/,+$/, '');

    let descriptor = '';
    if (!hadTrailingComma) {
      while (i < n && srcset[i] !== ',') descriptor += srcset[i++];
    }
    if (i < n && srcset[i] === ',') i++;

    if (!url) continue;
    const m = /^([\d.]+)[wx]$/.exec(descriptor.trim() || '1x');
    const score = m ? parseFloat(m[1]) : 1;
    if (score > bestScore) {
      bestScore = score;
      best = url;
    }
  }
  return best;
}

// Whether an <img> src looks like a lazy-load placeholder rather than the real
// image, so a data-src/data-original should win over it.
export function isPlaceholderSrc(src: string): boolean {
  return !src || /^data:/i.test(src) || /\b(?:blank|spacer|placeholder|1x1|transparent)\b/i.test(src);
}
