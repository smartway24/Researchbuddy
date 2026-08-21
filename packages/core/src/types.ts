/**
 * Core domain types for Researchbuddy.
 *
 * The product model: a learner picks a `Topic` (e.g. "ECMO"). The app builds a
 * `LearningLadder` for it — ordered rungs from fundamentals up to the current
 * research frontier. Each rung has concepts to master (tracked with spaced
 * repetition) and a literature feed sized to that rung. Frontier reading stays
 * locked until the underlying rungs are mastered, so the reading list is never
 * a firehose of papers the learner cannot yet evaluate.
 */

/** Where a piece of literature came from. */
export type SourceId = 'pubmed' | 'europepmc' | 'openalex' | 'manual';

/** Ordered rungs of the learning ladder. Index order is the study order. */
export const RUNG_ORDER = [
  'orientation',
  'foundations',
  'mechanism',
  'applied',
  'evidence',
  'frontier',
] as const;

export type RungId = (typeof RUNG_ORDER)[number];

export interface RungDefinition {
  id: RungId;
  title: string;
  /** One-line description shown to the learner. */
  goal: string;
  /**
   * Mastery of the previous rung required before this one unlocks, 0..1.
   * `null` means the rung is open from the start.
   */
  unlocksAt: number | null;
}

export interface Topic {
  id: string;
  /** What the learner typed, e.g. "ECMO". */
  label: string;
  /** Canonical subject heading, e.g. "Extracorporeal Membrane Oxygenation". */
  canonicalTerm: string;
  /** MeSH descriptor when we could resolve one. */
  meshTerm?: string;
  /** NLM's scope note for the descriptor — the topic's citable definition. */
  definition?: string;
  /** MeSH entry terms: every synonym that means the same thing. */
  synonyms: string[];
  /** Sibling / adjacent concepts — the "flurry of ideas" around the topic. */
  relatedConcepts: string[];
  createdAt: string;
  updatedAt: string;
}

/** A single idea the learner is expected to master. */
export interface Concept {
  id: string;
  topicId: string;
  rung: RungId;
  label: string;
  /** Short explanation, authored or model-generated. */
  summary: string;
  /** Concept ids this one builds on; used to order study within a rung. */
  prerequisites: string[];
  /** Provenance so the learner can always trace a claim back. */
  citations: Citation[];
}

export interface Citation {
  sourceId: SourceId;
  externalId: string;
  title: string;
  url?: string;
}

/** A question/answer pair scheduled by the spaced-repetition engine. */
export interface Card {
  id: string;
  conceptId: string;
  topicId: string;
  front: string;
  back: string;
  createdAt: string;
}

/** Mutable scheduling state for a card, per the SM-2 variant in `srs.ts`. */
export interface ReviewState {
  cardId: string;
  /** Consecutive successful reviews. */
  repetitions: number;
  /** Days until the next review. */
  intervalDays: number;
  /** SM-2 ease factor. */
  easeFactor: number;
  /** ISO date of the next scheduled review. */
  dueAt: string;
  lastReviewedAt: string | null;
  /** Total reviews ever, including lapses. */
  reviewCount: number;
  lapses: number;
}

/** Grade a learner gives themselves on a card, SM-2 scale. */
export type ReviewGrade = 0 | 1 | 2 | 3 | 4 | 5;

/** A paper, review, or guideline retrieved from a source. */
export interface Paper {
  /** Stable key: `${sourceId}:${externalId}`. */
  id: string;
  sourceId: SourceId;
  externalId: string;
  doi?: string;
  pmid?: string;
  pmcid?: string;
  title: string;
  abstract?: string;
  authors: string[];
  journal?: string;
  /** ISO date; day precision is often unavailable, so may be YYYY or YYYY-MM. */
  publishedAt?: string;
  year?: number;
  publicationTypes: string[];
  meshTerms: string[];
  keywords: string[];
  /** Freely readable full text, when the source reports one. */
  openAccessUrl?: string;
  /** Publisher landing page. */
  url?: string;
  citedByCount?: number;
}

/** How much a paper can be trusted to settle a question, roughly. */
export type EvidenceLevel =
  | 'guideline'
  | 'systematic-review'
  | 'rct'
  | 'cohort'
  | 'case-series'
  | 'narrative-review'
  | 'preclinical'
  | 'other';

export interface ScoredPaper {
  paper: Paper;
  evidenceLevel: EvidenceLevel;
  /** 0..1 composite of evidence level, recency, and topical fit. */
  score: number;
  /** Human-readable reasons, shown in the UI so ranking is never a black box. */
  reasons: string[];
}

/** A themed cluster of papers within a digest. */
export interface DigestSection {
  title: string;
  /** Why this cluster matters at the learner's current rung. */
  rationale: string;
  papers: ScoredPaper[];
}

export interface Digest {
  topicId: string;
  rung: RungId;
  generatedAt: string;
  sections: DigestSection[];
  /** Reading order across all sections, by paper id. */
  readingOrder: string[];
  /** Total papers considered before filtering, for transparency. */
  candidateCount: number;
  /**
   * What each source contributed. Present when the digest came from
   * `buildDigest`; it is how the UI knows a list was served from the
   * on-device cache, and how old that copy is.
   */
  sourceStatus?: {
    sourceId: string;
    count: number;
    error?: string;
    fromCache?: boolean;
    savedAt?: string;
  }[];
}

/** Per-topic progress, driving unlocks and the size of each digest. */
export interface TopicProgress {
  topicId: string;
  /** Mastery per rung, 0..1. */
  masteryByRung: Record<RungId, number>;
  unlockedRungs: RungId[];
  currentRung: RungId;
}
