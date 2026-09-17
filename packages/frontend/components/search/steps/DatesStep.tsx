/**
 * DatesStep — vacation-only check-in/check-out range picker, on Bloom's
 * `RangeCalendar` (`@oxy.so/bloom/date-picker`).
 *
 * Bloom owns the grid, paging and the two-press range. This step only maps the
 * search draft's civil `YYYY-MM-DD` strings to and from local-midnight `Date`s
 * and disables past days. Long-term searches never mount this step (the panel
 * omits it), so there is no calendar in long-term mode by design.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { RangeCalendar, type DateRange } from '@oxy.so/bloom/date-picker';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
import { getFormatLocale } from '@/utils/dateLocale';
import type { SearchDateRange } from '../types';

/** Format a Date as a local `YYYY-MM-DD` ISO date (no timezone shift). */
function toIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Parse a civil `YYYY-MM-DD` into a local-midnight Date, or null. */
function fromIso(iso: string | undefined): Date | null {
  const match = iso ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso) : null;
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
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
  const { t, i18n } = useTranslation();
  const [today] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });

  const selected = useMemo<DateRange | null>(() => {
    const start = fromIso(value?.start);
    const end = fromIso(value?.end);
    return start && end ? { start, end } : null;
  }, [value?.start, value?.end]);

  const handleChange = useCallback(
    ({ start, end }: DateRange) => {
      // A stay needs at least one night: the same day twice clears the range.
      if (toIso(start) === toIso(end)) {
        onChange(undefined);
        return;
      }
      onChange({ start: toIso(start), end: toIso(end) });
    },
    [onChange],
  );

  return (
    <View style={styles.container}>
      {compact ? null : (
        <BloomText style={styles.heading}>{t('search.step.dates.title')}</BloomText>
      )}
      <View style={styles.calendar}>
        <RangeCalendar
          value={selected}
          onChange={handleChange}
          minDate={today}
          weekStartsOn={1}
          locale={getFormatLocale(i18n.language)}
          accessibilityLabel={t('search.step.dates.title')}
        />
      </View>
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
  calendar: {
    alignItems: 'center',
  },
});

export default DatesStep;
