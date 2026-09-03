import { assessLevel, RUNG_LEVEL_TARGET, type Level } from './level.js';
import { type Judgements } from './judge.js';
import { topicTerms, type TopicSpec } from './query.js';
import type { EvidenceLevel, Paper, RungId, ScoredPaper } from './types.js';

/**
 * Ranking exists so the learner never has to triage a result list. Every score
 * is decomposed into reasons that are shown in the UI — an opaque ranking in a
 * medical reading tool is worse than no ranking.
 */

/** Ordered strongest-first; the first pattern that matches wins. */
const EVIDENCE_PATTERNS: { level: EvidenceLevel; patterns: RegExp[] }[] = [
  {
    level: 'guideline',
    patterns: [/practice guideline/i, /^guideline$/i, /consensus statement/i, /^guidelines?\b/i],
  },
  {
    level: 'systematic-review',
    patterns: [/meta-analysis/i, /systematic review/i, /scoping review/i],
  },
  {
    level: 'rct',
    patterns: [
      /randomized controlled trial/i,
      /randomised controlled trial/i,
      /^clinical trial(, phase (iii|iv))?$/i,
    ],
  },
  {
    level: 'cohort',
    patterns: [
      /observational study/i,
      /cohort/i,
      /comparative study/i,
      /multicenter study/i,
      /registry/i,
    ],
  },
  { level: 'case-series', patterns: [/case reports?/i, /case series/i] },
  { level: 'narrative-review', patterns: [/^review$/i, /editorial/i, /comment/i] },
  { level: 'preclinical', patterns: [/animal/i, /in vitro/i, /preclinical/i] },
];

const TITLE_HINTS: { level: EvidenceLevel; pattern: RegExp }[] = [
  { level: 'systematic-review', pattern: /\b(meta-analys[ie]s|systematic review)\b/i },
  { level: 'rct', pattern: /\b(randomi[sz]ed|randomi[sz]ed controlled trial|rct)\b/i },
  { level: 'guideline', pattern: /\b(guidelines?|consensus statement)\b/i },
  { level: 'preclinical', pattern: /\b(in vitro|murine|porcine|rat model|animal model)\b/i },
];

export function classifyEvidence(paper: Paper): EvidenceLevel {
  for (const { level, patterns } of EVIDENCE_PATTERNS) {
    for (const type of paper.publicationTypes) {
      if (patterns.some((pattern) => pattern.test(type))) return level;
    }
  }
  for (const hint of TITLE_HINTS) {
    if (hint.pattern.test(paper.title)) return hint.level;
  }
  return 'other';
}

/** How much each evidence level is worth, per rung. */
const EVIDENCE_WEIGHTS: Record<EvidenceLevel, number> = {
  guideline: 1,
  'systematic-review': 0.95,
  rct: 0.9,
  cohort: 0.65,
  'narrative-review': 0.6,
  'case-series': 0.35,
  preclinical: 0.3,
  other: 0.4,
};

/**
 * Early rungs want synthesis, not primary data: a good review beats a single
 * trial when you are still learning what the trial is measuring. Later rungs
 * invert that.
 */
const RUNG_PREFERENCE: Record<RungId, Partial<Record<EvidenceLevel, number>>> = {
  orientation: {
    'narrative-review': 1,
    'systematic-review': 0.9,
    guideline: 0.8,
    rct: 0.4,
    'case-series': 0.2,
    preclinical: 0.2,
  },
  foundations: {
    'narrative-review': 1,
    'systematic-review': 0.85,
    preclinical: 0.6,
    rct: 0.4,
    'case-series': 0.2,
  },
  mechanism: {
    'narrative-review': 0.9,
    preclinical: 0.9,
    'systematic-review': 0.8,
    cohort: 0.6,
    'case-series': 0.3,
  },
  applied: {
    guideline: 1,
    'systematic-review': 0.9,
    'narrative-review': 0.8,
    rct: 0.8,
    cohort: 0.7,
    preclinical: 0.2,
  },
  evidence: {
    'systematic-review': 1,
    rct: 1,
    guideline: 0.9,
    cohort: 0.6,
    'narrative-review': 0.4,
    preclinical: 0.1,
  },
  frontier: {
    rct: 1,
    'systematic-review': 0.85,
    cohort: 0.8,
    preclinical: 0.6,
    'narrative-review': 0.5,
    'case-series': 0.4,
  },
};

export interface ScoreOptions {
  rung: RungId;
  /** The topic, so aboutness and level can be judged. */
  topic?: TopicSpec;
  /** Terms the learner is studying now; overlap raises topical fit. */
  focusTerms?: string[];
  /**
   * Verdicts from the judgement pass. When a paper has one it decides
   * suitability and supplies the first reason shown — a sentence from
   * something that read the abstract beats a sentence from a pattern list.
   */
  judgements?: Judgements;
  now?: Date;
  /** Recency half-life in years. Short for the frontier, long for foundations. */
  halfLifeYears?: number;
}

/**
 * Recency half-life, in years, per rung.
 *
 * Long on the teaching rungs and short at the frontier, because that is how
 * the reading actually ages. What a pressure-volume loop is has not changed
 * since it was described; which device to use in cardiogenic shock changed
 * last year. An eight-year half-life on orientation was quietly ranking a
 * 2026 paper that mentions a concept above the 2018 paper that teaches it.
 */
const DEFAULT_HALF_LIFE: Record<RungId, number> = {
  orientation: 25,
  foundations: 30,
  mechanism: 20,
  applied: 7,
  evidence: 12,
  frontier: 1.5,
};

export function scorePaper(paper: Paper, options: ScoreOptions): ScoredPaper {
  const level = classifyEvidence(paper);
  const reasons: string[] = [];

  const preference = RUNG_PREFERENCE[options.rung][level] ?? 0.5;
  const evidence = EVIDENCE_WEIGHTS[level] * preference;
  reasons.push(`${evidenceLabel(level)} — ${describeFit(preference)} for the ${options.rung} rung`);

  const now = options.now ?? new Date();
  const halfLife = options.halfLifeYears ?? DEFAULT_HALF_LIFE[options.rung];
  const age = paperAgeYears(paper, now);
  const recency = age === null ? 0.5 : Math.pow(0.5, age / halfLife);
  if (age !== null) {
    reasons.push(
      age < 2 ? 'Published in the last two years' : `About ${Math.round(age)} years old`,
    );
  }

  const fit = topicalFit(paper, options.focusTerms ?? []);
  if (fit > 0.5 && (options.focusTerms?.length ?? 0) > 0) {
    reasons.push('Matches the concept you are studying');
  }

  // Citations are a weak, slow signal — useful as a tiebreaker, never a driver.
  const citations = paper.citedByCount ?? 0;
  const impact = Math.min(1, Math.log10(citations + 1) / 3);
  if (citations >= 100) reasons.push(`Cited ${citations} times`);

  if (paper.openAccessUrl) reasons.push('Free full text available');
  const readability = paper.abstract ? 1 : 0.6;
  if (!paper.abstract) reasons.push('No abstract indexed');

  // Is it about the topic, and is it pitched where the learner is? On the
  // lower rungs this matters more than anything else about the paper.
  const target = RUNG_LEVEL_TARGET[options.rung];
  const verdict = options.judgements?.get(paper.id);
  let suitability = 0.5;
  if (verdict && target) {
    const { judgement } = verdict;
    const levelFit = levelFitFor(judgement.level, target.levels);
    // A verdict carries no pedagogy score: something that read the paper and
    // called it introductory has already made that judgement, so level fit
    // stands on its own rather than being multiplied by a proxy for itself.
    suitability = 0.5 * judgement.aboutness + 0.5 * levelFit;
    reasons.unshift(judgement.reason);
  } else if (options.topic && target) {
    const assessment = assessLevel(paper, options.topic);
    const levelFit = levelFitFor(assessment.level, target.levels);
    suitability = 0.5 * assessment.aboutness + 0.5 * levelFit * assessment.pedagogy;
    reasons.unshift(...assessment.reasons.slice(0, 2));
  }

  const levelWeight = target
    ? verdict
      ? target.judgedWeight
      : options.topic
        ? target.weight
        : 0
    : 0;
  const rest = 1 - levelWeight;
  const score = round(
    (levelWeight * suitability +
      rest * (0.4 * evidence + 0.28 * recency + 0.17 * fit + 0.1 * impact + 0.05 * readability)) *
      (paper.openAccessUrl ? 1.03 : 1),
  );

  return { paper, evidenceLevel: level, score: Math.min(1, score), reasons };
}

export function rankPapers(papers: Paper[], options: ScoreOptions): ScoredPaper[] {
  return papers
    .map((paper) => scorePaper(paper, options))
    .sort((a, b) => b.score - a.score || (b.paper.year ?? 0) - (a.paper.year ?? 0));
}

/** Fraction of focus terms that appear in the paper's title, abstract, or MeSH. */
export function topicalFit(paper: Paper, focusTerms: string[]): number {
  if (focusTerms.length === 0) return 0.6;
  const haystack = [paper.title, paper.abstract ?? '', ...paper.meshTerms, ...paper.keywords]
    .join(' ')
    .toLowerCase();
  const hits = focusTerms.filter((term) => haystack.includes(term.toLowerCase())).length;
  return hits / focusTerms.length;
}

export function paperAgeYears(paper: Paper, now: Date = new Date()): number | null {
  const year =
    paper.year ?? (paper.publishedAt ? Number.parseInt(paper.publishedAt.slice(0, 4), 10) : NaN);
  if (!year || Number.isNaN(year)) return null;
  const published =
    paper.publishedAt && paper.publishedAt.length >= 7
      ? new Date(`${paper.publishedAt.slice(0, 7)}-01T00:00:00Z`)
      : new Date(Date.UTC(year, 6, 1));
  return Math.max(0, (now.getTime() - published.getTime()) / (365.25 * 86_400_000));
}

export function evidenceLabel(level: EvidenceLevel): string {
  switch (level) {
    case 'guideline':
      return 'Guideline';
    case 'systematic-review':
      return 'Systematic review / meta-analysis';
    case 'rct':
      return 'Randomised trial';
    case 'cohort':
      return 'Observational study';
    case 'case-series':
      return 'Case report or series';
    case 'narrative-review':
      return 'Narrative review';
    case 'preclinical':
      return 'Preclinical study';
    case 'other':
      return 'Uncategorised';
  }
}

/** How well a level suits a rung: wanted, adjacent, or wrong. */
function levelFitFor(level: Level, wanted: Level[]): number {
  if (wanted.includes(level)) return 1;
  return wanted.length > 0 && level === 'intermediate' ? 0.5 : 0.15;
}

function describeFit(preference: number): string {
  if (preference >= 0.9) return 'exactly the right kind of reading';
  if (preference >= 0.6) return 'useful';
  return 'lower priority';
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Is this paper actually about the topic?
 *
 * A search can match on words and still return something unrelated — that is
 * how a query for "PV loop" produced a meta-analysis about postoperative
 * nausea. Ranking alone does not save you there: a strong review of the wrong
 * subject still scores well. So relevance is a gate, not a weight.
 *
 * A paper passes if any name for the topic appears verbatim, or if every
 * meaningful word of the topic appears somewhere in its text — the second rule
 * catches "Pressure-Volume Loop" for a learner who typed "PV loop".
 */
export function matchesTopic(paper: Paper, topic: TopicSpec): boolean {
  const haystack = [paper.title, paper.abstract ?? '', ...paper.meshTerms, ...paper.keywords]
    .join(' ')
    .toLowerCase();

  const names = topicTerms(topic);
  if (names.length === 0) return true;

  if (names.some((name) => haystack.includes(name.toLowerCase()))) return true;

  const words = (names[0] ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 2);
  return words.length > 0 && words.every((word) => haystack.includes(word));
}
