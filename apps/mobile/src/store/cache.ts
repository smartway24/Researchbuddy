import AsyncStorage from '@react-native-async-storage/async-storage';
import { Cache, type KeyValueStore } from '@researchbuddy/core';

/**
 * The device is the cache. Researchbuddy has no backend, so search results are
 * stored here instead of on a server: repeat searches cost nothing and stay
 * well inside PubMed's rate limits, and a reading list opened without a
 * network shows the last copy rather than an error.
 */
const store: KeyValueStore = {
  get: (key) => AsyncStorage.getItem(key),
  set: (key, value) => AsyncStorage.setItem(key, value),
  remove: (key) => AsyncStorage.removeItem(key),
};

/**
 * A week is the right TTL for literature: new papers appear on that timescale,
 * and past it the entry is still served when the network is gone.
 */
export const searchCache = new Cache(store, {
  namespace: 'researchbuddy.cache',
  ttlMs: 7 * 24 * 60 * 60 * 1000,
  maxEntries: 300,
});

/**
 * Judgements, kept apart from searches and kept far longer.
 *
 * A verdict is about a paper's title and abstract, and neither changes, so it
 * never really expires — the judge reads stale entries deliberately. What the
 * TTL buys is a slow re-judge as the prompt improves. The entries are tiny and
 * there are many of them, hence the much larger cap, and its own namespace so
 * it cannot evict the search cache it sits on top of.
 */
export const judgementCache = new Cache(store, {
  namespace: 'researchbuddy.judge',
  ttlMs: 180 * 24 * 60 * 60 * 1000,
  maxEntries: 3000,
});
