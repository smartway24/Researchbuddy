import { defaultSources, resolveMeshTopic, withCache, type Topic } from '@researchbuddy/core';
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
import { searchCache } from './cache';
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
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [database, setDatabase] = useState<Database>(emptyDatabase);
  const [ready, setReady] = useState(false);
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
    }),
    [ready, database, addTopic, enrichTopic, removeTopic, markPapersSeen, updateSettings, sources],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const value = useContext(AppStateContext);
  if (!value) throw new Error('useAppState must be used inside AppStateProvider');
  return value;
}
