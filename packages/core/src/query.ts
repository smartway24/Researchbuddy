import type { RungId } from './types.js';

/**
 * Query building is where "remove the searching on my end" actually happens.
 *
 * The learner types a topic. For each rung of the ladder we know what kind of
 * reading is useful — a review article for foundations, a landmark trial for
 * the evidence rung, the last two years for the frontier — so we express that
 * as filters instead of asking the learner to know PubMed syntax.
 */
export interface QueryPlan {
  rung: RungId;
  /** PubMed-syntax query; Europe PMC accepts the field-free form well enough. */
  term: string;
  fromYear?: number;
  toYear?: number;
  limit: number;
  /** Shown in the UI: why these papers, in one sentence. */
  explanation: string;
}

export interface QueryContext {
  /** Canonical topic term, e.g. "Extracorporeal Membrane Oxygenation". */
  topic: string;
  /** MeSH descriptor when known — a MeSH-anchored query is far more precise. */
  meshTerm?: string;
  /** MeSH entry terms; searching them catches papers that use another name. */
  synonyms?: string[];
  /** Narrowing terms from the concept the learner is on right now. */
  focusTerms?: string[];
  currentYear?: number;
}

/** Quote a phrase and strip characters that would break PubMed's parser. */
export function quoteTerm(value: string): string {
  const cleaned = value
    .replace(/["[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.includes(' ') ? `"${cleaned}"` : cleaned;
}

/** The topic clause: MeSH-anchored when we can, plus a title/abstract fallback. */
export function topicClause(context: QueryContext): string {
  const clauses = [`${quoteTerm(context.topic)}[Title/Abstract]`];
  if (context.meshTerm) clauses.unshift(`${quoteTerm(context.meshTerm)}[MeSH Terms]`);
  // A few synonyms widen recall; all of them would blow past PubMed's term
  // limit and drown the query in near-duplicates.
  for (const synonym of (context.synonyms ?? []).slice(0, 4)) {
    clauses.push(`${quoteTerm(synonym)}[Title/Abstract]`);
  }
  const topic = `(${clauses.join(' OR ')})`;

  const focus = (context.focusTerms ?? []).filter(Boolean);
  if (focus.length === 0) return topic;
  const focusClause = focus.map((term) => `${quoteTerm(term)}[Title/Abstract]`).join(' OR ');
  return `${topic} AND (${focusClause})`;
}

const HUMAN_FILTER = 'humans[MeSH Terms]';

export function planForRung(rung: RungId, context: QueryContext): QueryPlan {
  const topic = topicClause(context);
  const currentYear = context.currentYear ?? new Date().getFullYear();

  switch (rung) {
    case 'orientation':
      return {
        rung,
        term: `${topic} AND (review[Publication Type] OR "overview"[Title])`,
        fromYear: currentYear - 8,
        limit: 8,
        explanation:
          'Recent overviews and review articles to get the vocabulary and the shape of the field.',
      };

    case 'foundations':
      return {
        rung,
        term: `${topic} AND (review[Publication Type]) AND (physiology[MeSH Subheading] OR "physiology"[Title/Abstract] OR "anatomy"[Title/Abstract] OR "principles"[Title])`,
        fromYear: currentYear - 15,
        limit: 10,
        explanation: 'Reviews covering the underlying physiology and anatomy the topic rests on.',
      };

    case 'mechanism':
      return {
        rung,
        term: `${topic} AND ("mechanism"[Title/Abstract] OR "pathophysiology"[Title/Abstract] OR physiopathology[MeSH Subheading] OR "haemodynamics"[Title/Abstract] OR "hemodynamics"[Title/Abstract])`,
        fromYear: currentYear - 12,
        limit: 12,
        explanation: 'How it works and how it fails — mechanism and pathophysiology.',
      };

    case 'applied':
      return {
        rung,
        term: `${topic} AND (${HUMAN_FILTER}) AND ("management"[Title/Abstract] OR "indications"[Title/Abstract] OR "complications"[Title/Abstract] OR therapy[MeSH Subheading] OR "practice guideline"[Publication Type])`,
        fromYear: currentYear - 8,
        limit: 12,
        explanation: 'Indications, management, and complications as they appear in practice.',
      };

    case 'evidence':
      return {
        rung,
        term: `${topic} AND (randomized controlled trial[Publication Type] OR meta-analysis[Publication Type] OR systematic review[Publication Type] OR "practice guideline"[Publication Type])`,
        fromYear: currentYear - 20,
        limit: 15,
        explanation: 'The trials, meta-analyses, and guidelines that set current consensus.',
      };

    case 'frontier':
      return {
        rung,
        term: `${topic} AND (${HUMAN_FILTER} OR "preprint"[Publication Type])`,
        fromYear: currentYear - 2,
        limit: 20,
        explanation: 'Everything from the last two years, newest and most-cited first.',
      };
  }
}

/**
 * "A flurry of ideas surrounding the concept": adjacent queries that map the
 * neighbourhood of a topic rather than drilling into it. Used to seed the
 * concept map before the learner has read anything.
 */
export function neighbourhoodPlans(context: QueryContext): QueryPlan[] {
  const topic = topicClause(context);
  const currentYear = context.currentYear ?? new Date().getFullYear();
  return [
    {
      rung: 'orientation',
      term: `${topic} AND ("history"[Title/Abstract] OR history[MeSH Subheading])`,
      limit: 5,
      explanation: 'Where this came from and what problem it was invented to solve.',
    },
    {
      rung: 'applied',
      term: `${topic} AND ("controversy"[Title/Abstract] OR "debate"[Title/Abstract] OR "unanswered"[Title/Abstract] OR "uncertainty"[Title/Abstract])`,
      fromYear: currentYear - 6,
      limit: 6,
      explanation: 'The open arguments — the fastest way to see where the edges of the field are.',
    },
    {
      rung: 'mechanism',
      term: `${topic} AND ("compared with"[Title/Abstract] OR "versus"[Title] OR "alternative"[Title/Abstract])`,
      fromYear: currentYear - 8,
      limit: 6,
      explanation: 'Adjacent and competing approaches, to place the topic among its alternatives.',
    },
  ];
}
