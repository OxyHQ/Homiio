import React, { useMemo, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import LoadingSpinner from '../LoadingSpinner';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';
import { useProperties } from '@/hooks';
import { PropertyCard } from '../PropertyCard';
import { ThemedText } from '../ThemedText';

export function FeaturedPropertiesWidget() {
  const { t } = useTranslation();

  // Use the same pattern as the main homepage
  const { properties, loading, error, loadProperties } = useProperties();

  // Load properties on mount if not already loaded
  useEffect(() => {
    if (!properties || properties.length === 0) {
      loadProperties({
        limit: 5,
        status: 'available',
      });
    }
  }, [loadProperties, properties]);

  const featured = useMemo(() => {
    return properties || [];
  }, [properties]);

  if (error) {
    console.error('FeaturedPropertiesWidget Error:', error);
    return (
      <BaseWidget title={t('home.featured.title')}>
        <View style={styles.errorContainer}>
          <ThemedText style={styles.errorText}>
            Failed to load properties
          </ThemedText>
        </View>
      </BaseWidget>
    );
  }

  return (
    <BaseWidget title={t('home.featured.title')}>
      <View>
        {loading ? (
          <View style={styles.loadingContainer}>
            <LoadingSpinner size={16} showText={false} />
            <ThemedText style={styles.loadingText}>{t('state.loading')}</ThemedText>
          </View>
        ) : (
          <FeaturedProperties properties={featured} />
        )}
      </View>
    </BaseWidget>
  );
}

function FeaturedProperties({ properties }: { properties: any[] }) {
  const router = useRouter();
  const { t } = useTranslation();

  // Debug: Log the properties to see the actual structure
  console.log('FeaturedProperties received:', properties);

  // Order most saved to less saved, then limit to 4
  const sorted = Array.isArray(properties)
    ? [...properties].sort((a, b) => {
      const aSaves = typeof a.savesCount === 'number' ? a.savesCount : 0;
      const bSaves = typeof b.savesCount === 'number' ? b.savesCount : 0;
      return bSaves - aSaves;
    })
    : [];
  const limited = sorted.slice(0, 4);

  // Show message if no properties available
  if (limited.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <ThemedText style={styles.emptyText}>
          {t('home.featured.empty')}
        </ThemedText>
      </View>
    );
  }

  return (
    <>
      {limited.map((property) => (
        <PropertyCard
          key={property._id || property.id}
          property={property}
          variant="compact"
          orientation="horizontal"
          showFavoriteButton={true}
          showVerifiedBadge={true}
          showTypeIcon={false}
          showFeatures={true}
          showPrice={true}
          showLocation={true}
          showRating={false}
          style={styles.propertyCard}
          onPress={() => router.push(`/properties/${property._id || property.id}`)}
        />
      ))}
      <TouchableOpacity
        onPress={() => router.push('/properties')}
        style={styles.showMoreButton}
        activeOpacity={0.7}
      >
        <ThemedText style={styles.showMoreText}>{t('home.viewAll')}</ThemedText>
      </TouchableOpacity>
    </>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    padding: 15,
    alignItems: 'center',
    borderRadius: 15,
    gap: 10,
  },
  loadingText: {
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  errorContainer: {
    padding: 15,
    alignItems: 'center',
    borderRadius: 15,
  },
  errorText: {
    color: '#ff6b6b',
    fontWeight: '500',
  },
  emptyContainer: {
    padding: 20,
    alignItems: 'center',
    borderRadius: 15,
  },
  emptyText: {
    color: colors.COLOR_BLACK_LIGHT_4,
    fontSize: 14,
    textAlign: 'center',
  },
  propertyCard: {
    marginBottom: 12,
  },
  showMoreButton: {
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 35,
    alignItems: 'center',
    marginTop: 5,
  },
  showMoreText: {
    color: colors.primaryColor,
    fontWeight: '600',
  },
});
