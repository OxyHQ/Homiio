import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';

const STORAGE_KEY = 'homiio.language';

export const SUPPORTED_LANGUAGE_CODES = ['en-US', 'es-ES', 'ca-ES', 'it-IT'] as const;
export type SupportedLanguageCode = (typeof SUPPORTED_LANGUAGE_CODES)[number];

export function isSupportedLanguage(code: string): code is SupportedLanguageCode {
  return (SUPPORTED_LANGUAGE_CODES as readonly string[]).includes(code);
}

export async function getStoredLanguage(): Promise<SupportedLanguageCode | null> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (stored && isSupportedLanguage(stored)) {
    return stored;
  }
  return null;
}

export async function setStoredLanguage(code: SupportedLanguageCode): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, code);
  await i18n.changeLanguage(code);
}
