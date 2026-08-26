import {
  OfflineProvider,
  accessLinks,
  buildDigest,
  digestFreshness,
  estimatedMinutes,
  evidenceLabel,
  extractRelatedConcepts,
  getRung,
  type AiProvider,
  type Digest,
  type Paper,
  type RungId,
  type ScoredPaper,
} from '@researchbuddy/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as WebBrowser from 'expo-web-browser';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useAppState } from '../store/AppState';
import { Body, Button, Card, Heading, Muted, Pill, Subheading } from '../ui/components';
import { spacing } from '../ui/theme';

/**
 * The reading list. One rung, one screen: themed sections, a reason attached to
 * every paper, and a way to open the full text through whichever access the
 * learner actually has.
 */
export function DigestScreen({
  topicId,
  rung,
  onBack,
}: {
  topicId: string;
  rung: RungId;
  onBack: () => void;
}) {
  const { database, markPapersSeen, addConcepts, addCards, sources } = useAppState();
  const topic = database.topics.find((candidate) => candidate.id === topicId);

  /**
   * One request key describes what this screen should be showing. State holds
   * the result *for a key*, so "loading" is derived rather than stored — no
   * synchronous setState in the effect, and no window where the previous
   * rung's papers render under the new rung's heading.
   */
  const requestKey = `${topicId}|${rung}|${topic?.meshTerm ?? topic?.canonicalTerm ?? ''}`;
  const [result, setResult] = useState<{
    key: string;
    digest?: Digest;
    error?: string;
  } | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const loading = result?.key !== requestKey;
  const digest = result?.key === requestKey ? result.digest : undefined;
  const error = result?.key === requestKey ? result.error : undefined;

  const seen = useMemo(
    () => new Set(database.seenPapers[topicId] ?? []),
    [database.seenPapers, topicId],
  );

  useEffect(() => {
    if (!topic) return undefined;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    // Every state update below happens after an await, once the request this
    // effect owns has actually produced something.
    void (async () => {
      try {
        const built = await buildDigest({
          topicId,
          rung,
          context: {
            topic: topic.canonicalTerm,
            ...(topic.meshTerm ? { meshTerm: topic.meshTerm } : {}),
            synonyms: topic.synonyms,
          },
          sources: sources(),
          seenPaperIds: seen,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setResult({ key: requestKey, digest: built });
      } catch (caught) {
        if (controller.signal.aborted) return;
        setResult({
          key: requestKey,
          error:
            caught instanceof Error ? caught.message : 'Could not reach the literature sources.',
        });
      }
    })();

    return () => controller.abort();
    // `seen` is deliberately excluded: marking a paper read must not re-run the
    // search and reshuffle the list under the learner's finger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, topicId, rung, sources, requestKey, reloadNonce]);

  const reload = useCallback(() => setReloadNonce((nonce) => nonce + 1), []);

  const provider: AiProvider = useMemo(() => new OfflineProvider(), []);

  const addCardsFor = useCallback(
    async (scored: ScoredPaper) => {
      if (!topic) return;
      const paper = scored.paper;
      const conceptId = `concept-${paper.id}`;
      addConcepts([
        {
          id: conceptId,
          topicId,
          rung,
          label: paper.title,
          summary: paper.abstract?.slice(0, 400) ?? '',
          prerequisites: [],
          citations: [
            {
              sourceId: paper.sourceId,
              externalId: paper.externalId,
              title: paper.title,
              ...(paper.url ? { url: paper.url } : {}),
            },
          ],
        },
      ]);

      const drafts = await provider.draftCards(
        {
          title: paper.title,
          body: paper.abstract ?? paper.title,
          sourceIds: [paper.id],
          count: 3,
        },
        { rung },
      );

      if (drafts.length === 0) {
        Alert.alert('No cards made', 'This record has too little text to build cards from.');
        return;
      }

      const now = new Date().toISOString();
      addCards(
        drafts.map((draft, index) => ({
          id: `card-${paper.id}-${index}`,
          conceptId,
          topicId,
          front: draft.front,
          back: draft.back,
          createdAt: now,
        })),
      );
      markPapersSeen(topicId, [paper.id]);
      Alert.alert('Added', `${drafts.length} cards added to ${topic.label}.`);
    },
    [topic, topicId, rung, provider, addConcepts, addCards, markPapersSeen],
  );

  const openPaper = useCallback(
    async (paper: Paper) => {
      const links = accessLinks(paper, database.settings.institutions);
      const first = links[0];
      if (!first) {
        Alert.alert('No link available', 'This record has no reachable full-text link.');
        return;
      }
      if (links.length === 1) {
        await WebBrowser.openBrowserAsync(first.url);
        return;
      }
      Alert.alert('Open full text', 'Choose how to read this paper.', [
        ...links.slice(0, 3).map((link) => ({
          text: link.requiresLogin ? `${link.label} (login)` : link.label,
          onPress: () => {
            void WebBrowser.openBrowserAsync(link.url);
          },
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ]);
    },
    [database.settings.institutions],
  );

  if (!topic) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Heading>Topic not found</Heading>
        <Button label="Back" variant="secondary" onPress={onBack} />
      </ScrollView>
    );
  }

  const relatedConcepts = digest
    ? extractRelatedConcepts(
        digest.sections.flatMap((section) => section.papers.map((scored) => scored.paper)),
        {
          exclude: [topic.canonicalTerm, topic.meshTerm ?? '', ...topic.synonyms],
          limit: 8,
          minPaperCount: 2,
        },
      )
    : [];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Heading>{getRung(rung).title}</Heading>
      <Muted>{getRung(rung).goal}</Muted>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator />
          <Muted>Searching PubMed and Europe PMC…</Muted>
        </View>
      ) : null}

      {error ? (
        <Card>
          <Subheading>Could not load the reading list</Subheading>
          <Body>{error}</Body>
          <View style={styles.retry}>
            <Button label="Try again" onPress={reload} />
          </View>
        </Card>
      ) : null}

      {digest && !loading ? (
        <>
          <Muted>
            {`${digest.readingOrder.length} of ${digest.candidateCount} papers kept · about ${estimatedMinutes(digest)} min`}
          </Muted>

          {(() => {
            const freshness = digestFreshness(digest);
            if (!freshness.cached && freshness.failedSources.length === 0) return null;
            return (
              <Card>
                <Subheading>{freshness.live ? 'Partly from your device' : 'Saved copy'}</Subheading>
                <Muted>
                  {freshness.savedAt
                    ? `Showing results saved ${describeAge(freshness.savedAt)}. They will refresh next time you are online.`
                    : 'Some sources could not be reached.'}
                </Muted>
                {freshness.failedSources.length > 0 ? (
                  <Muted>{`Could not reach: ${freshness.failedSources.join(', ')}`}</Muted>
                ) : null}
              </Card>
            );
          })()}

          {relatedConcepts.length > 0 ? (
            <Card>
              <Subheading>Around this topic</Subheading>
              <Muted>Concepts that keep appearing alongside it — threads worth pulling.</Muted>
              <View style={styles.pills}>
                {relatedConcepts.map((concept) => (
                  <Pill key={concept.label} label={`${concept.label} · ${concept.paperCount}`} />
                ))}
              </View>
            </Card>
          ) : null}

          {digest.sections.length === 0 ? (
            <Card>
              <Subheading>Nothing new</Subheading>
              <Muted>
                Every paper this search found is already marked read. Try a different rung, or widen
                the topic.
              </Muted>
            </Card>
          ) : null}

          {digest.sections.map((section) => (
            <View key={section.title}>
              <Subheading>{section.title}</Subheading>
              <Muted>{section.rationale}</Muted>
              {section.papers.map((scored) => (
                <Card key={scored.paper.id}>
                  <Body>{scored.paper.title}</Body>
                  <Muted>
                    {[scored.paper.journal, scored.paper.year].filter(Boolean).join(' · ')}
                  </Muted>
                  <View style={styles.pills}>
                    <Pill label={evidenceLabel(scored.evidenceLevel)} />
                    {scored.paper.openAccessUrl ? (
                      <Pill label="Free full text" tone="success" />
                    ) : null}
                    {seen.has(scored.paper.id) ? <Pill label="Read" /> : null}
                  </View>
                  {scored.reasons.slice(0, 3).map((reason) => (
                    <Muted key={reason}>{`· ${reason}`}</Muted>
                  ))}
                  <View style={styles.cardActions}>
                    <Button label="Open" onPress={() => void openPaper(scored.paper)} />
                    <Button
                      label="Make cards"
                      variant="secondary"
                      onPress={() => void addCardsFor(scored)}
                    />
                  </View>
                </Card>
              ))}
            </View>
          ))}

          <Button
            label="Mark all as read"
            variant="secondary"
            onPress={() => markPapersSeen(topicId, digest.readingOrder)}
          />
        </>
      ) : null}

      <View style={styles.back}>
        <Button label="Back" variant="secondary" onPress={onBack} />
      </View>
    </ScrollView>
  );
}

/** "3 days ago" beats an ISO timestamp when the point is "is this current?". */
function describeAge(savedAt: string): string {
  const ageMs = Date.now() - new Date(savedAt).getTime();
  const hours = Math.floor(ageMs / 3_600_000);
  if (hours < 1) return 'in the last hour';
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xl },
  loading: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  retry: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginVertical: spacing.sm },
  cardActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  back: { marginTop: spacing.lg },
});
