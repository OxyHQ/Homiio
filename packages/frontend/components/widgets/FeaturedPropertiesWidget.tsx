import React, { useMemo, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Image } from 'react-native';
import LoadingSpinner from '../LoadingSpinner';
import { Link, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';
import { useProperties } from '@/hooks';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { getPropertyImageSource } from '@/utils/propertyUtils';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '../ThemedText';

const IconComponent = Ionicons as any;

export function FeaturedPropertiesWidget() {
  const { t } = useTranslation();
  const router = useRouter();

  // Use the same pattern as the main homepage
  const { properties, loading, error, loadProperties } = useProperties();

  // Load properties on mount if not already loaded
  useEffect(() => {
    if (!properties || properties.length === 0) {
      loadProperties({
        limit: 4,
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
      <BaseWidget title={t('home.featured.title', 'Featured Properties')}>
        <View style={styles.errorContainer}>
          <ThemedText style={styles.errorText}>
            {error instanceof Error ? error.message : 'Failed to load properties'}
          </ThemedText>
        </View>
      </BaseWidget>
    );
  }

  return (
    <BaseWidget title={t('home.featured.title', 'Featured Properties')}>
      <View>
        {loading ? (
          <View style={styles.loadingContainer}>
            <LoadingSpinner size={16} showText={false} />
            <ThemedText style={styles.loadingText}>{t('state.loading', 'Loading...')}</ThemedText>
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

  // Map API data to display format
  const propertyItems = limited.map((property) => {
    console.log('Mapping property:', property); // Debug each property

    // Generate title dynamically from property data
    const generatedTitle = generatePropertyTitle({
      type: property.type,
      address: property.address,
      bedrooms: property.bedrooms,
      bathrooms: property.bathrooms,
    });

    const savesCount = typeof property.savesCount === 'number' ? property.savesCount : 0;

    return {
      id: property._id || property.id, // Use _id from MongoDB or fallback to id
      title: generatedTitle,
      location: `${property.address?.city || 'Unknown'}, ${property.address?.state || 'Unknown'}`,
      price: `$${property.rent?.amount || 0}/${property.priceUnit || property.rent?.paymentFrequency || 'month'}`,
      imageSource: getPropertyImageSource(property.images),
      isEcoCertified:
        property.amenities?.includes('eco-friendly') ||
        property.amenities?.includes('green') ||
        property.amenities?.includes('solar') ||
        false,
      savesCount,
    };
  });

  // Show message if no properties available
  if (propertyItems.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <ThemedText style={styles.emptyText}>
          {t('home.featured.empty', 'No featured properties available at the moment')}
        </ThemedText>
      </View>
    );
  }

  return (
    <>
      {propertyItems.map((property) => (
        <Link href={`/properties/${property.id}`} key={property.id} asChild>
          <TouchableOpacity style={styles.propertyItem}>
            <View style={styles.imageContainer}>
              <Image source={property.imageSource} style={styles.propertyImage} />
              <View style={styles.savesBadge}>
                <ThemedText style={styles.savesCountText}>{property.savesCount || 0}</ThemedText>
                <IconComponent name="heart" size={10} color="#ef4444" />
              </View>
            </View>
            <View style={styles.propertyContent}>
              <View style={styles.propertyHeader}>
                <ThemedText style={styles.propertyTitle} numberOfLines={2}>
                  {property.title}
                </ThemedText>
                {property.isEcoCertified && <ThemedText style={styles.ecoIcon}>🌿</ThemedText>}
              </View>
              <ThemedText style={styles.propertyLocation}>{property.location}</ThemedText>
              <View style={styles.propertyFooter}>
                <ThemedText style={styles.propertyPrice}>{property.price}</ThemedText>
              </View>
            </View>
          </TouchableOpacity>
        </Link>
      ))}
      <TouchableOpacity
        onPress={() => router.push('/properties')}
        style={styles.showMoreButton}
        activeOpacity={0.7}
      >
        <ThemedText style={styles.showMoreText}>{t('home.viewAll', 'View All')}</ThemedText>
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
  propertyItem: {
    flexDirection: 'row',
    marginBottom: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    paddingBottom: 10,
  },
  imageContainer: {
    position: 'relative',
  },
  propertyImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  savesBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 8,
    paddingHorizontal: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
    justifyContent: 'center',
  },
  savesCountText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#222222',
    marginRight: 1,
    fontFamily: 'Phudu',
    lineHeight: 18,
  },
  propertyContent: {
    flex: 1,
    marginLeft: 10,
    justifyContent: 'flex-start',
  },
  propertyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  propertyTitle: {
    fontWeight: 'bold',
    fontSize: 14,
    flex: 1,
    marginRight: 5,
    marginBottom: 3,
    lineHeight: 16,
  },
  propertyLocation: {
    color: colors.COLOR_BLACK_LIGHT_4,
    fontSize: 12,
    marginTop: 3,
    lineHeight: 14,
  },
  propertyFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  propertyPrice: {
    fontWeight: '600',
    lineHeight: 16,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingText: {
    marginLeft: 3,
    fontSize: 13,
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
  ecoIcon: {
    fontSize: 16,
    marginLeft: 5,
  },
  starIcon: {
    fontSize: 14,
    color: '#FFD700',
  },
});
