import { LADDER, type RungId } from '@researchbuddy/core';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useAppState } from '../store/AppState';
import { Body, Button, Card, Heading, Muted, Subheading } from '../ui/components';
import { spacing } from '../ui/theme';

/**
 * A topic, and the depths you can read it at.
 *
 * The rungs used to be locked behind recall scores. They are not gates any
 * more — a researcher looking something up should never be told they have not
 * earned the frontier — so they read as what they always were underneath: six
 * different kinds of reading about the same subject.
 */
export function TopicScreen({
  topicId,
  onRead,
  onBack,
}: {
  topicId: string;
  onRead: (rung: RungId) => void;
  onBack: () => void;
}) {
  const { database } = useAppState();
  const topic = database.topics.find((candidate) => candidate.id === topicId);

  if (!topic) {
    return (
      <ScrollView contentContainerStyle={styles.container}>
        <Heading>Topic not found</Heading>
        <Button label="Back" onPress={onBack} variant="secondary" />
      </ScrollView>
    );
  }

  const readCount = (database.seenPapers[topicId] ?? []).length;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Heading>{topic.label}</Heading>
      <Muted>{readCount === 0 ? 'Nothing read yet' : `${readCount} papers marked read`}</Muted>

      {topic.definition ? (
        <Card>
          <Subheading>{topic.canonicalTerm}</Subheading>
          <Body>{topic.definition}</Body>
          <Muted>Definition: NLM Medical Subject Headings</Muted>
        </Card>
      ) : null}

      <View style={styles.lead}>
        <Muted>Pick how deep you want to read.</Muted>
      </View>

      {LADDER.map((rung) => (
        <Card key={rung.id}>
          <Subheading>{rung.title}</Subheading>
          <Body>{rung.goal}</Body>
          <View style={styles.action}>
            <Button label="Reading list" variant="secondary" onPress={() => onRead(rung.id)} />
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xl },
  lead: { marginTop: spacing.lg, marginBottom: spacing.sm },
  action: { marginTop: spacing.md, alignSelf: 'flex-start' },
});
