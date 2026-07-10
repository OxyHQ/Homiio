import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { Section } from '@/components/property/Section';
import { colors } from '@/styles/colors';
import { useTranslation } from 'react-i18next';
import type { Property } from '@homiio/shared-types';
import { useNeighborhood } from '@/hooks/useNeighborhood';
import { formatCurrency } from '@/utils/currency';

interface Props {
  property: Property | null;
}

/**
 * Neighborhood section on the property-detail screen.
 *
 * Renders ONLY real, Homiio-derived metrics for the property's neighborhood
 * (listing count, average rent, vs-city contrast). There is no invented copy or
 * scores — when the property resolves to no neighborhood, the section is hidden.
 */
export const NeighborhoodInfo: React.FC<Props> = ({ property }) => {
  const { t } = useTranslation();
  const propertyId = property?._id;
  const { data: neighborhood } = useNeighborhood({ propertyId });

  if (!neighborhood) return null;

  const { name, city, listingCount, averageRent, currency, vsCity } = neighborhood;
  const currencyCode = currency ?? 'EUR';

  return (
    <Section title={t('property.neighborhood.title')}>
      <BloomText style={styles.name}>
        {city ? `${name}, ${city}` : name}
      </BloomText>
      <View style={styles.metricsRow}>
        <BloomText style={styles.metric}>
          {t('property.neighborhood.listingCount', { count: listingCount })}
        </BloomText>
        {averageRent !== null ? (
          <BloomText style={styles.metric}>
            {t('property.neighborhood.avgAmountPerMonth', { amount: formatCurrency(averageRent, currencyCode) })}
          </BloomText>
        ) : null}
      </View>
      {vsCity ? (
        <BloomText style={styles.vsCity}>
          {vsCity.percentDiff === 0
            ? t('property.neighborhood.onParWithCity')
            : t('property.neighborhood.pctVsCity', {
                pct: Math.abs(vsCity.percentDiff),
                dir: vsCity.percentDiff < 0 ? t('property.neighborhood.cheaper') : t('property.neighborhood.pricier'),
              })}
        </BloomText>
      ) : null}
    </Section>
  );
};

const styles = StyleSheet.create({
  name: { fontSize: 16, fontWeight: '600', color: colors.COLOR_BLACK, marginBottom: 6 },
  metricsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metric: { fontSize: 15, lineHeight: 22, color: colors.COLOR_BLACK_LIGHT_3 },
  vsCity: { fontSize: 14, lineHeight: 20, color: colors.COLOR_BLACK_LIGHT_3, marginTop: 6 },
});

export default NeighborhoodInfo;
