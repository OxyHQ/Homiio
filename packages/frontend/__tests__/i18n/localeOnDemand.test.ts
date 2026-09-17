/**
 * Only English is registered at i18n init; every other language is loaded the
 * first time the app switches to it (a static asset on web, a bundled file on
 * native — jest resolves the native loader). These assert the switch never
 * lands on a language whose strings were not registered first, and that the
 * web copy step and the loader agree on file names.
 */
import fs from 'fs';
import path from 'path';
import i18n from 'i18next';

import enUS from '@/locales/en.json';
import esES from '@/locales/es.json';
import { LOCALE_FILES } from '@/utils/localeFiles';
import { ensureLanguageLoaded, setStoredLanguage, SUPPORTED_LANGUAGE_CODES } from '@/utils/languagePreference';

beforeAll(async () => {
  await i18n.init({
    resources: { 'en-US': { translation: enUS } },
    lng: 'en-US',
    fallbackLng: 'en-US',
    interpolation: { escapeValue: false },
  });
});

describe('locales load on demand', () => {
  it('registers a language before switching to it', async () => {
    expect(i18n.hasResourceBundle('es-ES', 'translation')).toBe(false);

    await setStoredLanguage('es-ES');

    expect(i18n.language).toBe('es-ES');
    expect(i18n.hasResourceBundle('es-ES', 'translation')).toBe(true);
    expect(i18n.getResourceBundle('es-ES', 'translation')).toEqual(esES);
  });

  it('is idempotent and never reloads English', async () => {
    await ensureLanguageLoaded('es-ES');
    await ensureLanguageLoaded('en-US');
    expect(i18n.getResourceBundle('en-US', 'translation')).toEqual(enUS);
  });

  it('maps every supported language to a locale file that exists', () => {
    const localesDir = path.join(__dirname, '..', '..', 'locales');
    expect(Object.keys(LOCALE_FILES).sort()).toEqual([...SUPPORTED_LANGUAGE_CODES].sort());
    for (const file of Object.values(LOCALE_FILES)) {
      expect(fs.existsSync(path.join(localesDir, `${file}.json`))).toBe(true);
    }
  });
});
