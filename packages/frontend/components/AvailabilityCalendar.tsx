/**
 * AvailabilityCalendar — Homiio's stay/move-in picker, composed on Bloom's
 * `Calendar` / `RangeCalendar` (`@oxy.so/bloom/date-picker`).
 *
 * Bloom owns the month grid, paging, range band and keyboard navigation. This
 * file keeps only what Bloom cannot know about a listing:
 *  - host `windows` and reservation `booked` spans become `isDateUnavailable`
 *    (half-open `[start, end)`, matching the backend);
 *  - a completed range is rejected when it crosses an unavailable day or breaks
 *    `minStay` / `maxStay` (Bloom accepts any two presses);
 *  - the nights summary and the Clear / Apply footer.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import {
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  isSameDay,
  parseISO,
  startOfDay,
} from 'date-fns';
import { useTranslation } from 'react-i18next';
import { Button } from '@oxy.so/bloom/button';
import { Calendar, RangeCalendar, type DateRange } from '@oxy.so/bloom/date-picker';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import {
  AvailabilityWindow,
  AvailabilityWindowStatus,
} from '@homiio/shared-types';
import { useTheme } from '@oxy.so/bloom/theme';
import { formatLocalized, getFormatLocale } from '@/utils/dateLocale';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';

export type AvailabilityCalendarMode = 'inline' | 'modal';

/**
 * Selection behavior:
 * - `'range'` (default): two taps pick a check-in → check-out stay (vacation flow).
 * - `'single'`: every tap picks a single day (long-term move-in flow); the range
 *   is collapsed onto `checkIn === checkOut`.
 */
export type AvailabilityCalendarSelectionMode = 'range' | 'single';

export interface AvailabilityCalendarRange {
  /** Selected check-in date (start of day). */
  checkIn: Date;
  /** Selected check-out date (start of day; exclusive). */
  checkOut: Date;
}

export interface AvailabilityCalendarProps {
  /** `modal` + `hideActions` auto-applies on web once a selection completes. */
  mode?: AvailabilityCalendarMode;
  /** Range (two-tap stay) vs. single (one day per tap). Defaults to `'range'`. */
  selectionMode?: AvailabilityCalendarSelectionMode;
  /** Host-defined availability windows (blocked/available). */
  windows?: AvailabilityWindow[];
  /** Booked windows derived from confirmed reservations. */
  booked?: AvailabilityWindow[];
  /** Minimum stay nights enforced on the completed range. */
  minStay?: number;
  /** Maximum stay nights enforced on the completed range. */
  maxStay?: number;
  /** Starting range passed in by the parent. */
  initialRange?: AvailabilityCalendarRange | null;
  /** Earliest selectable date (default = today; never earlier than today). */
  minDate?: Date;
  /** Latest selectable date (default = +18 months). */
  maxDate?: Date;
  /** Called on "Apply" with the confirmed range; null if cleared. */
  onApply?: (range: AvailabilityCalendarRange | null) => void;
  /** Called on every selection change (without confirming). */
  onChange?: (range: AvailabilityCalendarRange | null) => void;
  /** Hide the bottom action bar (use for embedded variants). */
  hideActions?: boolean;
}

/** Monday-first grid. */
const WEEK_START = 1;

type BlockedSpan = { start: Date; end: Date };

const toBlockedSpans = (entries: AvailabilityWindow[]): BlockedSpan[] =>
  entries.flatMap((entry) => {
    if (entry.status === AvailabilityWindowStatus.AVAILABLE) return [];
    const start = typeof entry.start === 'string' ? parseISO(entry.start) : new Date(entry.start);
    const end = typeof entry.end === 'string' ? parseISO(entry.end) : new Date(entry.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
    return [{ start: startOfDay(start), end: startOfDay(end) }];
  });

export const AvailabilityCalendar: React.FC<AvailabilityCalendarProps> = ({
  mode = 'inline',
  selectionMode = 'range',
  windows,
  booked,
  minStay,
  maxStay,
  initialRange = null,
  minDate,
  maxDate,
  onApply,
  onChange,
  hideActions = false,
}) => {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const locale = getFormatLocale(i18n.language);
  const isLarge = useIsScreenNotMobile();
  const [selection, setSelection] = useState<AvailabilityCalendarRange | null>(initialRange);

  const [today] = useState(() => startOfDay(new Date()));
  // Past days are never selectable, whatever `minDate` says.
  const effectiveMin = useMemo(
    () => (minDate && startOfDay(minDate) > today ? startOfDay(minDate) : today),
    [minDate, today],
  );
  const effectiveMax = useMemo(() => maxDate ?? addMonths(today, 18), [maxDate, today]);

  const blocked = useMemo(
    () => toBlockedSpans([...(windows ?? []), ...(booked ?? [])]),
    [windows, booked],
  );
  const isDateUnavailable = useCallback(
    (date: Date) => {
      const time = startOfDay(date).getTime();
      return blocked.some((span) => time >= span.start.getTime() && time < span.end.getTime());
    },
    [blocked],
  );

  const commit = useCallback(
    (next: AvailabilityCalendarRange | null, complete: boolean) => {
      setSelection(next);
      onChange?.(next);
      if (Platform.OS === 'web' && mode === 'modal' && hideActions && next && complete) {
        onApply?.(next);
      }
    },
    [hideActions, mode, onApply, onChange],
  );

  const handleSingle = useCallback(
    (date: Date) => {
      // Tapping the already-selected day clears it.
      const next =
        selection && isSameDay(selection.checkIn, date) ? null : { checkIn: date, checkOut: date };
      commit(next, true);
    },
    [commit, selection],
  );

  const handleRange = useCallback(
    ({ start, end }: DateRange) => {
      if (isSameDay(start, end)) {
        commit({ checkIn: start, checkOut: start }, false);
        return;
      }
      const nights = differenceInCalendarDays(end, start);
      if ((minStay && nights < minStay) || (maxStay && nights > maxStay)) return;
      if (eachDayOfInterval({ start, end }).some(isDateUnavailable)) {
        // A stay cannot straddle a blocked/booked day: restart from the later tap.
        commit({ checkIn: end, checkOut: end }, false);
        return;
      }
      commit({ checkIn: start, checkOut: end }, true);
    },
    [commit, isDateUnavailable, maxStay, minStay],
  );

  const handleClear = useCallback(() => commit(null, false), [commit]);

  const isIncomplete = !selection || isSameDay(selection.checkIn, selection.checkOut);

  const handleApply = useCallback(() => {
    onApply?.(isIncomplete ? null : selection);
  }, [isIncomplete, onApply, selection]);

  const nightsLabel = useMemo(() => {
    if (!selection || isIncomplete) {
      return t('booking.calendar.selectRange', 'Select check-in and check-out');
    }
    const nights = differenceInCalendarDays(selection.checkOut, selection.checkIn);
    const nightWord = t(nights === 1 ? 'booking.toast.night' : 'booking.toast.nights');
    return `${formatLocalized(selection.checkIn, 'MMM d')} → ${formatLocalized(selection.checkOut, 'MMM d')} · ${nights} ${nightWord}`;
  }, [isIncomplete, selection, t]);

  const constraints = {
    minDate: effectiveMin,
    maxDate: effectiveMax,
    isDateUnavailable,
    weekStartsOn: WEEK_START,
    locale,
  } as const;

  return (
    <View style={styles.container}>
      {selectionMode === 'range' ? (
        <BloomText style={styles.summary} numberOfLines={1}>
          {nightsLabel}
        </BloomText>
      ) : null}
      <View style={styles.calendarRow}>
        {selectionMode === 'single' ? (
          <Calendar {...constraints} value={selection?.checkIn ?? null} onChange={handleSingle} />
        ) : (
          <RangeCalendar
            {...constraints}
            visibleMonths={isLarge ? 2 : 1}
            value={
              selection && !isIncomplete
                ? { start: selection.checkIn, end: selection.checkOut }
                : null
            }
            onChange={handleRange}
          />
        )}
      </View>
      {!hideActions ? (
        <View style={[styles.footerRow, { borderTopColor: theme.colors.border }]}>
          <Button variant="ghost" size="medium" onPress={handleClear}>
            {t('common.clear')}
          </Button>
          <Button variant="primary" size="medium" onPress={handleApply} disabled={isIncomplete}>
            {t('booking.calendar.apply', 'Apply')}
          </Button>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: 12,
  },
  summary: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
  },
  calendarRow: {
    alignItems: 'center',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
});

export default AvailabilityCalendar;
