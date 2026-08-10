/**
 * The app's binding to the shared formatting module in `@homiio/shared-types`.
 *
 * The shared module is deliberately pure and translation-agnostic — it takes a
 * BCP-47 tag and, where a word is needed ("month", "square metres"), it takes
 * that word too. This file is the one place that answers both questions for
 * Homiio: which locale the reader chose, and what the unit words are in it.
 * Screens import from here rather than resolving either themselves.
 *
 * `t` is injected rather than read from the i18next singleton so these stay
 * usable from pure helpers (`resolveHeadlinePrice`, the map-marker builder) that
 * cannot call hooks — the same shape `resolvePrimaryOffering` already uses for
 * its `freeLabel`. {@link useFormatting} is the hook for components.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import {
  DEFAULT_AREA_UNIT_LABELS,
  DEFAULT_PRICE_UNIT_LABELS,
  type AreaUnitLabels,
  type PriceUnitLabels,
} from '@homiio/shared-types';

import { getFormatLocale } from '@/utils/dateLocale';

/**
 * Per-frequency price wording for the reader's language.
 *
 * Every key carries the English default as its `t()` fallback, so a locale file
 * missing one renders a readable word rather than a raw key — the convention the
 * offering summaries already follow.
 */
export function priceUnitLabels(t: TFunction): PriceUnitLabels {
  return {
    night: {
      short: t('format.priceUnit.night.short', DEFAULT_PRICE_UNIT_LABELS.night.short),
      spoken: t('format.priceUnit.night.spoken', DEFAULT_PRICE_UNIT_LABELS.night.spoken),
    },
    day: {
      short: t('format.priceUnit.day.short', DEFAULT_PRICE_UNIT_LABELS.day.short),
      spoken: t('format.priceUnit.day.spoken', DEFAULT_PRICE_UNIT_LABELS.day.spoken),
    },
    week: {
      short: t('format.priceUnit.week.short', DEFAULT_PRICE_UNIT_LABELS.week.short),
      spoken: t('format.priceUnit.week.spoken', DEFAULT_PRICE_UNIT_LABELS.week.spoken),
    },
    month: {
      short: t('format.priceUnit.month.short', DEFAULT_PRICE_UNIT_LABELS.month.short),
      spoken: t('format.priceUnit.month.spoken', DEFAULT_PRICE_UNIT_LABELS.month.spoken),
    },
    year: {
      short: t('format.priceUnit.year.short', DEFAULT_PRICE_UNIT_LABELS.year.short),
      spoken: t('format.priceUnit.year.spoken', DEFAULT_PRICE_UNIT_LABELS.year.spoken),
    },
    // A sale price and a booking total take no visible suffix; only their spoken
    // forms carry a word, for the accessibility label.
    total: {
      short: DEFAULT_PRICE_UNIT_LABELS.total.short,
      spoken: t('format.priceUnit.total.spoken', DEFAULT_PRICE_UNIT_LABELS.total.spoken),
    },
    sale: DEFAULT_PRICE_UNIT_LABELS.sale,
  };
}

/** Area unit wording for the reader's language (`m²` stays notation, not a word). */
export function areaUnitLabels(t: TFunction): AreaUnitLabels {
  return {
    sqm: {
      short: DEFAULT_AREA_UNIT_LABELS.sqm.short,
      spoken: t('format.areaUnit.sqm.spoken', DEFAULT_AREA_UNIT_LABELS.sqm.spoken),
    },
    sqft: {
      short: DEFAULT_AREA_UNIT_LABELS.sqft.short,
      spoken: t('format.areaUnit.sqft.spoken', DEFAULT_AREA_UNIT_LABELS.sqft.spoken),
    },
  };
}

/** What a component needs to format anything: the locale plus the unit words. */
export interface Formatting {
  /** BCP-47 tag for every `Intl` formatter on this render. */
  locale: string;
  priceUnitLabels: PriceUnitLabels;
  areaUnitLabels: AreaUnitLabels;
}

/**
 * The formatting context for the reader's current language.
 *
 * Memoized on the language so the label objects are referentially stable across
 * re-renders, which matters because they are passed into `useMemo` dependency
 * lists on the price-heavy screens.
 */
export function useFormatting(): Formatting {
  const { t, i18n } = useTranslation();
  return useMemo(
    () => ({
      locale: getFormatLocale(i18n.language),
      priceUnitLabels: priceUnitLabels(t),
      areaUnitLabels: areaUnitLabels(t),
    }),
    [t, i18n.language],
  );
}
