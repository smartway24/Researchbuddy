import type { RungId } from '@researchbuddy/core';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { DigestScreen } from './src/screens/DigestScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { TopicScreen } from './src/screens/TopicScreen';
import { TopicsScreen } from './src/screens/TopicsScreen';
import { AppStateProvider, useAppState } from './src/store/AppState';
import { STANDING_DISCLAIMER } from './src/config';
import { Body, Button, Card, Heading, Muted } from './src/ui/components';
import { currentTheme, spacing } from './src/ui/theme';

const theme = currentTheme();

type Route =
  | { name: 'topics' }
  | { name: 'topic'; topicId: string }
  | { name: 'digest'; topicId: string; rung: RungId }
  | { name: 'settings' };

const TITLES: Record<Route['name'], string> = {
  topics: 'Research Buddy',
  topic: 'Topic',
  digest: 'Reading list',
  settings: 'Settings',
};

/**
 * Navigation is a real stack rather than a single current screen, so Back
 * always returns where you came from — including the case that used to strand
 * you, opening Settings from inside a reading list.
 */
function Shell() {
  const { ready, database, updateSettings } = useAppState();
  const [stack, setStack] = useState<Route[]>([{ name: 'topics' }]);

  const route = stack[stack.length - 1] ?? { name: 'topics' };
  const canGoBack = stack.length > 1;

  const push = useCallback((next: Route) => setStack((current) => [...current, next]), []);
  const back = useCallback(
    () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current)),
    [],
  );
  const home = useCallback(() => setStack([{ name: 'topics' }]), []);

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
            Research Buddy is a literature tool. It finds and organises published research. It is
            not clinical decision support, and nothing in it is advice about the care of a
            particular patient.
          </Body>
        </Card>
        <Card>
          <Body>
            Summaries are generated from abstracts and can be wrong or incomplete. Read the source
            before you rely on anything — every summary keeps a link back to it.
          </Body>
        </Card>
        <Button label="I understand" onPress={() => updateSettings({ acceptedDisclaimer: true })} />
      </View>
    );
  }

  return (
    <View style={styles.shell}>
      <View style={styles.header}>
        <View style={styles.headerSide}>
          {canGoBack ? (
            <Pressable
              onPress={back}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={12}
            >
              <Text style={styles.backLabel}>‹ Back</Text>
            </Pressable>
          ) : null}
        </View>

        <Pressable onPress={home} accessibilityRole="button" accessibilityLabel="Home">
          <Text style={styles.title} numberOfLines={1}>
            {TITLES[route.name]}
          </Text>
        </Pressable>

        <View style={[styles.headerSide, styles.headerRight]}>
          {route.name === 'settings' ? null : (
            <Pressable
              onPress={() => push({ name: 'settings' })}
              accessibilityRole="button"
              accessibilityLabel="Settings"
              hitSlop={12}
            >
              <Muted>Settings</Muted>
            </Pressable>
          )}
        </View>
      </View>

      {route.name === 'topics' ? (
        <TopicsScreen onOpenTopic={(topicId) => push({ name: 'topic', topicId })} />
      ) : null}

      {route.name === 'topic' ? (
        <TopicScreen
          topicId={route.topicId}
          onRead={(rung) => push({ name: 'digest', topicId: route.topicId, rung })}
          onBack={back}
        />
      ) : null}

      {route.name === 'digest' ? (
        <DigestScreen topicId={route.topicId} rung={route.rung} onBack={back} />
      ) : null}

      {route.name === 'settings' ? <SettingsScreen onBack={back} /> : null}

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
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.border,
  },
  // Equal-width sides keep the title optically centred whether or not Back is
  // showing, instead of letting it jump as you navigate.
  headerSide: { width: 76, justifyContent: 'center' },
  headerRight: { alignItems: 'flex-end' },
  title: { color: theme.text, fontSize: 17, fontWeight: '700' },
  backLabel: { color: theme.accent, fontSize: 16, fontWeight: '600' },
  disclaimerBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.border,
    backgroundColor: theme.surface,
  },
  disclaimerText: { color: theme.muted, fontSize: 11, textAlign: 'center' },
});
