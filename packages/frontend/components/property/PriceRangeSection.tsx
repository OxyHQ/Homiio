/**
 * PriceRangeSection — the price-transparency block on the property detail
 * screen ("Prices in this area").
 *
 * Powered by `GET /api/properties/:id/area-insights` (via `useAreaInsights`).
 * It compares the listing's price to similar homes nearby and renders:
 *  - a localized verdict badge (good deal / below average / typical / above),
 *  - a compact distribution histogram (pure Views — no charting dep) with the
 *    target's bucket highlighted,
 *  - a min→max range bar with markers for the average and this home,
 *  - a stat line (average · €/m² vs area · sample size),
 *  - an inline neighborhood-vs-city contrast line (companion 3).
 *
 * Fails soft: hides itself entirely on error, renders a graceful
 * "not enough data" note when `sampleSize === 0`, and caveats a low sample.
 *
 * Flat Airbnb-2026 aesthetic via the shared `Section` primitive — no cards,
 * no shadows, content sits on the page inset by `SECTION_GUTTER`.
 */
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import * as Skeleton from '@oxyhq/bloom/skeleton';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { Section } from '@/components/property/Section';
import { useAreaInsights } from '@/hooks';
import { useCurrency } from '@/hooks/useCurrency';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import type { AreaPriceVerdict, PropertyAreaInsights } from '@homiio/shared-types';

interface PriceRangeSectionProps {
  propertyId: string;
  /** Bedrooms of the target listing, for the subtitle ("{n}-bed homes …"). */
  bedrooms: number;
}

/** Below this many comparables we still render but caveat the count. */
const LOW_SAMPLE_THRESHOLD = 3;
/** Histogram bar geometry. */
const HISTOGRAM_HEIGHT = 64;
const HISTOGRAM_MIN_BAR = 4;
/** Range-bar marker sizing. */
const RANGE_DOT_SIZE = 14;

/** Visual treatment per verdict — tint + label colour. */
const VERDICT_TINT: Record<
  AreaPriceVerdict,
  { background: string; foreground: string }
> = {
  good_deal: { background: colors.successSubtle, foreground: colors.success },
  below_average: { background: colors.successSubtle, foreground: colors.success },
  average: { background: colors.mutedSubtle, foreground: colors.COLOR_BLACK_LIGHT_3 },
  above_average: { background: colors.warningSubtle, foreground: colors.warning },
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

/**
 * Resolve a signed comparison to one of three i18n keys —
 * `cheaperKey` (n < 0), `pricierKey` (n > 0) or `sameKey` (n === 0) —
 * passing `|n|` as `percent` (plus any shared interpolation args) to the
 * directional variants. The `same` variant receives only `args`, matching
 * the copy that omits a percentage when there is no difference.
 */
const signedKey = (
  t: ReturnType<typeof useTranslation>['t'],
  n: number,
  cheaperKey: string,
  pricierKey: string,
  sameKey: string,
  args: Record<string, string | number> = {},
): string => {
  if (n < 0) return t(cheaperKey, { ...args, percent: Math.abs(n) });
  if (n > 0) return t(pricierKey, { ...args, percent: Math.abs(n) });
  return t(sameKey, args);
};

export const PriceRangeSection: React.FC<PriceRangeSectionProps> = ({
  propertyId,
  bedrooms,
}) => {
  const { t } = useTranslation();
  const { insights, loading, error } = useAreaInsights(propertyId);

  // Fail soft: an errored call hides the section rather than crashing the page.
  if (error) return null;

  if (loading) {
    return (
      <Section title={t('property.areaInsights.title')}>
        <View>
          <Skeleton.Box width={120} height={28} borderRadius={radius.pill} />
          <Skeleton.Box
            width="100%"
            height={HISTOGRAM_HEIGHT}
            borderRadius={radius.md}
            style={styles.skeletonGap}
          />
          <Skeleton.Box
            width="100%"
            height={10}
            borderRadius={radius.pill}
            style={styles.skeletonGap}
          />
          <Skeleton.Box
            width="70%"
            height={14}
            borderRadius={4}
            style={styles.skeletonGap}
          />
        </View>
      </Section>
    );
  }

  if (!insights) return null;

  return (
    <PriceRangeContent t={t} insights={insights} bedrooms={bedrooms} />
  );
};

interface PriceRangeContentProps {
  t: ReturnType<typeof useTranslation>['t'];
  insights: PropertyAreaInsights;
  bedrooms: number;
}

const PriceRangeContent: React.FC<PriceRangeContentProps> = ({
  t,
  insights,
  bedrooms,
}) => {
  const { convertAndFormat } = useCurrency();
  const { currency } = insights;

  // All prices in the payload share `currency`; format every value through the
  // same path PropertyCard uses (convert to the user's display currency).
  // `convertAndFormat` is re-created each render, so memoizing buys nothing.
  const money = (amount: number): string =>
    convertAndFormat(amount, currency, false);

  const isStudio = bedrooms <= 0;
  const subtitle = useMemo(() => {
    if (insights.basis === 'radius') {
      return isStudio
        ? t('property.areaInsights.subtitleStudioRadius', {
            radiusKm: insights.radiusKm,
          })
        : t('property.areaInsights.subtitleRadius', {
            count: bedrooms,
            radiusKm: insights.radiusKm,
          });
    }
    return isStudio
      ? t('property.areaInsights.subtitleStudioCity', {
          areaLabel: insights.areaLabel,
        })
      : t('property.areaInsights.subtitleCity', {
          count: bedrooms,
          areaLabel: insights.areaLabel,
        });
  }, [t, insights, bedrooms, isStudio]);

  // --- Graceful low-data state: no fabricated range/histogram. ---
  if (insights.sampleSize === 0) {
    return (
      <Section title={t('property.areaInsights.title')} subtitle={subtitle}>
        <BloomText style={styles.lowDataNote}>
          {t('property.areaInsights.lowDataNote')}
        </BloomText>
      </Section>
    );
  }

  const { comparison, distribution, pricePerSqm, neighborhoodVsCity } = insights;

  const verdictTint = VERDICT_TINT[comparison.verdict];
  const verdictLabel = t(`property.areaInsights.verdict.${comparison.verdict}`);

  // vs-average delta label (handles +/- and equality).
  const deltaLabel = signedKey(
    t,
    comparison.percentDiffFromAvg,
    'property.areaInsights.vsAvgCheaper',
    'property.areaInsights.vsAvgPricier',
    'property.areaInsights.vsAvgSame',
  );

  // Range-bar marker positions (clamped to the track).
  const span = comparison.max - comparison.min;
  const thisRatio =
    span > 0 ? clamp01((comparison.thisPrice - comparison.min) / span) : 0.5;
  const avgRatio =
    span > 0 ? clamp01((comparison.avg - comparison.min) / span) : 0.5;

  // Histogram: heights proportional to the tallest bucket.
  const maxBucketCount = distribution.buckets.reduce(
    (max, bucket) => Math.max(max, bucket.count),
    0,
  );

  // Stat line: average · (€/m² vs area) · sample size.
  const samples = t('property.areaInsights.samples', {
    count: insights.sampleSize,
  });
  const averageText = t('property.areaInsights.average', {
    avg: money(comparison.avg),
  });
  const statLine = pricePerSqm
    ? t('property.areaInsights.statLineWithSqm', {
        average: averageText,
        perSqm: t('property.areaInsights.perSqm', {
          price: money(pricePerSqm.this),
          areaPrice: money(pricePerSqm.areaAvg),
        }),
        samples,
      })
    : t('property.areaInsights.statLine', { average: averageText, samples });

  // Neighborhood-vs-city line (companion 3) — hidden when null.
  const neighborhoodLine = neighborhoodVsCity
    ? signedKey(
        t,
        neighborhoodVsCity.percentDiff,
        'property.areaInsights.neighborhoodCheaper',
        'property.areaInsights.neighborhoodPricier',
        'property.areaInsights.neighborhoodSame',
        {
          neighborhood: neighborhoodVsCity.neighborhood,
          city: neighborhoodVsCity.city,
        },
      )
    : null;

  const isLowSample = insights.sampleSize < LOW_SAMPLE_THRESHOLD;

  return (
    <Section title={t('property.areaInsights.title')} subtitle={subtitle}>
      <View style={styles.body}>
        {/* Verdict badge + this-home price */}
        <View style={styles.verdictRow}>
          <View style={[styles.verdictBadge, { backgroundColor: verdictTint.background }]}>
            <BloomText style={[styles.verdictLabel, { color: verdictTint.foreground }]}>
              {verdictLabel}
            </BloomText>
          </View>
          <BloomText style={styles.thisPriceText}>
            {money(comparison.thisPrice)}
          </BloomText>
        </View>

        {/* Distribution histogram (pure Views) */}
        <View
          style={styles.histogram}
          accessibilityLabel={t('property.areaInsights.distributionLabel')}
        >
          {distribution.buckets.map((bucket, index) => {
            const ratio = maxBucketCount > 0 ? bucket.count / maxBucketCount : 0;
            const isThis = index === distribution.thisBucketIndex;
            const barHeight = Math.max(
              HISTOGRAM_MIN_BAR,
              Math.round(ratio * HISTOGRAM_HEIGHT),
            );
            return (
              <View key={`${bucket.min}-${bucket.max}-${index}`} style={styles.histogramSlot}>
                <View
                  style={[
                    styles.histogramBar,
                    { height: barHeight },
                    isThis ? styles.histogramBarThis : styles.histogramBarMuted,
                  ]}
                />
              </View>
            );
          })}
        </View>

        {/* Range bar: min → max with avg + this-home markers */}
        <View style={styles.rangeBlock}>
          <View style={styles.rangeTrack}>
            <View style={[styles.rangeAvgTick, { left: `${avgRatio * 100}%` }]} />
            <View
              style={[
                styles.rangeThisDot,
                {
                  left: `${thisRatio * 100}%`,
                  marginLeft: -(RANGE_DOT_SIZE / 2),
                },
              ]}
            />
          </View>
          <View style={styles.rangeLabels}>
            <BloomText style={styles.rangeBound}>{money(comparison.min)}</BloomText>
            <BloomText style={styles.rangeThisLabel}>
              {t('property.areaInsights.rangeMarkerLabel', {
                price: money(comparison.thisPrice),
                deltaLabel,
              })}
            </BloomText>
            <BloomText style={styles.rangeBound}>{money(comparison.max)}</BloomText>
          </View>
        </View>

        {/* Stat line */}
        <BloomText style={styles.statLine}>{statLine}</BloomText>

        {/* Neighborhood vs city (companion 3) */}
        {neighborhoodLine ? (
          <BloomText style={styles.neighborhoodLine}>{neighborhoodLine}</BloomText>
        ) : null}

        {/* Low-sample caveat */}
        {isLowSample ? (
          <BloomText style={styles.caveat}>
            {t('property.areaInsights.lowSampleCaveat', {
              count: insights.sampleSize,
            })}
          </BloomText>
        ) : null}
      </View>
    </Section>
  );
};

const styles = StyleSheet.create({
  body: {
    gap: spacing.lg,
  },
  skeletonGap: {
    marginTop: spacing.md,
  },
  lowDataNote: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 20,
  },
  verdictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  verdictBadge: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
  },
  verdictLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  thisPriceText: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    letterSpacing: -0.2,
  },
  histogram: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: HISTOGRAM_HEIGHT,
    gap: spacing.xs,
  },
  histogramSlot: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  histogramBar: {
    width: '100%',
    borderRadius: radius.md,
  },
  histogramBarMuted: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  histogramBarThis: {
    backgroundColor: colors.primaryColor,
  },
  rangeBlock: {
    gap: spacing.sm,
  },
  rangeTrack: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
    justifyContent: 'center',
  },
  rangeAvgTick: {
    position: 'absolute',
    width: 2,
    height: 14,
    marginLeft: -1,
    top: -4,
    borderRadius: 1,
    backgroundColor: colors.COLOR_BLACK_LIGHT_4,
  },
  rangeThisDot: {
    position: 'absolute',
    width: RANGE_DOT_SIZE,
    height: RANGE_DOT_SIZE,
    borderRadius: RANGE_DOT_SIZE / 2,
    backgroundColor: colors.primaryColor,
    borderWidth: 2,
    borderColor: colors.white,
  },
  rangeLabels: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rangeBound: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  rangeThisLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  statLine: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 18,
  },
  neighborhoodLine: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 18,
  },
  caveat: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    fontStyle: 'italic',
    lineHeight: 16,
  },
});

export default PriceRangeSection;
