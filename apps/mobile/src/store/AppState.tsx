import {
  computeProgress,
  defaultSources,
  emptyMastery,
  initialReviewState,
  resolveMeshTopic,
  review as applyReview,
  rungMastery,
  withCache,
  type Card,
  type Concept,
  type ReviewGrade,
  type ReviewState,
  type RungId,
  type Topic,
  type TopicProgress,
} from '@researchbuddy/core';
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
import { searchCache } from './cache';
import { emptyDatabase, loadDatabase, saveDatabase, type Database, type Settings } from './db';

interface AppStateValue {
  ready: boolean;
  database: Database;
  progressFor(topicId: string): TopicProgress;
  addTopic(input: { label: string; canonicalTerm: string; meshTerm?: string }): Topic;
  /**
   * Look the topic up in MeSH and store the canonical descriptor, NLM's
   * definition, and its synonyms. Best-effort: a topic with no MeSH entry
   * still works, it just searches on the raw words.
   */
  enrichTopic(topicId: string, term: string): Promise<void>;
  removeTopic(topicId: string): void;
  addConcepts(concepts: Concept[]): void;
  addCards(cards: Card[]): void;
  gradeCard(cardId: string, grade: ReviewGrade): void;
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

  // Debounced persistence: grading a card should not write the whole store on
  // every tap during a fast review session.
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

  const conceptRungs = useMemo(
    () => new Map(database.concepts.map((concept) => [concept.id, concept.rung])),
    [database.concepts],
  );
  const reviewsByCard = useMemo(
    () => new Map(database.reviews.map((state) => [state.cardId, state])),
    [database.reviews],
  );

  const progressFor = useCallback(
    (topicId: string): TopicProgress => {
      const cards = database.cards.filter((card) => card.topicId === topicId);
      const mastery = emptyMastery();
      for (const rung of Object.keys(mastery) as RungId[]) {
        mastery[rung] = rungMastery(cards, conceptRungs, reviewsByCard, rung);
      }
      return computeProgress(topicId, mastery);
    },
    [database.cards, conceptRungs, reviewsByCard],
  );

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
      const cardIds = new Set(
        previous.cards.filter((card) => card.topicId === topicId).map((card) => card.id),
      );
      const { [topicId]: _removed, ...seenPapers } = previous.seenPapers;
      return {
        ...previous,
        topics: previous.topics.filter((topic) => topic.id !== topicId),
        concepts: previous.concepts.filter((concept) => concept.topicId !== topicId),
        cards: previous.cards.filter((card) => card.topicId !== topicId),
        reviews: previous.reviews.filter((state) => !cardIds.has(state.cardId)),
        seenPapers,
      };
    });
  }, []);

  const addConcepts: AppStateValue['addConcepts'] = useCallback((concepts) => {
    setDatabase((previous) => {
      const existing = new Set(previous.concepts.map((concept) => concept.id));
      return {
        ...previous,
        concepts: [...previous.concepts, ...concepts.filter((concept) => !existing.has(concept.id))],
      };
    });
  }, []);

  const addCards: AppStateValue['addCards'] = useCallback((cards) => {
    setDatabase((previous) => {
      const existing = new Set(previous.cards.map((card) => card.id));
      const fresh = cards.filter((card) => !existing.has(card.id));
      const now = new Date();
      return {
        ...previous,
        cards: [...previous.cards, ...fresh],
        reviews: [...previous.reviews, ...fresh.map((card) => initialReviewState(card.id, now))],
      };
    });
  }, []);

  const gradeCard: AppStateValue['gradeCard'] = useCallback((cardId, grade) => {
    setDatabase((previous) => {
      const now = new Date();
      const current: ReviewState =
        previous.reviews.find((state) => state.cardId === cardId) ?? initialReviewState(cardId, now);
      const next = applyReview(current, grade, now);
      return {
        ...previous,
        reviews: [...previous.reviews.filter((state) => state.cardId !== cardId), next],
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
        defaultSources(
          database.settings.ncbiApiKey
            ? { pubmed: { apiKey: database.settings.ncbiApiKey, tool: 'researchbuddy' } }
            : {},
        ),
        searchCache,
      ),
    [database.settings.ncbiApiKey],
  );

  const value = useMemo<AppStateValue>(
    () => ({
      ready,
      database,
      progressFor,
      addTopic,
      enrichTopic,
      removeTopic,
      addConcepts,
      addCards,
      gradeCard,
      markPapersSeen,
      updateSettings,
      sources,
    }),
    [
      ready, database, progressFor, addTopic, enrichTopic, removeTopic, addConcepts,
      addCards, gradeCard, markPapersSeen, updateSettings, sources,
    ],
  );

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const value = useContext(AppStateContext);
  if (!value) throw new Error('useAppState must be used inside AppStateProvider');
  return value;
}
