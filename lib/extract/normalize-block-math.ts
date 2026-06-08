// Block-math blank-line normalization.
//
// Defuddle's MathML->LaTeX output (e.g. Wikipedia) emits $$...$$ glued to
// surrounding text with only single newlines. Markdown renderers treat
// block-level math as a real block: without a blank line around the $$
// delimiters the math folds into the adjacent paragraph and renders as literal
// "$$" text. This pads standalone $$...$$ blocks with blank lines so they parse
// as math.
//
// The notes app applies the same fix on import (preprocessMarkdown in
// markdown-to-tiptap.ts). Doing it here too means clips render correctly even on
// app versions that predate that fix. KEEP THE TWO REGEXES IN SYNC.
//
// Indent rule mirrors CommonMark: up to 3 *spaces* before $$ is still a block;
// a tab (or 4+ spaces) is indented code, so we leave it untouched.
export function normalizeBlockMath(markdown: string): string {
  return markdown.replace(
    /\n* {0,3}\$\$[ \t]*\n([\s\S]*?)\n {0,3}\$\$[ \t]*\n*/g,
    (match, body: string, offset: number, full: string) => {
      const before = offset === 0 ? '' : '\n\n';
      const after = offset + match.length >= full.length ? '' : '\n\n';
      return `${before}$$\n${body}\n$$${after}`;
    },
  );
}
