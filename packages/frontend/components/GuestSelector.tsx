/**
 * GuestSelector — adults / children / infants steppers for a short-stay booking.
 *
 * Each counter is a Bloom `Item` row (title + age band) with icon-only Bloom
 * `Button` steppers in its trailing slot. Adults and children share the host's
 * `maxGuests` capacity; infants never count toward it.
 */
import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@oxy.so/bloom/button';
import { Divider } from '@oxy.so/bloom/divider';
import { RiAddLine } from '@oxy.so/bloom/icons';
import { Item } from '@oxy.so/bloom/item';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text as BloomText, H3 } from '@oxy.so/bloom/typography';

export interface GuestCounts {
  adults: number;
  children: number;
  infants: number;
}

export interface GuestSelectorProps {
  /** Current value (controlled). */
  value: GuestCounts;
  /** Maximum total of adults + children (host-defined `maxGuests`). Infants do not count. */
  maxGuests?: number;
  /** Minimum adults (default 1). */
  minAdults?: number;
  /** Maximum infants regardless of `maxGuests` (default 5). */
  maxInfants?: number;
  /** Show the "X guests · Y infants" summary header. */
  showHeader?: boolean;
  onChange: (next: GuestCounts) => void;
}

interface CounterRowProps {
  title: string;
  subtitle?: string;
  value: number;
  min: number;
  max: number;
  onChange: (next: number) => void;
}

/** Remix ships no plain "subtract" line glyph; this draws one at the icon box. */
const MinusIcon: React.FC<{ width?: number; height?: number; fill?: string }> = ({
  width = 16,
  fill,
}) => (
  <View style={[styles.minusBox, { width, height: width }]}>
    <View style={[styles.minusBar, { width: width * 0.7, backgroundColor: fill }]} />
  </View>
);

const CounterRow: React.FC<CounterRowProps> = ({
  title,
  subtitle,
  value,
  min,
  max,
  onChange,
}) => {
  const { t } = useTranslation();
  const decrement = useCallback(() => {
    if (value > min) onChange(value - 1);
  }, [value, min, onChange]);
  const increment = useCallback(() => {
    if (value < max) onChange(value + 1);
  }, [value, max, onChange]);

  return (
    <Item
      title={title}
      subtitle={subtitle}
      trailing={
        <View style={styles.rowControls}>
          <Button
            variant="secondary"
            size="small"
            iconOnly
            leadingIcon={MinusIcon}
            onPress={decrement}
            disabled={value <= min}
            accessibilityLabel={t('booking.guests.decrease', 'Decrease {{title}}', { title })}
          />
          <BloomText style={styles.rowValue} accessibilityLiveRegion="polite">
            {value}
          </BloomText>
          <Button
            variant="secondary"
            size="small"
            iconOnly
            leadingIcon={RiAddLine}
            onPress={increment}
            disabled={value >= max}
            accessibilityLabel={t('booking.guests.increase', 'Increase {{title}}', { title })}
          />
        </View>
      }
    />
  );
};

export const GuestSelector: React.FC<GuestSelectorProps> = ({
  value,
  maxGuests,
  minAdults = 1,
  maxInfants = 5,
  showHeader = false,
  onChange,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const billableTotal = value.adults + value.children;
  const cap = maxGuests ?? 16;
  // Capacity left for adults + children combined
  const remainingCapacity = cap - billableTotal;
  const adultMax = value.adults + Math.max(remainingCapacity, 0);
  const childMax = value.children + Math.max(remainingCapacity, 0);

  const summary = useMemo(() => formatGuestSummary(t, value, ' · '), [t, value]);

  const update = useCallback(
    (patch: Partial<GuestCounts>) => {
      onChange({ ...value, ...patch });
    },
    [onChange, value],
  );

  return (
    <View style={styles.container}>
      {showHeader ? (
        <View style={styles.headerBlock}>
          <H3 style={styles.headerTitle}>{t('search.filters.guests')}</H3>
          <BloomText style={[styles.headerSubtitle, { color: theme.colors.textSecondary }]}>
            {summary}
          </BloomText>
        </View>
      ) : null}
      <CounterRow
        title={t('booking.guests.adults', 'Adults')}
        subtitle={t('booking.guests.adultsHint', 'Ages 13 or above')}
        value={value.adults}
        min={minAdults}
        max={Math.max(adultMax, value.adults)}
        onChange={(next) => update({ adults: next })}
      />
      <Divider />
      <CounterRow
        title={t('booking.guests.children', 'Children')}
        subtitle={t('booking.guests.childrenHint', 'Ages 2-12')}
        value={value.children}
        min={0}
        max={Math.max(childMax, value.children)}
        onChange={(next) => update({ children: next })}
      />
      <Divider />
      <CounterRow
        title={t('booking.guests.infants', 'Infants')}
        subtitle={t('booking.guests.infantsHint', 'Under 2')}
        value={value.infants}
        min={0}
        max={maxInfants}
        onChange={(next) => update({ infants: next })}
      />
      {maxGuests ? (
        <BloomText style={[styles.footnote, { color: theme.colors.textSecondary }]}>
          {t(
            'booking.guests.maxNote',
            'This place has a maximum of {{count}} guests, not including infants.',
            { count: maxGuests },
          )}
        </BloomText>
      ) : null}
    </View>
  );
};

type TFn = ReturnType<typeof useTranslation>['t'];

/** "2 guests, 1 infant" — shared by the selector header and the booking trigger. */
export function formatGuestSummary(t: TFn, counts: GuestCounts, separator = ', '): string {
  const billable = counts.adults + counts.children;
  const guests = t('booking.guests.count', {
    count: billable,
    defaultValue_one: '{{count}} guest',
    defaultValue_other: '{{count}} guests',
  });
  if (counts.infants === 0) return guests;
  const infants = t('booking.guests.infantCount', {
    count: counts.infants,
    defaultValue_one: '{{count}} infant',
    defaultValue_other: '{{count}} infants',
  });
  return `${guests}${separator}${infants}`;
}

const styles = StyleSheet.create({
  container: {
    gap: 4,
  },
  headerBlock: {
    marginBottom: 12,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  rowControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowValue: {
    minWidth: 24,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
  },
  minusBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  minusBar: {
    height: 2,
    borderRadius: 1,
  },
  footnote: {
    fontSize: 12,
    marginTop: 12,
  },
});

export default GuestSelector;
