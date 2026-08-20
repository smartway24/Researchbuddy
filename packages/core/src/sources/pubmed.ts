import type { Paper } from '../types.js';
import { buildUrl, httpGet, httpGetJson } from './http.js';
import type { SearchQuery, SearchResult, SourceAdapter } from './types.js';
import {
  childrenNamed,
  findAll,
  findFirst,
  firstNamed,
  parseXml,
  textContent,
  type XmlNode,
} from './xml.js';

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

export interface PubMedOptions {
  /**
   * NCBI API key. Optional: without one NCBI allows 3 requests/second, with one
   * it allows 10. The adapter throttles itself to match.
   */
  apiKey?: string;
  /** NCBI asks tools to identify themselves. */
  tool?: string;
  email?: string;
}

interface ESearchResponse {
  esearchresult?: {
    count?: string;
    idlist?: string[];
    querytranslation?: string;
  };
}

/** PubMed via NCBI E-utilities. The default source: free, no key required. */
export class PubMedSource implements SourceAdapter {
  readonly id = 'pubmed' as const;
  readonly label = 'PubMed';
  readonly isPublic = true;

  constructor(private readonly options: PubMedOptions = {}) {}

  private get minIntervalMs(): number {
    return this.options.apiKey ? 110 : 350;
  }

  private common(): Record<string, string | undefined> {
    return {
      api_key: this.options.apiKey,
      tool: this.options.tool ?? 'researchbuddy',
      email: this.options.email,
    };
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    const term = applyDateRange(query);
    const limit = Math.min(query.limit ?? 25, 100);

    const searchUrl = buildUrl(`${EUTILS}/esearch.fcgi`, {
      ...this.common(),
      db: 'pubmed',
      term,
      retmax: limit,
      retmode: 'json',
      sort: 'relevance',
    });

    const response = await httpGetJson<ESearchResponse>(searchUrl, {
      minIntervalMs: this.minIntervalMs,
      signal: query.signal,
    });

    const ids = response.esearchresult?.idlist ?? [];
    const total = Number.parseInt(response.esearchresult?.count ?? '0', 10) || 0;
    const executedQuery = response.esearchresult?.querytranslation ?? term;

    if (ids.length === 0) {
      return { sourceId: this.id, papers: [], total, executedQuery };
    }

    const fetchUrl = buildUrl(`${EUTILS}/efetch.fcgi`, {
      ...this.common(),
      db: 'pubmed',
      id: ids.join(','),
      retmode: 'xml',
    });

    const xml = await httpGet(fetchUrl, {
      minIntervalMs: this.minIntervalMs,
      signal: query.signal,
    });

    return { sourceId: this.id, papers: parsePubmedXml(xml), total, executedQuery };
  }
}

/** PubMed reads date filters inline rather than as query parameters. */
function applyDateRange(query: SearchQuery): string {
  if (query.fromYear === undefined && query.toYear === undefined) return query.term;
  const from = query.fromYear ?? 1800;
  const to = query.toYear ?? new Date().getFullYear();
  return `(${query.term}) AND ("${from}"[Date - Publication] : "${to}"[Date - Publication])`;
}

export function parsePubmedXml(xml: string): Paper[] {
  const document = parseXml(xml);
  return findAll(document, 'PubmedArticle').map(parseArticle).filter((p): p is Paper => p !== null);
}

function parseArticle(node: XmlNode): Paper | null {
  const citation = firstNamed(node, 'MedlineCitation');
  const article = citation ? firstNamed(citation, 'Article') : undefined;
  if (!citation || !article) return null;

  const pmid = textContent(firstNamed(citation, 'PMID'));
  if (!pmid) return null;

  const ids = new Map<string, string>();
  for (const idNode of findAll(node, 'ArticleId')) {
    const type = idNode.attributes['IdType'];
    if (type) ids.set(type, textContent(idNode));
  }

  const { year, publishedAt } = parsePubDate(article);
  const pmcid = ids.get('pmc');

  const paper: Paper = {
    id: `pubmed:${pmid}`,
    sourceId: 'pubmed',
    externalId: pmid,
    pmid,
    title: textContent(findFirst(article, 'ArticleTitle')).replace(/\.$/, ''),
    authors: parseAuthors(article),
    publicationTypes: findAll(article, 'PublicationType').map((n) => textContent(n)),
    meshTerms: findAll(citation, 'MeshHeading')
      .map((heading) => textContent(firstNamed(heading, 'DescriptorName')))
      .filter(Boolean),
    keywords: findAll(citation, 'Keyword').map((n) => textContent(n)).filter(Boolean),
    url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
  };

  const abstract = parseAbstract(article);
  if (abstract) paper.abstract = abstract;
  const doi = ids.get('doi');
  if (doi) paper.doi = doi;
  if (pmcid) {
    paper.pmcid = pmcid;
    paper.openAccessUrl = `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/`;
  }
  const journal = textContent(findFirst(article, 'Title'));
  if (journal) paper.journal = journal;
  if (year !== undefined) paper.year = year;
  if (publishedAt) paper.publishedAt = publishedAt;

  return paper;
}

/** Structured abstracts keep their section labels — they are the outline. */
function parseAbstract(article: XmlNode): string | undefined {
  const abstractNode = firstNamed(article, 'Abstract');
  if (!abstractNode) return undefined;
  const parts = childrenNamed(abstractNode, 'AbstractText').map((node) => {
    const label = node.attributes['Label'] ?? node.attributes['NlmCategory'];
    const text = textContent(node);
    if (!text) return '';
    return label ? `${toTitleCase(label)}: ${text}` : text;
  });
  const joined = parts.filter(Boolean).join('\n\n');
  return joined || undefined;
}

function parseAuthors(article: XmlNode): string[] {
  return findAll(article, 'Author')
    .map((author) => {
      const collective = textContent(firstNamed(author, 'CollectiveName'));
      if (collective) return collective;
      const last = textContent(firstNamed(author, 'LastName'));
      const initials = textContent(firstNamed(author, 'Initials'));
      return [last, initials].filter(Boolean).join(' ');
    })
    .filter(Boolean);
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function parsePubDate(article: XmlNode): { year?: number; publishedAt?: string } {
  const pubDate = findFirst(article, 'PubDate');
  if (!pubDate) return {};

  const yearText = textContent(firstNamed(pubDate, 'Year'));
  const medlineDate = textContent(firstNamed(pubDate, 'MedlineDate'));
  const yearMatch = yearText || /\d{4}/.exec(medlineDate)?.[0] || '';
  const year = Number.parseInt(yearMatch, 10);
  if (Number.isNaN(year)) return {};

  const monthText = textContent(firstNamed(pubDate, 'Month'));
  const month = MONTHS[monthText.slice(0, 3).toLowerCase()] ??
    (/^\d{1,2}$/.test(monthText) ? monthText.padStart(2, '0') : undefined);
  if (!month) return { year, publishedAt: String(year) };

  const dayText = textContent(firstNamed(pubDate, 'Day'));
  const day = /^\d{1,2}$/.test(dayText) ? dayText.padStart(2, '0') : undefined;
  return { year, publishedAt: day ? `${year}-${month}-${day}` : `${year}-${month}` };
}

function toTitleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
