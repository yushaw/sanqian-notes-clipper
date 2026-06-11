// Platform-neutral video clip model (design §7.5).
//
// A provider (youtube.ts, bilibili.ts, ...) fills this model from platform
// APIs; render.ts turns it into the note payload. The note format is defined
// once over this model, so adding platform N+1 never changes the output shape.

export type VideoPlatform = 'youtube' | 'bilibili';

export interface VideoMeta {
  platform: VideoPlatform;
  // Canonical watch URL (tracking params stripped; multi-part keeps ?p=).
  url: string;
  // iframe src. Must stay within notes' embed CSP frame-src whitelist
  // (notes src/renderer/src/utils/embedUrl.ts), or the embed renders blank.
  embedUrl: string;
  title: string;
  // Channel / uploader name.
  author?: string;
  // Publish date, YYYY-MM-DD.
  published?: string;
  durationSec?: number;
  // Full description, plain text.
  description?: string;
}

export interface TranscriptSegment {
  startSec: number;
  endSec?: number;
  text: string;
}

export interface VideoChapter {
  startSec: number;
  title: string;
}

export interface VideoClip {
  meta: VideoMeta;
  chapters: VideoChapter[];
  transcript: TranscriptSegment[];
  // Why the transcript is missing/empty; recorded as frontmatter
  // fallback_reason so the degradation is visible (design §7.5.3).
  transcriptIssue?: string;
  // Whether the fetched captions were auto-generated or human-made.
  transcriptKind?: 'auto' | 'manual';
  // Deep link into the video at a given second.
  timestampUrl(sec: number): string;
}
