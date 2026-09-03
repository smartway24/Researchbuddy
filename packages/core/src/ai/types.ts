import type { Level } from '../level.js';
import type { TopicSpec } from '../query.js';
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

/**
 * One paper, judged on the two axes that decide whether it belongs on a
 * reading list. This is the "critical eye" as data: the thing a learner would
 * otherwise have to apply by hand to every hit PubMed returns.
 */
export interface PaperJudgement {
  /** `Paper.id` of the paper judged. */
  paperId: string;
  /** 0..1 — is the paper *about* the topic, or does it merely use it? */
  aboutness: number;
  /** Who it is written for. */
  level: Level;
  /**
   * One plain clause, shown to the learner beside the paper. Never empty:
   * a ranking without its reason is exactly what this app exists to replace.
   */
  reason: string;
}

export interface JudgeOptions {
  rung: RungId;
  /** The topic in every name we know for it, so an acronym is not guessed at. */
  topic: TopicSpec;
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
  /**
   * Read each paper and judge whether it is about the topic and who it is
   * written for.
   *
   * Retrieval is a keyword problem and the query planner solves it well
   * enough; judgement is a reading problem, and regexes over titles cannot do
   * it — "Close, squeeze, open: introducing the cardiac cycle and
   * pressure-volume loop" is the single best introduction to PV loops in the
   * literature and no pattern list was ever going to know that.
   *
   * A provider may return fewer judgements than papers; the caller falls back
   * to the deterministic assessment for anything missing, so a partial answer
   * is always better than none.
   */
  judgePapers(papers: Paper[], options: JudgeOptions): Promise<PaperJudgement[]>;
}
