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
