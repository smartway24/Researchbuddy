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
  bySource: {
    sourceId: string;
    total: number;
    count: number;
    error?: string;
    fromCache?: boolean;
    savedAt?: string;
  }[];
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
        ...(outcome.value.fromCache ? { fromCache: true } : {}),
        ...(outcome.value.savedAt ? { savedAt: outcome.value.savedAt } : {}),
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
  // One paper can arrive with a DOI from one source and without from another.
  // Keying on a single identifier then produces two different keys for the
  // same work, so every identifier a record carries points at its entry and a
  // match on *any* of them counts as a duplicate.
  const index = new Map<string, number>();
  const merged: Paper[] = [];

  for (const paper of papers) {
    const keys = dedupeKeys(paper);
    const hit = keys
      .map((key) => index.get(key))
      .find((slot) => slot !== undefined && !contradicts(paper, merged[slot]));

    if (hit === undefined) {
      const slot = merged.length;
      merged.push(paper);
      for (const key of keys) index.set(key, slot);
      continue;
    }

    const existing = merged[hit];
    if (!existing) continue;
    const [keep, drop] =
      richness(paper) > richness(existing) ? [paper, existing] : [existing, paper];
    const result = mergePapers(keep, drop);
    merged[hit] = result;
    // The merged record can carry identifiers neither original had alone.
    for (const key of dedupeKeys(result)) index.set(key, hit);
  }

  return merged;
}

/**
 * Two records that both carry a DOI, and different ones, are different works
 * however alike their titles look — a preprint and its published version, or
 * two papers that genuinely share a name.
 */
function contradicts(paper: Paper, other: Paper | undefined): boolean {
  if (!other?.doi || !paper.doi) return false;
  return normaliseDoi(paper.doi) !== normaliseDoi(other.doi);
}

function normaliseDoi(doi: string): string {
  return doi.toLowerCase().replace(/^https?:\/\/doi\.org\//, '');
}

/** Every identifier this record could be recognised by. */
function dedupeKeys(paper: Paper): string[] {
  const keys: string[] = [];
  if (paper.doi) keys.push(`doi:${normaliseDoi(paper.doi)}`);
  if (paper.pmid) keys.push(`pmid:${paper.pmid}`);
  if (paper.pmcid) keys.push(`pmcid:${paper.pmcid.toLowerCase()}`);
  const title = paper.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (title) keys.push(`title:${title}`);
  return keys;
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
