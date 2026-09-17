/**
 * PriceStep — price range selector for the search panel.
 *
 * Offers mode-aware quick-pick range chips (monthly for long-term, nightly for
 * vacation, a sale price when buying) plus a Bloom `RangeSlider` for any other
 * range. A thumb resting on its end of the track means "no limit" on that side,
 * so both bounds can be left open. Reports the resolved `(min, max)` pair upward.
 */
import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Chip } from '@oxy.so/bloom/chip';
import { RangeSlider } from '@oxy.so/bloom/slider';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { OfferingType, formatMoney, formatMoneyRange } from '@homiio/shared-types';
import type { TFunction } from 'i18next';

import { SEARCH_PRICE_CURRENCY } from '@/components/search/types';
import { useFormatting } from '@/utils/format';
import { useColors } from '@/hooks/useThemeColor';
import { spacing } from '@/constants/styles';

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

/** Sale prices, for the buy mode. */
const SALE_BANDS: readonly PriceBand[] = [
  { min: 0, max: 150000 },
  { min: 150000, max: 300000 },
  { min: 300000, max: 600000 },
  { min: 600000, max: null },
] as const;

/** A slider track: its top is "no maximum", and `step` is its granularity. */
interface PriceTrack {
  max: number;
  step: number;
}

const LONG_TERM_TRACK: PriceTrack = { max: 5000, step: 50 };
const VACATION_TRACK: PriceTrack = { max: 1000, step: 10 };
const SALE_TRACK: PriceTrack = { max: 2000000, step: 10000 };

/**
 * Format a band into a human label.
 *
 * Both bounds go through the shared formatter in {@link SEARCH_PRICE_CURRENCY},
 * so the chips read `0 €–800 €` for a Spanish reader instead of `€0–€800`. The
 * open-ended band takes its `+` from the locale file rather than from a literal
 * here — several languages phrase "and up" as a word, not a sign.
 */
function bandLabel(band: PriceBand, locale: string, t: TFunction): string {
  const money = (amount: number): string =>
    formatMoney(amount, SEARCH_PRICE_CURRENCY, locale, { maximumFractionDigits: 0 });
  if (band.max === null) return t('format.range.from', { value: money(band.min) });
  return formatMoneyRange(band.min, band.max, SEARCH_PRICE_CURRENCY, locale, {
    maximumFractionDigits: 0,
  });
}

interface PriceStepProps {
  offering: OfferingType;
  priceMin?: number;
  priceMax?: number;
  onChange: (min: number | undefined, max: number | undefined) => void;
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
  compact = false,
}) => {
  const { t } = useTranslation();
  const { locale } = useFormatting();
  const colors = useColors();
  const isVacation = offering === OfferingType.SHORT_TERM_RENT;
  const isSale = offering === OfferingType.SALE;
  const bands = isVacation ? VACATION_BANDS : isSale ? SALE_BANDS : LONG_TERM_BANDS;
  const track = isVacation ? VACATION_TRACK : isSale ? SALE_TRACK : LONG_TERM_TRACK;

  const money = useCallback(
    (amount: number): string =>
      formatMoney(amount, SEARCH_PRICE_CURRENCY, locale, { maximumFractionDigits: 0 }),
    [locale],
  );

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

  // An unset bound sits at its end of the track; a bound beyond the track (a
  // saved search from a wider range) is pinned to the end rather than lost.
  const sliderValue = useMemo<[number, number]>(() => {
    const lo = Math.min(priceMin ?? 0, track.max);
    const hi = priceMax === undefined ? track.max : Math.min(priceMax, track.max);
    return [lo, Math.max(lo, hi)];
  }, [priceMin, priceMax, track.max]);

  const handleSlider = useCallback(
    ([lo, hi]: [number, number]) => {
      onChange(lo <= 0 ? undefined : lo, hi >= track.max ? undefined : hi);
    },
    [onChange, track.max],
  );

  const rangeSummary =
    priceMin !== undefined && priceMax !== undefined
      ? formatMoneyRange(priceMin, priceMax, SEARCH_PRICE_CURRENCY, locale, {
          maximumFractionDigits: 0,
        })
      : priceMin !== undefined
        ? t('format.range.from', { value: money(priceMin) })
        : priceMax !== undefined
          ? t('format.range.upTo', { value: money(priceMax) })
          : t('search.summary.anyPrice');

  const unitLabel = isVacation
    ? t('search.step.price.perNight')
    : isSale
      ? null
      : t('search.step.price.perMonth');

  return (
    <View style={compact ? styles.containerCompact : styles.container}>
      {compact ? (
        // The dialog header already says "Price range"; keep only the unit
        // hint (per month / per night), which the header does not convey.
        unitLabel ? (
          <BloomText style={[styles.unitStandalone, { color: colors.textSecondary }]}>
            {`(${unitLabel})`}
          </BloomText>
        ) : null
      ) : (
        <BloomText style={[styles.heading, { color: colors.text }]}>
          {t('search.step.price.title')}
          {unitLabel ? (
            <BloomText style={[styles.unit, { color: colors.textSecondary }]}> ({unitLabel})</BloomText>
          ) : null}
        </BloomText>
      )}

      <View style={styles.chips}>
        {bands.map((band, index) => {
          const label = bandLabel(band, locale, t);
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

      <View style={styles.sliderBlock}>
        <BloomText
          style={[styles.summary, { color: colors.text }]}
          accessibilityLiveRegion="polite"
        >
          {rangeSummary}
        </BloomText>
        <View style={styles.sliderTrack}>
          <RangeSlider
            value={sliderValue}
            min={0}
            max={track.max}
            step={track.step}
            onValueChange={handleSlider}
            formatValue={(value) => money(value)}
            thumbLabels={[t('search.step.price.min'), t('search.step.price.max')]}
            accessibilityLabel={t('search.step.price.title')}
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
  // that hint, the chips and the slider stays tight in the centered dialog.
  containerCompact: {
    gap: spacing.md,
  },
  heading: {
    fontSize: 18,
    fontWeight: '700',
  },
  unit: {
    fontSize: 14,
    fontWeight: '400',
  },
  unitStandalone: {
    fontSize: 13,
    fontWeight: '600',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  sliderBlock: {
    gap: spacing.sm,
  },
  // Half of each thumb's value bubble hangs past the track's ends; the inset
  // keeps it inside the dialog.
  sliderTrack: {
    paddingHorizontal: spacing.xl,
  },
  summary: {
    fontSize: 15,
    fontWeight: '600',
  },
});

export default PriceStep;
