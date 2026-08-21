import type { Paper, SourceId } from '../types.js';

export interface SearchQuery {
  /** Source-native query string, produced by `query.ts`. */
  term: string;
  limit?: number;
  /** Inclusive lower bound on publication year. */
  fromYear?: number;
  toYear?: number;
  signal?: AbortSignal;
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
