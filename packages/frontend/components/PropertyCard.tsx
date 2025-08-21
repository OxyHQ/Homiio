import React, { useCallback } from 'react';
import { View, Image, StyleSheet, TouchableOpacity, ViewStyle, Platform } from 'react-native';
import { colors } from '@/styles/colors';
import { IconButton } from './IconButton';
import { Property, PriceUnit } from '@homiio/shared-types';
import { getPropertyTitle, getPropertyImageSource } from '@/utils/propertyUtils';

import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';

import { SaveButton } from './SaveButton';
import { CurrencyFormatter } from './CurrencyFormatter';
import { ThemedText } from '@/components/ThemedText';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { prefetchProperty, prefetchPropertyStats } from '@/utils/queryPrefetch';

export type PropertyCardVariant = 'default' | 'compact' | 'featured' | 'saved';
export type PropertyCardOrientation = 'vertical' | 'horizontal';

type PropertyCardProps = {
  // Core data - now primarily uses property object
  property: Property;

  // Display options
  variant?: PropertyCardVariant;
  orientation?: PropertyCardOrientation;
  showFavoriteButton?: boolean;
  showVerifiedBadge?: boolean;
  showTypeIcon?: boolean;
  showFeatures?: boolean;
  showPrice?: boolean;
  showLocation?: boolean;
  showRating?: boolean;

  // State
  isSelected?: boolean;
  isProcessing?: boolean;

  // Actions
  onPress?: () => void;
  onLongPress?: () => void;

  // Styling
  style?: ViewStyle;
  imageHeight?: number;
  titleLines?: number;
  locationLines?: number;

  // Custom content
  footerContent?: React.ReactNode;
  badgeContent?: React.ReactNode;
  overlayContent?: React.ReactNode;

  // Saved-specific
  noteText?: string;
  onPressNote?: () => void;
};

// const { width: screenWidth } = Dimensions.get('window');

const getVariantStyles = (variant: PropertyCardVariant) => {
  const variants = {
    compact: {
      imageHeight: 60,
      showFeatures: true,
      showTypeIcon: false,
      showRating: false,
      titleLines: 2,
      locationLines: 1,
      showPrice: false,
    },
    featured: {
      imageHeight: 140,
      showFeatures: true,
      showTypeIcon: true,
      showRating: true,
      titleLines: 2,
      locationLines: 2,
      showPrice: true,
    },
    saved: {
      imageHeight: 120,
      showFeatures: true,
      showTypeIcon: false,
      showRating: true,
      titleLines: 2,
      locationLines: 1,
      showPrice: true,
    },
    default: {
      imageHeight: 120,
      showFeatures: true,
      showTypeIcon: false,
      showRating: true,
      titleLines: 2,
      locationLines: 1,
      showPrice: true,
    },
  };

  return variants[variant] || variants.default;
};

export function PropertyCard({
  // Core data
  property,

  // Display options
  variant = 'default',
  orientation = 'vertical',
  showFavoriteButton = true,
  showVerifiedBadge = true,
  showTypeIcon = true,
  showFeatures = true,
  showPrice = true,
  showLocation = true,
  showRating = true,

  // State
  isSelected = false,
  isProcessing = false,

  // Actions
  onPress,
  onLongPress,

  // Styling
  style,
  imageHeight,
  titleLines,
  locationLines,

  // Custom content
  footerContent,
  badgeContent,
  overlayContent,
  noteText,
  onPressNote,
}: PropertyCardProps) {
  // Use saved properties context to check if property is saved
  const { isPropertySaved, isInitialized } = useSavedPropertiesContext();

  // Extract data from property object
  const propertyData = {
    id: property._id || property.id,
    title: getPropertyTitle(property),
    location: `${property.address?.city || ''}, ${property.address?.state || ''}`,
    price: property.rent.amount,
    currency: property.rent.currency,
    priceUnit: property.priceUnit || PriceUnit.MONTH,
    type: property.type === 'room' ? 'apartment' : property.type === 'studio' ? 'apartment' : property.type,
    imageSource: getPropertyImageSource(property),
    bedrooms: property.bedrooms || 0,
    bathrooms: property.bathrooms || 0,
    size: property.squareFootage || 0,
    sizeUnit: 'm²',
    isVerified: property.isVerified || false,
    rating: 4.5, // Default rating since Property interface doesn't have this
    reviewCount: 12, // Default review count since Property interface doesn't have this
  };

  const isEco = Boolean(property.isEcoFriendly);
  const isFeatured = variant === 'featured';
  const isPropertySavedState = propertyData.id && isInitialized ? isPropertySaved(propertyData.id) : false;

  // Get variant-specific styles
  const variantStyles = getVariantStyles(variant);

  // Apply variant-specific overrides
  const finalImageHeight = imageHeight || variantStyles.imageHeight;
  const finalShowFeatures = showFeatures && variantStyles.showFeatures;
  const finalShowTypeIcon = showTypeIcon && variantStyles.showTypeIcon;
  const finalShowRating = showRating && variantStyles.showRating;
  const finalShowPrice = showPrice && (variantStyles.showPrice !== false);
  const finalTitleLines = titleLines !== undefined ? titleLines : variantStyles.titleLines;
  const finalLocationLines = locationLines !== undefined ? locationLines : variantStyles.locationLines;

  const queryClient = useQueryClient();
  const handlePressIn = useCallback(() => {
    const idToPrefetch = property._id || property.id;
    if (idToPrefetch) {
      prefetchProperty(queryClient, idToPrefetch as string);
      prefetchPropertyStats(queryClient, idToPrefetch as string);
    }
  }, [queryClient, property._id, property.id]);

  return (
    <TouchableOpacity
      style={[
        styles.container,
        orientation === 'horizontal' ? styles.horizontalContainer : null,
        style as ViewStyle,
        variant === 'featured' ? styles.featuredCard : null,
        variant === 'compact' ? styles.compactCard : null,
        variant === 'saved' ? styles.savedCard : null,
        isProcessing ? { opacity: 0.7 } : null,
      ]}
      onPress={onPress}
      onPressIn={handlePressIn}
      onLongPress={onLongPress}
      activeOpacity={0.9}
    >
      <View
        style={[
          styles.imageContainer,
          orientation === 'horizontal' ? styles.horizontalImageContainer : null,
          isFeatured ? styles.featuredImageContainer : null,
          isSelected ? styles.selectedImage : null,
          orientation === 'horizontal'
            ? { height: finalImageHeight, width: finalImageHeight }
            : { width: '100%', aspectRatio: 1 },
        ]}
      >
        <Image source={propertyData.imageSource} style={styles.image} resizeMode="cover" />

        {/* Save Button and Rating Container */}
        {/* Rating - moved to top-left */}
        {finalShowRating && propertyData.rating && (
          <View style={styles.ratingBadge}>
            <ThemedText style={styles.ratingBadgeText}>{propertyData.rating.toFixed(1)}</ThemedText>
            <IconButton
              style={{ width: 10, height: 10 }}
              name="star"
              size={12}
              color="#FFD700"
              backgroundColor="transparent"
            />
          </View>
        )}

        {/* Save Button - moved to top-right */}
        {showFavoriteButton && (
          <SaveButton
            isSaved={isPropertySavedState}
            size={24}
            variant="heart"
            color="#222"
            activeColor="#EF4444"
            style={styles.saveButton}
            property={property}
          />
        )}

        {/* Eco Badge */}
        {isEco && (
          <View style={styles.ecoBadge}>
            <IconButton name="leaf-outline" color="#4CAF50" backgroundColor="#e8f5e9" size={16} />
          </View>
        )}

        {/* Verified Badge */}
        {showVerifiedBadge && propertyData.isVerified && (
          <View style={styles.verifiedBadge}>
            <IconButton
              name="shield-checkmark"
              color="#fff"
              backgroundColor={colors.primaryColor}
              size={14}
            />
          </View>
        )}

        {/* Type Icon */}
        {finalShowTypeIcon && propertyData.type && (
          <View style={styles.typeIcon}>
            <IconButton
              name={propertyData.type === 'house' ? 'home-outline' : 'business-outline'}
              color="#fff"
              backgroundColor="rgba(0, 0, 0, 0.6)"
              size={16}
            />
          </View>
        )}

        {/* Custom Badge Content */}
        {badgeContent && <View style={styles.customBadge}>{badgeContent as React.ReactNode}</View>}

        {/* Overlay Content */}
        {overlayContent && <View style={styles.overlay}>{overlayContent as React.ReactNode}</View>}
      </View>

      <View
        style={[
          styles.content,
          orientation === 'horizontal' ? styles.horizontalContent : null,
          variant === 'compact' ? styles.compactContent : null,
          variant === 'featured' ? styles.featuredContent : null,
          variant === 'saved' ? styles.savedContent : null,
        ]}
      >
        {/* Title */}
        <ThemedText
          style={[
            styles.title,
            variant === 'compact' ? styles.compactTitle : null,
            isFeatured ? styles.featuredTitle : null,
            orientation === 'horizontal' ? styles.horizontalTitle : null,
          ]}
          numberOfLines={orientation === 'horizontal' ? undefined : finalTitleLines}
        >
          {propertyData.title}
        </ThemedText>

        {/* Location */}
        {showLocation && propertyData.location && (
          <ThemedText
            style={[
              styles.location,
              variant === 'compact' ? styles.compactLocation : null,
              isFeatured ? styles.featuredLocation : null,
              orientation === 'horizontal' ? styles.horizontalLocation : null,
            ]}
            numberOfLines={finalLocationLines}
          >
            {propertyData.location}
          </ThemedText>
        )}

        {/* Features */}
        {finalShowFeatures && (
          <View style={styles.features}>
            <View style={styles.feature}>
              <ThemedText style={styles.featureText}>
                {`${propertyData.bedrooms} bed${propertyData.bedrooms !== 1 ? 's' : ''}`}
              </ThemedText>
            </View>
            <ThemedText style={styles.featureSeparator}>•</ThemedText>
            <View style={styles.feature}>
              <ThemedText style={styles.featureText}>
                {`${propertyData.bathrooms} bath${propertyData.bathrooms !== 1 ? 's' : ''}`}
              </ThemedText>
            </View>
            {propertyData.size && propertyData.size > 0 && (
              <>
                <ThemedText style={styles.featureSeparator}>•</ThemedText>
                <View style={styles.feature}>
                  <ThemedText style={styles.featureText}>
                    {`${propertyData.size} ${propertyData.sizeUnit}`}
                  </ThemedText>
                </View>
              </>
            )}
            {variant === 'compact' && propertyData.type && (
              <>
                <ThemedText style={styles.featureSeparator}>•</ThemedText>
                <ThemedText style={styles.featureText}>{propertyData.type}</ThemedText>
              </>
            )}
          </View>
        )}

        {/* Price */}
        {finalShowPrice && propertyData.price && (
          <View style={styles.priceContainer}>
            <ThemedText
              style={[
                styles.price,
                variant === 'compact' ? styles.compactPrice : null,
                isFeatured ? styles.featuredPrice : null,
              ]}
            >
              <CurrencyFormatter
                amount={propertyData.price}
                originalCurrency={propertyData.currency}
                showConversion={false}
              />
              <ThemedText style={styles.priceUnit}> / {propertyData.priceUnit}</ThemedText>
            </ThemedText>
          </View>
        )}
      </View>

      {/* Inline Note (inside card content area) */}
      {(onPressNote || (noteText && noteText.trim().length > 0)) && (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={onPressNote}
          style={StyleSheet.flatten([
            styles.noteContainer,
            (!noteText || noteText.trim().length === 0) && styles.noteEmpty,
            variant === 'compact' && styles.compactNoteContainer,
          ])}
        >
          <View style={styles.noteRow}>
            <View style={styles.noteIconWrap}>
              <Ionicons name="document-text-outline" size={14} color={colors.primaryColor} />
            </View>
            <ThemedText
              numberOfLines={variant === 'compact' ? 1 : 2}
              style={StyleSheet.flatten([
                styles.noteText,
                (!noteText || noteText.trim().length === 0) && styles.notePlaceholder,
                variant === 'compact' && styles.compactNoteText,
              ])}
            >
              {noteText && noteText.trim().length > 0 ? noteText : 'Add a note'}
            </ThemedText>
            <Ionicons name="create-outline" size={16} color={colors.primaryColor} />
          </View>
        </TouchableOpacity>
      )}

      {/* Footer Content */}
      {footerContent && <View style={styles.footer}>{footerContent as React.ReactNode}</View>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // ===== BASE STYLES (shared across all variants) =====
  container: {
    width: '100%',
    height: 'auto',
    gap: 8,
  },
  horizontalContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  imageContainer: {
    position: 'relative',
    backgroundColor: '#f8f8f8',
    borderRadius: 16,
    overflow: 'hidden',
  },
  horizontalImageContainer: {
    flexShrink: 0,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
    gap: 2,
  },
  horizontalContent: {
    flex: 1,
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: '#222222',
    lineHeight: 20,
  },
  horizontalTitle: {
  },
  location: {
    fontSize: 12,
    color: '#717171',
    lineHeight: 18,
  },
  horizontalLocation: {
    fontSize: 14,
    color: '#717171',
    lineHeight: 18,
  },
  features: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureText: {
    fontSize: 12,
    color: '#717171',
  },
  featureSeparator: {
    fontSize: 12,
    color: '#717171',
    marginHorizontal: 4,
  },
  priceContainer: {
    marginTop: 'auto',
  },
  price: {
    fontSize: 15,
    fontWeight: '700',
    color: '#222222',
  },
  priceUnit: {
    fontSize: 12,
    fontWeight: '400',
    color: '#717171',
  },

  // Badge and overlay styles (shared)
  saveButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 20,
    padding: 8,
  },
  ecoBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 2,
    backgroundColor: '#e8f5e9',
    borderRadius: 14,
    padding: 3,
  },
  verifiedBadge: {
    position: 'absolute',
    top: 8,
    left: 36,
    zIndex: 2,
  },
  typeIcon: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    zIndex: 2,
  },
  ratingBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 0,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }
      : { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 }),
    justifyContent: 'center',
  },
  ratingBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#222222',
    marginRight: 1,
    fontFamily: 'Phudu',
  },

  // Note styles (shared)
  noteContainer: {
    marginTop: 8,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#efefef',
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
      : { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1 }),
  },
  noteEmpty: {
    backgroundColor: '#fafafa',
    borderStyle: 'dashed',
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  noteIconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryLight,
  },
  noteText: {
    fontSize: 13,
    color: '#444444',
    lineHeight: 18,
  },
  notePlaceholder: {
    color: '#999999',
    fontStyle: 'italic',
  },

  // Footer and overlay styles (shared)
  footer: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
  selectedImage: {
    borderWidth: 2,
    borderColor: colors.primaryColor,
    borderRadius: 25,
  },
  customBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 1,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.05)',
  },

  // ===== COMPACT VARIANT STYLES =====
  compactCard: {
  },
  compactContent: {
  },
  compactTitle: {
  },
  compactLocation: {
  },
  compactPrice: {
  },
  compactNoteContainer: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  compactNoteText: {
    fontSize: 12,
    lineHeight: 16,
  },

  // ===== FEATURED VARIANT STYLES =====
  featuredCard: {
  },
  featuredImageContainer: {},
  featuredContent: {
  },
  featuredTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  featuredLocation: {
    fontSize: 13,
  },
  featuredPrice: {
    fontSize: 15,
  },

  // ===== SAVED VARIANT STYLES =====
  savedCard: {
    // Saved card styling
  },
  savedContent: {
    // Saved content styling
  },

  // ===== DEFAULT VARIANT STYLES =====
  // (No specific styles needed - uses base styles)
});
