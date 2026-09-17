/**
 * The one map from a supported language code to its `locales/<file>.json`.
 *
 * Shared by the native loader (which `require`s the file), the web loader
 * (which fetches the copy `scripts/publish-web-locales.js` puts under
 * `public/locales/`) and that script itself, so the three cannot disagree.
 */
export const LOCALE_FILES = {
  'en-US': 'en',
  'zh-CN': 'zh-CN',
  'hi-IN': 'hi-IN',
  'es-ES': 'es',
  'fr-FR': 'fr-FR',
  ar: 'ar',
  'bn-BD': 'bn-BD',
  'pt-BR': 'pt-BR',
  'ru-RU': 'ru-RU',
  'id-ID': 'id-ID',
  'ca-ES': 'ca-ES',
  'it-IT': 'it',
} as const;

export type LocaleCode = keyof typeof LOCALE_FILES;

export type LocaleResource = Record<string, unknown>;
