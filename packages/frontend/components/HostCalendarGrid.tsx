import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  startOfDay,
  startOfMonth,
  subMonths,
} from 'date-fns';
import { Text as BloomText, H3 } from '@oxyhq/bloom/typography';
import { Button } from '@oxyhq/bloom/button';
import {
  AvailabilityWindow,
  AvailabilityWindowStatus,
  Reservation,
  ReservationStatus,
} from '@homiio/shared-types';
import { colors } from '@/styles/colors';

type CellKind = 'blocked' | 'pending' | 'confirmed';

interface DayOverlay {
  kind: CellKind;
  reservationId?: string;
}

interface CellState {
  date: Date;
  inMonth: boolean;
  isPast: boolean;
  overlay: DayOverlay | null;
  inSelectionRange: boolean;
  isSelectionEdge: boolean;
}

export interface HostCalendarSelection {
  start: Date;
  end: Date;
}

export interface HostCalendarGridProps {
  windows?: AvailabilityWindow[];
  reservations?: Reservation[];
  /** Called when a date range is selected via two consecutive taps. */
  onSelectRange?: (range: HostCalendarSelection) => void;
  /** Called when a booked range cell is tapped (for navigation). */
  onPressReservation?: (reservationId: string) => void;
  /** Optional initial month to anchor on; defaults to today. */
  initialMonth?: Date;
}

const WEEKDAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const WEEK_START: 0 | 1 = 1;

const buildMonthGrid = (monthDate: Date): Date[] => {
  const monthStart = startOfMonth(monthDate);
  const monthEnd = endOfMonth(monthDate);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const lead = (monthStart.getDay() - WEEK_START + 7) % 7;
  const padBefore: Date[] = [];
  for (let i = lead; i > 0; i -= 1) {
    padBefore.push(new Date(monthStart.getTime() - i * 24 * 60 * 60 * 1000));
  }
  const total = padBefore.length + days.length;
  const trail = (7 - (total % 7)) % 7;
  const padAfter: Date[] = [];
  for (let i = 1; i <= trail; i += 1) {
    padAfter.push(new Date(monthEnd.getTime() + i * 24 * 60 * 60 * 1000));
  }
  return [...padBefore, ...days, ...padAfter];
};

interface OverlayLookup {
  blocked: { start: Date; end: Date }[];
  bookings: { start: Date; end: Date; status: ReservationStatus; id: string }[];
}

const buildOverlayLookup = (
  windows: AvailabilityWindow[] | undefined,
  reservations: Reservation[] | undefined,
): OverlayLookup => {
  const blocked: OverlayLookup['blocked'] = [];
  if (windows) {
    for (const window of windows) {
      if (window.status !== AvailabilityWindowStatus.BLOCKED) continue;
      const start = startOfDay(new Date(window.start));
      const end = startOfDay(new Date(window.end));
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
      blocked.push({ start, end });
    }
  }
  const bookings: OverlayLookup['bookings'] = [];
  if (reservations) {
    for (const reservation of reservations) {
      if (
        reservation.status !== ReservationStatus.PENDING &&
        reservation.status !== ReservationStatus.CONFIRMED
      ) {
        continue;
      }
      const start = startOfDay(new Date(reservation.checkIn));
      const end = startOfDay(new Date(reservation.checkOut));
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
      bookings.push({ start, end, status: reservation.status, id: reservation.id });
    }
  }
  return { blocked, bookings };
};

const overlayForDate = (
  date: Date,
  lookup: OverlayLookup,
): DayOverlay | null => {
  for (const range of lookup.blocked) {
    const onOrAfter = isSameDay(date, range.start) || isAfter(date, range.start);
    const before = isBefore(date, range.end);
    if (onOrAfter && before) return { kind: 'blocked' };
  }
  for (const range of lookup.bookings) {
    const onOrAfter = isSameDay(date, range.start) || isAfter(date, range.start);
    const before = isBefore(date, range.end);
    if (onOrAfter && before) {
      return {
        kind:
          range.status === ReservationStatus.CONFIRMED ? 'confirmed' : 'pending',
        reservationId: range.id,
      };
    }
  }
  return null;
};

export const HostCalendarGrid: React.FC<HostCalendarGridProps> = ({
  windows,
  reservations,
  onSelectRange,
  onPressReservation,
  initialMonth,
}) => {
  const [monthAnchor, setMonthAnchor] = useState<Date>(
    () => startOfMonth(initialMonth ?? new Date()),
  );
  const [selectionStart, setSelectionStart] = useState<Date | null>(null);

  const lookup = useMemo(
    () => buildOverlayLookup(windows, reservations),
    [windows, reservations],
  );

  const grid = useMemo(() => buildMonthGrid(monthAnchor), [monthAnchor]);

  const cells = useMemo<CellState[]>(() => {
    const today = startOfDay(new Date());
    return grid.map((rawDate) => {
      const date = startOfDay(rawDate);
      const inMonth = isSameMonth(date, monthAnchor);
      const isPast = isBefore(date, today);
      const overlay = overlayForDate(date, lookup);
      const inSelectionRange =
        selectionStart !== null && isSameDay(date, selectionStart);
      const isSelectionEdge = inSelectionRange;
      return {
        date,
        inMonth,
        isPast,
        overlay,
        inSelectionRange,
        isSelectionEdge,
      };
    });
  }, [grid, monthAnchor, lookup, selectionStart]);

  const rows = useMemo(() => {
    const out: CellState[][] = [];
    for (let i = 0; i < cells.length; i += 7) {
      out.push(cells.slice(i, i + 7));
    }
    return out;
  }, [cells]);

  const handlePrev = useCallback(() => {
    setMonthAnchor((current) => subMonths(current, 1));
  }, []);
  const handleNext = useCallback(() => {
    setMonthAnchor((current) => addMonths(current, 1));
  }, []);

  const handlePress = useCallback(
    (cell: CellState) => {
      if (!cell.inMonth || cell.isPast) return;
      if (cell.overlay) {
        if (
          cell.overlay.reservationId &&
          onPressReservation
        ) {
          onPressReservation(cell.overlay.reservationId);
        }
        return;
      }
      if (!selectionStart) {
        setSelectionStart(cell.date);
        return;
      }
      if (isSameDay(cell.date, selectionStart)) {
        setSelectionStart(null);
        return;
      }
      const start = isBefore(cell.date, selectionStart) ? cell.date : selectionStart;
      const end = isAfter(cell.date, selectionStart) ? cell.date : selectionStart;
      // Backend uses half-open [start, end) — extend end by 1 day so the user's
      // last-tapped day is included.
      const endExclusive = new Date(end.getTime() + 24 * 60 * 60 * 1000);
      if (onSelectRange) {
        onSelectRange({ start, end: endExclusive });
      }
      setSelectionStart(null);
    },
    [onPressReservation, onSelectRange, selectionStart],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Button
          variant="icon"
          size="small"
          onPress={handlePrev}
          accessibilityLabel="Previous month"
        >
          {'‹'}
        </Button>
        <H3 style={styles.monthLabel}>{format(monthAnchor, 'MMMM yyyy')}</H3>
        <Button
          variant="icon"
          size="small"
          onPress={handleNext}
          accessibilityLabel="Next month"
        >
          {'›'}
        </Button>
      </View>
      <View style={styles.weekdayRow}>
        {WEEKDAY_LABELS.map((label) => (
          <View key={label} style={styles.weekdayCell}>
            <BloomText style={styles.weekdayLabel}>{label}</BloomText>
          </View>
        ))}
      </View>
      {rows.map((row, idx) => (
        <View
          key={`row-${idx}-${format(row[0].date, 'yyyyMMdd')}`}
          style={styles.weekRow}
        >
          {row.map((cell) => {
            const cellStyle = [
              styles.dayCell,
              !cell.inMonth && styles.dayCellOutMonth,
              cell.overlay?.kind === 'confirmed' && styles.dayCellConfirmed,
              cell.overlay?.kind === 'pending' && styles.dayCellPending,
              cell.overlay?.kind === 'blocked' && styles.dayCellBlocked,
              cell.isSelectionEdge && styles.dayCellSelected,
            ];
            const textStyle = [
              styles.dayText,
              !cell.inMonth && styles.dayTextOutMonth,
              cell.isPast && styles.dayTextPast,
              cell.overlay && styles.dayTextOnOverlay,
              cell.isSelectionEdge && styles.dayTextSelected,
            ];
            return (
              <Pressable
                key={format(cell.date, 'yyyyMMdd')}
                style={cellStyle}
                onPress={() => handlePress(cell)}
                disabled={cell.isPast && !cell.overlay}
                accessibilityRole="button"
                accessibilityLabel={format(cell.date, 'PPPP')}
              >
                <BloomText style={textStyle}>{cell.date.getDate()}</BloomText>
              </Pressable>
            );
          })}
        </View>
      ))}
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, styles.legendConfirmed]} />
          <BloomText style={styles.legendLabel}>Confirmed</BloomText>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, styles.legendPending]} />
          <BloomText style={styles.legendLabel}>Pending</BloomText>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendSwatch, styles.legendBlocked]} />
          <BloomText style={styles.legendLabel}>Blocked</BloomText>
        </View>
      </View>
      {selectionStart ? (
        <BloomText style={styles.hint}>
          Tap a second date to block a range starting from{' '}
          {format(selectionStart, 'MMM d')}.
        </BloomText>
      ) : (
        <BloomText style={styles.hint}>
          Tap two open dates to block them, or tap a booking to open it.
        </BloomText>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  monthLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  weekdayRow: {
    flexDirection: 'row',
    marginTop: 8,
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
  dayCell: {
    flex: 1,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
  },
  dayCellOutMonth: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_8,
  },
  dayCellConfirmed: {
    backgroundColor: colors.success,
  },
  dayCellPending: {
    backgroundColor: colors.warning,
  },
  dayCellBlocked: {
    backgroundColor: colors.error,
  },
  dayCellSelected: {
    borderColor: colors.primaryColor,
    borderWidth: 2,
  },
  dayText: {
    fontSize: 13,
    color: colors.COLOR_BLACK,
  },
  dayTextOutMonth: {
    color: colors.COLOR_BLACK_LIGHT_5,
  },
  dayTextPast: {
    color: colors.COLOR_BLACK_LIGHT_5,
  },
  dayTextOnOverlay: {
    color: colors.white,
    fontWeight: '700',
  },
  dayTextSelected: {
    color: colors.primaryColor,
    fontWeight: '700',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  legendSwatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
  },
  legendConfirmed: {
    backgroundColor: colors.success,
  },
  legendPending: {
    backgroundColor: colors.warning,
  },
  legendBlocked: {
    backgroundColor: colors.error,
  },
  legendLabel: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  hint: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    marginTop: 4,
  },
});

export default HostCalendarGrid;
