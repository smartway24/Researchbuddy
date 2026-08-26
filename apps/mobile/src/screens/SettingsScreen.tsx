import { validateInstitution, type Institution } from '@researchbuddy/core';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, TextInput, View } from 'react-native';
import { searchCache } from '../store/cache';
import { exportDatabase } from '../store/db';
import { useAppState } from '../store/AppState';
import {
  clearAnthropicKey,
  getAnthropicKey,
  keyStorageIsSecure,
  setAnthropicKey,
} from '../store/keys';
import { Body, Button, Card, Heading, Muted, Pill, Subheading } from '../ui/components';
import { currentTheme, spacing } from '../ui/theme';

const theme = currentTheme();

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const { database, updateSettings } = useAppState();
  const settings = database.settings;

  const [apiKey, setApiKey] = useState('');
  const [keyPresent, setKeyPresent] = useState(settings.hasApiKey);
  const [libraryName, setLibraryName] = useState('');
  const [libraryPrefix, setLibraryPrefix] = useState('');
  const [ncbiKey, setNcbiKey] = useState(settings.ncbiApiKey ?? '');
  const [cacheCleared, setCacheCleared] = useState(false);

  useEffect(() => {
    void getAnthropicKey().then((stored) => setKeyPresent(Boolean(stored)));
  }, []);

  const saveKey = async () => {
    const trimmed = apiKey.trim();
    if (!trimmed) return;
    await setAnthropicKey(trimmed);
    setApiKey('');
    setKeyPresent(true);
    updateSettings({ hasApiKey: true, aiProvider: 'anthropic' });
  };

  const removeKey = async () => {
    await clearAnthropicKey();
    setKeyPresent(false);
    updateSettings({ hasApiKey: false, aiProvider: 'offline' });
  };

  const addLibrary = () => {
    const candidate: Partial<Institution> = {
      name: libraryName.trim(),
      ezproxyPrefix: libraryPrefix.trim() || undefined,
    };
    const problems = validateInstitution(candidate);
    if (problems.length > 0) {
      Alert.alert('Check the details', problems.join('\n\n'));
      return;
    }
    updateSettings({
      institutions: [
        ...settings.institutions,
        {
          id: `inst-${Date.now()}`,
          name: candidate.name as string,
          ...(candidate.ezproxyPrefix ? { ezproxyPrefix: candidate.ezproxyPrefix } : {}),
        },
      ],
    });
    setLibraryName('');
    setLibraryPrefix('');
  };

  const removeLibrary = (id: string) => {
    updateSettings({ institutions: settings.institutions.filter((entry) => entry.id !== id) });
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Heading>Settings</Heading>

      <Card>
        <Subheading>Libraries and subscriptions</Subheading>
        <Muted>
          Paste your library&apos;s EZproxy login prefix (it ends in {'"url="'}). Paywalled papers
          then open through your institution&apos;s own login. Researchbuddy never stores your
          library password and never downloads anything you are not entitled to.
        </Muted>
        {settings.institutions.map((institution) => (
          <Pressable
            key={institution.id}
            onLongPress={() => removeLibrary(institution.id)}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${institution.name}`}
          >
            <View style={styles.row}>
              <Body>{institution.name}</Body>
              <Muted>long-press to remove</Muted>
            </View>
          </Pressable>
        ))}
        <TextInput
          value={libraryName}
          onChangeText={setLibraryName}
          placeholder="Library name"
          placeholderTextColor={theme.muted}
          style={styles.input}
          accessibilityLabel="Library name"
        />
        <TextInput
          value={libraryPrefix}
          onChangeText={setLibraryPrefix}
          placeholder="https://login.ezproxy.your-uni.edu/login?url="
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          accessibilityLabel="EZproxy login prefix"
        />
        <Button label="Add library" onPress={addLibrary} />
      </Card>

      <Card>
        <Subheading>AI summaries</Subheading>
        <View style={styles.pills}>
          <Pill
            label={settings.aiProvider === 'anthropic' ? 'Claude (your key)' : 'On-device only'}
            tone={settings.aiProvider === 'anthropic' ? 'neutral' : 'success'}
          />
        </View>
        <Muted>
          The app works fully without this. Summaries and cards are extracted from abstracts on
          device. Adding your own Claude API key gets you written summaries instead; the title and
          abstract of a paper are then sent to Anthropic. Nothing else leaves your device.
        </Muted>
        {keyPresent ? (
          <View style={styles.rowActions}>
            <Muted>
              {keyStorageIsSecure
                ? 'A key is stored in your keychain.'
                : 'A key is stored in this browser. Browsers have no keychain — use the phone app for anything you care about.'}
            </Muted>
            <Button label="Remove key" variant="secondary" onPress={() => void removeKey()} />
          </View>
        ) : (
          <>
            <TextInput
              value={apiKey}
              onChangeText={setApiKey}
              placeholder="sk-ant-…"
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={styles.input}
              accessibilityLabel="Anthropic API key"
            />
            <Button
              label="Save key"
              onPress={() => void saveKey()}
              disabled={apiKey.trim().length === 0}
            />
          </>
        )}
      </Card>

      <Card>
        <Subheading>PubMed rate limit</Subheading>
        <Muted>
          Optional. An NCBI API key raises PubMed&apos;s limit from 3 to 10 requests a second, which
          makes large reading lists load faster.
        </Muted>
        <TextInput
          value={ncbiKey}
          onChangeText={setNcbiKey}
          placeholder="NCBI API key"
          placeholderTextColor={theme.muted}
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.input}
          accessibilityLabel="NCBI API key"
        />
        <Button
          label="Save"
          variant="secondary"
          onPress={() => updateSettings({ ncbiApiKey: ncbiKey.trim() || undefined })}
        />
      </Card>

      <Card>
        <Subheading>Your data</Subheading>
        <Muted>
          Researchbuddy has no server and no account. Your topics, cards, and review history live on
          this device; searches are cached here too, which is what lets a reading list open with no
          signal. Export a copy whenever you want — it is plain JSON.
        </Muted>
        <Button
          label="Export"
          variant="secondary"
          onPress={() => {
            void Share.share({ message: exportDatabase(database) });
          }}
        />
        <View style={styles.rowActions}>
          <Button
            label={cacheCleared ? 'Cached searches cleared' : 'Clear cached searches'}
            variant="secondary"
            disabled={cacheCleared}
            onPress={() => {
              void searchCache.clear().then(() => setCacheCleared(true));
            }}
          />
        </View>
      </Card>

      <Button label="Back" variant="secondary" onPress={onBack} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: spacing.xl },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.border,
    backgroundColor: theme.background,
    borderRadius: 10,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    color: theme.text,
    fontSize: 15,
    marginVertical: spacing.sm,
  },
  row: { paddingVertical: spacing.sm },
  rowActions: { gap: spacing.sm, marginTop: spacing.sm },
  pills: { flexDirection: 'row', gap: spacing.xs, marginVertical: spacing.sm },
});
