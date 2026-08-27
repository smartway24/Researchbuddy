import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useAppState } from '../store/AppState';
import { Body, Button, Card, Heading, Muted, Subheading } from '../ui/components';
import { currentTheme, spacing } from '../ui/theme';

const theme = currentTheme();

export function TopicsScreen({ onOpenTopic }: { onOpenTopic: (topicId: string) => void }) {
  const { database, addTopic, enrichTopic, removeTopic } = useAppState();
  const [draft, setDraft] = useState('');

  const create = () => {
    const label = draft.trim();
    if (!label) return;
    const topic = addTopic({ label, canonicalTerm: label });
    setDraft('');
    // Canonicalising against MeSH is a network call; the topic opens
    // immediately and fills in its proper name when the lookup lands.
    void enrichTopic(topic.id, label);
    onOpenTopic(topic.id);
  };

  const confirmRemove = (topicId: string, label: string) => {
    Alert.alert('Delete topic?', `"${label}" and its cards will be removed from this device.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => removeTopic(topicId) },
    ]);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Heading>What do you want to learn?</Heading>
      <Muted>
        Name a process, a device, a drug, a disease. Researchbuddy builds the path from fundamentals
        up to current research, and does the searching for you.
      </Muted>

      <View style={styles.addRow}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="e.g. ECMO, sepsis, cardiac preload"
          placeholderTextColor={theme.muted}
          style={styles.input}
          autoCapitalize="none"
          returnKeyType="go"
          onSubmitEditing={create}
          accessibilityLabel="Topic to learn"
        />
        <Button label="Add" onPress={create} disabled={draft.trim().length === 0} />
      </View>

      {database.topics.length === 0 ? (
        <Card>
          <Subheading>Nothing here yet</Subheading>
          <Muted>
            Add a topic and Research Buddy resolves it against the medical subject headings, then
            pulls reading for it at whatever depth you ask for.
          </Muted>
        </Card>
      ) : null}

      {database.topics.map((topic) => (
        <Pressable
          key={topic.id}
          onPress={() => onOpenTopic(topic.id)}
          onLongPress={() => confirmRemove(topic.id, topic.label)}
          accessibilityRole="button"
          accessibilityLabel={`Open ${topic.label}`}
        >
          <Card>
            <Subheading>{topic.label}</Subheading>
            {topic.canonicalTerm !== topic.label ? <Body>{topic.canonicalTerm}</Body> : null}
            <Muted>
              {`${(database.seenPapers[topic.id] ?? []).length} papers read · long-press to delete`}
            </Muted>
          </Card>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xl },
  addRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: theme.text,
    fontSize: 15,
  },
});
