// Pure transcript shaping. Raw caption cues (one fragment per subtitle line)
// are unreadable as prose, so merge them into timestamped paragraphs.
//
// Break priority (the industry-consensus ladder, cf. Defuddle/transcription
// guides): chapter boundary / speaker change / long silence are hard breaks;
// past the target span, break at a sentence end; failing that, at the
// largest pause. Sentences are never cut while under the hard cap.

import type { TranscriptSegment, VideoChapter } from './types';

// Hard break when the silence between cues exceeds this.
const GAP_BREAK_SEC = 5;
// Target paragraph span: no length break before MIN; from MAX on, split at
// the best natural point at or past MIN.
const MIN_PARAGRAPH_SEC = 15;
const MAX_PARAGRAPH_SEC = 30;
// Weight cap parallel to the span cap, for dense speech. Weighted: a CJK
// glyph carries roughly a word fragment's worth of information and has no
// inter-word spaces, so it counts double (~180 CJK / ~360 latin chars).
const MAX_PARAGRAPH_WEIGHT = 360;
// Punctuated captions may run past MAX up to this factor waiting for the
// sentence to finish; beyond it, split at the largest pause instead.
const HARD_CAP_FACTOR = 1.5;

// Does the text end a sentence? (Trailing quotes/brackets allowed.)
const SENTENCE_END_RE = /[。！？.!?…][」』""'）)\]]*$/;

// Speaker-change markers: ">>" is the CEA-608/708 captioning convention
// (used by YouTube); a leading "- " is the subtitle dialogue convention.
const CHEVRON_MARKER_RE = /^\s*>>+\s*/;
const DASH_MARKER_RE = /^-\s+/;

export interface TranscriptParagraph {
  startSec: number;
  text: string;
}

export interface TranscriptSection {
  // Absent for the untitled lead section (paragraphs before the first
  // chapter) and for chapterless videos.
  chapter?: VideoChapter;
  paragraphs: TranscriptParagraph[];
}

export function formatTimestamp(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

// Fullwidth/CJK punctuation separates text without needing a space.
const CJK_PUNCT_END_RE = /[。，！？；：、…—）】」』]$/;

// A cue boundary is where the platform broke the caption line — for
// unpunctuated auto captions it is the only sentence-ish hint in the data,
// so keep it as a space. Only a fullwidth-punctuation ending (typical for
// punctuated CJK subtitles) needs no extra separator; latin text always
// takes the space.
function joinCueText(a: string, b: string): string {
  if (CJK_PUNCT_END_RE.test(a)) return a + b;
  return `${a} ${b}`;
}

// CJK punctuation/ideographs/fullwidth forms.
const CJK_WEIGHT_RE = /[\u3000-\u9fff\uf900-\ufaff\uff01-\uff60]/;

function textWeight(text: string): number {
  let weight = 0;
  for (const ch of text) weight += CJK_WEIGHT_RE.test(ch) ? 2 : 1;
  return weight;
}

interface Cue extends TranscriptSegment {
  speakerStart: boolean;
  weight: number;
}

export function mergeIntoParagraphs(
  segments: TranscriptSegment[],
  chapters: VideoChapter[] = [],
): TranscriptParagraph[] {
  const prepared = segments
    .map((s) => {
      const raw = s.text.replace(/\s+/g, ' ').trim();
      const chevron = CHEVRON_MARKER_RE.test(raw);
      const dash = !chevron && DASH_MARKER_RE.test(raw);
      return { ...s, chevron, dash, text: raw.replace(chevron ? CHEVRON_MARKER_RE : DASH_MARKER_RE, '') };
    })
    .filter((s) => s.text.length > 0)
    .sort((a, b) => a.startSec - b.startSec);

  // A leading "- " marks a speaker change only when it is the exception, not
  // the house style: tracks that dash-prefix every line (common in film and
  // European-language subs) would otherwise split into one paragraph per cue.
  const dashCount = prepared.filter((c) => c.dash).length;
  const dashIsMarker = dashCount > 0 && dashCount <= prepared.length / 2;
  const cues: Cue[] = prepared.map(({ chevron, dash, ...cue }) => ({
    ...cue,
    speakerStart: chevron || (dashIsMarker && dash),
    weight: textWeight(cue.text),
  }));
  const breakpoints = chapters.map((c) => c.startSec).sort((a, b) => a - b);
  // Unpunctuated captions (ASR, and many creator-uploaded Chinese subtitles)
  // have no sentence ends to wait for; they split right at the caps, at the
  // largest pause. Measure exactly the signal the splitter uses — cues
  // ENDING with sentence punctuation, as a meaningful share — so stray dots
  // inside the text ("USB 3.0", "11.5瓦时") cannot flip the whole track into
  // sentence-waiting mode (which would drag every break to the hard cap).
  const sentenceEnders = cues.filter((c) => SENTENCE_END_RE.test(c.text)).length;
  const punctuated = sentenceEnders >= 3 && sentenceEnders >= cues.length * 0.05;

  const endOf = (c: Cue): number => c.endSec ?? c.startSec;

  const paragraphs: TranscriptParagraph[] = [];
  let buf: Cue[] = [];
  let bufWeight = 0;
  let nextBreak = 0;

  // Emit buf[0..idx] as a paragraph and keep the rest buffered.
  const split = (idx: number): void => {
    const group = buf.slice(0, idx + 1);
    paragraphs.push({
      startSec: group[0].startSec,
      text: group.map((c) => c.text).reduce(joinCueText),
    });
    buf = buf.slice(idx + 1);
    bufWeight = buf.reduce((w, c) => w + c.weight, 0);
  };

  // Split-point candidates must leave at least MIN seconds in the paragraph.
  const minOk = (i: number): boolean => endOf(buf[i]) - buf[0].startSec >= MIN_PARAGRAPH_SEC;

  const lastSentenceEnd = (): number => {
    for (let i = buf.length - 1; i >= 0 && minOk(i); i--) {
      if (SENTENCE_END_RE.test(buf[i].text)) return i;
    }
    return -1;
  };

  // The largest inter-cue pause at or past MIN; ties go to the later pause.
  // Falls back to "split everything" when no interior candidate qualifies.
  const largestPause = (): number => {
    let best = buf.length - 1;
    let bestGap = -1;
    for (let i = 0; i < buf.length - 1; i++) {
      if (!minOk(i)) continue;
      const gap = buf[i + 1].startSec - endOf(buf[i]);
      if (gap >= bestGap) {
        bestGap = gap;
        best = i;
      }
    }
    return best;
  };

  for (const cue of cues) {
    let crossedChapter = false;
    while (nextBreak < breakpoints.length && cue.startSec >= breakpoints[nextBreak]) {
      nextBreak++;
      crossedChapter = true;
    }
    if (buf.length > 0) {
      const gap = cue.startSec - endOf(buf[buf.length - 1]);
      if (crossedChapter || gap > GAP_BREAK_SEC || cue.speakerStart) {
        split(buf.length - 1);
      }
    }
    buf.push(cue);
    bufWeight += cue.weight;

    const span = endOf(cue) - buf[0].startSec;
    const over = (factor: number): boolean =>
      span >= MAX_PARAGRAPH_SEC * factor || bufWeight >= MAX_PARAGRAPH_WEIGHT * factor;
    if (!over(1)) continue;
    if (punctuated) {
      const idx = lastSentenceEnd();
      if (idx >= 0) split(idx);
      else if (over(HARD_CAP_FACTOR)) split(largestPause());
    } else {
      split(largestPause());
    }
  }
  if (buf.length > 0) split(buf.length - 1);

  return paragraphs;
}

// Slice merged paragraphs into chapter sections. Paragraphs before the first
// chapter become an untitled lead section; a chapter keeps its (possibly
// empty) section so the outline stays complete.
export function sectionByChapters(
  paragraphs: TranscriptParagraph[],
  chapters: VideoChapter[],
): TranscriptSection[] {
  if (chapters.length === 0) {
    return paragraphs.length > 0 ? [{ paragraphs }] : [];
  }
  const sorted = [...chapters].sort((a, b) => a.startSec - b.startSec);
  const sections: TranscriptSection[] = [];
  let i = 0;

  const take = (endSec: number): TranscriptParagraph[] => {
    const out: TranscriptParagraph[] = [];
    while (i < paragraphs.length && paragraphs[i].startSec < endSec) out.push(paragraphs[i++]);
    return out;
  };

  const lead = take(sorted[0].startSec);
  if (lead.length > 0) sections.push({ paragraphs: lead });
  sorted.forEach((chapter, c) => {
    sections.push({ chapter, paragraphs: take(c + 1 < sorted.length ? sorted[c + 1].startSec : Infinity) });
  });
  return sections;
}
