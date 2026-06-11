// Bilibili provider (design §7.5.2). Metadata + the current part's cid come
// from x/web-interface/view (no login, no wbi signing needed); subtitles and
// chapters (view_points) come from x/player/wbi/v2 in one call — verified
// 2026-06 to work unsigned when sent from the user's browser with cookies.
//
// Known traps handled here (design §7.5.2): subtitles require login
// (need_login_subtitle); subtitle_url may be http:// or protocol-relative and
// carries a short-lived auth_key (fetch immediately, never cache the URL);
// the list contains placeholder entries with an empty subtitle_url; a
// risk-control response is code 0 with the real data fields missing.

import { epochToLocalDate } from '../epoch-date';
import type { TranscriptSegment, VideoChapter, VideoClip, VideoMeta } from './types';

const VIDEO_PATH_RE = /^\/video\/(?:(BV[0-9A-Za-z]+)|av(\d+))(?:\/|$)/;

export interface BilibiliVideoRef {
  bvid?: string;
  aid?: number;
  // 1-based part number from ?p= (multi-part videos).
  page: number;
}

export function parseBilibiliVideoUrl(rawUrl: string): BilibiliVideoRef | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!/(^|\.)bilibili\.com$/i.test(url.hostname)) return null;
  const m = VIDEO_PATH_RE.exec(url.pathname);
  if (!m) return null;
  const page = Math.max(1, Number.parseInt(url.searchParams.get('p') ?? '1', 10) || 1);
  return m[1] ? { bvid: m[1], page } : { aid: Number(m[2]), page };
}

export function normalizeSubtitleUrl(raw: string): string {
  if (raw.startsWith('//')) return `https:${raw}`;
  return raw.replace(/^http:\/\//i, 'https://');
}

export interface SubtitleTrack {
  // 'zh-CN', 'en-US', ... ; AI-generated tracks are 'ai-zh' etc.
  lan?: string;
  subtitle_url?: string;
}

// Manual zh -> any manual -> AI zh -> anything. Entries without a
// subtitle_url are placeholders.
export function pickSubtitleTrack<T extends SubtitleTrack>(tracks: T[]): T | null {
  const usable = tracks.filter((t) => t.subtitle_url);
  const isAi = (t: T): boolean => (t.lan ?? '').startsWith('ai-');
  const isZh = (t: T): boolean => (t.lan ?? '').replace(/^ai-/, '').startsWith('zh');
  return (
    usable.find((t) => !isAi(t) && isZh(t)) ??
    usable.find((t) => !isAi(t)) ??
    usable.find((t) => isZh(t)) ??
    usable[0] ??
    null
  );
}

async function fetchBiliApi<T>(url: string): Promise<T> {
  const endpoint = new URL(url).pathname;
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'include' });
  } catch (e) {
    throw new Error(`${endpoint}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new Error(`${endpoint}: HTTP ${res.status}`);
  const json = (await res.json()) as { code?: number; message?: string; data?: T };
  if (json.code !== 0 || !json.data) {
    throw new Error(`${endpoint}: code ${json.code}${json.message ? ` (${json.message})` : ''}`);
  }
  return json.data;
}

interface ViewPage {
  cid: number;
  page: number;
  part?: string;
  duration?: number;
}

interface ViewData {
  bvid: string;
  aid: number;
  videos?: number;
  title: string;
  desc?: string;
  pubdate?: number;
  duration?: number;
  cid?: number;
  owner?: { name?: string };
  pages?: ViewPage[];
}

interface PlayerData {
  need_login_subtitle?: boolean;
  subtitle?: { subtitles?: SubtitleTrack[] };
  view_points?: Array<{ content?: string; from?: number; to?: number }>;
}

export async function extractBilibili(ref: BilibiliVideoRef): Promise<VideoClip> {
  const query = ref.bvid ? `bvid=${ref.bvid}` : `aid=${ref.aid}`;
  const view = await fetchBiliApi<ViewData>(`https://api.bilibili.com/x/web-interface/view?${query}`);

  const pages = view.pages ?? [];
  const page = pages.find((pg) => pg.page === ref.page) ?? pages[0];
  const cid = page?.cid ?? view.cid;
  if (!cid) throw new Error('view API returned no cid');
  const multiPart = (view.videos ?? pages.length) > 1;
  const partNo = page?.page ?? 1;

  const canonical = `https://www.bilibili.com/video/${view.bvid}`;
  // partNo > 1 implies a multi-part video (single-part videos only have p=1).
  const partQuery = partNo > 1 ? `p=${partNo}` : '';
  const meta: VideoMeta = {
    platform: 'bilibili',
    url: partQuery ? `${canonical}?${partQuery}` : canonical,
    embedUrl: `https://player.bilibili.com/player.html?bvid=${view.bvid}&p=${partNo}&autoplay=0`,
    title: multiPart && page?.part ? `${view.title} · P${partNo} ${page.part}` : view.title,
    author: view.owner?.name || undefined,
    published: view.pubdate ? epochToLocalDate(view.pubdate) : undefined,
    durationSec: (multiPart ? page?.duration : view.duration) || undefined,
    description: view.desc?.trim() || undefined,
  };

  // Subtitle/chapter failures degrade to a metadata-only video note (design
  // §7.5.3 step 2) instead of failing the whole provider.
  let chapters: VideoChapter[] = [];
  let transcript: TranscriptSegment[] = [];
  let transcriptIssue: string | undefined;
  let transcriptKind: 'auto' | 'manual' | undefined;
  try {
    const player = await fetchBiliApi<PlayerData>(
      `https://api.bilibili.com/x/player/wbi/v2?aid=${view.aid}&cid=${cid}`,
    );
    // Risk control answers code 0 with the real fields missing (v_voucher
    // only) — treat that as a failed call, not as "no subtitles".
    if (!player.subtitle) throw new Error('player API returned no subtitle data (risk control?)');

    chapters = (player.view_points ?? [])
      .filter((vp) => typeof vp.from === 'number' && vp.content)
      .map((vp) => ({ startSec: vp.from as number, title: vp.content as string }));

    const track = pickSubtitleTrack(player.subtitle.subtitles ?? []);
    if (!track) {
      transcriptIssue = player.need_login_subtitle
        ? 'bilibili subtitles require login'
        : 'no subtitles available on this video';
    } else {
      // No credentials here: the subtitle URL carries its own short-lived
      // auth_key, and the CDN (aisubtitle.hdslb.com) answers with wildcard
      // CORS — a credentialed cross-origin read gets rejected by the browser
      // ("Failed to fetch") even though the player's own cookie-less fetch
      // of the same URL succeeds.
      const subUrl = normalizeSubtitleUrl(track.subtitle_url as string);
      let subRes: Response;
      try {
        subRes = await fetch(subUrl, { credentials: 'omit' });
      } catch (e) {
        throw new Error(
          `subtitle CDN fetch (${new URL(subUrl).hostname}): ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      if (!subRes.ok) throw new Error(`subtitle CDN fetch: HTTP ${subRes.status}`);
      const sub = (await subRes.json()) as { body?: Array<{ from?: number; to?: number; content?: string }> };
      transcript = (sub.body ?? [])
        .filter((cue) => typeof cue.from === 'number' && cue.content)
        .map((cue) => ({ startSec: cue.from as number, endSec: cue.to, text: cue.content as string }));
      if (transcript.length === 0) transcriptIssue = 'subtitle file is empty';
      else transcriptKind = (track.lan ?? '').startsWith('ai-') ? 'auto' : 'manual';
    }
  } catch (e) {
    transcriptIssue = e instanceof Error ? e.message : String(e);
  }

  return {
    meta,
    chapters,
    transcript,
    transcriptIssue,
    transcriptKind,
    // Deep links derive from the canonical meta.url so the part encoding
    // lives in exactly one place.
    timestampUrl: (sec) => `${meta.url}${partQuery ? '&' : '?'}t=${Math.floor(sec)}`,
  };
}
