import React, { useCallback, useMemo } from 'react';
import { View, Image, StyleSheet, Pressable, TouchableOpacity, ViewStyle, Platform } from 'react-native';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
import { Property, PriceUnit, RentMode } from '@homiio/shared-types';
import { getPropertyTitle, getPropertyImageSource } from '@/utils/propertyUtils';

import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { useRentalMode } from '@/context/RentalModeContext';

import { SaveButton } from './SaveButton';
import { CurrencyFormatter } from './CurrencyFormatter';
import { ThemedText } from '@/components/ThemedText';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { prefetchProperty, prefetchPropertyStats } from '@/utils/queryPrefetch';
import { PropertyCardSkeleton } from './ui/skeletons/PropertyCardSkeleton';

/**
 * Derive the displayed price unit for a property based on the user's
 * currently-selected rental mode. Listings tagged `RentMode.VACATION` or
 * `RentMode.BOTH` displayed in vacation mode always show per-night pricing
 * regardless of how the host stored the unit. Long-term mode falls back to
 * the stored unit (typically MONTH).
 */
function resolvePriceUnit(property: Property, mode: 'long_term' | 'vacation'): PriceUnit {
  if (mode === 'vacation') return PriceUnit.NIGHT;
  if (property.priceUnit) return property.priceUnit;
  return PriceUnit.MONTH;
}

function shouldShowInstantBook(
  property: Property,
  mode: 'long_term' | 'vacation',
): boolean {
  if (mode !== 'vacation') return false;
  if (!property.instantBook) return false;
  return property.rentMode === RentMode.VACATION || property.rentMode === RentMode.BOTH;
}

export type PropertyCardVariant = 'default' | 'compact' | 'featured' | 'saved' | 'grid';
export type PropertyCardOrientation = 'vertical' | 'horizontal';

/**
 * Property objects can be momentarily flagged as `isSaved` by the server
 * response while the saved-properties context is still bootstrapping. We
 * type that optional flag here instead of casting through `any`.
 */
type PropertyWithSavedHint = Property & { readonly isSaved?: boolean };

type PropertyCardProps = {
  // Core data - now primarily uses property object
  property: Property;

  // Display options
  variant?: PropertyCardVariant;
  orientation?: PropertyCardOrientation;
  showSaveButton?: boolean;
  showVerifiedBadge?: boolean;
  showTypeIcon?: boolean;
  showFeatures?: boolean;
  showPrice?: boolean;
  showLocation?: boolean;
  showRating?: boolean;
  showSaveCount?: boolean;
  saveCountDisplayMode?: 'badge' | 'inline';

  // State
  isSelected?: boolean;
  isProcessing?: boolean;
  isLoading?: boolean;

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
    /**
     * Airbnb-2026 grid variant — photo-first card used in dense, multi-
     * column merchandising grids (no overlays, no rating, single heart
     * top-right, minimal text below).
     */
    grid: {
      imageHeight: 0,
      showFeatures: false,
      showTypeIcon: false,
      showRating: false,
      titleLines: 1,
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
  showSaveButton = true,
  showVerifiedBadge = true,
  showTypeIcon = true,
  showFeatures = true,
  showPrice = true,
  showLocation = true,
  showRating = true,
  showSaveCount = false,
  saveCountDisplayMode = 'badge',

  // State
  isSelected = false,
  isProcessing = false,
  isLoading = false,

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
  const { mode } = useRentalMode();
  const queryClient = useQueryClient();

  // Define the callback function (using property parameter directly)
  const handlePressIn = useCallback(() => {
    if (!property) return;
    const idToPrefetch = property._id || property.id;
    if (idToPrefetch) {
      prefetchProperty(queryClient, idToPrefetch as string);
      prefetchPropertyStats(queryClient, idToPrefetch as string);
    }
  }, [queryClient, property]);

  const showInstantBook = useMemo(
    () => (property ? shouldShowInstantBook(property, mode) : false),
    [property, mode],
  );

  // Show skeleton loading state
  if (isLoading) {
    return (
      <PropertyCardSkeleton
        variant={variant}
        orientation={orientation}
        showSaveButton={showSaveButton}
        showRating={showRating}
        showPrice={showPrice}
        showFeatures={showFeatures}
        showLocation={showLocation}
        imageHeight={imageHeight}
      />
    );
  }

  // Early return if property is null/undefined
  if (!property) {
    return null;
  }

  // Extract data from property object
  const propertyData = {
    id: property._id || property.id,
    title: getPropertyTitle(property),
    location: `${property.address?.city || ''}, ${property.address?.state || ''}`,
    price: property.rent.amount,
    currency: property.rent.currency,
    priceUnit: resolvePriceUnit(property, mode),
    type: property.type === 'room' ? 'apartment' : property.type === 'studio' ? 'apartment' : property.type,
    imageSource: getPropertyImageSource(property),
    bedrooms: property.bedrooms || 0,
    bathrooms: property.bathrooms || 0,
    size: property.squareFootage || 0,
    sizeUnit: 'm²',
    isVerified: property.isVerified || false,
    rating: undefined as number | undefined,
    reviewCount: undefined as number | undefined,
  };

  const isEco = Boolean(property.isEcoFriendly);
  const isFeatured = variant === 'featured';
  const isGrid = variant === 'grid';
  const propertyWithSavedHint = property as PropertyWithSavedHint;
  const isPropertySavedState = propertyData.id
    ? isInitialized
      ? isPropertySaved(propertyData.id)
      : propertyWithSavedHint.isSaved ?? false
    : false;

  /**
   * Grid cards present a photo-first layout. Long-term flats look better
   * square (more wall surface visible), vacation rentals breathe in 4:3
   * so the landscape framing reads. Featured/default carousels keep
   * their existing square aspect.
   */
  const gridAspectRatio = mode === 'vacation' ? 4 / 3 : 1;

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

  return (
    <View
      style={[
        styles.container,
        style as ViewStyle,
        isProcessing ? { opacity: 0.7 } : null,
      ]}
    >
      <Pressable
        style={[
          styles.body,
          orientation === 'horizontal' ? styles.horizontalBody : null,
        ]}
        onPress={onPress}
        onPressIn={handlePressIn}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={propertyData.title}
      >
        <View
          style={[
            styles.imageContainer,
            isGrid ? styles.gridImageContainer : null,
            orientation === 'horizontal' ? styles.horizontalImageContainer : null,
            isSelected ? styles.selectedImage : null,
            orientation === 'horizontal'
              ? { height: finalImageHeight, width: finalImageHeight }
              : isGrid
                ? { width: '100%', aspectRatio: gridAspectRatio }
                : { width: '100%', aspectRatio: 1 },
          ]}
        >
          <Image source={propertyData.imageSource} style={styles.image} resizeMode="cover" />

          {/* Rating - moved to top-left (hidden in grid variant for photo-first feel) */}
          {finalShowRating && propertyData.rating && !isGrid && (
            <View style={styles.ratingBadge}>
              <ThemedText style={styles.ratingBadgeText}>{propertyData.rating.toFixed(1)}</ThemedText>
              <Ionicons name="star" size={12} color={colors.ratingStar} />
            </View>
          )}

        {/* Status badges — suppressed in grid variant to keep cards photo-first */}
        {!isGrid && (
          <>
            {/* Eco Badge */}
            {isEco && (
              <View style={[styles.ecoBadge, styles.statusChip, { backgroundColor: colors.successSubtle }]}>
                <Ionicons name="leaf-outline" size={16} color={colors.success} />
              </View>
            )}

            {/* Verified Badge */}
            {showVerifiedBadge && propertyData.isVerified && (
              <View style={[styles.verifiedBadge, styles.statusChip, { backgroundColor: colors.primaryColor }]}>
                <Ionicons name="shield-checkmark" size={14} color={colors.white} />
              </View>
            )}

            {/* Instant Book badge (vacation mode only) */}
            {showInstantBook && (
              <View style={styles.instantBookBadge}>
                <Ionicons name="flash" size={12} color={colors.white} />
                <ThemedText style={styles.instantBookBadgeText}>Instant book</ThemedText>
              </View>
            )}

            {/* Type Icon */}
            {finalShowTypeIcon && propertyData.type && (
              <View style={[styles.typeIcon, styles.statusChip, { backgroundColor: 'rgba(0, 0, 0, 0.6)' }]}>
                <Ionicons
                  name={(propertyData.type === 'house' ? 'home-outline' : 'business-outline') as IoniconName}
                  size={16}
                  color={colors.white}
                />
              </View>
            )}

            {/* External Source Badge */}
            {property.isExternal && property.source && property.source !== 'internal' && variant !== 'compact' && (
              <View style={styles.sourceBadge}>
                <ThemedText style={styles.sourceBadgeText}>
                  {property.source.charAt(0).toUpperCase() + property.source.slice(1)}
                </ThemedText>
              </View>
            )}
          </>
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
          isGrid ? styles.gridContent : null,
        ]}
      >
        {/* Title */}
        <ThemedText
          style={[
            styles.title,
            isFeatured ? styles.featuredTitle : null,
            isGrid ? styles.gridTitle : null,
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
              isFeatured ? styles.featuredLocation : null,
              orientation === 'horizontal' ? styles.horizontalLocation : null,
              isGrid ? styles.gridLocation : null,
            ]}
            numberOfLines={finalLocationLines}
          >
            {propertyData.location}
          </ThemedText>
        )}

        {/* Features — suppressed in grid variant to keep cards photo-first */}
        {finalShowFeatures && !isGrid && (
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
          <View style={[styles.priceContainer, isGrid ? styles.gridPriceContainer : null]}>
            <BloomText
              style={[
                styles.price,
                isFeatured ? styles.featuredPrice : null,
                isGrid ? styles.gridPrice : null,
              ]}
            >
              <CurrencyFormatter
                amount={propertyData.price}
                originalCurrency={propertyData.currency}
                showConversion={false}
              />
              <BloomText style={[styles.priceUnit, isGrid ? styles.gridPriceUnit : null]}>
                {' / '}{propertyData.priceUnit}
              </BloomText>
            </BloomText>
          </View>
        )}
        </View>
      </Pressable>

      {/* Save Button — lives in an absolutely-positioned overlay that mirrors
          the photo box, as a SIBLING of the body Pressable. This keeps the
          heart its own tap target without nesting a <button> inside the card
          button (invalid HTML + hydration error on web). The overlay matches
          the image geometry per orientation so the heart stays pinned to the
          photo's top-right corner. */}
      {showSaveButton && (
        <View
          pointerEvents="box-none"
          style={[
            styles.mediaOverlay,
            orientation === 'horizontal'
              ? { width: finalImageHeight, height: finalImageHeight }
              : { left: 0, right: 0, aspectRatio: isGrid ? gridAspectRatio : 1 },
          ]}
        >
          <SaveButton
            isSaved={isPropertySavedState}
            size={variant === 'compact' ? 5 : 24}
            variant="heart"
            color={colors.COLOR_BLACK}
            activeColor={colors.busy}
            style={styles.saveButton}
            property={property}
            showCount={showSaveCount}
            countDisplayMode={saveCountDisplayMode}
          />
        </View>
      )}

      {/* Inline Note — sibling of the body Pressable, its own tap target. */}
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
    </View>
  );
}

const styles = StyleSheet.create({
  // ===== BASE STYLES (shared across all variants) =====
  container: {
    width: '100%',
    height: 'auto',
    position: 'relative',
    gap: spacing.sm,
  },
  body: {
    width: '100%',
    gap: spacing.sm,
  },
  horizontalBody: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  imageContainer: {
    position: 'relative',
    backgroundColor: colors.COLOR_BLACK_LIGHT_8,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  /**
   * Grid variant — photos read as proper Airbnb tiles: rounder corners
   * (24px) and no shadow on the photo itself (the cell handles spacing).
   */
  gridImageContainer: {
    borderRadius: radius.photo,
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
    color: colors.COLOR_BLACK,
    lineHeight: 20,
  },
  location: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    lineHeight: 18,
  },
  horizontalLocation: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_4,
    lineHeight: 18,
  },
  features: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  feature: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureText: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  featureSeparator: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    marginHorizontal: spacing.xs,
  },
  priceContainer: {
    marginTop: 'auto',
  },
  price: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  priceUnit: {
    fontSize: 12,
    fontWeight: '400',
    color: colors.COLOR_BLACK_LIGHT_4,
  },

  // Badge and overlay styles (shared)
  // Absolute layer pinned to the top-left of the card that mirrors the photo
  // box; hosts the SaveButton as a sibling of the body Pressable so the heart
  // never nests inside the card's button element.
  mediaOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 2,
  },
  saveButton: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    zIndex: 2,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 20,
    padding: spacing.sm,
  },
  statusChip: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ecoBadge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    zIndex: 2,
  },
  verifiedBadge: {
    position: 'absolute',
    top: spacing.sm,
    left: 36,
    zIndex: 2,
  },
  typeIcon: {
    position: 'absolute',
    bottom: spacing.sm,
    left: spacing.sm,
    zIndex: 2,
  },
  sourceBadge: {
    position: 'absolute',
    bottom: spacing.sm,
    right: spacing.sm,
    zIndex: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  instantBookBadge: {
    position: 'absolute',
    bottom: spacing.sm,
    left: spacing.sm,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
    borderRadius: 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  instantBookBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.white,
    letterSpacing: 0.2,
  },
  sourceBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.white,
    textTransform: 'capitalize',
  },
  ratingBadge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 0,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }
      : { shadowColor: colors.COLOR_BLACK, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2 }),
    justifyContent: 'center',
  },
  ratingBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    marginRight: 1,
  },

  // Note styles (shared)
  noteContainer: {
    marginTop: spacing.sm,
    backgroundColor: colors.white,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }
      : { shadowColor: colors.COLOR_BLACK, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 3, elevation: 1 }),
  },
  noteEmpty: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_8,
    borderStyle: 'dashed',
  },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
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
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 18,
  },
  notePlaceholder: {
    color: colors.COLOR_BLACK_LIGHT_5,
    fontStyle: 'italic',
  },

  // Footer and overlay styles (shared)
  footer: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.COLOR_BLACK_LIGHT_6,
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
  compactNoteContainer: {
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  compactNoteText: {
    fontSize: 12,
    lineHeight: 16,
  },

  // ===== FEATURED VARIANT STYLES =====
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

  // ===== GRID VARIANT STYLES =====
  /**
   * Tighter content block under the photo. The grid lives at a wider
   * cadence than carousels — copy stays small so the photo dominates.
   */
  gridContent: {
    gap: 2,
    paddingTop: spacing.sm,
    paddingHorizontal: 2,
  },
  gridTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    lineHeight: 20,
  },
  gridLocation: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.COLOR_BLACK_LIGHT_4,
    lineHeight: 18,
  },
  gridPriceContainer: {
    marginTop: 4,
  },
  gridPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  gridPriceUnit: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.COLOR_BLACK_LIGHT_4,
  },
});
