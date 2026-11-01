import { parse } from 'date-fns/parse';
import { parseCalendarDate } from '@/utils/parseCalendarDate';

/** The previous form parser accepted short numeric fields and trailing whitespace. */
function previous(value: string): number | null {
  const parsed = parse(value, 'yyyy-MM-dd', new Date());
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

describe('parseCalendarDate', () => {
  it('matches the original parser for date boundaries, leap years and accepted short fields', () => {
    for (const year of [1, 4, 26, 99, 100, 400, 1900, 2000, 2011, 2024, 2026, 2100, 9999]) {
      for (let month = 0; month <= 13; month++) {
        for (let day = 0; day <= 32; day++) {
          for (const pad of [false, true]) {
            const value = `${String(year).padStart(pad ? 4 : 1, '0')}-${String(month).padStart(pad ? 2 : 1, '0')}-${String(day).padStart(pad ? 2 : 1, '0')}`;
            expect(parseCalendarDate(value)?.getTime() ?? null).toBe(previous(value));
          }
        }
      }
    }
  });

  it.each([
    '',
    ' ',
    '2026-01-01 ',
    '2026-01-01\n',
    ' 2026-01-01',
    '0000-01-01',
    '2026-01',
    '2026-001',
    '2026-01-01T00:00:00',
    '+010000-01-01',
    '2026-2-29',
    '2024-2-29',
    '2026-04-31',
    '26-1-1',
    '99999-01-01',
    '2026-001-01',
  ])('matches the original for %p', (value) => {
    expect(parseCalendarDate(value)?.getTime() ?? null).toBe(previous(value));
  });
});
