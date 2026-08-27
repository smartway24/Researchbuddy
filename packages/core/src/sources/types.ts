import type { QueryPlan } from '../query.js';
import type { Paper, SourceId } from '../types.js';

export interface SearchQuery {
  /**
   * What to search for, described once and rendered into each source's own
   * syntax by the adapter. Prefer this: a query string written for one source
   * and sent to another does not fail, it silently returns nonsense.
   */
  plan?: QueryPlan;
  /** Raw source-native query, for ad-hoc searches that bypass planning. */
  term?: string;
  limit?: number;
  /** Inclusive lower bound on publication year. */
  fromYear?: number;
  toYear?: number;
  signal?: AbortSignal;
}

/**
 * Collapse a query into the values an adapter needs. The plan wins where it
 * sets something; explicit fields on the query override it.
 */
export function resolveQuery(
  query: SearchQuery,
  render: (plan: QueryPlan) => string,
): { term: string; limit: number; fromYear?: number; toYear?: number } {
  const term = query.plan ? render(query.plan) : (query.term ?? '');
  const limit = query.limit ?? query.plan?.limit ?? 25;
  const fromYear = query.fromYear ?? query.plan?.fromYear;
  const toYear = query.toYear ?? query.plan?.toYear;
  return {
    term,
    limit,
    ...(fromYear !== undefined ? { fromYear } : {}),
    ...(toYear !== undefined ? { toYear } : {}),
  };
}

export interface SearchResult {
  sourceId: SourceId;
  papers: Paper[];
  /** Total matches the source reports, which may exceed `papers.length`. */
  total: number;
  /** The query string actually sent, kept for the "why am I seeing this" view. */
  executedQuery: string;
  /** True when this came from the on-device cache rather than the network. */
  fromCache?: boolean;
  /** When the cached copy was fetched, so the UI can say how old it is. */
  savedAt?: string;
}

export interface SourceAdapter {
  readonly id: SourceId;
  readonly label: string;
  /** False for adapters that need the learner to supply credentials first. */
  readonly isPublic: boolean;
  search(query: SearchQuery): Promise<SearchResult>;
}

/**
 * How a learner reaches full text they are entitled to.
 *
 * Researchbuddy never stores institutional passwords and never scrapes behind a
 * paywall. It rewrites links so the publisher's own login flow runs in an
 * in-app browser session the learner controls — the same thing a library's
 * "find it @ my institution" button does.
 */
export type AccessMethod = 'open-access' | 'ezproxy' | 'openathens' | 'publisher';

export interface Institution {
  id: string;
  name: string;
  /**
   * EZproxy login prefix, e.g. `https://login.ezproxy.example.edu/login?url=`.
   * The target URL is appended (encoded).
   */
  ezproxyPrefix?: string;
  /** OpenAthens redirector, e.g. `https://go.openathens.net/redirector/example.edu?url=`. */
  openAthensRedirector?: string;
  /** Extra full-text hosts this institution subscribes to, for labelling only. */
  subscribedDomains?: string[];
}

export interface AccessLink {
  url: string;
  method: AccessMethod;
  /** Shown next to the link so the learner knows why it will (or won't) open. */
  label: string;
  /** True when opening the link is expected to require a login. */
  requiresLogin: boolean;
}
