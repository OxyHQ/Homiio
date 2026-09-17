import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';

import { loadLocaleResource } from './localeResources';

const STORAGE_KEY = 'homiio.language';

export const SUPPORTED_LANGUAGE_CODES = [
  'en-US',
  'zh-CN',
  'hi-IN',
  'es-ES',
  'fr-FR',
  'ar',
  'bn-BD',
  'pt-BR',
  'ru-RU',
  'id-ID',
  'ca-ES',
  'it-IT',
] as const;
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

/**
 * Register a language's strings before switching to it. English is registered
 * at init; every other locale loads on first use (a static asset on web, a
 * bundled file on native), so switching never shows raw keys.
 */
export async function ensureLanguageLoaded(code: SupportedLanguageCode): Promise<void> {
  if (code === 'en-US' || i18n.hasResourceBundle(code, 'translation')) return;
  const resource = await loadLocaleResource(code);
  i18n.addResourceBundle(code, 'translation', resource, true, true);
}

export async function setStoredLanguage(code: SupportedLanguageCode): Promise<void> {
  await ensureLanguageLoaded(code);
  await AsyncStorage.setItem(STORAGE_KEY, code);
  await i18n.changeLanguage(code);
}
