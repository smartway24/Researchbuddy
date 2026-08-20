import type { Paper, RungId } from '../types.js';

/**
 * Optional AI layer.
 *
 * Everything in Researchbuddy works without it: retrieval, ranking, theming and
 * scheduling are deterministic. A model provider only ever *adds* — plainer
 * explanations, better cards, tighter summaries — and every generated claim
 * carries the citations it was generated from, so nothing enters the learner's
 * deck without a traceable source.
 */

export interface CardDraft {
  front: string;
  back: string;
  /** Paper ids the answer came from. Empty means "from the learner's own notes". */
  sourceIds: string[];
}

export interface PaperSummary {
  /** One sentence: what the paper found. */
  headline: string;
  /** 2–5 bullets a learner at this rung can act on. */
  bullets: string[];
  /** Limitations worth knowing before quoting it. */
  caveats: string[];
}

export interface ProviderCapabilities {
  /** False for the offline provider: it extracts, it does not write prose. */
  generatesProse: boolean;
  /** True when calls leave the device. Surfaced in the UI before first use. */
  sendsDataOffDevice: boolean;
  label: string;
}

export interface SummarizeOptions {
  rung: RungId;
  signal?: AbortSignal;
}

export interface AiProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  summarizePaper(paper: Paper, options: SummarizeOptions): Promise<PaperSummary>;
  /** Draft review cards for one paper or concept. */
  draftCards(
    input: { title: string; body: string; sourceIds: string[]; count?: number },
    options: SummarizeOptions,
  ): Promise<CardDraft[]>;
}
