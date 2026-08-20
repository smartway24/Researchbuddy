import { buildUrl, httpGetJson } from './http.js';

/**
 * Canonicalise what the learner typed.
 *
 * "ECMO" is not a search term — "Extracorporeal Membrane Oxygenation" is the
 * MeSH descriptor, and NLM already curates its definition and its synonyms.
 * Resolving the topic up front buys three things at once: precise queries,
 * a ready-made orientation card, and a synonym list so the topic itself stops
 * showing up in its own list of related concepts.
 */
export interface ResolvedTopic {
  meshUid: string;
  /** The canonical descriptor, e.g. "Extracorporeal Membrane Oxygenation". */
  descriptor: string;
  /** NLM's scope note — a short, citable definition. */
  definition?: string;
  /** Entry terms: every synonym NLM maps onto this descriptor. */
  synonyms: string[];
  yearIntroduced?: string;
}

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

interface MeshSearchResponse {
  esearchresult?: { idlist?: string[] };
}

interface MeshSummaryResponse {
  result?: Record<string, unknown> & { uids?: string[] };
}

export interface ResolveOptions {
  apiKey?: string;
  signal?: AbortSignal;
}

export async function resolveMeshTopic(
  term: string,
  options: ResolveOptions = {},
): Promise<ResolvedTopic | null> {
  const trimmed = term.trim();
  if (!trimmed) return null;

  const minIntervalMs = options.apiKey ? 110 : 350;
  const common = { api_key: options.apiKey, tool: 'researchbuddy', retmode: 'json' };

  const search = await httpGetJson<MeshSearchResponse>(
    buildUrl(`${EUTILS}/esearch.fcgi`, { ...common, db: 'mesh', term: trimmed, retmax: 1 }),
    { minIntervalMs, ...(options.signal ? { signal: options.signal } : {}) },
  );

  const uid = search.esearchresult?.idlist?.[0];
  if (!uid) return null;

  const summary = await httpGetJson<MeshSummaryResponse>(
    buildUrl(`${EUTILS}/esummary.fcgi`, { ...common, db: 'mesh', id: uid }),
    { minIntervalMs, ...(options.signal ? { signal: options.signal } : {}) },
  );

  return parseMeshSummary(summary, uid);
}

export function parseMeshSummary(summary: MeshSummaryResponse, uid: string): ResolvedTopic | null {
  const record = summary.result?.[uid] as Record<string, unknown> | undefined;
  if (!record) return null;

  const terms = Array.isArray(record['ds_meshterms'])
    ? (record['ds_meshterms'] as unknown[]).map((value) => String(value)).filter(Boolean)
    : [];
  const descriptor = terms[0];
  if (!descriptor) return null;

  const definition = typeof record['ds_scopenote'] === 'string' ? record['ds_scopenote'].trim() : '';
  const year = typeof record['ds_yearintroduced'] === 'string' ? record['ds_yearintroduced'] : '';

  return {
    meshUid: uid,
    descriptor,
    ...(definition ? { definition } : {}),
    synonyms: terms.slice(1),
    ...(year ? { yearIntroduced: year } : {}),
  };
}
