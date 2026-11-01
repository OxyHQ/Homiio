import i18next from 'i18next';

/**
 * The BCP-47 tag every `Intl` formatter in the app runs on, derived from the
 * i18next language.
 *
 * It is not date-specific: money, area, distance and
 * percentages all resolve their locale through this one function (see
 * `utils/format.ts`), because a screen showing `1.700 €` beside `29 mar 2026`
 * must have taken both from the same language.
 */
export function getFormatLocale(language?: string): string {
  const tag = (language ?? i18next.language ?? 'en-US').toLowerCase();
  const base = tag.split('-')[0];
  switch (base) {
    case 'es':
      return 'es-ES';
    case 'ca':
      return 'ca-ES';
    case 'it':
      return 'it-IT';
    case 'zh':
      return 'zh-CN';
    case 'hi':
      return 'hi-IN';
    case 'fr':
      return 'fr-FR';
    case 'ar':
      return 'ar';
    case 'bn':
      return 'bn-BD';
    case 'pt':
      return 'pt-BR';
    case 'ru':
      return 'ru-RU';
    case 'id':
      return 'id-ID';
    default:
      return 'en-US';
  }
}
