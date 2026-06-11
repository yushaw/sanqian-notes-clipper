// DOM-fragment repairs shared by every handler that feeds a detached clone to
// Turndown (selection mode in chain.ts, the wechat handler, future handlers).
// Single source of truth for lazy-load attribute conventions and URL
// absolutization — site handlers must not grow their own copies.

import { largestSrcsetUrl, isPlaceholderSrc } from './srcset';

// Lazy-load attributes that carry the real image URL, in priority order.
const LAZY_SRC_ATTRS = ['data-src', 'data-original', 'data-lazy-src'];

// Resolve responsive/lazy-loaded images to the best candidate the page
// references, then drop srcset so downstream conversion uses src: prefer the
// largest srcset candidate (from the <img> or its <picture> sources), else a
// lazy-load attribute when the visible src is just a placeholder (or missing
// entirely, as on WeChat articles).
export function resolveResponsiveImages(root: HTMLElement): void {
  root.querySelectorAll('img').forEach((img) => {
    const srcset =
      img.getAttribute('srcset') ||
      img.getAttribute('data-srcset') ||
      img.closest('picture')?.querySelector('source[srcset]')?.getAttribute('srcset') ||
      '';
    const lazy = LAZY_SRC_ATTRS.map((attr) => img.getAttribute(attr)).find(Boolean);

    let chosen = srcset ? largestSrcsetUrl(srcset) : null;
    if (!chosen && lazy && isPlaceholderSrc(img.getAttribute('src') || '')) {
      chosen = lazy;
    }
    if (chosen) img.setAttribute('src', chosen);
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
  });
  root.querySelectorAll('source[srcset]').forEach((el) => el.removeAttribute('srcset'));
}

// Resolve relative src/href in a cloned fragment to absolute URLs against a
// base (detached fragments carry no <base>, so relative image/link URLs would
// otherwise break or fail to localize).
export function absolutizeUrls(root: HTMLElement, baseUrl: string): void {
  const fix = (el: Element, attr: string): void => {
    const value = el.getAttribute(attr);
    if (!value || /^(?:data|blob|mailto|javascript):/i.test(value)) return;
    try {
      el.setAttribute(attr, new URL(value, baseUrl).href);
    } catch {
      // leave as-is
    }
  };
  root.querySelectorAll('[src]').forEach((el) => fix(el, 'src'));
  root.querySelectorAll('a[href]').forEach((el) => fix(el, 'href'));
}
