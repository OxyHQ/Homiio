import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Skeleton, SkeletonText } from './Skeleton';
import { PropertyCardVariant, PropertyCardOrientation } from '../../PropertyCard';

export interface PropertyCardSkeletonProps {
  variant?: PropertyCardVariant;
  orientation?: PropertyCardOrientation;
  showFavoriteButton?: boolean;
  showRating?: boolean;
  showPrice?: boolean;
  showFeatures?: boolean;
  showLocation?: boolean;
  imageHeight?: number;
}

export function PropertyCardSkeleton({
  variant = 'default',
  orientation = 'vertical',
  showFavoriteButton = true,
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
        <Skeleton
          style={StyleSheet.flatten([
            styles.image,
            { height: finalImageHeight },
          ])}
        />

        {/* Save Button Skeleton */}
        {showFavoriteButton && (
          <Skeleton style={styles.saveButtonSkeleton} />
        )}

        {/* Rating Badge Skeleton */}
        {showRating && (
          <Skeleton style={styles.ratingBadgeSkeleton} />
        )}

        {/* Type Icon Skeleton */}
        <Skeleton style={styles.typeIconSkeleton} />

        {/* Verified Badge Skeleton */}
        <Skeleton style={styles.verifiedBadgeSkeleton} />
      </View>

      {/* Content */}
      <View
        style={[
          styles.content,
          orientation === 'horizontal' ? styles.horizontalContent : null,
        ]}
      >
        {/* Title */}
        <SkeletonText
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
          <SkeletonText
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
            <SkeletonText style={StyleSheet.flatten([styles.featureText, { width: 60 }])} />
            <SkeletonText style={StyleSheet.flatten([styles.featureText, { width: 70 }])} />
            <SkeletonText style={StyleSheet.flatten([styles.featureText, { width: 50 }])} />
          </View>
        )}

        {/* Price */}
        {showPrice && (
          <View style={styles.priceContainer}>
            <SkeletonText
              style={StyleSheet.flatten([
                styles.price,
                variant === 'compact' ? styles.compactPrice : null,
                variant === 'featured' ? styles.featuredPrice : null,
                { width: 120 },
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
  image: {
    width: '100%',
    height: '100%',
    borderRadius: 16,
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
    height: 20,
    marginBottom: 4,
  },
  location: {
    height: 16,
    marginBottom: 4,
  },
  features: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  featureText: {
    height: 14,
  },
  priceContainer: {
    marginTop: 'auto',
  },
  price: {
    height: 18,
    marginTop: 4,
  },

  // Badge skeletons
  saveButtonSkeleton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    zIndex: 2,
  },
  ratingBadgeSkeleton: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 50,
    height: 24,
    borderRadius: 12,
    zIndex: 2,
  },
  typeIconSkeleton: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    zIndex: 1,
  },
  verifiedBadgeSkeleton: {
    position: 'absolute',
    top: 40,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
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
  compactTitle: {
    height: 16,
  },
  featuredTitle: {
    height: 22,
  },
  horizontalTitle: {
    height: 18,
  },
  compactLocation: {
    height: 14,
  },
  featuredLocation: {
    height: 16,
  },
  horizontalLocation: {
    height: 16,
  },
  compactPrice: {
    height: 16,
  },
  featuredPrice: {
    height: 20,
  },
});
