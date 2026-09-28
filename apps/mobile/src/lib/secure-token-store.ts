import * as SecureStore from 'expo-secure-store';
import type { TokenStore } from './session';

const KEY = 'alora.refreshToken';
/** Only on this device, only while unlocked, and only if the phone has a passcode (D-043). */
const OPTIONS: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY };

/**
 * The refresh token in the iOS Keychain / Android Keystore. If the phone has no passcode the keychain refuses to
 * store it; then the session lives in memory only and the caregiver signs in with their password next launch.
 */
export function secureTokenStore(): TokenStore {
  let memory: string | null = null;
  return {
    async get() {
      return memory ?? (await SecureStore.getItemAsync(KEY, OPTIONS).catch(() => null));
    },
    async set(value) {
      memory = value;
      await SecureStore.setItemAsync(KEY, value, OPTIONS).catch(() => undefined);
    },
    async clear() {
      memory = null;
      await SecureStore.deleteItemAsync(KEY, OPTIONS).catch(() => undefined);
    },
  };
}
