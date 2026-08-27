import type { Paper } from '../types.js';
import { buildUrl, httpGetJson } from './http.js';
import { renderEuropePmcQuery } from '../query.js';
import { resolveQuery, type SearchQuery, type SearchResult, type SourceAdapter } from './types.js';

const BASE = 'https://www.ebi.ac.uk/europepmc/webservices/rest/search';

interface EuropePmcResponse {
  hitCount?: number;
  resultList?: { result?: EuropePmcResult[] };
}

interface EuropePmcResult {
  id?: string;
  source?: string;
  pmid?: string;
  pmcid?: string;
  doi?: string;
  title?: string;
  authorString?: string;
  journalTitle?: string;
  pubYear?: string;
  firstPublicationDate?: string;
  abstractText?: string;
  pubType?: string;
  keywordList?: { keyword?: string[] };
  meshHeadingList?: { meshHeading?: { descriptorName?: string }[] };
  isOpenAccess?: string;
  citedByCount?: number;
  fullTextUrlList?: { fullTextUrl?: { url?: string; availability?: string }[] };
}

/**
 * Europe PMC. Complements PubMed: it indexes preprints and life-science
 * literature PubMed misses, and it reports open-access full-text links
 * directly, which is what makes "just let me read it" work without a login.
 */
export class EuropePmcSource implements SourceAdapter {
  readonly id = 'europepmc' as const;
  readonly label = 'Europe PMC';
  readonly isPublic = true;

  async search(query: SearchQuery): Promise<SearchResult> {
    const resolved = resolveQuery(query, renderEuropePmcQuery);
    const term = query.plan ? resolved.term : applyDateRange(resolved);
    const url = buildUrl(BASE, {
      query: term,
      format: 'json',
      resultType: 'core',
      pageSize: Math.min(resolved.limit, 100),
      // Europe PMC's default sort is relevance. Sorting by citations instead
      // floats big statistics reports to the top of any loose match, which is
      // exactly the wrong failure when a query is imprecise.
    });

    const response = await httpGetJson<EuropePmcResponse>(url, {
      minIntervalMs: 200,
      signal: query.signal,
    });

    const results = response.resultList?.result ?? [];
    return {
      sourceId: this.id,
      papers: results.map(toPaper).filter((p): p is Paper => p !== null),
      total: response.hitCount ?? results.length,
      executedQuery: term,
    };
  }
}

function applyDateRange(query: { term: string; fromYear?: number; toYear?: number }): string {
  if (query.fromYear === undefined && query.toYear === undefined) return query.term;
  const from = query.fromYear ?? 1800;
  const to = query.toYear ?? new Date().getFullYear();
  return `(${query.term}) AND (FIRST_PDATE:[${from}-01-01 TO ${to}-12-31])`;
}

function toPaper(result: EuropePmcResult): Paper | null {
  const externalId = result.id;
  const title = result.title?.replace(/\.$/, '');
  if (!externalId || !title) return null;

  const year = result.pubYear ? Number.parseInt(result.pubYear, 10) : undefined;
  const openAccessUrl = pickOpenAccessUrl(result);

  const paper: Paper = {
    id: `europepmc:${externalId}`,
    sourceId: 'europepmc',
    externalId,
    title,
    authors: result.authorString
      ? result.authorString
          .replace(/\.$/, '')
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean)
      : [],
    publicationTypes: result.pubType
      ? result.pubType
          .split(';')
          .map((t) => t.trim())
          .filter(Boolean)
      : [],
    meshTerms: (result.meshHeadingList?.meshHeading ?? [])
      .map((heading) => heading.descriptorName ?? '')
      .filter(Boolean),
    keywords: result.keywordList?.keyword ?? [],
    url: `https://europepmc.org/article/${result.source ?? 'MED'}/${externalId}`,
  };

  if (result.abstractText) paper.abstract = result.abstractText;
  if (result.doi) paper.doi = result.doi;
  if (result.pmid) paper.pmid = result.pmid;
  if (result.pmcid) paper.pmcid = result.pmcid;
  if (result.journalTitle) paper.journal = result.journalTitle;
  if (year !== undefined && !Number.isNaN(year)) paper.year = year;
  if (result.firstPublicationDate) paper.publishedAt = result.firstPublicationDate;
  if (openAccessUrl) paper.openAccessUrl = openAccessUrl;
  if (typeof result.citedByCount === 'number') paper.citedByCount = result.citedByCount;

  return paper;
}

function pickOpenAccessUrl(result: EuropePmcResult): string | undefined {
  const links = result.fullTextUrlList?.fullTextUrl ?? [];
  const free =
    links.find((link) => link.availability === 'Open access') ??
    links.find((link) => link.availability === 'Free');
  if (free?.url) return free.url;
  if (result.isOpenAccess === 'Y' && result.pmcid) {
    return `https://europepmc.org/article/PMC/${result.pmcid}`;
  }
  return undefined;
}
