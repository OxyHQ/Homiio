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
 * caller passes `histogram` from `useSearchPriceHistogram` — the distribution of
 * the SEARCH's own scope, offering and filters, bucketed over this track — and
 * omits it while loading or when nothing in scope is priced. There is no
 * app-wide fallback: `/analytics/stats` buckets are worldwide monthly rent, and
 * drawing them under a Barcelona nightly search would present a worldwide
 * picture as a local one.
 *
 * ## The currency is the SCOPE's, and it is stated
 *
 * One distribution holds one currency (ADR 0004 §6.5), and which one is a fact
 * about the area rather than about the app — a London search is in GBP. So the
 * bars and the thumb labels are formatted in the currency the histogram came
 * back in, and {@link PriceHistogramNote} names it under the control. Until the
 * answer arrives there is nothing local to state, so the labels fall back to
 * {@link SEARCH_PRICE_CURRENCY}.
 */
import React, { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { PriceRangeFilter } from '@oxy.so/bloom/stay-filters';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { OfferingType, formatMoney } from '@homiio/shared-types';

import { SEARCH_PRICE_CURRENCY } from '@/components/search/types';
import type { SearchPriceHistogram } from '@/hooks/useSearchPriceHistogram';
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

/**
 * How the range fields show a price: the top of the track is open-ended
 * ("€5,000+").
 *
 * `currency` is the scope's, from the histogram, and defaults to
 * {@link SEARCH_PRICE_CURRENCY} for the callers that have no scope answer to go
 * on (a saved-search row, the room filters) and for the moments before one
 * arrives.
 */
export function usePriceFormatter(
  track: PriceTrack,
  currency: string = SEARCH_PRICE_CURRENCY,
): (price: number) => string {
  const { locale } = useFormatting();
  return useCallback(
    (price: number) => {
      const text = formatMoney(price, currency, locale, { maximumFractionDigits: 0 });
      return price >= track.max ? `${text}+` : text;
    },
    [currency, locale, track.max],
  );
}

/**
 * What the bars are in, and what they leave out.
 *
 * Both lines are load-bearing rather than decorative: the first is the only
 * place the reader learns that a track labelled `1,200` is 1,200 zł, and the
 * second is the honest remainder — listings the area really holds that this
 * distribution cannot count without mixing currencies. Converting them at a
 * rate we do not have and cannot version is exactly what ADR 0004 §6.5 forbids.
 */
export const PriceHistogramNote: React.FC<{ histogram?: SearchPriceHistogram }> = ({ histogram }) => {
  const { t } = useTranslation();
  const colors = useColors();
  if (!histogram) return null;
  return (
    <View style={styles.note}>
      <BloomText style={[styles.noteText, { color: colors.textSecondary }]}>
        {t('search.step.price.inCurrency', { currency: histogram.currency })}
      </BloomText>
      {histogram.otherCurrencyCount > 0 ? (
        <BloomText style={[styles.noteText, { color: colors.textSecondary }]}>
          {t('search.step.price.otherCurrency', { count: histogram.otherCurrencyCount })}
        </BloomText>
      ) : null}
    </View>
  );
};

interface PriceStepProps {
  offering: OfferingType;
  priceMin?: number;
  priceMax?: number;
  /** The scope's distribution over `0`..`track.max`; omit to draw no bars. */
  histogram?: SearchPriceHistogram;
  onChange: (min: number | undefined, max: number | undefined) => void;
}

export const PriceStep: React.FC<PriceStepProps> = ({ offering, priceMin, priceMax, histogram, onChange }) => {
  const { t } = useTranslation();
  const colors = useColors();
  const track = priceTrackFor(offering);
  const formatPrice = usePriceFormatter(track, histogram?.currency);
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
        buckets={histogram?.counts}
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
      <PriceHistogramNote histogram={histogram} />
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
  note: {
    gap: spacing.xs,
  },
  noteText: {
    fontSize: 12,
  },
});

export default PriceStep;
