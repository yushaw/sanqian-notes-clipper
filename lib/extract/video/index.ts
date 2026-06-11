// Video provider registry (design §7.5.1): URL -> platform provider ->
// platform-neutral VideoClip -> shared renderer. Adding a platform means
// adding one provider module and one branch here. Labels are resolved by the
// caller (chain.ts owns the i18n boundary) so this whole pipeline stays pure.

import type { MarkdownPayload } from '@/lib/handlers/types';
import type { VideoClip, VideoPlatform } from './types';
import { renderVideoClip, type VideoRenderLabels } from './render';
import { youTubeVideoId, extractYouTube } from './youtube';
import { parseBilibiliVideoUrl, extractBilibili } from './bilibili';

export type VideoClipResult =
  // A video page, successfully clipped (possibly without transcript).
  | { kind: 'video'; payload: MarkdownPayload }
  // A video page, but the provider broke entirely; the chain should fall back
  // to generic extraction and record the degradation (design §7.5.3 step 3).
  | { kind: 'failed'; platform: VideoPlatform; reason: string }
  // Not a video page.
  | { kind: 'skip' };

export async function tryVideoClip(url: string, labels: VideoRenderLabels): Promise<VideoClipResult> {
  const run = async (platform: VideoPlatform, extract: () => Promise<VideoClip>): Promise<VideoClipResult> => {
    try {
      return { kind: 'video', payload: renderVideoClip(await extract(), labels) };
    } catch (e) {
      return { kind: 'failed', platform, reason: e instanceof Error ? e.message : String(e) };
    }
  };

  const ytId = youTubeVideoId(url);
  if (ytId) return run('youtube', () => extractYouTube(ytId));

  const biliRef = parseBilibiliVideoUrl(url);
  if (biliRef) return run('bilibili', () => extractBilibili(biliRef));

  return { kind: 'skip' };
}
