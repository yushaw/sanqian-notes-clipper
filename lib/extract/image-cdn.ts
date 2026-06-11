// Per-host "thumbnail -> original" image URL upgrades.
//
// General image resolution (largest srcset candidate, lazy-load, noscript
// fallbacks) is handled upstream: by Defuddle in article mode and by
// resolveResponsiveImages() in selection mode. That only ever yields the best
// candidate the page itself references -- which for many image CDNs is still a
// downscaled thumbnail. This layer recovers the *original* full-resolution file
// that sites deliberately keep out of the page DOM, for known CDNs.
//
// Each rule must degrade safely: the caller fetches the upgraded URL and falls
// back to the original in-page URL on any failure (see background.ts), so a
// rule that produces a dead URL never loses the image. Keep transforms pure and
// conservative -- only rewrite when the URL unambiguously matches the CDN's
// thumbnail shape. Adding a CDN = adding one entry.

interface CdnRule {
  // Matched against the URL's hostname.
  host: RegExp;
  // Returns the upgraded URL string, or null when the rule does not apply.
  upgrade(u: URL): string | null;
}

const RULES: CdnRule[] = [
  // Wikimedia (Wikipedia / Commons). In-article images are thumbnails:
  //   /wikipedia/commons/thumb/3/34/Name.png/250px-Name.png
  // The original drops the /thumb/ segment and the trailing size variant:
  //   /wikipedia/commons/3/34/Name.png
  // The same transform recovers SVG originals too
  //   (.../Name.svg/250px-Name.svg.png -> .../Name.svg),
  // which Sanqian Notes renders inline as vectors.
  {
    host: /(^|\.)wikimedia\.org$/i,
    upgrade(u) {
      const m = /^(\/wikipedia\/[^/]+)\/thumb\/(.+)\/[^/]+$/.exec(u.pathname);
      if (!m) return null;
      u.pathname = `${m[1]}/${m[2]}`;
      return u.href;
    },
  },

  // WeChat article CDN (mmbiz.qpic.cn). The last path segment is a size cap:
  //   /mmbiz_jpg/<id>/640?wx_fmt=jpeg  (also /300 etc.); /0 is the original.
  // Arbitrary other values (e.g. /1000) answer an empty body, so only swap a
  // known numeric cap for 0. Also drop tp=webp so the download keeps the
  // source format (wx_fmt) instead of a webp transcode.
  {
    host: /(^|\.)mmbiz\.qpic\.cn$/i,
    upgrade(u) {
      let changed = false;
      const m = /^(.*\/)(\d+)\/?$/.exec(u.pathname);
      if (m && m[2] !== '0') {
        u.pathname = `${m[1]}0`;
        changed = true;
      }
      if (u.searchParams.get('tp') === 'webp') {
        u.searchParams.delete('tp');
        changed = true;
      }
      return changed ? u.href : null;
    },
  },
];

// Upgrade a remote image URL to its original via a known-CDN rule, or return it
// unchanged. Non-absolute / non-http(s) URLs are returned as-is (the caller
// handles data:/relative separately).
export function upgradeImageUrl(rawUrl: string): string {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return rawUrl;
  for (const rule of RULES) {
    if (!rule.host.test(u.hostname)) continue;
    const upgraded = rule.upgrade(u);
    if (upgraded) return upgraded;
  }
  return rawUrl;
}
