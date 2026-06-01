import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { colors } from '@/styles/colors';
import { formatCurrency } from '@/utils/currency';

/** A price breakdown always shows cents, so fix precision at 2 fraction digits. */
const MONEY_FORMAT: { minimumFractionDigits: number; maximumFractionDigits: number } = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

export interface PriceBreakdownProps {
  nights: number;
  nightlyRate: number;
  cleaningFee?: number;
  serviceFee?: number;
  /** Percentage 0-100. Applied to (nightly * nights + cleaningFee + serviceFee). */
  taxesPercent?: number;
  currency: string;
  /** Style override for the wrapper. */
  compact?: boolean;
}

interface LineProps {
  label: string;
  amount: number;
  currency: string;
  emphasis?: boolean;
}

const Line: React.FC<LineProps> = ({ label, amount, currency, emphasis }) => (
  <View style={styles.line}>
    <BloomText
      style={[styles.lineLabel, emphasis ? styles.lineLabelEmphasis : null]}
    >
      {label}
    </BloomText>
    <BloomText
      style={[styles.lineAmount, emphasis ? styles.lineAmountEmphasis : null]}
    >
      {formatCurrency(amount, currency, MONEY_FORMAT)}
    </BloomText>
  </View>
);

export const PriceBreakdown: React.FC<PriceBreakdownProps> = ({
  nights,
  nightlyRate,
  cleaningFee = 0,
  serviceFee = 0,
  taxesPercent = 0,
  currency,
  compact = false,
}) => {
  const breakdown = useMemo(() => {
    const safeNights = Math.max(0, Math.floor(nights));
    const safeRate = Math.max(0, nightlyRate);
    const subtotal = safeNights * safeRate;
    const cleaning = Math.max(0, cleaningFee);
    const service = Math.max(0, serviceFee);
    const taxableBase = subtotal + cleaning + service;
    const taxes =
      Math.round(taxableBase * (Math.max(0, taxesPercent) / 100) * 100) / 100;
    const total = Math.round((taxableBase + taxes) * 100) / 100;
    return {
      safeNights,
      safeRate,
      subtotal,
      cleaning,
      service,
      taxes,
      total,
    };
  }, [nights, nightlyRate, cleaningFee, serviceFee, taxesPercent]);

  if (breakdown.safeNights === 0) {
    return (
      <View style={[styles.container, compact ? styles.containerCompact : null]}>
        <BloomText style={styles.emptyHint}>
          Select dates to see the total price.
        </BloomText>
      </View>
    );
  }

  return (
    <View style={[styles.container, compact ? styles.containerCompact : null]}>
      <Line
        label={`${formatCurrency(breakdown.safeRate, currency, MONEY_FORMAT)} × ${breakdown.safeNights} ${
          breakdown.safeNights === 1 ? 'night' : 'nights'
        }`}
        amount={breakdown.subtotal}
        currency={currency}
      />
      {breakdown.cleaning > 0 ? (
        <Line label="Cleaning fee" amount={breakdown.cleaning} currency={currency} />
      ) : null}
      {breakdown.service > 0 ? (
        <Line label="Service fee" amount={breakdown.service} currency={currency} />
      ) : null}
      {breakdown.taxes > 0 ? (
        <Line label="Taxes" amount={breakdown.taxes} currency={currency} />
      ) : null}
      <View style={styles.separator} />
      <Line
        label="Total"
        amount={breakdown.total}
        currency={currency}
        emphasis
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  containerCompact: {
    padding: 12,
  },
  emptyHint: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_4,
    textAlign: 'center',
  },
  line: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  lineLabel: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_2,
    flexShrink: 1,
    paddingRight: 8,
  },
  lineLabelEmphasis: {
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  lineAmount: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_2,
    fontVariant: ['tabular-nums'],
  },
  lineAmountEmphasis: {
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    fontSize: 16,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.COLOR_BLACK_LIGHT_6,
    marginVertical: 4,
  },
});

export default PriceBreakdown;
