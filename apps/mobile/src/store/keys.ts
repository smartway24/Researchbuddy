import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * The user's own API key.
 *
 * On a phone it lives in the iOS keychain, not in the app's JSON store — it is
 * a credential with a third party, and a plaintext copy in AsyncStorage would
 * end up in unencrypted device backups.
 *
 * On the web there is no keychain: `expo-secure-store` is an empty stub there,
 * so calling it would crash the settings screen. Browser storage is the honest
 * fallback, and the UI says so rather than implying a security guarantee the
 * platform cannot make.
 */
const ANTHROPIC_KEY = 'researchbuddy.anthropic.apiKey';

const isWeb = Platform.OS === 'web';

/** True when the key is held somewhere that is actually secure. */
export const keyStorageIsSecure = !isWeb;

function webStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Private browsing and blocked site data both throw on access.
    return null;
  }
}

export async function getAnthropicKey(): Promise<string | null> {
  if (isWeb) return webStorage()?.getItem(ANTHROPIC_KEY) ?? null;
  return SecureStore.getItemAsync(ANTHROPIC_KEY);
}

export async function setAnthropicKey(key: string): Promise<void> {
  if (isWeb) {
    webStorage()?.setItem(ANTHROPIC_KEY, key);
    return;
  }
  await SecureStore.setItemAsync(ANTHROPIC_KEY, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function clearAnthropicKey(): Promise<void> {
  if (isWeb) {
    webStorage()?.removeItem(ANTHROPIC_KEY);
    return;
  }
  await SecureStore.deleteItemAsync(ANTHROPIC_KEY);
}
