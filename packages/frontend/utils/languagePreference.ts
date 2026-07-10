import AsyncStorage from '@react-native-async-storage/async-storage';

export const LANGUAGE_STORAGE_KEY = 'homiio.language';

/** i18next resource codes backed by locale bundles. */
export const SUPPORTED_LANGUAGE_CODES = [
  'en-US',
  'es-ES',
  'ca-ES',
  'it-IT',
] as const;

export type SupportedLanguageCode = (typeof SUPPORTED_LANGUAGE_CODES)[number];

export const DEFAULT_LANGUAGE_CODE: SupportedLanguageCode = 'en-US';

export function isSupportedLanguageCode(
  value: string | null | undefined,
): value is SupportedLanguageCode {
  return (
    value !== null &&
    value !== undefined &&
    (SUPPORTED_LANGUAGE_CODES as readonly string[]).includes(value)
  );
}

export async function getStoredLanguage(): Promise<SupportedLanguageCode | null> {
  try {
    const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
    return isSupportedLanguageCode(stored) ? stored : null;
  } catch {
    return null;
  }
}

export async function setStoredLanguage(code: SupportedLanguageCode): Promise<void> {
  await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, code);
}
