import { LOCALE_FILES, type LocaleCode, type LocaleResource } from './localeFiles';

/**
 * WEB: a locale is a static asset, fetched only when the app switches to it.
 *
 * Bundled, the twelve locale files were ~18% of the web JavaScript budget, all
 * parsed on every page load to show one language. `scripts/publish-web-locales.js`
 * (run from `metro.config.js`) copies `locales/*.json` to `public/locales/`, so
 * the files served are always the ones this build was made from.
 *
 * `no-cache` revalidates against the asset's ETag rather than trusting a cached
 * copy, because the URL carries no content hash: a deploy that changes a string
 * must not be masked by a browser cache.
 */
export async function loadLocaleResource(code: Exclude<LocaleCode, 'en-US'>): Promise<LocaleResource> {
  const response = await fetch(`/locales/${LOCALE_FILES[code]}.json`, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`Locale ${code} failed to load (${response.status})`);
  }
  return (await response.json()) as LocaleResource;
}
