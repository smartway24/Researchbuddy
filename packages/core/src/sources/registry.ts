import type { Paper } from '../types.js';
import { EuropePmcSource } from './europepmc.js';
import { PubMedSource, type PubMedOptions } from './pubmed.js';
import type { SearchQuery, SearchResult, SourceAdapter } from './types.js';

export interface RegistryOptions {
  pubmed?: PubMedOptions;
  /** Extra adapters, e.g. an institutional catalogue added later. */
  extra?: SourceAdapter[];
}

export function defaultSources(options: RegistryOptions = {}): SourceAdapter[] {
  return [new PubMedSource(options.pubmed ?? {}), new EuropePmcSource(), ...(options.extra ?? [])];
}

export interface FederatedResult {
  papers: Paper[];
  /** Per-source outcome, so a failing source is visible rather than silent. */
  bySource: { sourceId: string; total: number; count: number; error?: string }[];
}

/**
 * Query every source at once and merge. A source that fails is reported, not
 * thrown: a PubMed outage should still leave the learner with Europe PMC.
 */
export async function searchAll(
  sources: SourceAdapter[],
  query: SearchQuery,
): Promise<FederatedResult> {
  const settled = await Promise.allSettled(sources.map((source) => source.search(query)));

  const results: SearchResult[] = [];
  const bySource: FederatedResult['bySource'] = [];

  settled.forEach((outcome, index) => {
    const source = sources[index];
    if (!source) return;
    if (outcome.status === 'fulfilled') {
      results.push(outcome.value);
      bySource.push({
        sourceId: source.id,
        total: outcome.value.total,
        count: outcome.value.papers.length,
      });
    } else {
      bySource.push({
        sourceId: source.id,
        total: 0,
        count: 0,
        error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason),
      });
    }
  });

  return { papers: dedupe(results.flatMap((result) => result.papers)), bySource };
}

/**
 * The same paper routinely appears in several sources. Prefer the record with
 * the most usable metadata, but keep any open-access link and identifier the
 * duplicates contribute — one source often knows the DOI and another the PMC id.
 */
export function dedupe(papers: Paper[]): Paper[] {
  const byKey = new Map<string, Paper>();

  for (const paper of papers) {
    const key = dedupeKey(paper);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, paper);
      continue;
    }
    const [keep, drop] = richness(paper) > richness(existing) ? [paper, existing] : [existing, paper];
    byKey.set(key, mergePapers(keep, drop));
  }

  return [...byKey.values()];
}

function dedupeKey(paper: Paper): string {
  if (paper.doi) return `doi:${paper.doi.toLowerCase()}`;
  if (paper.pmid) return `pmid:${paper.pmid}`;
  return `title:${paper.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
}

function richness(paper: Paper): number {
  return (
    (paper.abstract?.length ?? 0) / 100 +
    paper.meshTerms.length +
    paper.publicationTypes.length +
    (paper.openAccessUrl ? 5 : 0) +
    (paper.doi ? 2 : 0)
  );
}

function mergePapers(keep: Paper, drop: Paper): Paper {
  return {
    ...keep,
    doi: keep.doi ?? drop.doi,
    pmid: keep.pmid ?? drop.pmid,
    pmcid: keep.pmcid ?? drop.pmcid,
    abstract: keep.abstract ?? drop.abstract,
    journal: keep.journal ?? drop.journal,
    year: keep.year ?? drop.year,
    publishedAt: keep.publishedAt ?? drop.publishedAt,
    openAccessUrl: keep.openAccessUrl ?? drop.openAccessUrl,
    citedByCount: keep.citedByCount ?? drop.citedByCount,
    publicationTypes: unique([...keep.publicationTypes, ...drop.publicationTypes]),
    meshTerms: unique([...keep.meshTerms, ...drop.meshTerms]),
    keywords: unique([...keep.keywords, ...drop.keywords]),
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
