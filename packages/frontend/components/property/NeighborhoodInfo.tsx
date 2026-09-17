import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card } from '@oxy.so/bloom/card';
import { Chip } from '@oxy.so/bloom/chip';
import { RiMapPinLine } from '@oxy.so/bloom/icons';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { Section } from '@/components/property/Section';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
import type { Property } from '@homiio/shared-types';
import { useNeighborhood } from '@/hooks/useNeighborhood';
import { formatMoney } from '@homiio/shared-types';
import { useFormatting } from '@/utils/format';

interface Props {
  property: Property | null;
}

interface MetricTileProps {
  label: string;
  value: string;
}

/** One real metric: a muted label over its value, on a quiet Bloom card. */
const MetricTile: React.FC<MetricTileProps> = ({ label, value }) => (
  <Card variant="filled" radius="radius-12" elevation="none" style={styles.tile}>
    <BloomText variant="body-2-regular" style={styles.tileLabel}>
      {label}
    </BloomText>
    <BloomText variant="title-3-semibold" style={styles.tileValue}>
      {value}
    </BloomText>
  </Card>
);

/**
 * Neighborhood section on the property-detail screen.
 *
 * Renders ONLY real, Homiio-derived metrics for the property's neighborhood
 * (listing count, average rent, vs-city contrast). There is no invented copy or
 * scores — when the property resolves to no neighborhood, the section is hidden.
 * The area the metrics describe is always named above them (ADR 0002).
 */
export const NeighborhoodInfo: React.FC<Props> = ({ property }) => {
  const { t } = useTranslation();
  const { locale } = useFormatting();
  const propertyId = property?.id;
  const { data: neighborhood } = useNeighborhood({ propertyId });

  if (!neighborhood) return null;

  const { name, city, listingCount, averageRent, currency, vsCity } = neighborhood;
  const currencyCode = currency ?? 'EUR';

  return (
    <Section title={t('property.neighborhood.title')} bodyStyle={styles.body}>
      <View style={styles.nameRow}>
        <RiMapPinLine width={18} height={18} fill={colors.COLOR_BLACK_LIGHT_3} />
        <BloomText variant="headline-semibold" style={styles.name}>
          {city ? `${name}, ${city}` : name}
        </BloomText>
      </View>
      <View style={styles.tiles}>
        <MetricTile
          label={t('property.neighborhood.listings')}
          value={listingCount.toLocaleString(locale)}
        />
        {averageRent !== null ? (
          <MetricTile
            label={t('property.neighborhood.avgRentPerMonth')}
            value={formatMoney(averageRent, currencyCode, locale)}
          />
        ) : null}
      </View>
      {vsCity ? (
        <Chip
          size="large"
          color={vsCity.percentDiff < 0 ? 'success' : 'default'}
        >
          {vsCity.percentDiff === 0
            ? t('property.neighborhood.onParWithCity')
            : t('property.neighborhood.pctVsCity', {
                pct: Math.abs(vsCity.percentDiff),
                dir: vsCity.percentDiff < 0 ? t('property.neighborhood.cheaper') : t('property.neighborhood.pricier'),
              })}
        </Chip>
      ) : null}
    </Section>
  );
};

const styles = StyleSheet.create({
  body: { gap: spacing.md },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  name: { color: colors.COLOR_BLACK, flexShrink: 1 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { flexGrow: 1, flexBasis: 140, padding: spacing.lg, gap: 2 },
  tileLabel: { color: colors.COLOR_BLACK_LIGHT_3 },
  tileValue: { color: colors.COLOR_BLACK },
});

export default NeighborhoodInfo;
