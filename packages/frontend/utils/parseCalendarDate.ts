import { parseISO } from 'date-fns/parseISO';

/** Parse the wizard's yyyy-MM-dd day as local time, or return null if invalid. */
export function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{1,4})-(\d{1,2})-(\d{1,2})\s*$/.exec(value);
  if (!match || Number(match[1]) === 0) return null;
  const day = `${match[1].padStart(4, '0')}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  const parsed = parseISO(day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
