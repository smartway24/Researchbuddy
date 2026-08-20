import * as SecureStore from 'expo-secure-store';

/**
 * API keys live in the iOS keychain, not in the app's JSON store — they are
 * the learner's credentials with a third party, and a plaintext copy in
 * AsyncStorage would end up in unencrypted device backups.
 */
const ANTHROPIC_KEY = 'researchbuddy.anthropic.apiKey';

export async function getAnthropicKey(): Promise<string | null> {
  return SecureStore.getItemAsync(ANTHROPIC_KEY);
}

export async function setAnthropicKey(key: string): Promise<void> {
  await SecureStore.setItemAsync(ANTHROPIC_KEY, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearAnthropicKey(): Promise<void> {
  await SecureStore.deleteItemAsync(ANTHROPIC_KEY);
}
