import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton } from '@oxyhq/bloom';
import { TextLines } from './TextLines';
import { PropertyCardVariant, PropertyCardOrientation } from '../../PropertyCard';

export interface PropertyCardSkeletonProps {
  variant?: PropertyCardVariant;
  orientation?: PropertyCardOrientation;
  showSaveButton?: boolean;
  showRating?: boolean;
  showPrice?: boolean;
  showFeatures?: boolean;
  showLocation?: boolean;
  imageHeight?: number;
}

export function PropertyCardSkeleton({
  variant = 'default',
  orientation = 'vertical',
  showSaveButton = true,
  showRating = true,
  showPrice = true,
  showFeatures = true,
  showLocation = true,
  imageHeight,
}: PropertyCardSkeletonProps) {
  // Define variant-specific dimensions
  const getVariantStyles = (variant: PropertyCardVariant) => {
    const variants = {
      compact: {
        imageHeight: 60,
        showFeatures: true,
        showPrice: false,
        titleLines: 2,
        locationLines: 1,
      },
      featured: {
        imageHeight: 140,
        showFeatures: true,
        showPrice: true,
        titleLines: 2,
        locationLines: 2,
      },
      saved: {
        imageHeight: 120,
        showFeatures: true,
        showPrice: true,
        titleLines: 2,
        locationLines: 1,
      },
      grid: {
        imageHeight: 0,
        showFeatures: false,
        showPrice: true,
        titleLines: 1,
        locationLines: 1,
      },
      default: {
        imageHeight: 120,
        showFeatures: true,
        showPrice: true,
        titleLines: 2,
        locationLines: 1,
      },
    };
    return variants[variant] || variants.default;
  };

  const variantStyles = getVariantStyles(variant);
  const finalImageHeight = imageHeight || variantStyles.imageHeight;

  return (
    <View
      style={[
        styles.container,
        orientation === 'horizontal' ? styles.horizontalContainer : null,
        variant === 'featured' ? styles.featuredCard : null,
        variant === 'compact' ? styles.compactCard : null,
        variant === 'saved' ? styles.savedCard : null,
      ]}
    >
      {/* Image Container */}
      <View
        style={[
          styles.imageContainer,
          orientation === 'horizontal' ? styles.horizontalImageContainer : null,
          variant === 'featured' ? styles.featuredImageContainer : null,
          orientation === 'horizontal'
            ? { height: finalImageHeight, width: finalImageHeight }
            : { width: '100%', aspectRatio: 1 },
        ]}
      >
        <Skeleton.Box
          width="100%"
          height={finalImageHeight}
          borderRadius={16}
        />

        {/* Save Button Skeleton */}
        {showSaveButton && (
          <Skeleton.Box
            width={32}
            height={32}
            borderRadius={16}
            style={styles.saveButtonSkeleton}
          />
        )}

        {/* Rating Badge Skeleton */}
        {showRating && (
          <Skeleton.Box
            width={50}
            height={24}
            borderRadius={12}
            style={styles.ratingBadgeSkeleton}
          />
        )}

        {/* Type Icon Skeleton */}
        <Skeleton.Box
          width={32}
          height={32}
          borderRadius={16}
          style={styles.typeIconSkeleton}
        />

        {/* Verified Badge Skeleton */}
        <Skeleton.Box
          width={24}
          height={24}
          borderRadius={12}
          style={styles.verifiedBadgeSkeleton}
        />
      </View>

      {/* Content */}
      <View
        style={[
          styles.content,
          orientation === 'horizontal' ? styles.horizontalContent : null,
        ]}
      >
        {/* Title */}
        <TextLines
          style={StyleSheet.flatten([
            styles.title,
            variant === 'compact' ? styles.compactTitle : null,
            variant === 'featured' ? styles.featuredTitle : null,
            orientation === 'horizontal' ? styles.horizontalTitle : null,
          ])}
          lines={variant === 'compact' ? 1 : 2}
        />

        {/* Location */}
        {showLocation && (
          <TextLines
            style={StyleSheet.flatten([
              styles.location,
              variant === 'compact' ? styles.compactLocation : null,
              variant === 'featured' ? styles.featuredLocation : null,
              orientation === 'horizontal' ? styles.horizontalLocation : null,
            ])}
            lines={1}
          />
        )}

        {/* Features */}
        {showFeatures && (
          <View style={styles.features}>
            <Skeleton.Box width={60} height={14} />
            <Skeleton.Box width={70} height={14} />
            <Skeleton.Box width={50} height={14} />
          </View>
        )}

        {/* Price */}
        {showPrice && (
          <View style={styles.priceContainer}>
            <Skeleton.Box
              width={120}
              height={18}
              style={StyleSheet.flatten([
                styles.price,
                variant === 'compact' ? styles.compactPrice : null,
                variant === 'featured' ? styles.featuredPrice : null,
              ])}
            />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Base styles
  container: {
    width: '100%',
    height: 'auto',
    gap: 8,
  },
  horizontalContainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },

  // Image container
  imageContainer: {
    position: 'relative',
    backgroundColor: '#f8f8f8',
    borderRadius: 16,
    overflow: 'hidden',
  },
  horizontalImageContainer: {
    flexShrink: 0,
  },

  // Content
  content: {
    flex: 1,
    justifyContent: 'space-between',
    gap: 6,
  },
  horizontalContent: {
    flex: 1,
    justifyContent: 'space-between',
  },

  // Text elements
  title: {
    marginBottom: 4,
  },
  location: {
    marginBottom: 4,
  },
  features: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  priceContainer: {
    marginTop: 'auto',
  },
  price: {
    marginTop: 4,
  },

  // Badge skeletons
  saveButtonSkeleton: {
    position: 'absolute',
    top: 8,
    right: 8,
    zIndex: 2,
  },
  ratingBadgeSkeleton: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 2,
  },
  typeIconSkeleton: {
    position: 'absolute',
    top: 8,
    left: 8,
    zIndex: 1,
  },
  verifiedBadgeSkeleton: {
    position: 'absolute',
    top: 40,
    right: 8,
    zIndex: 2,
  },

  // Variant-specific styles
  featuredCard: {
    // Featured card styles if needed
  },
  compactCard: {
    // Compact card styles if needed
  },
  savedCard: {
    // Saved card styles if needed
  },
  featuredImageContainer: {
    // Featured image container styles if needed
  },

  // Variant text styles
  compactTitle: {},
  featuredTitle: {},
  horizontalTitle: {},
  compactLocation: {},
  featuredLocation: {},
  horizontalLocation: {},
  compactPrice: {},
  featuredPrice: {},
});
