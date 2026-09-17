/**
 * PriceRangeSection — the price-transparency block on the property detail
 * screen ("Prices in this area").
 *
 * Powered by `GET /api/properties/:id/area-insights` (via `useAreaInsights`).
 * It compares the listing's price to similar homes nearby and renders:
 *  - a localized verdict chip (good deal / below average / typical / above),
 *  - a min→max Bloom `StatBar` placing this home inside the local range,
 *  - a stat line (average · €/m² vs area · sample size),
 *  - the price distribution as a Bloom `BarListCard`: one row per price
 *    bucket, labelled with its bounds and its home count, in price order, with
 *    this home's bucket painted in the brand colour,
 *  - an inline neighborhood-vs-city contrast line (companion 3).
 *
 * Fails soft: hides itself entirely on error, renders a graceful
 * "not enough data" note when `sampleSize === 0`, and caveats a low sample.
 */
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BarListCard, type BarListItem } from '@oxy.so/bloom/chart-cards';
import { Chip } from '@oxy.so/bloom/chip';
import { RiHome5Fill } from '@oxy.so/bloom/icons';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { StatBar } from '@oxy.so/bloom/stat-bar';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { Section } from '@/components/property/Section';
import { useAreaInsights } from '@/hooks';
import { useFormatting } from '@/utils/format';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import {
  formatMoney,
  type AreaPriceVerdict,
  type PropertyAreaInsights,
} from '@homiio/shared-types';

interface PriceRangeSectionProps {
  propertyId: string;
  /** Bedrooms of the target listing, for the subtitle ("{n}-bed homes …"). */
  bedrooms: number;
}

/** Below this many comparables we still render but caveat the count. */
const LOW_SAMPLE_THRESHOLD = 3;
/** Skeleton height standing in for the distribution list while loading. */
const DISTRIBUTION_SKELETON_HEIGHT = 160;

/** Chip tone per verdict. */
const VERDICT_TONE: Record<AreaPriceVerdict, 'success' | 'default' | 'warning'> = {
  good_deal: 'success',
  below_average: 'success',
  average: 'default',
  above_average: 'warning',
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
          <Skeleton.Box
            width="100%"
            height={DISTRIBUTION_SKELETON_HEIGHT}
            borderRadius={radius.lg}
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
  const { locale } = useFormatting();
  const theme = useTheme();
  const { currency } = insights;

  // All prices in the payload share `currency` and are quoted IN it — the same
  // currency the listing's own price is quoted in, which is the whole point of a
  // comparison. Converting them into the reader's display currency (what this
  // used to do) put the comparison and the price it compares against in
  // different units, at an exchange rate with no timestamp.
  const money = (amount: number): string => formatMoney(amount, currency, locale);

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

  const verdictLabel = t(`property.areaInsights.verdict.${comparison.verdict}`);

  // vs-average delta label (handles +/- and equality).
  const deltaLabel = signedKey(
    t,
    comparison.percentDiffFromAvg,
    'property.areaInsights.vsAvgCheaper',
    'property.areaInsights.vsAvgPricier',
    'property.areaInsights.vsAvgSame',
  );

  // Range bar: this home's position between the cheapest and priciest
  // comparable (clamped to the track; centred when the range is degenerate).
  const span = comparison.max - comparison.min;
  const thisRatio =
    span > 0 ? clamp01((comparison.thisPrice - comparison.min) / span) : 0.5;

  // Distribution: one labelled row per price bucket, kept in price order, with
  // the bucket this home falls in painted in the brand colour.
  const distributionItems: BarListItem[] = distribution.buckets.map((bucket, index) => {
    const isThis = index === distribution.thisBucketIndex;
    return {
      label: `${money(bucket.min)} – ${money(bucket.max)}`,
      value: bucket.count,
      color: isThis ? theme.colors.primary : theme.colors.border,
      icon: isThis ? RiHome5Fill : undefined,
    };
  });

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
        {/* Verdict chip + this-home price */}
        <View style={styles.verdictRow}>
          <Chip variant="subtle" color={VERDICT_TONE[comparison.verdict]} size="medium">
            {verdictLabel}
          </Chip>
          <BloomText style={styles.thisPriceText}>
            {money(comparison.thisPrice)}
          </BloomText>
        </View>

        {/* Range bar: min → max with this home placed on it */}
        <StatBar
          label={t('property.areaInsights.rangeMarkerLabel', {
            price: money(comparison.thisPrice),
            deltaLabel,
          })}
          value={thisRatio}
          max={1}
          minLabel={money(comparison.min)}
          maxLabel={money(comparison.max)}
          height={8}
        />

        {/* Stat line */}
        <BloomText style={styles.statLine}>{statLine}</BloomText>

        {/* Distribution of comparable prices */}
        {distributionItems.length > 0 ? (
          <BarListCard
            title={t('property.areaInsights.distributionLabel')}
            metricLabel={t('property.areaInsights.homesMetric', 'Homes')}
            metric="value"
            items={distributionItems}
            limit={distributionItems.length}
          />
        ) : null}

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
  thisPriceText: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    letterSpacing: -0.2,
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
