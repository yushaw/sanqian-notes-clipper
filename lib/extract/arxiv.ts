// Lightweight arxiv URL detection (a routing hint only).
//
// The authoritative parse lives in notes' parseArxivInput, called server-side
// by the import_arxiv bridge tool. Here we only decide whether to delegate.
// Mirrors notes' ARXIV_URL_HOSTS / article path prefixes.

const ARXIV_HOSTS = new Set([
  'arxiv.org',
  'www.arxiv.org',
  'export.arxiv.org',
  'ar5iv.labs.arxiv.org',
  'ar5iv.org',
]);

const ARXIV_PATH_PREFIXES = ['/abs/', '/pdf/', '/html/', '/format/', '/src/', '/e-print/'];

export function isArxivUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!ARXIV_HOSTS.has(url.hostname)) {
    return false;
  }
  return ARXIV_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}
