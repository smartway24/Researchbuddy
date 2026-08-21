import type { Paper } from './types.js';

/**
 * The "flurry of ideas surrounding the concept", derived from data rather than
 * guessed by a model: MeSH indexing on the papers a topic returns is a
 * hand-curated map of what that topic is *about*. Counting co-occurring
 * descriptors and dropping the ones that are everywhere gives a usable concept
 * neighbourhood offline, with no API key and no hallucination risk.
 */

/** MeSH descriptors so broad they carry no signal about any specific topic. */
const STOP_TERMS = new Set([
  'humans',
  'animals',
  'male',
  'female',
  'adult',
  'aged',
  'middle aged',
  'young adult',
  'child',
  'infant',
  'infant, newborn',
  'adolescent',
  'aged, 80 and over',
  'child, preschool',
  'retrospective studies',
  'prospective studies',
  'treatment outcome',
  'risk factors',
  'time factors',
  'follow-up studies',
  'cohort studies',
  'incidence',
  'prevalence',
  'united states',
  'europe',
  'registries',
  'hospital mortality',
  'survival rate',
  'reproducibility of results',
  'sensitivity and specificity',
  'severity of illness index',
]);

export interface RelatedConcept {
  label: string;
  /** How many of the sampled papers are indexed under this descriptor. */
  paperCount: number;
  /** 0..1 share of the sample. */
  prevalence: number;
  /** Papers to read first if the learner follows this thread. */
  examplePaperIds: string[];
}

export interface ExtractOptions {
  /** Terms to exclude — normally the topic itself and its synonyms. */
  exclude?: string[];
  /** Drop descriptors appearing in more than this share of papers (too generic). */
  maxPrevalence?: number;
  /** Require at least this many papers before a descriptor counts as a concept. */
  minPaperCount?: number;
  limit?: number;
}

export function extractRelatedConcepts(
  papers: Paper[],
  options: ExtractOptions = {},
): RelatedConcept[] {
  const { maxPrevalence = 0.8, minPaperCount = 2, limit = 20 } = options;
  if (papers.length === 0) return [];

  const excluded = new Set((options.exclude ?? []).map(normalise));
  const counts = new Map<string, { label: string; paperIds: string[] }>();

  for (const paper of papers) {
    // Count each descriptor once per paper, not once per occurrence.
    const seen = new Set<string>();
    for (const term of [...paper.meshTerms, ...paper.keywords]) {
      const key = normalise(term);
      if (!key || seen.has(key)) continue;
      if (STOP_TERMS.has(key) || excluded.has(key)) continue;
      if (key.length < 3) continue;
      seen.add(key);
      const entry = counts.get(key) ?? { label: tidyLabel(term), paperIds: [] };
      entry.paperIds.push(paper.id);
      counts.set(key, entry);
    }
  }

  return [...counts.values()]
    .map((entry) => ({
      label: entry.label,
      paperCount: entry.paperIds.length,
      prevalence: round(entry.paperIds.length / papers.length),
      examplePaperIds: entry.paperIds.slice(0, 3),
    }))
    .filter((concept) => concept.paperCount >= minPaperCount && concept.prevalence <= maxPrevalence)
    .sort((a, b) => b.paperCount - a.paperCount || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/**
 * Group papers by shared indexing so a digest reads as themes rather than a
 * list. Each paper lands in exactly one theme — its most distinctive shared
 * descriptor — and anything that shares nothing falls through to the caller.
 */
export interface Theme {
  label: string;
  paperIds: string[];
}

export function clusterByTheme(
  papers: Paper[],
  options: ExtractOptions = {},
): { themes: Theme[]; unthemed: string[] } {
  const concepts = extractRelatedConcepts(papers, { ...options, limit: options.limit ?? 6 });
  const claimed = new Set<string>();
  const themes: Theme[] = [];

  for (const concept of concepts) {
    const key = normalise(concept.label);
    const members = papers.filter(
      (paper) =>
        !claimed.has(paper.id) &&
        [...paper.meshTerms, ...paper.keywords].some((term) => normalise(term) === key),
    );
    if (members.length < 2) continue;
    for (const paper of members) claimed.add(paper.id);
    themes.push({ label: concept.label, paperIds: members.map((paper) => paper.id) });
  }

  return {
    themes,
    unthemed: papers.filter((paper) => !claimed.has(paper.id)).map((paper) => paper.id),
  };
}

function normalise(term: string): string {
  return term.toLowerCase().replace(/\s+/g, ' ').trim();
}

function tidyLabel(term: string): string {
  const trimmed = term.trim();
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
