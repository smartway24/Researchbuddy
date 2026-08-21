import type { RungId } from '@researchbuddy/core';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { DigestScreen } from './src/screens/DigestScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { StudyScreen } from './src/screens/StudyScreen';
import { TopicScreen } from './src/screens/TopicScreen';
import { TopicsScreen } from './src/screens/TopicsScreen';
import { AppStateProvider, useAppState } from './src/store/AppState';
import { Body, Button, Card, Heading, Muted } from './src/ui/components';
import { STANDING_DISCLAIMER } from './src/config';
import { currentTheme, spacing } from './src/ui/theme';

const theme = currentTheme();

/**
 * Navigation is a plain state machine rather than a navigation library: the
 * app has five screens and one back path, and a dependency-free stack keeps
 * the iOS build surface small.
 */
type Route =
  | { name: 'topics' }
  | { name: 'topic'; topicId: string }
  | { name: 'study'; topicId: string }
  | { name: 'digest'; topicId: string; rung: RungId }
  | { name: 'settings' };

function Shell() {
  const { ready, database, updateSettings } = useAppState();
  const [route, setRoute] = useState<Route>({ name: 'topics' });

  if (!ready) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!database.settings.acceptedDisclaimer) {
    return (
      <View style={styles.disclaimer}>
        <Heading>Before you start</Heading>
        <Card>
          <Body>
            Researchbuddy is a study tool. It surfaces published literature and helps you remember
            what you read. It is not clinical decision support, and nothing in it is advice about
            the care of a particular patient.
          </Body>
        </Card>
        <Card>
          <Body>
            Summaries are generated from abstracts and can be wrong or incomplete. Read the source
            before you rely on anything — every card and every summary keeps a link back to it.
          </Body>
        </Card>
        <Button label="I understand" onPress={() => updateSettings({ acceptedDisclaimer: true })} />
      </View>
    );
  }

  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        <Pressable onPress={() => setRoute({ name: 'topics' })} accessibilityRole="button">
          <Text style={styles.brand}>Researchbuddy</Text>
        </Pressable>
        <Pressable
          onPress={() => setRoute({ name: 'settings' })}
          accessibilityRole="button"
          accessibilityLabel="Settings"
        >
          <Muted>Settings</Muted>
        </Pressable>
      </View>

      {route.name === 'topics' ? (
        <TopicsScreen onOpenTopic={(topicId) => setRoute({ name: 'topic', topicId })} />
      ) : null}

      {route.name === 'topic' ? (
        <TopicScreen
          topicId={route.topicId}
          onStudy={() => setRoute({ name: 'study', topicId: route.topicId })}
          onRead={(rung) => setRoute({ name: 'digest', topicId: route.topicId, rung })}
          onBack={() => setRoute({ name: 'topics' })}
        />
      ) : null}

      {route.name === 'study' ? (
        <StudyScreen
          topicId={route.topicId}
          onBack={() => setRoute({ name: 'topic', topicId: route.topicId })}
        />
      ) : null}

      {route.name === 'digest' ? (
        <DigestScreen
          topicId={route.topicId}
          rung={route.rung}
          onBack={() => setRoute({ name: 'topic', topicId: route.topicId })}
        />
      ) : null}

      {route.name === 'settings' ? (
        <SettingsScreen onBack={() => setRoute({ name: 'topics' })} />
      ) : null}

      <View style={styles.disclaimerBar}>
        <Text style={styles.disclaimerText}>{STANDING_DISCLAIMER}</Text>
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="auto" />
      <AppStateProvider>
        <Shell />
      </AppStateProvider>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.background },
  shell: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  disclaimer: { flex: 1, padding: spacing.lg, justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  brand: { color: theme.text, fontSize: 17, fontWeight: '700' },
  disclaimerBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
    backgroundColor: theme.surface,
  },
  disclaimerText: { color: theme.muted, fontSize: 11, textAlign: 'center' },
});
