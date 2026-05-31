/**
 * Locale-aware `date-fns` formatting.
 *
 * `date-fns`' `format()` defaults to English month/weekday names unless a
 * `locale` is passed. The app's UI language is driven by i18next (`en-US`,
 * `es-ES`, `ca-ES`, `it-IT`), so every human-facing date must be formatted with
 * the matching `date-fns` locale or it silently renders in English regardless of
 * the chosen language.
 *
 * This module maps the active i18next language to the corresponding `date-fns`
 * locale and exposes {@link formatLocalized}, a thin wrapper over `format()`
 * that injects that locale. Unknown languages fall back to English so a missing
 * mapping degrades gracefully rather than throwing.
 *
 * Modules read the i18next singleton directly (mirroring `propertyTitleGenerator`
 * / `notifications`) so the helper works outside React components too.
 */
import i18next from 'i18next';
import { format, formatDistanceToNowStrict, type Locale } from 'date-fns';
import { ca, enUS, es, it } from 'date-fns/locale';

/**
 * Map an i18next language tag to a `date-fns` locale. Both the full BCP-47 tag
 * (`es-ES`) and the bare language subtag (`es`) resolve, so it tolerates the
 * detector returning either form. Unmapped languages fall back to English.
 */
function resolveLocale(language: string | undefined): Locale {
  const tag = (language ?? '').toLowerCase();
  const base = tag.split('-')[0];
  switch (base) {
    case 'es':
      return es;
    case 'ca':
      return ca;
    case 'it':
      return it;
    default:
      return enUS;
  }
}

/** The `date-fns` locale matching the active i18next language (English fallback). */
export function getDateFnsLocale(): Locale {
  return resolveLocale(i18next.language);
}

/**
 * `date-fns` `format()` with the active UI locale applied, so month and weekday
 * names follow the user's selected language. Drop-in replacement for
 * `format(date, fmt)` at any human-facing call site.
 */
export function formatLocalized(date: Date | number, formatStr: string): string {
  return format(date, formatStr, { locale: getDateFnsLocale() });
}

/**
 * Locale-aware "time ago" label (e.g. "5 min ago", "hace 5 min", "3 h",
 * "2 d"). Wraps `date-fns` `formatDistanceToNowStrict` with the active UI
 * locale and `addSuffix`, so relative timestamps in lists (inbox, activity
 * feeds) follow the user's selected language instead of silently rendering in
 * English. Centralised here so screens stop re-rolling their own
 * `diffInSeconds` ladders.
 */
export function formatRelativeTime(date: Date | number): string {
  return formatDistanceToNowStrict(date, {
    addSuffix: true,
    locale: getDateFnsLocale(),
  });
}
