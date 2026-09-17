/**
 * PriceStep — the price range for a search, on Bloom's `PriceRangeFilter`.
 *
 * The unit is fixed per offering (monthly rent, nightly rate, sale price) and
 * is stated under the control, never reinterpreted. A thumb resting on its end
 * of the track means "no limit" on that side, so both bounds can be left open.
 *
 * ## The histogram
 *
 * `PriceRangeFilter` draws listing counts per price bucket when given them. The
 * caller passes `buckets` from `useSearchPriceHistogram` — the distribution of
 * the SEARCH's own scope, offering and filters, bucketed over this track — and
 * omits them while loading or when nothing in scope is priced. There is no
 * app-wide fallback: `/analytics/stats` buckets are worldwide monthly rent, and
 * drawing them under a Barcelona nightly search would present a worldwide
 * picture as a local one.
 */
import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PriceRangeFilter } from '@oxy.so/bloom/stay-filters';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { OfferingType, formatMoney } from '@homiio/shared-types';

import { SEARCH_PRICE_CURRENCY } from '@/components/search/types';
import { useFormatting } from '@/utils/format';
import { useColors } from '@/hooks/useThemeColor';
import { spacing } from '@/constants/styles';

/** A slider track: its top is "no maximum", and `step` is its granularity. */
export interface PriceTrack {
  max: number;
  step: number;
}

const LONG_TERM_TRACK: PriceTrack = { max: 5000, step: 50 };
const VACATION_TRACK: PriceTrack = { max: 1000, step: 10 };
const SALE_TRACK: PriceTrack = { max: 2000000, step: 10000 };

/** The track for an offering's price unit. */
export function priceTrackFor(offering: OfferingType): PriceTrack {
  if (offering === OfferingType.SHORT_TERM_RENT) return VACATION_TRACK;
  if (offering === OfferingType.SALE) return SALE_TRACK;
  return LONG_TERM_TRACK;
}

/** The i18n key naming the unit a price is in, or `null` for a sale price. */
export function priceUnitKey(offering: OfferingType): string | null {
  if (offering === OfferingType.SHORT_TERM_RENT) return 'search.step.price.perNight';
  if (offering === OfferingType.SALE) return null;
  return 'search.step.price.perMonth';
}

/** The slider position for a pair of optional bounds. */
export function priceRangeValue(
  priceMin: number | undefined,
  priceMax: number | undefined,
  track: PriceTrack,
): [number, number] {
  // A bound beyond the track (a saved search from a wider range) is pinned to
  // the end rather than lost.
  const lo = Math.min(priceMin ?? 0, track.max);
  const hi = priceMax === undefined ? track.max : Math.min(priceMax, track.max);
  return [lo, Math.max(lo, hi)];
}

/** The optional bounds a slider position means: an end of the track is no bound. */
export function priceBounds(
  [lo, hi]: [number, number],
  track: PriceTrack,
): { priceMin: number | undefined; priceMax: number | undefined } {
  return {
    priceMin: lo <= 0 ? undefined : lo,
    priceMax: hi >= track.max ? undefined : hi,
  };
}

/** How the range fields show a price: the top of the track is open-ended ("€5,000+"). */
export function usePriceFormatter(track: PriceTrack): (price: number) => string {
  const { locale } = useFormatting();
  return useCallback(
    (price: number) => {
      const text = formatMoney(price, SEARCH_PRICE_CURRENCY, locale, { maximumFractionDigits: 0 });
      return price >= track.max ? `${text}+` : text;
    },
    [locale, track.max],
  );
}

interface PriceStepProps {
  offering: OfferingType;
  priceMin?: number;
  priceMax?: number;
  /** Listing counts per bucket over `0`..`track.max`; omit to draw no bars. */
  buckets?: number[];
  onChange: (min: number | undefined, max: number | undefined) => void;
}

export const PriceStep: React.FC<PriceStepProps> = ({ offering, priceMin, priceMax, buckets, onChange }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const track = priceTrackFor(offering);
  const formatPrice = usePriceFormatter(track);
  const unitKey = priceUnitKey(offering);

  const value = useMemo(() => priceRangeValue(priceMin, priceMax, track), [priceMin, priceMax, track]);

  const handleChange = useCallback(
    (next: [number, number]) => {
      const bounds = priceBounds(next, track);
      onChange(bounds.priceMin, bounds.priceMax);
    },
    [onChange, track],
  );

  return (
    <View style={styles.container}>
      {unitKey ? (
        <BloomText style={[styles.unit, { color: colors.textSecondary }]}>{t(unitKey)}</BloomText>
      ) : null}
      <PriceRangeFilter
        buckets={buckets}
        min={0}
        max={track.max}
        step={track.step}
        value={value}
        onValueChange={handleChange}
        formatPrice={formatPrice}
        minLabel={t('search.step.price.min')}
        maxLabel={t('search.step.price.max')}
        accessibilityLabel={t('search.step.price.title')}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  unit: {
    fontSize: 14,
  },
});

export default PriceStep;
