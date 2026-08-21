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
  ttlMs: 7 * 24 * 60 * 60 * 1000,
  maxEntries: 300,
});
