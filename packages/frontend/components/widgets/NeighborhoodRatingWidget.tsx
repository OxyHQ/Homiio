import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';
import { useNeighborhood } from '@/hooks/useNeighborhood';
import { useOxy } from '@oxyhq/services';
import LoadingSpinner from '../LoadingSpinner';
import Button from '../Button';

// Type assertion for Ionicons compatibility with React 19
const IconComponent = Ionicons as any;

interface NeighborhoodRatingWidgetProps {
  propertyId?: string;
  neighborhoodName?: string;
  city?: string;
  state?: string;
}

export function NeighborhoodRatingWidget({
  propertyId,
  neighborhoodName,
  city,
  state,
}: NeighborhoodRatingWidgetProps = {}) {
  const { t } = useTranslation();
  const { oxyServices, activeSessionId } = useOxy();
  const {
    currentNeighborhood,
    isLoading,
    error,
    isAuthenticated,
    isDataStale,
    fetchByName,
    fetchByProperty,
    setCurrent,
  } = useNeighborhood();

  // Default neighborhood data for when API is not available
  const defaultNeighborhood = {
    name: neighborhoodName || 'El Born, Barcelona',
    overallScore: 4.2,
    ratings: [
      { category: 'Safety', score: 4.5, icon: 'shield-checkmark-outline' },
      { category: 'Dining', score: 4.8, icon: 'restaurant-outline' },
      { category: 'Transit', score: 4.3, icon: 'subway-outline' },
      { category: 'Nightlife', score: 4.0, icon: 'wine-outline' },
      { category: 'Shopping', score: 3.9, icon: 'bag-outline' },
    ],
  };

  // Use current neighborhood data or fall back to default
  const neighborhoodData = currentNeighborhood || defaultNeighborhood;
  const displayName = currentNeighborhood?.name || defaultNeighborhood.name;
  const overallScore = currentNeighborhood?.overallScore || defaultNeighborhood.overallScore;
  const categories = currentNeighborhood?.ratings || defaultNeighborhood.ratings;

  // Load neighborhood data on component mount if authenticated and data is stale
  useEffect(() => {
    if (isAuthenticated && (!currentNeighborhood || isDataStale())) {
      if (propertyId) {
        // If we have a property ID, fetch neighborhood data for that property
        console.log('NeighborhoodRatingWidget: Fetching neighborhood for property:', propertyId);
        fetchByProperty(propertyId);
      } else if (neighborhoodName && city) {
        // If we have neighborhood name and city, fetch by name
        console.log(
          'NeighborhoodRatingWidget: Fetching neighborhood by name:',
          neighborhoodName,
          city,
        );
        fetchByName(neighborhoodName, city, state);
      } else {
        // Fallback to default location
        console.log('NeighborhoodRatingWidget: Using default neighborhood data');
      }
    }
  }, [
    isAuthenticated,
    currentNeighborhood,
    isDataStale,
    fetchByName,
    fetchByProperty,
    propertyId,
    neighborhoodName,
    city,
    state,
  ]);

  // Helper to render stars based on rating
  const renderStars = (rating: number) => {
    const fullStars = Math.floor(rating);
    const halfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (halfStar ? 1 : 0);

    return (
      <View style={styles.starsContainer}>
        {[...Array(fullStars)].map((_, i) => (
          <IconComponent key={`full-${i}`} name="star" size={14} color="#FFD700" />
        ))}
        {halfStar && <IconComponent name="star-half" size={14} color="#FFD700" />}
        {[...Array(emptyStars)].map((_, i) => (
          <IconComponent key={`empty-${i}`} name="star-outline" size={14} color="#FFD700" />
        ))}
        <Text style={styles.ratingNumber}>{rating.toFixed(1)}</Text>
      </View>
    );
  };

  // Show loading state
  if (isLoading) {
    return (
      <BaseWidget
        title={t('Neighborhood')}
        icon={<IconComponent name="location" size={22} color={colors.primaryColor} />}
      >
        <View style={styles.loadingContainer}>
          <LoadingSpinner size={16} showText={false} />
          <Text style={styles.loadingText}>{t('Loading neighborhood data...')}</Text>
        </View>
      </BaseWidget>
    );
  }

  // Show error state
  if (error && !currentNeighborhood) {
    return (
      <BaseWidget
        title={t('Neighborhood')}
        icon={<IconComponent name="location" size={22} color={colors.primaryColor} />}
      >
        <View style={styles.errorContainer}>
          <IconComponent name="alert-circle-outline" size={24} color={colors.COLOR_BLACK_LIGHT_4} />
          <Text style={styles.errorText}>{t('Unable to load neighborhood data')}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              if (propertyId) {
                fetchByProperty(propertyId);
              } else if (neighborhoodName && city) {
                fetchByName(neighborhoodName, city, state);
              } else {
                fetchByName('El Born', 'Barcelona', 'Catalonia');
              }
            }}
          >
            <Text style={styles.retryButtonText}>{t('Retry')}</Text>
          </TouchableOpacity>
        </View>
      </BaseWidget>
    );
  }

  return (
    <BaseWidget
      title={t('Neighborhood')}
      icon={<IconComponent name="location" size={22} color={colors.primaryColor} />}
    >
      <View style={styles.container}>
        <View style={styles.headerSection}>
          <Text style={styles.neighborhoodName}>{displayName}</Text>
          <View style={styles.overallRating}>{renderStars(overallScore)}</View>
        </View>

        <View style={styles.categoriesSection}>
          {categories.map((category, index) => (
            <View key={index} style={styles.categoryItem}>
              <View style={styles.categoryInfo}>
                <IconComponent name={category.icon as any} size={16} color={colors.primaryColor} />
                <Text style={styles.categoryName}>{category.category}</Text>
              </View>
              {renderStars(category.score)}
            </View>
          ))}
        </View>

        <Button style={styles.moreButton}>
          {t('View Neighborhood Guide')}
        </Button>
      </View>
    </BaseWidget>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 10,
  },
  loadingContainer: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 8,
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  errorContainer: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    marginTop: 8,
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_4,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.primaryColor,
    borderRadius: 8,
  },
  retryButtonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
  headerSection: {
    marginBottom: 15,
  },
  neighborhoodName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 5,
  },
  overallRating: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  starsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingNumber: {
    marginLeft: 5,
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  categoriesSection: {
    marginBottom: 15,
  },
  categoryItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
  },
  categoryInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  categoryName: {
    marginLeft: 8,
    fontSize: 14,
  },
  moreButton: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 20,
    alignItems: 'center',
  },
  moreButtonText: {
    color: colors.primaryColor,
    fontWeight: '600',
    fontSize: 14,
  },
});
