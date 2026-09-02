import type { Paper } from './types.js';
import { topicTerms, type TopicSpec } from './query.js';

/**
 * The critical eye.
 *
 * A publication-type tag says what a paper *is* — a review, a trial. It says
 * nothing about the two things a learner actually needs to know before opening
 * it, and conflating them is why a 2025 narrative review of VA-ECMO
 * haemodynamics was offered as the first thing to read about PV loops. That
 * paper is a review, and it does discuss PV loops — as its *method*, for
 * readers who already know what one is.
 *
 * So two independent judgements, scored separately:
 *
 *  - **Aboutness**: is this paper about the topic, or does it merely use it?
 *  - **Level**: does it teach the concept, or assume it?
 *
 * Both are heuristics over title, abstract and indexing. They are deliberately
 * transparent and deterministic — every judgement produces a reason string the
 * UI can show — and they are the fallback a model-backed judgement improves on
 * rather than replaces.
 */

export type Level = 'introductory' | 'intermediate' | 'specialist';

export interface LevelAssessment {
  level: Level;
  /** 0..1, how strongly the paper is *about* the topic rather than using it. */
  aboutness: number;
  /** 0..1, how much it teaches rather than assumes. */
  pedagogy: number;
  /** Plain-language reasons, shown to the learner. */
  reasons: string[];
}

/** Title language that signals a paper written to explain something. */
const TEACHING_TITLE = [
  /\bunderstanding\b/i,
  /\bprimer\b/i,
  /\bbasics?\b/i,
  /\bfundamentals?\b/i,
  /\bintroduction to\b/i,
  /\bexplained\b/i,
  /\btutorial\b/i,
  /\boverview\b/i,
  /\bwhat (is|are)\b/i,
  /\bhow to\b/i,
  /\ba review of\b/i,
  /\bphysiolog(y|ical)\b/i,
  /\bprinciples?\b/i,
  /\bconcepts?\b/i,
  /\bfor (the )?(beginner|novice|clinician|trainee)/i,
];

/** Title language that signals a specialist contribution, not an explanation. */
const SPECIALIST_TITLE = [
  /\bvalidation\b|\bvalidating\b/i,
  /\bcomparison of\b|\bcompared (with|to)\b|\bversus\b|\bvs\.?\b/i,
  /\bpredictors? of\b/i,
  /\bassociation (of|between)\b/i,
  /\boutcomes? (of|after|in)\b/i,
  /\bfeasibility\b/i,
  /\bsingle[- ]cent(re|er)\b/i,
  /\bpilot study\b/i,
  /\brandomi[sz]ed\b/i,
  /\bcohort\b/i,
  /\bcase report\b/i,
  /\bnovel\b/i,
  /\bfirst[- ]in[- ]human\b/i,
];

/** Abstract language that defines rather than assumes. */
const DEFINING_TEXT = [
  /\bis defined as\b/i,
  /\brefers to\b/i,
  /\brepresents? the\b/i,
  /\bin this review,? we (describe|explain|summari[sz]e|outline)\b/i,
  /\bwe (describe|explain|review|outline) the (basic|fundamental|underlying)\b/i,
  /\bthis (review|article) (describes|explains|provides an overview)\b/i,
  /\baims? to (explain|describe|familiaris|introduc)/i,
];

/** Abstract language typical of a primary study reporting results. */
const RESULTS_TEXT = [
  /\bp\s*[<=]\s*0?\.\d+/i,
  /\b95%\s*(confidence interval|ci)\b/i,
  /\bhazard ratio\b|\bodds ratio\b/i,
  /\bwe enrolled\b|\bwere randomi[sz]ed\b|\bconsecutive patients\b/i,
  /\bprimary (end ?point|outcome)\b/i,
];

/**
 * How strongly this paper is *about* the topic.
 *
 * Title presence is the strongest cheap signal of aboutness: authors put the
 * subject of the work in the title and the tools in the abstract. MeSH major
 * topic is NLM saying the same thing after reading it.
 */
export function aboutness(paper: Paper, topic: TopicSpec): { score: number; reasons: string[] } {
  const names = topicTerms(topic).map((name) => name.toLowerCase());
  if (names.length === 0) return { score: 0.5, reasons: [] };

  const title = paper.title.toLowerCase();
  const reasons: string[] = [];
  let score = 0.2;

  if (names.some((name) => title.includes(name))) {
    score += 0.5;
    reasons.push('The topic is in the title, so the paper is about it rather than using it');
  }

  const majorTopic = paper.meshTerms.some((term) =>
    names.some((name) => term.toLowerCase().includes(name) || name.includes(term.toLowerCase())),
  );
  if (majorTopic) {
    score += 0.3;
    reasons.push('Indexed under the topic by the National Library of Medicine');
  }

  if (score <= 0.2) {
    reasons.push('Mentions the topic without being about it');
  }

  return { score: Math.min(1, score), reasons };
}

/** How much this paper teaches versus assumes. */
export function pedagogy(paper: Paper): { score: number; reasons: string[] } {
  const title = paper.title;
  const abstract = paper.abstract ?? '';
  const reasons: string[] = [];
  // Start below the intermediate threshold. A paper showing no sign of
  // teaching anything is a specialist paper by default — starting at the
  // threshold let anything with no signal at all through the foundations
  // gate, which is how vancomycin pharmacokinetics became an ECMO foundation.
  let score = 0.3;

  const teaching = TEACHING_TITLE.filter((pattern) => pattern.test(title)).length;
  if (teaching > 0) {
    score += Math.min(0.4, teaching * 0.22);
    reasons.push('Written to explain the subject, not to report a new result');
  }

  const specialist = SPECIALIST_TITLE.filter((pattern) => pattern.test(title)).length;
  if (specialist > 0) {
    score -= Math.min(0.35, specialist * 0.2);
    reasons.push('Reports a specific study rather than explaining the subject');
  }

  if (DEFINING_TEXT.some((pattern) => pattern.test(abstract))) {
    score += 0.25;
    reasons.push('The abstract defines its terms rather than assuming them');
  }

  const results = RESULTS_TEXT.filter((pattern) => pattern.test(abstract)).length;
  if (results >= 2) {
    score -= 0.2;
    reasons.push('Reports statistical results, so it assumes you can read them');
  }

  // A narrative review with no abstract tells us nothing either way.
  if (!abstract) reasons.push('No abstract, so its level could not be judged');

  return { score: Math.max(0, Math.min(1, score)), reasons };
}

export function assessLevel(paper: Paper, topic: TopicSpec): LevelAssessment {
  const about = aboutness(paper, topic);
  const teach = pedagogy(paper);

  const level: Level =
    teach.score >= 0.5 ? 'introductory' : teach.score >= 0.4 ? 'intermediate' : 'specialist';

  return {
    level,
    aboutness: round(about.score),
    pedagogy: round(teach.score),
    reasons: [...about.reasons, ...teach.reasons],
  };
}

/** What each rung wants, on both axes. */
export const RUNG_LEVEL_TARGET: Record<
  string,
  {
    levels: Level[];
    minAboutness: number;
    weight: number;
    /**
     * Exclude anything below this, rather than merely ranking it lower. On the
     * teaching rungs a specialist paper is not a worse answer, it is the wrong
     * answer — three papers that actually explain the concept beat twelve
     * where nine assume it.
     */
    excludeBelow?: Level;
  }
> = {
  // Orientation and foundations are where being taught matters most, and where
  // a paper that merely uses the concept is worst.
  orientation: {
    levels: ['introductory'],
    minAboutness: 0.6,
    weight: 0.45,
    excludeBelow: 'introductory',
  },
  foundations: {
    levels: ['introductory', 'intermediate'],
    minAboutness: 0.5,
    weight: 0.4,
    excludeBelow: 'intermediate',
  },
  mechanism: {
    levels: ['introductory', 'intermediate'],
    minAboutness: 0.5,
    weight: 0.3,
    excludeBelow: 'intermediate',
  },
  applied: { levels: ['intermediate', 'specialist'], minAboutness: 0.4, weight: 0.2 },
  evidence: { levels: ['intermediate', 'specialist'], minAboutness: 0.4, weight: 0.15 },
  // At the frontier a specialist paper is the point.
  frontier: { levels: ['specialist', 'intermediate'], minAboutness: 0.4, weight: 0.15 },
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

const LEVEL_ORDER: Level[] = ['specialist', 'intermediate', 'introductory'];

/** Is this paper pitched at or above the level the rung demands? */
export function meetsLevel(assessment: LevelAssessment, floor: Level | undefined): boolean {
  if (!floor) return true;
  return LEVEL_ORDER.indexOf(assessment.level) >= LEVEL_ORDER.indexOf(floor);
}
