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

import { PriceRangeFilter, SegmentedFilter } from '@oxy.so/bloom/stay-filters';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { OfferingType, formatMoney, type ListingCurrency } from '@homiio/shared-types';

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

/**
 * The optional bounds a slider position means: an end of the track is no bound.
 *
 * The CURRENCY comes back with them, because a bound and its unit are one
 * answer and splitting them across two calls is how they came to disagree. The
 * caller passes the currency the bars were counted in — the scope's own, from
 * the histogram — so the range the user set is filtered in the currency they
 * were looking at while they set it.
 *
 * A slider pushed to both ends is no filter, so it carries no unit either:
 * shipping a lone `priceCurrency` would narrow a search to one market on behalf
 * of somebody who had just cleared the price.
 */
export function priceBounds(
  [lo, hi]: [number, number],
  track: PriceTrack,
  currency: ListingCurrency | undefined,
): {
  priceMin: number | undefined;
  priceMax: number | undefined;
  priceCurrency: ListingCurrency | undefined;
} {
  const priceMin = lo <= 0 ? undefined : lo;
  const priceMax = hi >= track.max ? undefined : hi;
  return {
    priceMin,
    priceMax,
    priceCurrency: priceMin === undefined && priceMax === undefined ? undefined : currency,
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

/**
 * Which currency the bound is read in, when the area is priced in more than one.
 *
 * The filter narrows to ONE currency and never converts — there is no rate
 * Homiio can cite or version, and an invented one is an invented price (ADR
 * 0004). So in a market priced in two, a searcher offered only the dominant one
 * cannot reach the other half at all. The note above already says how many were
 * left out; this is what lets them do something about it.
 *
 * Drawn ONLY when there is a choice. A switch with one option in it would
 * appear on every search and mean nothing on almost all of them.
 */
export const PriceCurrencyChoice: React.FC<{
  histogram?: SearchPriceHistogram;
  onChange: (currency: ListingCurrency) => void;
}> = ({ histogram, onChange }) => {
  const { t } = useTranslation();
  if (!histogram || histogram.currencies.length < 2) return null;
  return (
    <SegmentedFilter
      options={histogram.currencies.map((currency) => ({ value: currency, label: currency }))}
      value={histogram.currency}
      onValueChange={(value) => onChange(value as ListingCurrency)}
      accessibilityLabel={t('search.step.price.currencyChoice')}
    />
  );
};

interface PriceStepProps {
  offering: OfferingType;
  priceMin?: number;
  priceMax?: number;
  /** The scope's distribution over `0`..`track.max`; omit to draw no bars. */
  histogram?: SearchPriceHistogram;
  onChange: (
    min: number | undefined,
    max: number | undefined,
    currency: ListingCurrency | undefined,
  ) => void;
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
      // The unit the bars in front of the user are counted in. Until the
      // histogram answers there is none, and `undefined` is sent as itself —
      // the server then resolves it from the scope rather than the client
      // guessing euros and filtering a złoty market away.
      const bounds = priceBounds(next, track, histogram?.currency);
      onChange(bounds.priceMin, bounds.priceMax, bounds.priceCurrency);
    },
    [histogram?.currency, onChange, track],
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
      <PriceCurrencyChoice
        histogram={histogram}
        // Switching the currency re-reads the same bound in a different unit —
        // "up to 1,200" becomes "up to 1,200 złoty" — rather than converting
        // it, which is the one thing this contract will not do.
        onChange={(currency) => onChange(priceMin, priceMax, currency)}
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
