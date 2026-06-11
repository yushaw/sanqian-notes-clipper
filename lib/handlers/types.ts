// Clip handler chain types (design doc §7).
//
// The chain runs in the page (content script) where it has the live DOM.
// Each handler either produces a `markdown` payload (generic clip → create_note)
// or a `delegate` payload (hand off to a notes-side importer, e.g. arxiv).

export type ClipMode = 'auto' | 'article' | 'selection';

export interface ClipContext {
  url: string;
  mode: ClipMode;
}

export interface ClipFrontmatter {
  title: string;
  source: string;
  author?: string;
  published?: string;
  description?: string;
  // Video clips only (design §7.5.4): running time as h:mm:ss / m:ss.
  duration?: string;
  // Video clips with a transcript: whether the captions were auto-generated
  // (asr / ai-*) or human-made. Lets a future notes-side AI enhancement pass
  // select exactly the notes that need cleaning.
  transcript?: 'auto' | 'manual';
  // Set when a specialized path degraded. Recorded in the note's frontmatter
  // so the degradation is visible and the user can re-clip for a richer
  // result. `fallback` is a machine code with two grammars: `<handler>-failed`
  // when a matched handler broke and the clip fell back to generic extraction
  // (import_arxiv-failed, youtube-video-failed, wechat-article-failed, ...),
  // and `video-transcript-missing` when a video note saved without its
  // transcript. `fallbackReason` carries the underlying cause for diagnosis.
  fallback?: string;
  fallbackReason?: string;
}

export interface MarkdownPayload {
  kind: 'markdown';
  title: string;
  markdown: string;
  frontmatter: ClipFrontmatter;
}

export interface DelegatePayload {
  kind: 'delegate';
  tool: string;
  args: Record<string, unknown>;
}

// A user-facing reason the clip cannot proceed (e.g. nothing selected).
export interface ErrorPayload {
  kind: 'error';
  message: string;
}

export type ClipPayload = MarkdownPayload | DelegatePayload | ErrorPayload;
