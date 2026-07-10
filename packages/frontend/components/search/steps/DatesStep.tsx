/**
 * DatesStep — vacation-only check-in/check-out range picker.
 *
 * A compact two-month calendar (current + next month) rendered from derived
 * state — no `useEffect`. Tapping a day sets the start; tapping a later day
 * sets the end; tapping again restarts the range. Long-term searches never
 * mount this step (the panel omits it), so there is no calendar in long-term
 * mode by design.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import type { SearchDateRange } from '../types';

const DAYS_IN_WEEK = 7;
const MONTHS_SHOWN = 2;
const WEEKDAY_KEYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;

/** A single rendered calendar cell. `null` pads the leading week. */
interface DayCell {
  iso: string;
  day: number;
}

/** Format a Date as a local `YYYY-MM-DD` ISO date (no timezone shift). */
function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Build the (Monday-first) day cells for a given month, padded with leading blanks. */
function buildMonth(year: number, month: number): (DayCell | null)[] {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // JS getDay(): 0=Sun..6=Sat. Convert to Monday-first index (0=Mon..6=Sun).
  const leading = (first.getDay() + 6) % DAYS_IN_WEEK;
  const cells: (DayCell | null)[] = [];
  for (let i = 0; i < leading; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ iso: toIso(new Date(year, month, day)), day });
  }
  return cells;
}

interface DatesStepProps {
  value?: SearchDateRange;
  onChange: (range: SearchDateRange | undefined) => void;
  /**
   * Compact mode for the wide centered dialog: the dialog header already names
   * the step ("When"), so the step's internal heading is suppressed. The narrow
   * sheet leaves this `false` and keeps the per-step heading.
   */
  compact?: boolean;
}

export const DatesStep: React.FC<DatesStepProps> = ({ value, onChange, compact = false }) => {
  const { t } = useTranslation();
  // Anchor the visible window on today; this is derived once on mount and never
  // needs to react to props, so plain useState (no effect) is correct.
  const [anchor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth(), todayIso: toIso(now) };
  });

  const months = useMemo(() => {
    return Array.from({ length: MONTHS_SHOWN }, (_, offset) => {
      const date = new Date(anchor.year, anchor.month + offset, 1);
      return {
        year: date.getFullYear(),
        month: date.getMonth(),
        cells: buildMonth(date.getFullYear(), date.getMonth()),
      };
    });
  }, [anchor]);

  const monthFormatter = useMemo(
    () => new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }),
    [],
  );

  const handlePress = useCallback(
    (iso: string) => {
      // No selection yet, or a complete range exists → start a new range.
      if (!value || (value.start && value.end)) {
        onChange({ start: iso, end: '' });
        return;
      }
      // A start exists but no end.
      if (iso < value.start) {
        onChange({ start: iso, end: '' });
        return;
      }
      if (iso === value.start) {
        onChange(undefined);
        return;
      }
      onChange({ start: value.start, end: iso });
    },
    [value, onChange],
  );

  const isInRange = useCallback(
    (iso: string): boolean => {
      if (!value?.start || !value?.end) return false;
      return iso > value.start && iso < value.end;
    },
    [value],
  );

  return (
    <View style={styles.container}>
      {compact ? null : (
        <BloomText style={styles.heading}>
          {t('search.step.dates.title')}
        </BloomText>
      )}

      <View style={styles.weekdays}>
        {WEEKDAY_KEYS.map((key) => (
          <BloomText key={key} style={styles.weekday}>
            {t(`search.step.dates.weekday.${key}`)}
          </BloomText>
        ))}
      </View>

      {months.map((m) => (
        <View key={`${m.year}-${m.month}`} style={styles.month}>
          <BloomText style={styles.monthLabel}>
            {monthFormatter.format(new Date(m.year, m.month, 1))}
          </BloomText>
          <View style={styles.grid}>
            {m.cells.map((cell, index) => {
              if (!cell) {
                return <View key={`pad-${m.month}-${index}`} style={styles.cell} />;
              }
              const isPast = cell.iso < anchor.todayIso;
              const isStart = value?.start === cell.iso;
              const isEnd = value?.end === cell.iso;
              const inRange = isInRange(cell.iso);
              const isEndpoint = isStart || isEnd;
              return (
                <Pressable
                  key={cell.iso}
                  disabled={isPast}
                  onPress={() => handlePress(cell.iso)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isEndpoint, disabled: isPast }}
                  accessibilityLabel={cell.iso}
                  style={[
                    styles.cell,
                    inRange ? styles.cellInRange : null,
                    isEndpoint ? styles.cellEndpoint : null,
                  ]}
                >
                  <BloomText
                    style={[
                      styles.cellText,
                      isPast ? styles.cellTextDisabled : null,
                      isEndpoint ? styles.cellTextEndpoint : null,
                    ]}
                  >
                    {cell.day}
                  </BloomText>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  weekdays: {
    flexDirection: 'row',
  },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  month: {
    gap: spacing.sm,
  },
  monthLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  cell: {
    width: `${100 / DAYS_IN_WEEK}%`,
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellInRange: {
    backgroundColor: colors.primaryLight_1,
  },
  cellEndpoint: {
    backgroundColor: colors.primaryColor,
    borderRadius: radius.pill,
  },
  cellText: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
  cellTextDisabled: {
    color: colors.COLOR_BLACK_LIGHT_5,
  },
  cellTextEndpoint: {
    color: colors.primaryForeground,
    fontWeight: '700',
  },
});

export default DatesStep;
