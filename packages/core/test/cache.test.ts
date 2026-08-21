import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Cache, CachingSource, MemoryStore, searchCacheKey } from '../src/cache.js';
import { digestFreshness } from '../src/digest.js';
import type { SearchQuery, SearchResult, SourceAdapter } from '../src/sources/types.js';
import type { Digest } from '../src/types.js';
import { makePaper } from './helpers.js';

const START = new Date('2026-06-01T09:00:00Z');
const at = (hours: number) => new Date(START.getTime() + hours * 3600_000);

function result(papers = [makePaper({ id: 'a' })]): SearchResult {
  return { sourceId: 'pubmed', papers, total: papers.length, executedQuery: 'q' };
}

/** A source that answers from a script: each call takes the next entry. */
function scriptedSource(script: (('ok' | 'fail') | SearchResult)[]): {
  adapter: SourceAdapter;
  calls: () => number;
} {
  let index = 0;
  return {
    calls: () => index,
    adapter: {
      id: 'pubmed',
      label: 'Scripted',
      isPublic: true,
      async search(_query: SearchQuery) {
        const step = script[index++] ?? 'ok';
        if (step === 'fail') throw new Error('network down');
        return step === 'ok' ? result() : step;
      },
    },
  };
}

test('a fresh entry is returned and a stale one is not, unless asked for', async () => {
  let clock = START;
  const cache = new Cache(new MemoryStore(), { ttlMs: 3600_000, now: () => clock });

  await cache.set('k', { hello: 'world' });
  assert.deepEqual((await cache.get<{ hello: string }>('k'))?.value, { hello: 'world' });
  assert.equal((await cache.get('k'))?.stale, false);

  clock = at(2);
  assert.equal(await cache.get('k'), null, 'past its TTL it is a miss');

  const stale = await cache.get<{ hello: string }>('k', true);
  assert.deepEqual(stale?.value, { hello: 'world' });
  assert.equal(stale?.stale, true);
  assert.equal(stale?.savedAt, START.toISOString());
});

test('a missing or corrupt entry is a miss, never a crash', async () => {
  const store = new MemoryStore();
  const cache = new Cache(store);
  assert.equal(await cache.get('nothing'), null);
  await store.set('researchbuddy.cache.broken', '{not json');
  assert.equal(await cache.get('broken'), null);
});

test('the cache evicts its oldest entries and touches nothing else', async () => {
  let clock = START;
  const store = new MemoryStore();
  const cache = new Cache(store, { maxEntries: 3, now: () => clock });

  await store.set('researchbuddy.db.v1', 'the app data');
  for (const [index, key] of ['a', 'b', 'c', 'd'].entries()) {
    clock = at(index);
    await cache.set(key, index);
  }

  assert.equal(await cache.size(), 3);
  assert.equal(await cache.get('a', true), null, 'the oldest entry is evicted');
  assert.equal((await cache.get<number>('d'))?.value, 3);
  assert.equal(await store.get('researchbuddy.db.v1'), 'the app data', 'app data is untouched');
});

test('clear removes only what the cache owns', async () => {
  const store = new MemoryStore();
  const cache = new Cache(store);
  await store.set('researchbuddy.db.v1', 'the app data');
  await cache.set('a', 1);
  await cache.clear();
  assert.equal(await cache.size(), 0);
  assert.equal(await cache.get('a', true), null);
  assert.equal(await store.get('researchbuddy.db.v1'), 'the app data');
});

test('cache keys are stable and separate different queries', () => {
  const query: SearchQuery = { term: 'ecmo', limit: 10, fromYear: 2024 };
  assert.equal(searchCacheKey('pubmed', query), searchCacheKey('pubmed', { ...query }));
  assert.notEqual(searchCacheKey('pubmed', query), searchCacheKey('europepmc', query));
  assert.notEqual(
    searchCacheKey('pubmed', query),
    searchCacheKey('pubmed', { ...query, limit: 20 }),
  );
  assert.notEqual(
    searchCacheKey('pubmed', query),
    searchCacheKey('pubmed', { ...query, fromYear: 2020 }),
  );
});

test('a repeated search hits the cache instead of the network', async () => {
  const scripted = scriptedSource(['ok', 'ok']);
  const cache = new Cache(new MemoryStore(), { now: () => START });
  const source = new CachingSource(scripted.adapter, cache);

  const first = await source.search({ term: 'ecmo' });
  assert.equal(first.fromCache, undefined, 'the first search is live');

  const second = await source.search({ term: 'ecmo' });
  assert.equal(scripted.calls(), 1, 'the network was not touched again');
  assert.equal(second.fromCache, true);
  assert.equal(second.savedAt, START.toISOString());
  assert.equal(second.papers.length, first.papers.length);
});

test('losing the network falls back to the stale copy rather than failing', async () => {
  let clock = START;
  const scripted = scriptedSource(['ok', 'fail']);
  const cache = new Cache(new MemoryStore(), { ttlMs: 3600_000, now: () => clock });
  const source = new CachingSource(scripted.adapter, cache);

  await source.search({ term: 'ecmo' });
  clock = at(48); // long past the TTL, and now offline

  const offline = await source.search({ term: 'ecmo' });
  assert.equal(offline.fromCache, true);
  assert.equal(offline.savedAt, START.toISOString());
  assert.equal(offline.papers.length, 1, "the reading list survives with yesterday's papers");
});

test('a failure with nothing cached still surfaces as an error', async () => {
  const scripted = scriptedSource(['fail']);
  const source = new CachingSource(scripted.adapter, new Cache(new MemoryStore()));
  await assert.rejects(() => source.search({ term: 'ecmo' }), /network down/);
});

test('freshness reports the oldest cached copy and any failed source', () => {
  const digest: Digest = {
    topicId: 't',
    rung: 'evidence',
    generatedAt: START.toISOString(),
    sections: [],
    readingOrder: [],
    candidateCount: 0,
    sourceStatus: [
      { sourceId: 'pubmed', count: 5, fromCache: true, savedAt: '2026-05-30T00:00:00.000Z' },
      { sourceId: 'europepmc', count: 3, fromCache: true, savedAt: '2026-05-31T00:00:00.000Z' },
    ],
  };
  const freshness = digestFreshness(digest);
  assert.equal(freshness.cached, true);
  assert.equal(freshness.live, false);
  assert.equal(freshness.savedAt, '2026-05-30T00:00:00.000Z');
  assert.deepEqual(freshness.failedSources, []);

  const partial = digestFreshness({
    ...digest,
    sourceStatus: [
      { sourceId: 'pubmed', count: 5 },
      { sourceId: 'europepmc', count: 0, error: 'network down' },
    ],
  });
  assert.equal(partial.live, true);
  assert.equal(partial.cached, false);
  assert.deepEqual(partial.failedSources, ['europepmc']);
});

test('a digest with no source status reports neither live nor cached', () => {
  const freshness = digestFreshness({
    topicId: 't',
    rung: 'evidence',
    generatedAt: START.toISOString(),
    sections: [],
    readingOrder: [],
    candidateCount: 0,
  });
  assert.equal(freshness.live, false);
  assert.equal(freshness.cached, false);
  assert.equal(freshness.savedAt, undefined);
});
