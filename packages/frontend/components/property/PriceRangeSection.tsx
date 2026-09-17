/**
 * PriceRangeSection — "Prices in this area" on the property detail screen, on
 * Bloom's `property-insights` family.
 *
 * Powered by `GET /api/properties/:id/area-insights` (via `useAreaInsights`):
 * the asking prices of comparable listings nearby (same offering, ±1 bedroom),
 * within a radius or, when that is too thin, across the city.
 *
 * ## It describes a local distribution; it does not judge the listing
 *
 * `docs/adr/0004-local-explainable-pricing.md` decides the shape, and this
 * section is built to it rather than to the mean-based verdict the endpoint
 * still sends:
 *
 *  - **No verdict vocabulary.** `comparison.verdict` ("good deal", "above
 *    average") is not rendered. Bloom's `PriceEstimate` places this home against
 *    the range of the homes compared and words it neutrally ("Within the local
 *    range", "12% above the local range") — never red, however far above.
 *  - **Confidence is explicit and drawn**, from the sample size against the
 *    per-offering minimums of ADR 0004 §6.9, and never above `medium`: every
 *    figure here is an ASKING price (§6.7). At `low` the band widens and the
 *    placement is withheld; below the `low` minimum nothing is placed at all and
 *    a visible line says why (§8.1 — insufficient data is stated, not hidden).
 *  - **The reasoning travels with the number**: the basis, the sample, the
 *    median and the limitation are behind "How this range is built".
 *
 * There is no model version or assessment date to show: the endpoint computes
 * on read and carries neither, so the footer names the method alone rather than
 * inventing either.
 *
 * Fails soft: hides itself entirely on error.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BarListCard, type BarListItem } from '@oxy.so/bloom/chart-cards';
import { RiHome5Fill } from '@oxy.so/bloom/icons';
import {
  PriceEstimate,
  PricePerAreaComparison,
  type EstimateConfidence,
  type PriceVerdict,
} from '@oxy.so/bloom/property-insights';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { Section } from '@/components/property/Section';
import { useAreaInsights } from '@/hooks';
import { useFormatting } from '@/utils/format';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import { formatMoney, type PropertyAreaInsights } from '@homiio/shared-types';

interface PriceRangeSectionProps {
  propertyId: string;
  /** Bedrooms of the target listing, for the subtitle ("{n}-bed homes …"). */
  bedrooms: number;
}

/** Skeleton height standing in for the range while loading. */
const RANGE_SKELETON_HEIGHT = 120;

/** Distinct comparables needed for `low` and `medium` confidence, per price unit (ADR 0004 §6.9). */
const SAMPLE_MINIMUMS: Record<string, { low: number; medium: number }> = {
  month: { low: 8, medium: 15 },
  night: { low: 20, medium: 40 },
  sale: { low: 12, medium: 25 },
};

/**
 * The confidence a sample supports, or `null` when it is too small to place a
 * price at all. Capped at `medium`: the sample is asking prices only.
 */
export function areaPriceConfidence(sampleSize: number, priceUnit: string): EstimateConfidence | null {
  const minimums = SAMPLE_MINIMUMS[priceUnit] ?? SAMPLE_MINIMUMS.month;
  if (sampleSize < minimums.low) return null;
  return sampleSize < minimums.medium ? 'low' : 'medium';
}

export const PriceRangeSection: React.FC<PriceRangeSectionProps> = ({ propertyId, bedrooms }) => {
  const { t } = useTranslation();
  const { insights, loading, error } = useAreaInsights(propertyId);

  // Fail soft: an errored call hides the section rather than crashing the page.
  if (error) return null;

  if (loading) {
    return (
      <Section title={t('property.areaInsights.title')}>
        <View>
          <Skeleton.Box width={180} height={20} borderRadius={4} />
          <Skeleton.Box
            width="100%"
            height={RANGE_SKELETON_HEIGHT}
            borderRadius={radius.lg}
            style={styles.skeletonGap}
          />
        </View>
      </Section>
    );
  }

  if (!insights) return null;

  return <PriceRangeContent insights={insights} bedrooms={bedrooms} />;
};

interface PriceRangeContentProps {
  insights: PropertyAreaInsights;
  bedrooms: number;
}

const PriceRangeContent: React.FC<PriceRangeContentProps> = ({ insights, bedrooms }) => {
  const { t } = useTranslation();
  const { locale } = useFormatting();
  const theme = useTheme();
  const { currency, sampleSize } = insights;

  // Every price in the payload is quoted in `currency` — the listing's own. The
  // comparison is only meaningful in that one unit, so nothing is converted.
  const money = (amount: number): string =>
    formatMoney(Math.round(amount), currency, locale, { maximumFractionDigits: 0 });

  const isStudio = bedrooms <= 0;
  const subtitle =
    insights.basis === 'radius'
      ? isStudio
        ? t('property.areaInsights.subtitleStudioRadius', { radiusKm: insights.radiusKm })
        : t('property.areaInsights.subtitleRadius', { count: bedrooms, radiusKm: insights.radiusKm })
      : isStudio
        ? t('property.areaInsights.subtitleStudioCity', { areaLabel: insights.areaLabel })
        : t('property.areaInsights.subtitleCity', { count: bedrooms, areaLabel: insights.areaLabel });

  if (sampleSize === 0) {
    return (
      <Section title={t('property.areaInsights.title')} subtitle={subtitle}>
        <BloomText style={styles.note}>{t('property.areaInsights.lowDataNote')}</BloomText>
      </Section>
    );
  }

  const confidence = areaPriceConfidence(sampleSize, insights.priceUnit);
  const askingNote = t('property.areaInsights.askingPricesNote');

  if (confidence === null) {
    return (
      <Section title={t('property.areaInsights.title')} subtitle={subtitle}>
        <View style={styles.body}>
          <BloomText style={styles.note}>
            {t('property.areaInsights.insufficient', { count: sampleSize })}
          </BloomText>
          <BloomText style={styles.caption}>{askingNote}</BloomText>
        </View>
      </Section>
    );
  }

  const { comparison, distribution, pricePerSqm, neighborhoodVsCity } = insights;

  const formatVerdict = (verdict: PriceVerdict): string => {
    const percent = Math.max(1, Math.round(verdict.ratio * 100));
    if (verdict.position === 'above') return t('property.areaInsights.placement.above', { percent });
    if (verdict.position === 'below') return t('property.areaInsights.placement.below', { percent });
    return t('property.areaInsights.placement.within');
  };

  const reasons = [
    insights.basis === 'city'
      ? t('property.areaInsights.reason.cityBasis', {
          areaLabel: insights.areaLabel,
          radiusKm: insights.radiusKm,
        })
      : t('property.areaInsights.reason.radiusBasis', { radiusKm: insights.radiusKm }),
    t('property.areaInsights.reason.middle', { median: money(comparison.median), avg: money(comparison.avg) }),
    t('property.areaInsights.reason.range', { min: money(comparison.min), max: money(comparison.max) }),
    ...(neighborhoodVsCity
      ? [
          neighborhoodVsCity.percentDiff === 0
            ? t('property.areaInsights.neighborhoodSame', {
                neighborhood: neighborhoodVsCity.neighborhood,
                city: neighborhoodVsCity.city,
              })
            : t(
                neighborhoodVsCity.percentDiff < 0
                  ? 'property.areaInsights.neighborhoodCheaper'
                  : 'property.areaInsights.neighborhoodPricier',
                {
                  neighborhood: neighborhoodVsCity.neighborhood,
                  city: neighborhoodVsCity.city,
                  percent: Math.abs(neighborhoodVsCity.percentDiff),
                },
              ),
        ]
      : []),
    askingNote,
  ];

  // The distribution of the comparables, in price order, with this home's
  // bucket in the brand colour.
  const distributionItems: BarListItem[] = distribution.buckets.map((bucket, index) => {
    const isThis = index === distribution.thisBucketIndex;
    return {
      label: `${money(bucket.min)} – ${money(bucket.max)}`,
      value: bucket.count,
      color: isThis ? theme.colors.primary : theme.colors.border,
      icon: isThis ? RiHome5Fill : undefined,
    };
  });

  const perSqm = (amount: number) => t('property.areaInsights.perSqmValue', { price: money(amount) });

  return (
    <Section title={t('property.areaInsights.title')} subtitle={subtitle}>
      <View style={styles.body}>
        <PriceEstimate
          low={comparison.min}
          high={comparison.max}
          estimate={comparison.median}
          asking={comparison.thisPrice}
          confidence={confidence}
          confidenceNote={t('property.areaInsights.comparables', { count: sampleSize })}
          confidenceLabels={{
            low: t('property.areaInsights.confidence.low'),
            medium: t('property.areaInsights.confidence.medium'),
            high: t('property.areaInsights.confidence.high'),
          }}
          format={money}
          title={t('property.areaInsights.rangeTitle')}
          askingLabel={t('property.areaInsights.thisHome')}
          formatVerdict={formatVerdict}
          // A price above the local range is a fact about the distribution, not
          // a fault: never escalate it to the error tone.
          highAboveRatio={Number.POSITIVE_INFINITY}
          lowConfidenceVerdictLabel={t('property.areaInsights.tooFewToPlace')}
          reasons={reasons}
          reasonsLabel={t('property.areaInsights.reasonsLabel')}
          comparables={sampleSize}
          comparablesLabel={(count) => t('property.areaInsights.comparables', { count })}
          method={t('property.areaInsights.method')}
        />

        {pricePerSqm ? (
          <View style={styles.block}>
            <BloomText variant="body-medium">{t('property.areaInsights.perSqmTitle')}</BloomText>
            <PricePerAreaComparison
              accessibilityLabel={t('property.areaInsights.perSqmTitle')}
              rows={[
                {
                  label: t('property.areaInsights.thisHome'),
                  value: pricePerSqm.this,
                  display: perSqm(pricePerSqm.this),
                  highlight: true,
                },
                {
                  label: t('property.areaInsights.areaAverage', { areaLabel: insights.areaLabel }),
                  value: pricePerSqm.areaAvg,
                  display: perSqm(pricePerSqm.areaAvg),
                },
              ]}
            />
          </View>
        ) : null}

        {distributionItems.length > 0 ? (
          <BarListCard
            title={t('property.areaInsights.distributionLabel')}
            metricLabel={t('property.areaInsights.homesMetric')}
            metric="value"
            items={distributionItems}
            limit={distributionItems.length}
          />
        ) : null}
      </View>
    </Section>
  );
};

const styles = StyleSheet.create({
  body: {
    gap: spacing.xl,
  },
  block: {
    gap: spacing.md,
  },
  skeletonGap: {
    marginTop: spacing.md,
  },
  note: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 20,
  },
  caption: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    lineHeight: 16,
  },
});

export default PriceRangeSection;
