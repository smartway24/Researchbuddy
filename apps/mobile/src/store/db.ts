import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Institution, Topic } from '@researchbuddy/core';

/**
 * Local-first storage. Everything the learner accumulates — topics, and which
 * papers they have already been shown — lives on the device. There is no
 * account and no server, which is also why there is an export: the data should
 * never be trapped in this app.
 */

export interface Settings {
  /** 'offline' needs nothing; 'anthropic' uses the learner's own API key. */
  aiProvider: 'offline' | 'anthropic';
  /** Stored in the secure keychain, never in AsyncStorage. */
  hasApiKey: boolean;
  institutions: Institution[];
  /** NCBI key raises the PubMed rate limit; optional. */
  ncbiApiKey?: string;
  acceptedDisclaimer: boolean;
}

export interface Database {
  version: 1;
  topics: Topic[];
  /** Paper ids already delivered in a reading list, per topic. */
  seenPapers: Record<string, string[]>;
  settings: Settings;
}

const KEY = 'researchbuddy.db.v1';

export function emptyDatabase(): Database {
  return {
    version: 1,
    topics: [],
    seenPapers: {},
    settings: {
      aiProvider: 'offline',
      hasApiKey: false,
      institutions: [],
      acceptedDisclaimer: false,
    },
  };
}

export async function loadDatabase(): Promise<Database> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return emptyDatabase();
    const parsed = JSON.parse(raw) as Partial<Database>;
    // Merge over the empty shape so a database written by an older build is
    // still readable after fields are added or removed.
    return {
      ...emptyDatabase(),
      ...parsed,
      settings: { ...emptyDatabase().settings, ...(parsed.settings ?? {}) },
      version: 1,
    };
  } catch {
    // A corrupt store must not brick the app; start clean rather than crash.
    return emptyDatabase();
  }
}

export async function saveDatabase(database: Database): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(database));
}

/** Portable export — the learner's library should never be locked in here. */
export function exportDatabase(database: Database): string {
  return JSON.stringify(database, null, 2);
}
