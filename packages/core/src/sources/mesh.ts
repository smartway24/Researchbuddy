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

  // Several candidates, not one. MeSH search is loose enough that the first
  // hit for "cardiac preload" is "Cardiotoxicity" — a different subject
  // entirely, which would then silently replace the topic.
  const search = await httpGetJson<MeshSearchResponse>(
    buildUrl(`${EUTILS}/esearch.fcgi`, { ...common, db: 'mesh', term: trimmed, retmax: 8 }),
    { minIntervalMs, ...(options.signal ? { signal: options.signal } : {}) },
  );

  const uids = search.esearchresult?.idlist ?? [];
  if (uids.length === 0) return null;

  const summary = await httpGetJson<MeshSummaryResponse>(
    buildUrl(`${EUTILS}/esummary.fcgi`, { ...common, db: 'mesh', id: uids.join(',') }),
    { minIntervalMs, ...(options.signal ? { signal: options.signal } : {}) },
  );

  const candidates = uids
    .map((uid) => parseMeshSummary(summary, uid))
    .filter((resolved): resolved is ResolvedTopic => resolved !== null);

  return pickMatchingTopic(trimmed, candidates);
}

/**
 * Accept a descriptor only if it is demonstrably the thing that was typed.
 *
 * NLM lists every name a descriptor answers to, so the test is whether the
 * query appears among them — that is how "ECMO" correctly reaches
 * "Extracorporeal Membrane Oxygenation" despite sharing no words with it, and
 * how "cardiac preload" correctly fails to reach "Cardiotoxicity" despite
 * being its top search hit. An unmatched topic is not a failure: searching the
 * learner's own words is a perfectly good fallback, and far better than
 * researching a different subject without telling them.
 */
export function pickMatchingTopic(term: string, candidates: ResolvedTopic[]): ResolvedTopic | null {
  const needle = normalise(term);

  // Exact match against any name the descriptor carries.
  for (const candidate of candidates) {
    const names = [candidate.descriptor, ...candidate.synonyms].map(normalise);
    if (names.includes(needle)) return candidate;
  }

  // Then a whole-phrase appearance inside one of those names, which is what
  // catches abbreviations listed as "ARDS Human" or "ECMO Treatment".
  for (const candidate of candidates) {
    const names = [candidate.descriptor, ...candidate.synonyms].map(normalise);
    if (names.some((name) => containsPhrase(name, needle))) return candidate;
  }

  return null;
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Whole-word phrase containment, so "ards" never matches "guards". */
function containsPhrase(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const words = haystack.split(' ');
  const target = needle.split(' ');
  for (let i = 0; i + target.length <= words.length; i++) {
    if (target.every((word, offset) => words[i + offset] === word)) return true;
  }
  return false;
}

export function parseMeshSummary(summary: MeshSummaryResponse, uid: string): ResolvedTopic | null {
  const record = summary.result?.[uid] as Record<string, unknown> | undefined;
  if (!record) return null;

  const terms = Array.isArray(record['ds_meshterms'])
    ? (record['ds_meshterms'] as unknown[]).map((value) => String(value)).filter(Boolean)
    : [];
  const descriptor = terms[0];
  if (!descriptor) return null;

  const definition =
    typeof record['ds_scopenote'] === 'string' ? record['ds_scopenote'].trim() : '';
  const year = typeof record['ds_yearintroduced'] === 'string' ? record['ds_yearintroduced'] : '';

  return {
    meshUid: uid,
    descriptor,
    ...(definition ? { definition } : {}),
    synonyms: terms.slice(1),
    ...(year ? { yearIntroduced: year } : {}),
  };
}
