import type { SearchQuery, SearchResult, SourceAdapter } from './sources/types.js';

/**
 * On-device caching.
 *
 * Researchbuddy has no backend, and this is the piece that keeps it that way.
 * The usual reasons a project like this grows a server are rate limits and
 * offline reading — so both are solved here, on the device, instead:
 *
 *  - a repeated search is served from disk rather than from NCBI, which keeps
 *    the app inside PubMed's per-second limits without a proxy in the middle;
 *  - when the network is gone, a stale entry is served rather than an error,
 *    flagged so the UI can say how old it is.
 *
 * Ranking, theming and scheduling are all pure functions over cached papers,
 * so a cached search is enough to rebuild an entire reading list offline.
 */

/** The storage primitive the app supplies. AsyncStorage satisfies this as-is. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

interface Envelope<T> {
  savedAt: string;
  value: T;
}

export interface CacheEntry<T> {
  value: T;
  savedAt: string;
  /** True when the entry is past its TTL but was returned anyway. */
  stale: boolean;
}

export interface CacheOptions {
  /** How long an entry counts as fresh. Default 24 hours. */
  ttlMs?: number;
  /** Cap on stored entries; the oldest are evicted past this. Default 200. */
  maxEntries?: number;
  /**
   * Key prefix, and with it the eviction index this cache owns.
   *
   * Two caches over the same store must not share a namespace: they would
   * share an index, and each would evict the other's entries to stay under
   * its own cap. Searches and judgements have very different sizes and
   * lifetimes, so they get a namespace each.
   */
  namespace?: string;
  now?: () => Date;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_NAMESPACE = 'researchbuddy.cache';

/**
 * A TTL cache over a key/value store, with its own index so it can evict
 * without needing the store to support key enumeration (AsyncStorage's
 * `getAllKeys` would also return the app's own data).
 */
export class Cache {
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly namespace: string;
  private readonly indexKey: string;
  private readonly now: () => Date;

  constructor(
    private readonly store: KeyValueStore,
    options: CacheOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.maxEntries = options.maxEntries ?? 200;
    this.namespace = options.namespace ?? DEFAULT_NAMESPACE;
    this.indexKey = `${this.namespace}.index`;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Read an entry. `allowStale` is what makes offline work: past the TTL the
   * entry is still returned, marked stale, instead of being treated as absent.
   */
  async get<T>(key: string, allowStale = false): Promise<CacheEntry<T> | null> {
    const raw = await this.store.get(this.namespaced(key)).catch(() => null);
    if (!raw) return null;

    let envelope: Envelope<T>;
    try {
      envelope = JSON.parse(raw) as Envelope<T>;
    } catch {
      // A corrupt entry is a cache miss, never a crash.
      return null;
    }
    if (!envelope || typeof envelope.savedAt !== 'string') return null;

    const age = this.now().getTime() - new Date(envelope.savedAt).getTime();
    const stale = !(age >= 0 && age < this.ttlMs);
    if (stale && !allowStale) return null;

    return { value: envelope.value, savedAt: envelope.savedAt, stale };
  }

  async set<T>(key: string, value: T): Promise<void> {
    const savedAt = this.now().toISOString();
    const envelope: Envelope<T> = { savedAt, value };
    try {
      await this.store.set(this.namespaced(key), JSON.stringify(envelope));
      await this.recordInIndex(key, savedAt);
    } catch {
      // Storage full or unavailable: the app must keep working uncached.
    }
  }

  /** Drop everything this cache owns, leaving the app's own data untouched. */
  async clear(): Promise<void> {
    const index = await this.readIndex();
    for (const key of Object.keys(index)) {
      await this.store.remove(this.namespaced(key)).catch(() => undefined);
    }
    await this.store.remove(this.indexKey).catch(() => undefined);
  }

  async size(): Promise<number> {
    return Object.keys(await this.readIndex()).length;
  }

  private namespaced(key: string): string {
    return `${this.namespace}.${key}`;
  }

  private async readIndex(): Promise<Record<string, string>> {
    const raw = await this.store.get(this.indexKey).catch(() => null);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw) as Record<string, string>;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  private async recordInIndex(key: string, savedAt: string): Promise<void> {
    const index = await this.readIndex();
    index[key] = savedAt;

    const keys = Object.keys(index);
    if (keys.length > this.maxEntries) {
      const oldestFirst = keys.sort(
        (a, b) => new Date(index[a] ?? 0).getTime() - new Date(index[b] ?? 0).getTime(),
      );
      for (const evicted of oldestFirst.slice(0, keys.length - this.maxEntries)) {
        delete index[evicted];
        await this.store.remove(this.namespaced(evicted)).catch(() => undefined);
      }
    }

    await this.store.set(this.indexKey, JSON.stringify(index));
  }
}

/** Stable cache key for a search. Field order is fixed so it never drifts. */
export function searchCacheKey(sourceId: string, query: SearchQuery): string {
  const parts = [
    sourceId,
    query.term,
    String(query.limit ?? ''),
    String(query.fromYear ?? ''),
    String(query.toYear ?? ''),
  ];
  return `search.${stableHash(parts.join('|'))}`;
}

/**
 * Wraps a source so its searches are cached.
 *
 * Fresh cache → no request at all. Cache miss → live request, then stored.
 * Live request fails → any stale entry is served, marked, so losing the
 * network degrades the reading list to "what you had yesterday" rather than
 * to an error page.
 */
export class CachingSource implements SourceAdapter {
  readonly id: SourceAdapter['id'];
  readonly label: string;
  readonly isPublic: boolean;

  constructor(
    private readonly inner: SourceAdapter,
    private readonly cache: Cache,
  ) {
    this.id = inner.id;
    this.label = inner.label;
    this.isPublic = inner.isPublic;
  }

  async search(query: SearchQuery): Promise<SearchResult> {
    const key = searchCacheKey(this.inner.id, query);

    const fresh = await this.cache.get<SearchResult>(key);
    if (fresh) return { ...fresh.value, fromCache: true, savedAt: fresh.savedAt };

    try {
      const result = await this.inner.search(query);
      await this.cache.set(key, result);
      return result;
    } catch (error) {
      const stale = await this.cache.get<SearchResult>(key, true);
      if (stale) return { ...stale.value, fromCache: true, savedAt: stale.savedAt };
      throw error;
    }
  }
}

export function withCache(sources: SourceAdapter[], cache: Cache): SourceAdapter[] {
  return sources.map((source) => new CachingSource(source, cache));
}

/** In-memory store, for tests and for a run where persistence is unavailable. */
export class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }

  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}

/** FNV-1a: short, stable, and enough to key a local cache. */
export function stableHash(input: string): string {
  let value = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    value ^= input.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(36);
}
