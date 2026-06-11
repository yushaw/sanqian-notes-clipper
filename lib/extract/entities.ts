// Minimal HTML/XML entity decoding, DOM-free so it is usable and testable in
// any context (caption XML in the video providers, inline-script string
// literals in the wechat handler).

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code = /^#x/i.test(name) ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}
