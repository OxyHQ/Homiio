import { getDateFnsLocale, getFormatLocale as legacyFormatLocale } from '@/utils/dateLocale';
import { getFormatLocale } from '@/utils/formatLocale';
import i18next from 'i18next';

jest.mock('i18next', () => ({ __esModule: true, default: { language: 'en-US' } }), {
  virtual: true,
});

it.each([
  ['en-US', 'en-US', 'en-US'],
  ['es-ES', 'es-ES', 'es'],
  ['ca-ES', 'ca-ES', 'ca'],
  ['it-IT', 'it-IT', 'it'],
  ['zh-CN', 'zh-CN', 'zh-CN'],
  ['hi-IN', 'hi-IN', 'hi'],
  ['fr-FR', 'fr-FR', 'fr'],
  ['ar', 'ar', 'ar'],
  ['bn-BD', 'bn-BD', 'bn'],
  ['pt-BR', 'pt-BR', 'pt-BR'],
  ['ru-RU', 'ru-RU', 'ru'],
  ['id-ID', 'id-ID', 'id'],
])('preserves locale mapping for %s', (language, intlLocale, dateFnsLocale) => {
  i18next.language = language;
  expect(getFormatLocale(language)).toBe(intlLocale);
  expect(getFormatLocale()).toBe(intlLocale);
  expect(legacyFormatLocale(language)).toBe(intlLocale);
  expect(getDateFnsLocale().code).toBe(dateFnsLocale);
});

it('keeps the English fallback for unknown tags', () => {
  expect(getFormatLocale('unknown')).toBe('en-US');
});
