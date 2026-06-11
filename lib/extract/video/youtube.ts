// YouTube provider (design §7.5.2). Fetch-first: re-fetch the watch page HTML
// (same-origin, with the user's cookies) and parse ytInitialPlayerResponse out
// of it — always fresh, immune to SPA navigation leaving stale page globals,
// and needs no MAIN-world injection. Captions come from the player response's
// captionTracks (same-origin timedtext URLs), never from the transcript-panel
// DOM, which breaks on every YouTube UI redesign.

import { decodeHtmlEntities } from '../entities';
import type { TranscriptSegment, VideoChapter, VideoClip, VideoMeta } from './types';

const WATCH_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com']);

// The 11-char video id, or null when the URL is not a single-video page.
// Covers /watch?v=, /shorts/, /live/, /embed/ and youtu.be share links.
export function youTubeVideoId(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  let id: string | null = null;
  if (url.hostname === 'youtu.be') {
    id = url.pathname.slice(1).split('/')[0] || null;
  } else if (WATCH_HOSTS.has(url.hostname)) {
    id = url.pathname === '/watch' ? url.searchParams.get('v') : (/^\/(?:shorts|live|embed)\/([^/?]+)/.exec(url.pathname)?.[1] ?? null);
  }
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

// Extract the JSON object literal assigned to `name` inside an HTML string.
// Brace-scans (string- and escape-aware) instead of a regex so braces nested
// in the JSON cannot truncate the match.
export function extractAssignedJson(html: string, name: string): unknown {
  const assign = new RegExp(`${name}\\s*=\\s*\\{`).exec(html);
  if (!assign) return null;
  const start = assign.index + assign[0].length - 1;
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(html.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export interface CaptionTrack {
  baseUrl?: string;
  languageCode?: string;
  // 'asr' marks auto-generated captions.
  kind?: string;
}

// Manual tracks beat auto-generated (asr); within each tier, follow the
// language preference list (base-language match), then document order.
export function pickCaptionTrack<T extends CaptionTrack>(tracks: T[], preferredLangs: string[]): T | null {
  const prefs = preferredLangs.map((l) => l.toLowerCase().split('-')[0]);
  let best: T | null = null;
  let bestScore = Infinity;
  tracks.forEach((track, index) => {
    if (!track.baseUrl) return;
    const lang = (track.languageCode ?? '').toLowerCase().split('-')[0];
    const prefRank = prefs.indexOf(lang);
    const score =
      (track.kind === 'asr' ? 1_000_000 : 0) + (prefRank === -1 ? prefs.length : prefRank) * 1000 + index;
    if (score < bestScore) {
      bestScore = score;
      best = track;
    }
  });
  return best;
}

// timedtext cue text is double-encoded ("&amp;#39;"), so decode twice.
function decodeCueText(raw: string): string {
  return decodeHtmlEntities(decodeHtmlEntities(raw.replace(/<[^>]+>/g, '')));
}

// Parse a timedtext response fetched from a raw baseUrl (no fmt override).
// Two formats exist in the wild: srv3 (<p t="ms" d="ms"><s>word</s></p>) and
// the legacy srv1 (<text start="s" dur="s">). Regex-scanned rather than
// DOMParser so it runs (and is testable) outside a DOM environment.
export function parseTimedTextXml(xml: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  for (const m of xml.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
    const t = Number(/\bt="(\d+)"/.exec(m[1])?.[1]);
    const d = Number(/\bd="(\d+)"/.exec(m[1])?.[1]);
    const text = decodeCueText(m[2]);
    if (Number.isFinite(t) && text.trim()) {
      segments.push({ startSec: t / 1000, endSec: Number.isFinite(d) ? (t + d) / 1000 : undefined, text });
    }
  }
  if (segments.length > 0) return segments;
  for (const m of xml.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/g)) {
    const start = Number(/\bstart="([\d.]+)"/.exec(m[1])?.[1]);
    const dur = Number(/\bdur="([\d.]+)"/.exec(m[1])?.[1]);
    const text = decodeCueText(m[2]);
    if (Number.isFinite(start) && text.trim()) {
      segments.push({ startSec: start, endSec: Number.isFinite(dur) ? start + dur : undefined, text });
    }
  }
  return segments;
}

// YouTube chapters are sourced from timestamp lines in the description; apply
// the same validity rules YouTube does: at least 3, first at 0:00, ascending.
const CHAPTER_LINE_RE = /^[\s\-–—•*]*((?:\d{1,2}:)?\d{1,2}:\d{2})[\s\-–—:：.|]*(\S.*)$/;

function parseClockTimestamp(ts: string): number {
  return ts.split(':').reduce((acc, part) => acc * 60 + Number(part), 0);
}

export function chaptersFromDescription(description: string | undefined): VideoChapter[] {
  const chapters: VideoChapter[] = [];
  for (const line of description?.split('\n') ?? []) {
    const m = CHAPTER_LINE_RE.exec(line);
    if (m) chapters.push({ startSec: parseClockTimestamp(m[1]), title: m[2].trim() });
  }
  if (chapters.length < 3 || chapters[0].startSec !== 0) return [];
  for (let i = 1; i < chapters.length; i++) {
    if (chapters[i].startSec <= chapters[i - 1].startSec) return [];
  }
  return chapters;
}

interface PlayerResponse {
  videoDetails?: {
    videoId?: string;
    title?: string;
    author?: string;
    lengthSeconds?: string;
    shortDescription?: string;
  };
  microformat?: { playerMicroformatRenderer?: { publishDate?: string; uploadDate?: string } };
  captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: CaptionTrack[] } };
}

function captionTracksOf(player: PlayerResponse): CaptionTrack[] {
  return player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
}

// Caption baseUrls from WEB-context player responses (including the watch
// page's ytInitialPlayerResponse) started requiring a per-video PO token in
// 2025 — without it timedtext answers an empty 200, logged in or not. Player
// responses from the InnerTube IOS client return token-free baseUrls, so that
// is the primary caption source; WEB InnerTube and the watch-page HTML stay
// in the waterfall as fallbacks. Same ladder Defuddle/Obsidian Clipper
// converged on (verified working 2026-06).
const INNERTUBE_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const INNERTUBE_CLIENTS = [
  { clientName: 'IOS', clientVersion: '20.10.3' },
  { clientName: 'WEB', clientVersion: '2.20240101.00.00' },
];

async function fetchInnerTubePlayer(
  videoId: string,
  client: { clientName: string; clientVersion: string },
): Promise<PlayerResponse | null> {
  try {
    const res = await fetch(INNERTUBE_URL, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context: { client }, videoId }),
    });
    if (!res.ok) return null;
    const player = (await res.json()) as PlayerResponse;
    return player.videoDetails?.videoId === videoId ? player : null;
  } catch {
    return null;
  }
}

async function fetchWatchPlayerResponse(videoId: string): Promise<PlayerResponse | null> {
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { credentials: 'include' });
    if (!res.ok) return null;
    const player = extractAssignedJson(await res.text(), 'ytInitialPlayerResponse') as PlayerResponse | null;
    return player?.videoDetails?.videoId === videoId ? player : null;
  } catch {
    return null;
  }
}

// Fetch a caption baseUrl as-is: no fmt override, no custom headers (a
// User-Agent header would trigger a CORS preflight timedtext cannot answer).
// An empty 200 body means the URL was PO-token-gated — return [] so the
// caller can try the next source.
async function fetchTimedText(baseUrl: string): Promise<TranscriptSegment[]> {
  const url = new URL(baseUrl, 'https://www.youtube.com');
  if (!url.hostname.endsWith('.youtube.com')) return [];
  const res = await fetch(url.href, { credentials: 'include' });
  if (!res.ok) throw new Error(`timedtext fetch: HTTP ${res.status}`);
  return parseTimedTextXml(await res.text());
}

export async function extractYouTube(videoId: string): Promise<VideoClip> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Caption sources in reliability order: InnerTube IOS -> InnerTube WEB
  // (only consulted when IOS yields no tracks) -> watch-page HTML. The watch
  // page is always needed — it is the only source carrying microformat
  // (InnerTube IOS responses omit it, verified live) — so its ~1MB fetch
  // starts now and runs concurrently with the InnerTube round-trips.
  const watchPromise = fetchWatchPlayerResponse(videoId);
  const sources: PlayerResponse[] = [];
  for (const client of INNERTUBE_CLIENTS) {
    const player = await fetchInnerTubePlayer(videoId, client);
    if (player) sources.push(player);
    if (player && captionTracksOf(player).length > 0) break;
  }
  const htmlPlayer = await watchPromise;
  if (htmlPlayer) sources.push(htmlPlayer);

  const details = (htmlPlayer ?? sources[0])?.videoDetails;
  if (!details?.title) {
    throw new Error('no player response from InnerTube or the watch page (consent interstitial or API change?)');
  }

  const description = details.shortDescription?.trim() || undefined;
  const durationSec = Number(details.lengthSeconds);
  const micro = sources.find((s) => s.microformat?.playerMicroformatRenderer)?.microformat
    ?.playerMicroformatRenderer;
  const meta: VideoMeta = {
    platform: 'youtube',
    url: watchUrl,
    embedUrl: `https://www.youtube.com/embed/${videoId}`,
    title: details.title,
    author: details.author || undefined,
    published: (micro?.publishDate ?? micro?.uploadDate)?.slice(0, 10),
    durationSec: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : undefined,
    description,
  };

  // Walk the sources until one yields cues. Failures degrade to a
  // metadata-only video note (design §7.5.3 step 2), never fail the provider.
  let transcript: TranscriptSegment[] = [];
  let transcriptIssue: string | undefined;
  let transcriptKind: 'auto' | 'manual' | undefined;
  const attempted = new Set<string>();
  for (const source of sources) {
    const track = pickCaptionTrack(captionTracksOf(source), [navigator.language, 'zh', 'en']);
    if (!track?.baseUrl || attempted.has(track.baseUrl)) continue;
    attempted.add(track.baseUrl);
    try {
      transcript = await fetchTimedText(track.baseUrl);
      if (transcript.length > 0) {
        transcriptIssue = undefined;
        transcriptKind = track.kind === 'asr' ? 'auto' : 'manual';
        break;
      }
      transcriptIssue = 'caption fetch returned no cues (PO-token-gated baseUrl?)';
    } catch (e) {
      transcriptIssue = e instanceof Error ? e.message : String(e);
    }
  }
  if (attempted.size === 0) transcriptIssue = 'no captions available on this video';

  return {
    meta,
    chapters: chaptersFromDescription(description),
    transcript,
    transcriptIssue,
    transcriptKind,
    timestampUrl: (sec) => `${watchUrl}&t=${Math.floor(sec)}s`,
  };
}
