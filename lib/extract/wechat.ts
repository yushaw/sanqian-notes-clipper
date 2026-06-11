// WeChat official-account article handler (mp.weixin.qq.com/s..., design
// §7.6). Generic Defuddle extraction breaks on these pages, so the body is
// converted directly from #js_content with Turndown after DOM repairs:
//
// - Article <img> elements have NO src at all — the real URL lives in
//   data-src and is copied into src only when the image scrolls into view
//   (IntersectionObserver). Unscrolled and carousel images would all be lost.
// - #js_content starts as visibility:hidden;opacity:0 (page JS reveals it),
//   which Defuddle's hidden-element removal can delete wholesale.
// - Formatter-generated code blocks (one <code> per line, or <br> line
//   breaks) collapse to a single line under naive HTML->MD conversion.
// - Channels-video / voice components are signed, expiring streams the clip
//   cannot persist; they degrade to a link back to the article.
//
// Size-cap upgrade of mmbiz image URLs (/640 -> /0, tp=webp removal) happens
// at download time via the image-cdn rule, with safe fallback. The mmbiz CDN
// answers CORS only to qq-family origins, but the manifest's <all_urls> host
// permission (WXT-injected for the runtime content script) exempts the
// background worker's downloads from CORS.

import type { MarkdownPayload } from '@/lib/handlers/types';
import { htmlFragmentToMarkdown } from './turndown';
import { normalizeBlockMath } from './normalize-block-math';
import { resolveResponsiveImages, absolutizeUrls } from './fragment';
import { decodeHtmlEntities } from './entities';
import { epochToLocalDate } from './epoch-date';

export function isWeChatArticleUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  return url.hostname === 'mp.weixin.qq.com' && (url.pathname === '/s' || url.pathname.startsWith('/s/'));
}

// Publish time has no meta tag; the reliable source is the inline-script
// variable `var ct = "<epoch seconds>"`.
export function publishedFromPageScripts(scriptTexts: string[]): string | undefined {
  for (const text of scriptTexts) {
    const m = /var\s+ct\s*=\s*"?(\d{9,11})"?/.exec(text);
    if (m) return epochToLocalDate(Number(m[1]));
  }
  return undefined;
}

// Account name fallback when #js_name is missing: `var nickname =
// htmlDecode("...")`. The embedded string is HTML-encoded (that is what the
// page's htmlDecode is for) and may contain backslash-escaped quotes, so
// unescape then decode. (og:article:author is the article's author field, a
// different thing from the account name.)
export function nicknameFromPageScripts(scriptTexts: string[]): string | undefined {
  for (const text of scriptTexts) {
    const m = /var\s+nickname\s*=\s*(?:htmlDecode\()?"((?:[^"\\]|\\.)*)"/.exec(text);
    if (m) return decodeHtmlEntities(m[1].replace(/\\(.)/g, '$1'));
  }
  return undefined;
}

// Normalize formatter code blocks to a single <pre><code> with real newlines
// so Turndown emits a fenced block instead of one merged line.
function normalizeCodeBlocks(root: HTMLElement): void {
  root.querySelectorAll('pre').forEach((pre) => {
    const codes = pre.querySelectorAll('code');
    let text: string;
    if (codes.length > 1) {
      text = [...codes].map((code) => code.textContent ?? '').join('\n');
    } else {
      const target = codes[0] ?? pre;
      target.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
      text = target.textContent ?? '';
    }
    const code = document.createElement('code');
    code.textContent = text.replace(/\u00a0/g, ' ').replace(/\s+$/, '');
    pre.textContent = '';
    pre.appendChild(code);
  });
}

// Channels video / voice / embedded-player components cannot be persisted
// (signed expiring URLs); replace each with a link back to the article so the
// note shows where content was dropped.
const EPHEMERAL_MEDIA_SELECTOR =
  'mpvoice, mp-common-mpaudio, mp-common-videosnap, mpvideosnap, .video_iframe, iframe';

function replaceEphemeralMedia(root: HTMLElement, articleUrl: string, label: string): void {
  root.querySelectorAll(EPHEMERAL_MEDIA_SELECTOR).forEach((el) => {
    const p = document.createElement('p');
    const a = document.createElement('a');
    a.setAttribute('href', articleUrl);
    a.textContent = label;
    p.appendChild(a);
    el.replaceWith(p);
  });
}

export interface WeChatLabels {
  // Link text standing in for video/audio that cannot be clipped.
  originalMedia: string;
}

export type WeChatResult = MarkdownPayload | { kind: 'failed'; reason: string };

// The URL already identified this as an article page, so a missing/empty body
// is a handler failure (markup change, premature trigger), not a skip — the
// chain records it as `wechat-article-failed` so the degradation is visible.
export function extractWeChatArticle(labels: WeChatLabels): WeChatResult {
  const content = document.querySelector('#js_content');
  if (!content) return { kind: 'failed', reason: '#js_content not found (markup change?)' };

  const og = (property: string): string | undefined =>
    document.querySelector(`meta[property="${property}"]`)?.getAttribute('content')?.trim() || undefined;
  const source = og('og:url') ?? location.href;

  const clone = content.cloneNode(true) as HTMLElement;
  resolveResponsiveImages(clone);
  absolutizeUrls(clone, location.href);
  normalizeCodeBlocks(clone);
  replaceEphemeralMedia(clone, source, labels.originalMedia);
  const markdown = normalizeBlockMath(htmlFragmentToMarkdown(clone.innerHTML).trim());
  if (!markdown) return { kind: 'failed', reason: '#js_content produced no markdown' };

  const scripts = [...document.querySelectorAll('script:not([src])')].map((s) => s.textContent ?? '');
  // <title> and #activity-name start empty (JS-filled); og:title is server-rendered.
  const title = og('og:title') || document.title || 'Untitled';

  return {
    kind: 'markdown',
    title,
    markdown,
    frontmatter: {
      title,
      source,
      author: document.querySelector('#js_name')?.textContent?.trim() || nicknameFromPageScripts(scripts),
      published:
        publishedFromPageScripts(scripts) ||
        document.querySelector('#publish_time')?.textContent?.trim() ||
        undefined,
      description: og('og:description'),
    },
  };
}
