import type { LocaleCode, LocaleResource } from './localeFiles';

/**
 * NATIVE: every locale ships inside the app binary, so loading one is a
 * synchronous `require` behind a promise. The web fork (`localeResources.web.ts`)
 * fetches instead, to keep eleven locales out of the web JavaScript bundle.
 *
 * English is not listed: it is the fallback and is registered at i18n init.
 */
const NATIVE_LOCALES: Record<Exclude<LocaleCode, 'en-US'>, () => LocaleResource> = {
  'zh-CN': () => require('@/locales/zh-CN.json'),
  'hi-IN': () => require('@/locales/hi-IN.json'),
  'es-ES': () => require('@/locales/es.json'),
  'fr-FR': () => require('@/locales/fr-FR.json'),
  ar: () => require('@/locales/ar.json'),
  'bn-BD': () => require('@/locales/bn-BD.json'),
  'pt-BR': () => require('@/locales/pt-BR.json'),
  'ru-RU': () => require('@/locales/ru-RU.json'),
  'id-ID': () => require('@/locales/id-ID.json'),
  'ca-ES': () => require('@/locales/ca-ES.json'),
  'it-IT': () => require('@/locales/it.json'),
};

export async function loadLocaleResource(code: Exclude<LocaleCode, 'en-US'>): Promise<LocaleResource> {
  return NATIVE_LOCALES[code]();
}
