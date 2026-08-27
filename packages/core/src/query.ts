import type { RungId } from './types.js';

/**
 * Query planning is where "remove the searching on my end" actually happens.
 *
 * A plan is deliberately *not* a query string. Every source speaks its own
 * language — PubMed wants `review[Publication Type]`, Europe PMC wants
 * `PUB_TYPE:"review"` — and handing one source another's syntax does not fail
 * loudly. Europe PMC silently ignores field tags it does not recognise and
 * returns whatever matched the bare words, sorted by citations, which is how a
 * search for "PV loop" came back with a meta-analysis about postoperative
 * nausea. So the planner describes *intent*, and each adapter renders it.
 */

/** What the learner is studying, in every name we know for it. */
export interface TopicSpec {
  /** Canonical term — the MeSH descriptor when we resolved one, else what they typed. */
  term: string;
  /** MeSH descriptor, when known. */
  meshTerm?: string;
  /** MeSH entry terms; catches papers that use another name for the same thing. */
  synonyms?: string[];
}

/** Kinds of paper a rung wants, expressed once and translated per source. */
export type EvidenceFilter = 'review' | 'systematic-review' | 'meta-analysis' | 'rct' | 'guideline';

export interface QueryPlan {
  rung: RungId;
  topic: TopicSpec;
  /** Any-of. Empty means no restriction on publication type. */
  publicationTypes: EvidenceFilter[];
  /** Any-of free text, matched in title or abstract. */
  anyText: string[];
  /** Restrict to human studies. */
  humansOnly: boolean;
  /**
   * Require the topic in the *title*, not just anywhere in the record.
   *
   * Authors put the subject of the work in the title and their tools in the
   * abstract, so this is the cheapest strong signal that a paper is about the
   * topic rather than merely using it. The lower rungs demand it; the frontier
   * does not, because that is where a paper applying the concept is the point.
   */
  titleAnchored: boolean;
  fromYear?: number;
  toYear?: number;
  limit: number;
  /** Shown in the UI: why these papers, in one sentence. */
  explanation: string;
}

/** Strip characters that would break either source's parser. */
export function cleanTerm(value: string): string {
  return value
    .replace(/["[\]():]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quote a phrase for PubMed, which only needs quotes when there is a space. */
function pubmedPhrase(value: string): string {
  const cleaned = cleanTerm(value);
  return cleaned.includes(' ') ? `"${cleaned}"` : cleaned;
}

/** Europe PMC wants every phrase quoted, space or not. */
function europePmcPhrase(value: string): string {
  return `"${cleanTerm(value)}"`;
}

/**
 * Every name for the topic, deduplicated, most specific first. A few synonyms
 * widen recall; all of them would drown the query in near-duplicates.
 */
export function topicTerms(topic: TopicSpec, maxSynonyms = 4): string[] {
  const all = [topic.meshTerm, topic.term, ...(topic.synonyms ?? []).slice(0, maxSynonyms)];
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const value of all) {
    const cleaned = value ? cleanTerm(value) : '';
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(cleaned);
  }
  return terms;
}

const PUBMED_TYPES: Record<EvidenceFilter, string> = {
  review: 'review[Publication Type]',
  'systematic-review': 'systematic review[Publication Type]',
  'meta-analysis': 'meta-analysis[Publication Type]',
  rct: 'randomized controlled trial[Publication Type]',
  guideline: 'practice guideline[Publication Type]',
};

const EUROPE_PMC_TYPES: Record<EvidenceFilter, string> = {
  review: 'PUB_TYPE:"review"',
  'systematic-review': 'PUB_TYPE:"systematic review"',
  'meta-analysis': 'PUB_TYPE:"meta-analysis"',
  rct: 'PUB_TYPE:"randomized controlled trial"',
  guideline: 'PUB_TYPE:"practice guideline"',
};

export function renderPubMedQuery(plan: QueryPlan): string {
  const clauses: string[] = [];

  const field = plan.titleAnchored ? '[Title]' : '[Title/Abstract]';
  const topic = topicTerms(plan.topic).map((term) => `${pubmedPhrase(term)}${field}`);
  if (plan.topic.meshTerm) {
    // MeSH Major Topic is NLM saying the paper is principally about this,
    // which is the same claim the title makes, made by an indexer.
    const mesh = plan.titleAnchored ? '[MeSH Major Topic]' : '[MeSH Terms]';
    topic.unshift(`${pubmedPhrase(plan.topic.meshTerm)}${mesh}`);
  }
  clauses.push(`(${topic.join(' OR ')})`);

  if (plan.publicationTypes.length > 0) {
    clauses.push(`(${plan.publicationTypes.map((type) => PUBMED_TYPES[type]).join(' OR ')})`);
  }
  if (plan.anyText.length > 0) {
    clauses.push(
      `(${plan.anyText.map((text) => `${pubmedPhrase(text)}[Title/Abstract]`).join(' OR ')})`,
    );
  }
  if (plan.humansOnly) clauses.push('humans[MeSH Terms]');

  if (plan.fromYear !== undefined || plan.toYear !== undefined) {
    const from = plan.fromYear ?? 1800;
    const to = plan.toYear ?? new Date().getFullYear();
    clauses.push(`("${from}"[Date - Publication] : "${to}"[Date - Publication])`);
  }

  return clauses.join(' AND ');
}

export function renderEuropePmcQuery(plan: QueryPlan): string {
  const clauses: string[] = [];

  const field = plan.titleAnchored ? 'TITLE' : 'TITLE_ABS';
  const topic = topicTerms(plan.topic).map((term) => `${field}:${europePmcPhrase(term)}`);
  if (plan.topic.meshTerm) {
    topic.unshift(`MESH:${europePmcPhrase(plan.topic.meshTerm)}`);
  }
  clauses.push(`(${topic.join(' OR ')})`);

  if (plan.publicationTypes.length > 0) {
    clauses.push(`(${plan.publicationTypes.map((type) => EUROPE_PMC_TYPES[type]).join(' OR ')})`);
  }
  if (plan.anyText.length > 0) {
    clauses.push(
      `(${plan.anyText.map((text) => `TITLE_ABS:${europePmcPhrase(text)}`).join(' OR ')})`,
    );
  }
  if (plan.humansOnly) clauses.push('MESH:"Humans"');

  if (plan.fromYear !== undefined || plan.toYear !== undefined) {
    const from = plan.fromYear ?? 1800;
    const to = plan.toYear ?? new Date().getFullYear();
    clauses.push(`(FIRST_PDATE:[${from}-01-01 TO ${to}-12-31])`);
  }

  return clauses.join(' AND ');
}

export interface PlanOptions {
  currentYear?: number;
  /** Narrowing terms from the concept the learner is on right now. */
  focusTerms?: string[];
}

export function planForRung(rung: RungId, topic: TopicSpec, options: PlanOptions = {}): QueryPlan {
  const currentYear = options.currentYear ?? new Date().getFullYear();
  const focus = options.focusTerms ?? [];
  const base = { rung, topic, humansOnly: false, titleAnchored: false } as const;

  switch (rung) {
    case 'orientation':
      return {
        ...base,
        // No publication-type filter: "review" is a metadata tag, not a level.
        // Aboutness comes from the title; level is judged after retrieval.
        titleAnchored: true,
        publicationTypes: [],
        anyText: focus,
        fromYear: currentYear - 20,
        limit: 25,
        explanation: 'Papers written to explain the subject rather than to report a new result.',
      };

    case 'foundations':
      return {
        ...base,
        titleAnchored: true,
        publicationTypes: [],
        anyText: [...focus, 'physiology', 'anatomy', 'physics', 'principles', 'mechanics'],
        fromYear: currentYear - 25,
        limit: 25,
        explanation: 'The physics, physiology, and anatomy the topic rests on.',
      };

    case 'mechanism':
      return {
        ...base,
        titleAnchored: true,
        publicationTypes: [],
        anyText: [...focus, 'mechanism', 'pathophysiology', 'haemodynamics', 'hemodynamics'],
        fromYear: currentYear - 15,
        limit: 20,
        explanation: 'How it works and how it fails — mechanism and pathophysiology.',
      };

    case 'applied':
      return {
        ...base,
        humansOnly: true,
        publicationTypes: ['guideline', 'review'],
        anyText: [...focus, 'management', 'indications', 'complications'],
        fromYear: currentYear - 8,
        limit: 12,
        explanation: 'Indications, management, and complications as they appear in practice.',
      };

    case 'evidence':
      return {
        ...base,
        publicationTypes: ['rct', 'meta-analysis', 'systematic-review', 'guideline'],
        anyText: focus,
        fromYear: currentYear - 20,
        limit: 15,
        explanation: 'The trials, meta-analyses, and guidelines that set current consensus.',
      };

    case 'frontier':
      return {
        ...base,
        publicationTypes: [],
        anyText: focus,
        fromYear: currentYear - 2,
        limit: 20,
        explanation: 'Everything from the last two years, newest and most relevant first.',
      };
  }
}
