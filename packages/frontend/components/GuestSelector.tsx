import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText, H3 } from '@oxyhq/bloom/typography';
import { colors } from '@/styles/colors';

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
  /** Show as a list of counter rows (compact card). */
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

const CounterRow: React.FC<CounterRowProps> = ({
  title,
  subtitle,
  value,
  min,
  max,
  onChange,
}) => {
  const decrement = useCallback(() => {
    if (value > min) onChange(value - 1);
  }, [value, min, onChange]);
  const increment = useCallback(() => {
    if (value < max) onChange(value + 1);
  }, [value, max, onChange]);

  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <BloomText style={styles.rowTitle}>{title}</BloomText>
        {subtitle ? (
          <BloomText style={styles.rowSubtitle}>{subtitle}</BloomText>
        ) : null}
      </View>
      <View style={styles.rowControls}>
        <Button
          variant="icon"
          size="small"
          onPress={decrement}
          disabled={value <= min}
          accessibilityLabel={`Decrease ${title}`}
        >
          {'−'}
        </Button>
        <BloomText style={styles.rowValue}>{value}</BloomText>
        <Button
          variant="icon"
          size="small"
          onPress={increment}
          disabled={value >= max}
          accessibilityLabel={`Increase ${title}`}
        >
          {'+'}
        </Button>
      </View>
    </View>
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
  const billableTotal = value.adults + value.children;
  const cap = maxGuests ?? 16;
  // Capacity left for adults + children combined
  const remainingCapacity = cap - billableTotal;
  const adultMax = value.adults + Math.max(remainingCapacity, 0);
  const childMax = value.children + Math.max(remainingCapacity, 0);

  const summary = useMemo(() => {
    const guestWord = billableTotal === 1 ? 'guest' : 'guests';
    const infantPart =
      value.infants > 0
        ? ` · ${value.infants} ${value.infants === 1 ? 'infant' : 'infants'}`
        : '';
    return `${billableTotal} ${guestWord}${infantPart}`;
  }, [billableTotal, value.infants]);

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
          <H3 style={styles.headerTitle}>Guests</H3>
          <BloomText style={styles.headerSubtitle}>{summary}</BloomText>
        </View>
      ) : null}
      <CounterRow
        title="Adults"
        subtitle="Ages 13 or above"
        value={value.adults}
        min={minAdults}
        max={Math.max(adultMax, value.adults)}
        onChange={(next) => update({ adults: next })}
      />
      <View style={styles.divider} />
      <CounterRow
        title="Children"
        subtitle="Ages 2-12"
        value={value.children}
        min={0}
        max={Math.max(childMax, value.children)}
        onChange={(next) => update({ children: next })}
      />
      <View style={styles.divider} />
      <CounterRow
        title="Infants"
        subtitle="Under 2"
        value={value.infants}
        min={0}
        max={maxInfants}
        onChange={(next) => update({ infants: next })}
      />
      {maxGuests ? (
        <BloomText style={styles.footnote}>
          This place has a maximum of {maxGuests} guests, not including infants.
        </BloomText>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 16,
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
    color: colors.COLOR_BLACK_LIGHT_3,
    marginTop: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  rowText: {
    flex: 1,
    paddingRight: 12,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  rowSubtitle: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
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
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.COLOR_BLACK_LIGHT_6,
  },
  footnote: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    marginTop: 12,
  },
});

export default GuestSelector;
