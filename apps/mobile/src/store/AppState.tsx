import {
  defaultSources,
  PaperJudge,
  resolveMeshTopic,
  withCache,
  type Topic,
} from '@researchbuddy/core';
import { AnthropicProvider } from '@researchbuddy/core/anthropic';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { NCBI_CONTACT_EMAIL, NCBI_TOOL_NAME } from '../config';
import { judgementCache, searchCache } from './cache';
import { getAnthropicKey } from './keys';
import { emptyDatabase, loadDatabase, saveDatabase, type Database, type Settings } from './db';

interface AppStateValue {
  ready: boolean;
  database: Database;
  addTopic(input: { label: string; canonicalTerm: string; meshTerm?: string }): Topic;
  /**
   * Look the topic up in MeSH and store the canonical descriptor, NLM's
   * definition, and its synonyms. Best-effort: a topic with no MeSH entry
   * still works, it just searches on the raw words.
   */
  enrichTopic(topicId: string, term: string): Promise<void>;
  removeTopic(topicId: string): void;
  markPapersSeen(topicId: string, paperIds: string[]): void;
  updateSettings(patch: Partial<Settings>): void;
  sources(): ReturnType<typeof defaultSources>;
  /**
   * The critical eye, when the learner has supplied a key for one.
   *
   * Undefined means no model is available, and the reading list falls back to
   * the deterministic assessment in core — the app has to work with no AI, no
   * account and no network, so this is allowed to be absent at any moment.
   */
  judge(): PaperJudge | undefined;
  /**
   * Whether `judge()` will return one right now.
   *
   * A separate flag because the key is read from the keychain asynchronously:
   * for the first frames after launch the settings say there is a key and
   * `judge()` still returns undefined. A screen that keyed its work off the
   * settings alone would build one unjudged reading list and then never
   * notice the key had arrived.
   */
  canJudge: boolean;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [database, setDatabase] = useState<Database>(emptyDatabase);
  const [ready, setReady] = useState(false);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadDatabase().then((loaded) => {
      if (cancelled) return;
      setDatabase(loaded);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // The key lives in the keychain, not in the database, so it is read
  // separately — and re-read whenever the settings say it changed, which is
  // how saving a key in Settings reaches the reading list without a restart.
  useEffect(() => {
    let cancelled = false;
    const pending = database.settings.hasApiKey
      ? getAnthropicKey().catch(() => null)
      : Promise.resolve(null);
    void pending.then((stored) => {
      if (!cancelled) setApiKey(stored);
    });
    return () => {
      cancelled = true;
    };
  }, [database.settings.hasApiKey]);

  // Debounced persistence: a burst of edits should not rewrite the whole store
  // on every keystroke.
  useEffect(() => {
    if (!ready) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveDatabase(database);
    }, 400);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [database, ready]);

  const addTopic: AppStateValue['addTopic'] = useCallback((input) => {
    const now = new Date().toISOString();
    const topic: Topic = {
      id: `topic-${now}-${Math.random().toString(36).slice(2, 8)}`,
      label: input.label,
      canonicalTerm: input.canonicalTerm,
      ...(input.meshTerm ? { meshTerm: input.meshTerm } : {}),
      synonyms: [],
      relatedConcepts: [],
      createdAt: now,
      updatedAt: now,
    };
    setDatabase((previous) => ({ ...previous, topics: [...previous.topics, topic] }));
    return topic;
  }, []);

  // `term` is passed in rather than read from state: this runs immediately
  // after the topic is created, when the closure's copy of the topic list is
  // still one render behind.
  const enrichTopic: AppStateValue['enrichTopic'] = useCallback(
    async (topicId, term) => {
      const resolved = await resolveMeshTopic(term, {
        ...(database.settings.ncbiApiKey ? { apiKey: database.settings.ncbiApiKey } : {}),
      }).catch(() => null);
      if (!resolved) return;
      setDatabase((previous) => ({
        ...previous,
        topics: previous.topics.map((candidate) =>
          candidate.id === topicId
            ? {
                ...candidate,
                canonicalTerm: resolved.descriptor,
                meshTerm: resolved.descriptor,
                ...(resolved.definition ? { definition: resolved.definition } : {}),
                synonyms: resolved.synonyms,
                updatedAt: new Date().toISOString(),
              }
            : candidate,
        ),
      }));
    },
    [database.settings.ncbiApiKey],
  );

  const removeTopic: AppStateValue['removeTopic'] = useCallback((topicId) => {
    setDatabase((previous) => {
      const { [topicId]: _removed, ...seenPapers } = previous.seenPapers;
      return {
        ...previous,
        topics: previous.topics.filter((topic) => topic.id !== topicId),
        seenPapers,
      };
    });
  }, []);

  const markPapersSeen: AppStateValue['markPapersSeen'] = useCallback((topicId, paperIds) => {
    setDatabase((previous) => ({
      ...previous,
      seenPapers: {
        ...previous.seenPapers,
        [topicId]: [...new Set([...(previous.seenPapers[topicId] ?? []), ...paperIds])],
      },
    }));
  }, []);

  const updateSettings: AppStateValue['updateSettings'] = useCallback((patch) => {
    setDatabase((previous) => ({ ...previous, settings: { ...previous.settings, ...patch } }));
  }, []);

  // Sources are wrapped in the on-device cache: no backend, and a reading
  // list still opens on a plane.
  const sources = useCallback(
    () =>
      withCache(
        defaultSources({
          pubmed: {
            tool: NCBI_TOOL_NAME,
            ...(NCBI_CONTACT_EMAIL ? { email: NCBI_CONTACT_EMAIL } : {}),
            ...(database.settings.ncbiApiKey ? { apiKey: database.settings.ncbiApiKey } : {}),
          },
        }),
        searchCache,
      ),
    [database.settings.ncbiApiKey],
  );

  /**
   * The judgement pass, built fresh per reading list.
   *
   * `dangerouslyAllowBrowser` is correct here and nowhere else: the key is the
   * learner's own, held in their keychain, and there is no server to hold it
   * on instead. Verdicts are cached, so a paper is read once and then never
   * billed again.
   */
  const canJudge = database.settings.aiProvider === 'anthropic' && Boolean(apiKey);

  const judge = useCallback(() => {
    if (database.settings.aiProvider !== 'anthropic' || !apiKey) return undefined;
    return new PaperJudge(new AnthropicProvider({ apiKey, allowBrowser: true }), {
      cache: judgementCache,
    });
  }, [database.settings.aiProvider, apiKey]);

  const value = useMemo<AppStateValue>(
    () => ({
      ready,
      database,
      addTopic,
      enrichTopic,
      removeTopic,
      markPapersSeen,
      updateSettings,
      sources,
      judge,
      canJudge,
    }),
    [
      ready,
      database,
      addTopic,
      enrichTopic,
      removeTopic,
      markPapersSeen,
      updateSettings,
      sources,
      judge,
      canJudge,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const value = useContext(AppStateContext);
  if (!value) throw new Error('useAppState must be used inside AppStateProvider');
  return value;
}
