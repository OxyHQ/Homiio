import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import LoadingSpinner from '../LoadingSpinner';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useOxy } from '@oxyhq/services';
import { BaseWidget } from './BaseWidget';
import { PropertyCard } from '@/components/PropertyCard';
import { colors } from '@/styles/colors';
import type { Property } from '@/services/propertyService';

// Type assertion for Ionicons compatibility with React 19
const IconComponent = Ionicons as any;

export function RecentlyViewedWidget() {
  const { t } = useTranslation();
  const { oxyServices, activeSessionId } = useOxy();
  const { properties: recentProperties, isLoading, error } = useRecentlyViewed();
  const scrollViewRef = useRef<ScrollView>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const [currentScrollX, setCurrentScrollX] = useState(0);

  const isAuthenticated = !!(oxyServices && activeSessionId);
  const isNative = Platform.OS === 'ios' || Platform.OS === 'android';
  const showArrows = !isNative && recentProperties.length > 2; // Only show if more than 2 items

  // Initialize scroll state
  useEffect(() => {
    if (showArrows && recentProperties.length > 2) {
      setCanScrollRight(true);
      setCanScrollLeft(false);
      setCurrentScrollX(0);
    } else {
      setCanScrollRight(false);
      setCanScrollLeft(false);
    }
  }, [showArrows, recentProperties.length]);

  const scrollLeft = () => {
    if (scrollViewRef.current) {
      const cardWidth = 152; // 140 + 12 margin
      const newX = Math.max(0, currentScrollX - cardWidth * 2);
      scrollViewRef.current.scrollTo({ x: newX, animated: true });
    }
  };

  const scrollRight = () => {
    if (scrollViewRef.current) {
      const cardWidth = 152; // 140 + 12 margin
      const newX = currentScrollX + cardWidth * 2;
      scrollViewRef.current.scrollTo({ x: newX, animated: true });
    }
  };

  const handleScroll = (event: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const scrollPosition = contentOffset.x;
    const maxScroll = contentSize.width - layoutMeasurement.width;

    setCurrentScrollX(scrollPosition);
    setCanScrollLeft(scrollPosition > 5);
    setCanScrollRight(scrollPosition < maxScroll - 5);
  };

  // Debug logging
  console.log('RecentlyViewedWidget Debug:', {
    isAuthenticated,
    oxyServices: !!oxyServices,
    activeSessionId: !!activeSessionId,
    recentPropertiesCount: recentProperties?.length || 0,
    isLoading,
    error: error || null,
  });

  const navigateToProperty = (property: Property) => {
    router.push(`/properties/${property._id || property.id}`);
  };

  // Hide widget completely if not authenticated
  if (!isAuthenticated) {
    console.log('RecentlyViewedWidget: User not authenticated, hiding widget');
    return null;
  }

  if (error) {
    console.log('RecentlyViewedWidget Error:', error);
    return (
      <BaseWidget
        title={t('home.recentlyViewed.title')}
        icon={<IconComponent name="time-outline" size={22} color={colors.primaryColor} />}
      >
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error || 'Failed to load properties'}</Text>
        </View>
      </BaseWidget>
    );
  }

  console.log(
    'RecentlyViewedWidget: User authenticated, showing properties:',
    recentProperties?.length || 0,
  );
  console.log('Arrow Debug:', {
    isNative,
    showArrows,
    propertiesLength: recentProperties.length,
    canScrollLeft,
    canScrollRight,
  });

  return (
    <BaseWidget
      title={t('home.recentlyViewed.title')}
      icon={<IconComponent name="time-outline" size={22} color={colors.primaryColor} />}
      noPadding={true}
    >
      <View style={styles.widgetContent}>
        {showArrows && (
          <>
            {canScrollLeft && (
              <TouchableOpacity style={[styles.arrowButton, styles.leftArrow]} onPress={scrollLeft}>
                <IconComponent name="chevron-back" size={20} color={colors.primaryColor} />
              </TouchableOpacity>
            )}
            {canScrollRight && (
              <TouchableOpacity
                style={[styles.arrowButton, styles.rightArrow]}
                onPress={scrollRight}
              >
                <IconComponent name="chevron-forward" size={20} color={colors.primaryColor} />
              </TouchableOpacity>
            )}
          </>
        )}
        <ScrollView
          ref={scrollViewRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.container}
          contentContainerStyle={styles.scrollContent}
          onScroll={handleScroll}
          scrollEventThrottle={16}
        >
          {isLoading ? (
            <View style={styles.loadingContainer}>
              <LoadingSpinner size={16} showText={false} />
            </View>
          ) : recentProperties.length === 0 ? (
            <View style={styles.emptyContainer}>
              <IconComponent name="time-outline" size={32} color={colors.COLOR_BLACK_LIGHT_4} />
              <Text style={styles.emptyText}>{t('home.recentlyViewed.noProperties')}</Text>
              <Text style={styles.emptySubtext}>
                {t('home.recentlyViewed.noPropertiesDescription')}
              </Text>
            </View>
          ) : (
            recentProperties.map((property) => (
              <View key={property._id || property.id} style={styles.propertyCard}>
                <PropertyCard
                  property={property}
                  variant="compact"
                  onPress={() => navigateToProperty(property)}
                  showFeatures={false}
                  showTypeIcon={false}
                />
              </View>
            ))
          )}

          <TouchableOpacity
            style={styles.viewAllButton}
            onPress={() => router.push('/properties/recently-viewed')}
          >
            <Text style={styles.viewAllText}>{t('home.viewAll')}</Text>
            <IconComponent name="chevron-forward" size={16} color={colors.primaryColor} />
          </TouchableOpacity>
        </ScrollView>
      </View>
    </BaseWidget>
  );
}

const styles = StyleSheet.create({
  widgetContent: {
    position: 'relative',
  },
  container: {
    marginVertical: 5,
  },
  scrollContent: {
    paddingHorizontal: 15,
    paddingRight: 35,
  },
  propertyCard: {
    width: 140,
    marginRight: 12,
  },
  arrowButton: {
    position: 'absolute',
    top: '50%',
    zIndex: 10,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
    transform: [{ translateY: -18 }],
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.1)',
  },
  leftArrow: {
    left: 10,
  },
  rightArrow: {
    right: 10,
  },
  viewAllButton: {
    width: 80,
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderStyle: 'dashed',
    flexDirection: 'column',
  },
  viewAllText: {
    color: colors.primaryColor,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 4,
  },
  loadingContainer: {
    width: '100%',
    height: 140,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 15,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 30,
    paddingHorizontal: 35,
  },
  emptyText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_4,
    marginTop: 8,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    marginTop: 4,
    textAlign: 'center',
  },
  errorContainer: {
    padding: 15,
    alignItems: 'center',
  },
  errorText: {
    color: colors.COLOR_BLACK_LIGHT_4,
    fontSize: 12,
  },
});
