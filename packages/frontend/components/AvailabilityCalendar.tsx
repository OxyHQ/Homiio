import React, { useCallback, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfDay,
  startOfMonth,
  subMonths,
} from 'date-fns';
import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText, H3 } from '@oxyhq/bloom/typography';
import {
  AvailabilityWindow,
  AvailabilityWindowStatus,
} from '@homiio/shared-types';
import { colors } from '@/styles/colors';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';

export type AvailabilityCalendarMode = 'inline' | 'modal';

export interface AvailabilityCalendarRange {
  /** Selected check-in date (start of day). */
  checkIn: Date;
  /** Selected check-out date (start of day; exclusive). */
  checkOut: Date;
}

export interface AvailabilityCalendarProps {
  /** Inline shows confirm buttons; modal also exposes them but the consumer typically wraps it. */
  mode?: AvailabilityCalendarMode;
  /** Host-defined availability windows (blocked/available). */
  windows?: AvailabilityWindow[];
  /** Booked windows derived from confirmed reservations. */
  booked?: AvailabilityWindow[];
  /** Minimum stay nights enforced for the second tap. */
  minStay?: number;
  /** Maximum stay nights enforced for the second tap. */
  maxStay?: number;
  /** Starting range passed in by the parent. */
  initialRange?: AvailabilityCalendarRange | null;
  /** Earliest selectable date (default = today). */
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

const WEEK_START = 1; // Monday

const DAY_CELL_HEIGHT = 40;
const HORIZONTAL_GUTTER = 4;

interface CalendarDayState {
  date: Date;
  inMonth: boolean;
  disabled: boolean;
  reason?: 'past' | 'blocked' | 'booked' | 'out-of-range';
  isStart: boolean;
  isEnd: boolean;
  inRange: boolean;
}

interface DisabledLookup {
  ranges: { start: Date; end: Date; reason: 'blocked' | 'booked' }[];
}

const toRangeArray = (entries: AvailabilityWindow[] | undefined): DisabledLookup => {
  if (!entries || entries.length === 0) return { ranges: [] };
  const ranges = entries
    .map((entry) => {
      const start =
        typeof entry.start === 'string'
          ? parseISO(entry.start)
          : new Date(entry.start);
      const end =
        typeof entry.end === 'string'
          ? parseISO(entry.end)
          : new Date(entry.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return null;
      }
      const reason: 'blocked' | 'booked' =
        entry.status === AvailabilityWindowStatus.BOOKED ? 'booked' : 'blocked';
      if (entry.status === AvailabilityWindowStatus.AVAILABLE) {
        return null;
      }
      return { start: startOfDay(start), end: startOfDay(end), reason };
    })
    .filter((value): value is { start: Date; end: Date; reason: 'blocked' | 'booked' } => value !== null);
  return { ranges };
};

const isDateInDisabledRanges = (
  date: Date,
  lookup: DisabledLookup,
): 'blocked' | 'booked' | null => {
  for (const range of lookup.ranges) {
    // Half-open interval [start, end) — end is exclusive (matches backend).
    const onOrAfterStart =
      isSameDay(date, range.start) || isAfter(date, range.start);
    const beforeEnd = isBefore(date, range.end);
    if (onOrAfterStart && beforeEnd) {
      return range.reason;
    }
  }
  return null;
};

const buildMonthGrid = (
  monthDate: Date,
  weekStartsOn: 0 | 1,
): Date[] => {
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  // Pad leading days
  const lead = (monthStart.getDay() - weekStartsOn + 7) % 7;
  const padBefore: Date[] = [];
  for (let i = lead; i > 0; i -= 1) {
    padBefore.push(new Date(monthStart.getTime() - i * 24 * 60 * 60 * 1000));
  }
  // Pad trailing days to multiple of 7
  const total = padBefore.length + days.length;
  const trail = (7 - (total % 7)) % 7;
  const padAfter: Date[] = [];
  for (let i = 1; i <= trail; i += 1) {
    padAfter.push(new Date(monthEnd.getTime() + i * 24 * 60 * 60 * 1000));
  }
  return [...padBefore, ...days, ...padAfter];
};

interface DayCellProps {
  state: CalendarDayState;
  onPress: (date: Date) => void;
}

const DayCell: React.FC<DayCellProps> = ({ state, onPress }) => {
  const { date, inMonth, disabled, isStart, isEnd, inRange } = state;
  const handlePress = useCallback(() => {
    if (!disabled && inMonth) onPress(date);
  }, [date, disabled, inMonth, onPress]);

  const showRange = inRange && inMonth;
  const showEndpoint = (isStart || isEnd) && inMonth;
  const dayNumber = date.getDate();

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled || !inMonth}
      style={styles.dayWrapper}
      accessibilityRole="button"
      accessibilityLabel={format(date, 'PPPP')}
      accessibilityState={{ disabled: disabled || !inMonth, selected: showEndpoint }}
    >
      {showRange && !showEndpoint ? (
        <View style={styles.dayRangeFill} />
      ) : null}
      {showEndpoint ? (
        <>
          {(isStart && !isEnd) || (isEnd && !isStart) ? (
            <View
              style={[
                styles.dayRangeFillHalf,
                isStart ? styles.dayRangeFillHalfRight : styles.dayRangeFillHalfLeft,
              ]}
            />
          ) : null}
          <View style={styles.daySelectedCircle}>
            <BloomText style={styles.daySelectedText}>{dayNumber}</BloomText>
          </View>
        </>
      ) : (
        <BloomText
          style={[
            styles.dayText,
            !inMonth && styles.dayTextOutMonth,
            disabled && styles.dayTextDisabled,
            showRange && styles.dayTextInRange,
          ]}
        >
          {dayNumber}
        </BloomText>
      )}
      {disabled && inMonth && !showEndpoint ? (
        <View style={styles.dayStrikethrough} />
      ) : null}
    </Pressable>
  );
};

interface MonthGridProps {
  monthDate: Date;
  selection: AvailabilityCalendarRange | null;
  minDate: Date;
  maxDate: Date;
  disabledLookup: DisabledLookup;
  weekStartsOn: 0 | 1;
  onDayPress: (date: Date) => void;
  weekdayLabels: string[];
}

const MonthGrid: React.FC<MonthGridProps> = ({
  monthDate,
  selection,
  minDate,
  maxDate,
  disabledLookup,
  weekStartsOn,
  onDayPress,
  weekdayLabels,
}) => {
  const grid = useMemo(() => buildMonthGrid(monthDate, weekStartsOn), [monthDate, weekStartsOn]);

  const dayStates = useMemo<CalendarDayState[]>(() => {
    const today = startOfDay(new Date());
    return grid.map((rawDate) => {
      const date = startOfDay(rawDate);
      const inMonth = isSameMonth(date, monthDate);
      const isBeforeMin = isBefore(date, startOfDay(minDate)) || isBefore(date, today);
      const isAfterMax = isAfter(date, startOfDay(maxDate));
      const blockedReason = isDateInDisabledRanges(date, disabledLookup);
      let disabled = false;
      let reason: CalendarDayState['reason'];
      if (isBeforeMin) {
        disabled = true;
        reason = 'past';
      } else if (isAfterMax) {
        disabled = true;
        reason = 'out-of-range';
      } else if (blockedReason) {
        disabled = true;
        reason = blockedReason;
      }
      const isStart = selection ? isSameDay(date, selection.checkIn) : false;
      const isEnd = selection ? isSameDay(date, selection.checkOut) : false;
      const inRange = selection
        ? isAfter(date, selection.checkIn) && isBefore(date, selection.checkOut)
        : false;
      return { date, inMonth, disabled, reason, isStart, isEnd, inRange };
    });
  }, [grid, monthDate, minDate, maxDate, disabledLookup, selection]);

  const rows = useMemo(() => {
    const out: CalendarDayState[][] = [];
    for (let i = 0; i < dayStates.length; i += 7) {
      out.push(dayStates.slice(i, i + 7));
    }
    return out;
  }, [dayStates]);

  return (
    <View style={styles.month}>
      <H3 style={styles.monthTitle}>{format(monthDate, 'MMMM yyyy')}</H3>
      <View style={styles.weekdayRow}>
        {weekdayLabels.map((label) => (
          <View key={label} style={styles.weekdayCell}>
            <BloomText style={styles.weekdayLabel}>{label}</BloomText>
          </View>
        ))}
      </View>
      {rows.map((row, idx) => (
        <View key={`row-${idx}-${format(row[0].date, 'yyyyMMdd')}`} style={styles.weekRow}>
          {row.map((state) => (
            <DayCell
              key={format(state.date, 'yyyyMMdd')}
              state={state}
              onPress={onDayPress}
            />
          ))}
        </View>
      ))}
    </View>
  );
};

const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

export const AvailabilityCalendar: React.FC<AvailabilityCalendarProps> = ({
  mode = 'inline',
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
  const isLarge = useIsScreenNotMobile();
  const [anchorMonth, setAnchorMonth] = useState<Date>(() => {
    if (initialRange) return startOfMonth(initialRange.checkIn);
    return startOfMonth(new Date());
  });
  const [selection, setSelection] = useState<AvailabilityCalendarRange | null>(
    initialRange,
  );

  const today = startOfDay(new Date());
  const effectiveMin = useMemo(() => minDate ?? today, [minDate, today]);
  const effectiveMax = useMemo(
    () => maxDate ?? addMonths(today, 18),
    [maxDate, today],
  );

  const disabledLookup = useMemo<DisabledLookup>(() => {
    const merged: AvailabilityWindow[] = [...(windows ?? []), ...(booked ?? [])];
    return toRangeArray(merged);
  }, [windows, booked]);

  const handleDayPress = useCallback(
    (date: Date) => {
      const start = startOfDay(date);
      setSelection((current) => {
        let next: AvailabilityCalendarRange | null = null;
        if (!current || (current.checkIn && current.checkOut)) {
          // Start a new range
          next = { checkIn: start, checkOut: start };
        } else if (isBefore(start, current.checkIn)) {
          next = { checkIn: start, checkOut: current.checkIn };
        } else if (isSameDay(start, current.checkIn)) {
          // Tap again on start = reset
          next = null;
        } else {
          // Second tap — validate stay constraints
          const nights = differenceInCalendarDays(start, current.checkIn);
          if (minStay && nights < minStay) {
            return current;
          }
          if (maxStay && nights > maxStay) {
            return current;
          }
          // Reject if any disabled day sits inside the range
          const interim = eachDayOfInterval({ start: current.checkIn, end: start });
          const containsDisabled = interim.some((day) =>
            Boolean(isDateInDisabledRanges(startOfDay(day), disabledLookup)),
          );
          if (containsDisabled) {
            return { checkIn: start, checkOut: start };
          }
          next = { checkIn: current.checkIn, checkOut: start };
        }
        if (onChange) onChange(next);
        // Auto-apply on web second tap when in modal mode w/ actions hidden
        if (
          Platform.OS === 'web' &&
          mode === 'modal' &&
          hideActions &&
          next &&
          !isSameDay(next.checkIn, next.checkOut) &&
          onApply
        ) {
          onApply(next);
        }
        return next;
      });
    },
    [disabledLookup, hideActions, minStay, maxStay, mode, onApply, onChange],
  );

  const handlePrev = useCallback(() => {
    setAnchorMonth((current) => subMonths(current, 1));
  }, []);
  const handleNext = useCallback(() => {
    setAnchorMonth((current) => addMonths(current, 1));
  }, []);

  const handleClear = useCallback(() => {
    setSelection(null);
    if (onChange) onChange(null);
  }, [onChange]);

  const handleApply = useCallback(() => {
    if (!onApply) return;
    if (!selection || isSameDay(selection.checkIn, selection.checkOut)) {
      onApply(null);
      return;
    }
    onApply(selection);
  }, [onApply, selection]);

  const showTwoMonths = isLarge;
  const secondMonthDate = useMemo(() => addMonths(anchorMonth, 1), [anchorMonth]);

  const isApplyDisabled =
    !selection || isSameDay(selection.checkIn, selection.checkOut);

  const nightsLabel = useMemo(() => {
    if (!selection || isSameDay(selection.checkIn, selection.checkOut)) {
      return 'Select check-in and check-out';
    }
    const nights = differenceInCalendarDays(
      selection.checkOut,
      selection.checkIn,
    );
    const checkInLabel = format(selection.checkIn, 'MMM d');
    const checkOutLabel = format(selection.checkOut, 'MMM d');
    const nightWord = nights === 1 ? 'night' : 'nights';
    return `${checkInLabel} → ${checkOutLabel} · ${nights} ${nightWord}`;
  }, [selection]);

  return (
    <View
      style={styles.container}
      pointerEvents="auto"
    >
      <View style={styles.headerRow}>
        <Button
          variant="icon"
          size="small"
          onPress={handlePrev}
          accessibilityLabel="Previous month"
        >
          {'‹'}
        </Button>
        <BloomText style={styles.summary} numberOfLines={1}>
          {nightsLabel}
        </BloomText>
        <Button
          variant="icon"
          size="small"
          onPress={handleNext}
          accessibilityLabel="Next month"
        >
          {'›'}
        </Button>
      </View>
      <ScrollView
        horizontal={showTwoMonths}
        contentContainerStyle={[
          styles.monthsContainer,
          showTwoMonths ? styles.monthsContainerTwo : styles.monthsContainerOne,
        ]}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      >
        <MonthGrid
          monthDate={anchorMonth}
          selection={selection}
          minDate={effectiveMin}
          maxDate={effectiveMax}
          disabledLookup={disabledLookup}
          weekStartsOn={WEEK_START}
          onDayPress={handleDayPress}
          weekdayLabels={WEEKDAY_LABELS}
        />
        {showTwoMonths ? (
          <MonthGrid
            monthDate={secondMonthDate}
            selection={selection}
            minDate={effectiveMin}
            maxDate={effectiveMax}
            disabledLookup={disabledLookup}
            weekStartsOn={WEEK_START}
            onDayPress={handleDayPress}
            weekdayLabels={WEEKDAY_LABELS}
          />
        ) : null}
      </ScrollView>
      {!hideActions ? (
        <View style={styles.footerRow}>
          <Button variant="ghost" size="medium" onPress={handleClear}>
            Clear
          </Button>
          <Button
            variant="primary"
            size="medium"
            onPress={handleApply}
            disabled={isApplyDisabled}
          >
            Apply
          </Button>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    width: '100%',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  summary: {
    flex: 1,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
  },
  monthsContainer: {
    flexDirection: 'row',
    gap: 16,
  },
  monthsContainerTwo: {
    flexDirection: 'row',
  },
  monthsContainerOne: {
    flexDirection: 'column',
  },
  month: {
    width: 280,
    paddingHorizontal: HORIZONTAL_GUTTER,
    flexGrow: 1,
    minWidth: 280,
  },
  monthTitle: {
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  weekdayRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  weekdayCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 4,
  },
  weekdayLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_4,
    textTransform: 'uppercase',
  },
  weekRow: {
    flexDirection: 'row',
  },
  dayWrapper: {
    flex: 1,
    height: DAY_CELL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  dayText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  dayTextOutMonth: {
    color: 'transparent',
  },
  dayTextDisabled: {
    color: colors.COLOR_BLACK_LIGHT_5,
  },
  dayTextInRange: {
    color: colors.primaryColor,
    fontWeight: '600',
  },
  dayRangeFill: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 0,
    right: 0,
    backgroundColor: colors.primaryLight_2,
  },
  dayRangeFillHalf: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    width: '50%',
    backgroundColor: colors.primaryLight_2,
  },
  dayRangeFillHalfLeft: {
    left: 0,
  },
  dayRangeFillHalfRight: {
    right: 0,
  },
  daySelectedCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.primaryColor,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daySelectedText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  dayStrikethrough: {
    position: 'absolute',
    height: 1,
    width: 20,
    backgroundColor: colors.COLOR_BLACK_LIGHT_5,
    transform: [{ rotate: '-20deg' }],
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.COLOR_BLACK_LIGHT_6,
    gap: 12,
  },
});

export default AvailabilityCalendar;
