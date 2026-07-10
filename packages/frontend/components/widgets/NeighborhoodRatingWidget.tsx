import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';
import { useNeighborhood } from '@/hooks/useNeighborhood';
import { formatCurrency } from '@/utils/currency';

interface NeighborhoodRatingWidgetProps {
  propertyId?: string;
  neighborhoodName?: string;
  city?: string;
  /** Kept for call-site compatibility; not used for lookups (geo is relational). */
  state?: string;
}

/**
 * Neighborhood metrics widget.
 *
 * Renders ONLY real, Homiio-derived metrics (listing count, average rent,
 * vs-city contrast) for the resolved neighborhood. There are no invented
 * walkability/transit/safety scores. When no neighborhood resolves (or the
 * lookup errors), the widget renders nothing rather than showing placeholder
 * data.
 */
export function NeighborhoodRatingWidget({
  propertyId,
  neighborhoodName,
  city,
}: NeighborhoodRatingWidgetProps = {}) {
  const { t } = useTranslation();
  const { data: neighborhood, isLoading } = useNeighborhood({
    propertyId,
    name: neighborhoodName,
    city,
  });

  // No resolvable neighborhood (or an error) → hide the widget entirely.
  if (isLoading || !neighborhood) {
    return null;
  }

  const { name, city: cityName, listingCount, averageRent, currency, vsCity } = neighborhood;
  const currencyCode = currency ?? 'EUR';

  return (
    <BaseWidget
      title={t('Neighborhood')}
      icon={<Ionicons name="location" size={22} color={colors.primaryColor} />}
    >
      <View style={styles.container}>
        <View style={styles.headerSection}>
          <Text style={styles.neighborhoodName}>{name}</Text>
          {cityName ? <Text style={styles.citySubtitle}>{cityName}</Text> : null}
        </View>

        <View style={styles.metricsRow}>
          <View style={styles.metric}>
            <Text style={styles.metricValue}>{listingCount}</Text>
            <Text style={styles.metricLabel}>{t('Listings')}</Text>
          </View>
          {averageRent !== null ? (
            <View style={styles.metric}>
              <Text style={styles.metricValue}>{formatCurrency(averageRent, currencyCode)}</Text>
              <Text style={styles.metricLabel}>{t('Avg. rent / mo')}</Text>
            </View>
          ) : null}
        </View>

        {vsCity ? (
          <View style={styles.vsCityRow}>
            <Ionicons
              name={vsCity.percentDiff <= 0 ? 'trending-down-outline' : 'trending-up-outline'}
              size={16}
              color={vsCity.percentDiff <= 0 ? colors.success : colors.COLOR_BLACK_LIGHT_3}
            />
            <Text style={styles.vsCityText}>
              {vsCity.percentDiff === 0
                ? t('On par with the city average')
                : t('{{pct}}% {{dir}} than the city average', {
                    pct: Math.abs(vsCity.percentDiff),
                    dir: vsCity.percentDiff < 0 ? t('cheaper') : t('pricier'),
                  })}
            </Text>
          </View>
        ) : null}
      </View>
    </BaseWidget>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 10,
    gap: 14,
  },
  headerSection: {
    gap: 2,
  },
  neighborhoodName: {
    fontSize: 16,
    fontWeight: '600',
  },
  citySubtitle: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  metric: {
    flex: 1,
    gap: 2,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.primaryColor,
  },
  metricLabel: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  vsCityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  vsCityText: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    flexShrink: 1,
  },
});
