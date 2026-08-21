import { LADDER, dueQueue, getRung, type RungId } from '@researchbuddy/core';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useAppState } from '../store/AppState';
import {
  Body,
  Button,
  Card,
  Heading,
  Muted,
  Pill,
  ProgressBar,
  Subheading,
} from '../ui/components';
import { spacing } from '../ui/theme';

export function TopicScreen({
  topicId,
  onStudy,
  onRead,
  onBack,
}: {
  topicId: string;
  onStudy: () => void;
  onRead: (rung: RungId) => void;
  onBack: () => void;
}) {
  const { database, progressFor } = useAppState();
  const topic = database.topics.find((candidate) => candidate.id === topicId);
  const progress = progressFor(topicId);

  if (!topic) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Heading>Topic not found</Heading>
        <Button label="Back" onPress={onBack} variant="secondary" />
      </ScrollView>
    );
  }

  const topicCardIds = new Set(
    database.cards.filter((card) => card.topicId === topicId).map((card) => card.id),
  );
  const due = dueQueue(
    database.reviews.filter((state) => topicCardIds.has(state.cardId)),
    new Date(),
    50,
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Heading>{topic.label}</Heading>
      <Muted>{`${topicCardIds.size} cards · ${due.length} due now`}</Muted>

      {topic.definition ? (
        <Card>
          <Subheading>{topic.canonicalTerm}</Subheading>
          <Body>{topic.definition}</Body>
          <Muted>Definition: NLM Medical Subject Headings</Muted>
        </Card>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={due.length > 0 ? `Study ${due.length} due` : 'Study'}
          onPress={onStudy}
          disabled={topicCardIds.size === 0}
        />
        <Button
          label="Reading list"
          variant="secondary"
          onPress={() => onRead(progress.currentRung)}
        />
      </View>

      {topicCardIds.size === 0 ? (
        <Card>
          <Subheading>Start with the reading list</Subheading>
          <Muted>
            Open the reading list, then add cards from a paper you have read. Mastery is measured
            from those cards, and it is what unlocks the next rung.
          </Muted>
        </Card>
      ) : null}

      {LADDER.map((rung) => {
        const unlocked = progress.unlockedRungs.includes(rung.id);
        const mastery = progress.masteryByRung[rung.id] ?? 0;
        const isCurrent = progress.currentRung === rung.id;
        return (
          <Card key={rung.id}>
            <View style={styles.rungHeader}>
              <Subheading>{rung.title}</Subheading>
              {isCurrent ? <Pill label="You are here" tone="success" /> : null}
              {!unlocked ? <Pill label="Locked" tone="warning" /> : null}
            </View>
            <Body>{rung.goal}</Body>
            <View style={styles.progress}>
              <ProgressBar value={mastery} />
            </View>
            <Muted>
              {unlocked
                ? `${Math.round(mastery * 100)}% recall strength`
                : `Unlocks at ${Math.round((rung.unlocksAt ?? 0) * 100)}% on ${previousTitle(rung.id)}`}
            </Muted>
            {unlocked ? (
              <View style={styles.rungAction}>
                <Button
                  label="Read at this level"
                  variant="secondary"
                  onPress={() => onRead(rung.id)}
                />
              </View>
            ) : null}
          </Card>
        );
      })}

      <Button label="Back to topics" variant="secondary" onPress={onBack} />
    </ScrollView>
  );
}

function previousTitle(rung: RungId): string {
  const index = LADDER.findIndex((candidate) => candidate.id === rung);
  const previous = LADDER[index - 1];
  return previous ? getRung(previous.id).title : 'the rung below';
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xl },
  actions: { flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.md },
  rungHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  progress: { marginVertical: spacing.sm },
  rungAction: { marginTop: spacing.sm, alignSelf: 'flex-start' },
});
