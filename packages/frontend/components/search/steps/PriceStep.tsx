/**
 * PriceStep — price range selector for the search panel.
 *
 * Offers mode-aware quick-pick range chips (monthly for long-term, nightly for
 * vacation) plus explicit Min/Max numeric inputs. Either bound may be left
 * blank to mean "no limit". Reports the resolved `(min, max)` pair upward.
 */
import React, { useCallback, useMemo } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Chip } from '@oxyhq/bloom/chip';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { OfferingType } from '@homiio/shared-types';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

/** A quick-pick price band. `max: null` means "and up". */
interface PriceBand {
  min: number;
  max: number | null;
}

/** Monthly bands for long-term browsing. */
const LONG_TERM_BANDS: readonly PriceBand[] = [
  { min: 0, max: 800 },
  { min: 800, max: 1200 },
  { min: 1200, max: 2000 },
  { min: 2000, max: null },
] as const;

/** Nightly bands for vacation browsing. */
const VACATION_BANDS: readonly PriceBand[] = [
  { min: 0, max: 80 },
  { min: 80, max: 150 },
  { min: 150, max: 300 },
  { min: 300, max: null },
] as const;

/** Format a band into a human label given the active currency symbol. */
function bandLabel(band: PriceBand, symbol: string): string {
  if (band.min === 0 && band.max !== null) return `${symbol}0–${symbol}${band.max}`;
  if (band.max === null) return `${symbol}${band.min}+`;
  return `${symbol}${band.min}–${symbol}${band.max}`;
}

/** Parse a free-text numeric input into a positive integer or undefined. */
function parsePrice(text: string): number | undefined {
  const digits = text.replace(/[^\d]/g, '');
  if (!digits) return undefined;
  const value = Number.parseInt(digits, 10);
  return Number.isFinite(value) ? value : undefined;
}

interface PriceStepProps {
  offering: OfferingType;
  priceMin?: number;
  priceMax?: number;
  onChange: (min: number | undefined, max: number | undefined) => void;
  /** Currency symbol to render. Defaults to the euro sign used app-wide. */
  currencySymbol?: string;
  /**
   * Compact mode for the wide centered dialog: the dialog header already names
   * the step ("Price range"), so the step's internal heading is suppressed and
   * the inter-element gap tightens. The narrow sheet leaves this `false`.
   */
  compact?: boolean;
}

export const PriceStep: React.FC<PriceStepProps> = ({
  offering,
  priceMin,
  priceMax,
  onChange,
  currencySymbol = '€',
  compact = false,
}) => {
  const { t } = useTranslation();
  const isVacation = offering === OfferingType.SHORT_TERM_RENT;
  const bands = isVacation ? VACATION_BANDS : LONG_TERM_BANDS;

  const activeBandIndex = useMemo(
    () =>
      bands.findIndex(
        (b) => b.min === (priceMin ?? 0) && (b.max ?? undefined) === priceMax,
      ),
    [bands, priceMin, priceMax],
  );

  const handleBand = useCallback(
    (band: PriceBand) => {
      onChange(band.min === 0 ? undefined : band.min, band.max ?? undefined);
    },
    [onChange],
  );

  const handleMinChange = useCallback(
    (text: string) => onChange(parsePrice(text), priceMax),
    [onChange, priceMax],
  );

  const handleMaxChange = useCallback(
    (text: string) => onChange(priceMin, parsePrice(text)),
    [onChange, priceMin],
  );

  const unitLabel = isVacation
    ? t('search.step.price.perNight')
    : t('search.step.price.perMonth');

  return (
    <View style={compact ? styles.containerCompact : styles.container}>
      {compact ? (
        // The dialog header already says "Price range"; keep only the unit
        // hint (per month / per night), which the header does not convey.
        <BloomText style={styles.unitStandalone}>{`(${unitLabel})`}</BloomText>
      ) : (
        <BloomText style={styles.heading}>
          {t('search.step.price.title')}{' '}
          <BloomText style={styles.unit}>({unitLabel})</BloomText>
        </BloomText>
      )}

      <View style={styles.chips}>
        {bands.map((band, index) => {
          const label = bandLabel(band, currencySymbol);
          const isSelected = index === activeBandIndex;
          return (
            <Chip
              key={label}
              variant={isSelected ? 'solid' : 'outlined'}
              color={isSelected ? 'primary' : 'default'}
              size="large"
              selected={isSelected}
              onPress={() => handleBand(band)}
              accessibilityLabel={label}
            >
              {label}
            </Chip>
          );
        })}
      </View>

      <View style={styles.inputs}>
        <View style={styles.inputGroup}>
          <BloomText style={styles.inputLabel}>
            {t('search.step.price.min')}
          </BloomText>
          <TextInput
            style={styles.input}
            value={priceMin !== undefined ? String(priceMin) : ''}
            onChangeText={handleMinChange}
            keyboardType="number-pad"
            inputMode="numeric"
            placeholder={`${currencySymbol}0`}
            placeholderTextColor={colors.COLOR_BLACK_LIGHT_5}
            accessibilityLabel={t('search.step.price.min')}
          />
        </View>
        <View style={styles.separator} />
        <View style={styles.inputGroup}>
          <BloomText style={styles.inputLabel}>
            {t('search.step.price.max')}
          </BloomText>
          <TextInput
            style={styles.input}
            value={priceMax !== undefined ? String(priceMax) : ''}
            onChangeText={handleMaxChange}
            keyboardType="number-pad"
            inputMode="numeric"
            placeholder={t('search.step.price.any')}
            placeholderTextColor={colors.COLOR_BLACK_LIGHT_5}
            accessibilityLabel={t('search.step.price.max')}
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  // Compact drops the large heading for a slim unit hint, so the gap between
  // that hint, the chips, and the inputs stays tight in the centered dialog.
  containerCompact: {
    gap: spacing.md,
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  unit: {
    fontSize: 14,
    fontWeight: '400',
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  unitStandalone: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  inputs: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.md,
  },
  inputGroup: {
    flex: 1,
    gap: spacing.xs,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 16,
    color: colors.COLOR_BLACK,
    backgroundColor: colors.surfaceElevated,
  },
  separator: {
    width: spacing.lg,
    height: 1,
    backgroundColor: colors.border,
    marginBottom: spacing.xl,
  },
});

export default PriceStep;
