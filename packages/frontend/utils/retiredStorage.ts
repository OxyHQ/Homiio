import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Device storage that nothing reads any more, removed at startup so a retired
 * feature leaves no state behind on the phones and browsers that had it.
 *
 * - `@homiio/sindi-preferences` — Settings → Sindi's device preferences (tips
 *   toggle), retired with Homiio's own Sindi pages in #692: Sindi's starters
 *   are set in Alia's agent editor now.
 *
 * Removing a key that is not there does nothing, so this runs on every start
 * rather than remembering that it ran. A key stays listed until the builds that
 * could have written it are long gone.
 */
export const RETIRED_STORAGE_KEYS: readonly string[] = ['@homiio/sindi-preferences'];

export async function clearRetiredStorage(): Promise<void> {
  await AsyncStorage.multiRemove([...RETIRED_STORAGE_KEYS]);
}
