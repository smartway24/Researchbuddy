import { dueQueue, type ReviewGrade } from '@researchbuddy/core';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useAppState } from '../store/AppState';
import { Body, Button, Card, Heading, Muted, Subheading } from '../ui/components';
import { spacing } from '../ui/theme';

/** SM-2 grades, phrased as a learner would actually think about a card. */
const GRADES: { grade: ReviewGrade; label: string }[] = [
  { grade: 1, label: 'No idea' },
  { grade: 3, label: 'Hard' },
  { grade: 4, label: 'Good' },
  { grade: 5, label: 'Easy' },
];

export function StudyScreen({ topicId, onBack }: { topicId: string; onBack: () => void }) {
  const { database, gradeCard } = useAppState();
  const [revealed, setRevealed] = useState(false);
  const [studied, setStudied] = useState(0);

  const topicCards = useMemo(
    () => database.cards.filter((card) => card.topicId === topicId),
    [database.cards, topicId],
  );
  const cardById = useMemo(() => new Map(topicCards.map((card) => [card.id, card])), [topicCards]);

  const queue = useMemo(() => {
    const ids = new Set(topicCards.map((card) => card.id));
    return dueQueue(
      database.reviews.filter((state) => ids.has(state.cardId)),
      new Date(),
      20,
    );
  }, [database.reviews, topicCards]);

  const current = queue[0];
  const card = current ? cardById.get(current.cardId) : undefined;

  const grade = (value: ReviewGrade) => {
    if (!current) return;
    gradeCard(current.cardId, value);
    setRevealed(false);
    setStudied((count) => count + 1);
  };

  if (!card) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Heading>Nothing due</Heading>
        <Muted>
          {studied > 0
            ? `You reviewed ${studied} card${studied === 1 ? '' : 's'}. Come back when the next batch is due.`
            : 'No cards are due for this topic right now.'}
        </Muted>
        <View style={styles.back}>
          <Button label="Back" variant="secondary" onPress={onBack} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Muted>{`${queue.length} due · ${studied} done`}</Muted>

      <Card style={styles.prompt}>
        <Subheading>{card.front}</Subheading>
        {revealed ? <Body>{card.back}</Body> : <Muted>Answer hidden</Muted>}
      </Card>

      {revealed ? (
        <View style={styles.grades}>
          {GRADES.map((option) => (
            <Button
              key={option.grade}
              label={option.label}
              variant={option.grade >= 4 ? 'primary' : 'secondary'}
              onPress={() => grade(option.grade)}
            />
          ))}
        </View>
      ) : (
        <Button label="Show answer" onPress={() => setRevealed(true)} />
      )}

      <View style={styles.back}>
        <Button label="Stop for now" variant="secondary" onPress={onBack} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xl },
  prompt: { minHeight: 160, justifyContent: 'center', marginVertical: spacing.lg },
  grades: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  back: { marginTop: spacing.xl },
});
