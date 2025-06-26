import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, ViewStyle, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { IconButton } from './IconButton';
import { Property } from '@/services/propertyService';
import { getPropertyTitle, getPropertyImageSource } from '@/utils/propertyUtils';
import { useFavorites } from '@/hooks/useFavorites';
import { SaveButton } from './SaveButton';

export type PropertyType = 'apartment' | 'house' | 'coliving' | 'eco';

export type PropertyCardVariant = 'default' | 'compact' | 'featured' | 'saved';

type PropertyCardProps = {
    // Core data - can pass either individual props or a Property object
    property?: Property;
    id?: string;
    title?: string;
    location?: string;
    price?: number;
    currency?: string;
    type?: PropertyType;
    imageSource?: any;
    bedrooms?: number;
    bathrooms?: number;
    size?: number;
    sizeUnit?: string;
    rating?: number;
    reviewCount?: number;

    // Display options
    variant?: PropertyCardVariant;
    showFavoriteButton?: boolean;
    showVerifiedBadge?: boolean;
    showTypeIcon?: boolean;
    showFeatures?: boolean;
    showPrice?: boolean;
    showLocation?: boolean;
    showRating?: boolean;

    // State
    isVerified?: boolean;

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
};

const { width: screenWidth } = Dimensions.get('window');

const getPropertyTypeIcon = (type: PropertyType) => {
    switch (type) {
        case 'apartment':
            return 'business-outline';
        case 'house':
            return 'home-outline';
        case 'coliving':
            return 'people-outline';
        case 'eco':
            return 'leaf-outline';
        default:
            return 'home-outline';
    }
};

const getVariantStyles = (variant: PropertyCardVariant) => {
    switch (variant) {
        case 'compact':
            return {
                imageHeight: 120,
                titleLines: 1,
                locationLines: 1,
                showFeatures: false,
                showTypeIcon: false,
                showRating: false,
            };
        case 'featured':
            return {
                imageHeight: 200,
                titleLines: 2,
                locationLines: 1,
                showFeatures: true,
                showTypeIcon: true,
                showRating: true,
            };
        case 'saved':
            return {
                imageHeight: 160,
                titleLines: 2,
                locationLines: 1,
                showFeatures: true,
                showTypeIcon: true,
                showRating: true,
            };
        default:
            return {
                imageHeight: 160,
                titleLines: 2,
                locationLines: 1,
                showFeatures: true,
                showTypeIcon: true,
                showRating: true,
            };
    }
};

export function PropertyCard({
    // Core data
    property,
    id,
    title,
    location,
    price,
    currency = '$',
    type,
    imageSource,
    bedrooms,
    bathrooms,
    size,
    sizeUnit = 'm²',
    rating,
    reviewCount,

    // Display options
    variant = 'default',
    showFavoriteButton = true,
    showVerifiedBadge = true,
    showTypeIcon = true,
    showFeatures = true,
    showPrice = true,
    showLocation = true,
    showRating = true,

    // State
    isVerified = false,

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
}: PropertyCardProps) {
    const { isFavorite, toggleFavorite, isPropertySaving } = useFavorites();

    // Use property object if provided, otherwise use individual props
    const propertyData = property ? {
        id: property._id || property.id,
        title: getPropertyTitle(property),
        location: `${property.address.city}, ${property.address.state}`,
        price: property.rent.amount,
        currency: property.rent.currency,
        type: property.type === 'room' ? 'apartment' : property.type === 'studio' ? 'apartment' : property.type === 'house' ? 'house' : 'apartment' as PropertyType,
        imageSource: getPropertyImageSource(property.images),
        bedrooms: property.bedrooms || 0,
        bathrooms: property.bathrooms || 0,
        size: property.squareFootage || 0,
        isVerified: false,
        rating: 4.5, // Default rating since Property interface doesn't have this
        reviewCount: 12, // Default review count since Property interface doesn't have this
    } : {
        id,
        title,
        location,
        price,
        currency,
        type,
        imageSource,
        bedrooms,
        bathrooms,
        size,
        isVerified,
        rating,
        reviewCount,
    };

    const isEco = Boolean(property && typeof property === 'object' && 'ecoCertified' in property && property.ecoCertified);
    const isFeatured = variant === 'featured' || Boolean(property && typeof property === 'object' && 'isFeatured' in property && property.isFeatured);
    const isPropertyFavorite = isFavorite(propertyData.id || '');

    // Get variant-specific styles
    const variantStyles = getVariantStyles(variant);
    const finalImageHeight = imageHeight || variantStyles.imageHeight;
    const finalTitleLines = titleLines || variantStyles.titleLines;
    const finalLocationLines = locationLines || variantStyles.locationLines;
    const shouldShowFeatures = showFeatures && variantStyles.showFeatures;
    const shouldShowTypeIcon = showTypeIcon && variantStyles.showTypeIcon;
    const shouldShowRating = showRating && variantStyles.showRating;

    const handleFavoritePress = () => {
        if (propertyData.id) {
            toggleFavorite(propertyData.id || '');
        }
    };

    return (
        <TouchableOpacity
            style={[
                styles.container,
                style as ViewStyle,
                isFeatured ? styles.featuredCard : null,
            ]}
            onPress={onPress}
            onLongPress={onLongPress}
            activeOpacity={0.9}
        >
            <View style={[
                styles.imageContainer,
                { height: finalImageHeight },
                isFeatured ? styles.featuredImageContainer : null,
            ]}>
                <Image
                    source={propertyData.imageSource}
                    style={styles.image}
                    resizeMode="cover"
                />

                {/* Save Button */}
                {showFavoriteButton && (
                    <SaveButton
                        isSaved={isPropertyFavorite}
                        onPress={handleFavoritePress}
                        size={24}
                        variant="heart"
                        color="#222"
                        activeColor="#EF4444"
                        isLoading={isPropertySaving(propertyData.id || '')}
                        style={styles.saveButton}
                    />
                )}

                {/* Eco Badge */}
                {isEco && (
                    <View style={styles.ecoBadge}>
                        <IconButton
                            name="leaf-outline"
                            color="#4CAF50"
                            backgroundColor="#e8f5e9"
                            size={16}
                        />
                    </View>
                )}

                {/* Verified Badge */}
                {showVerifiedBadge && (isVerified || propertyData.isVerified) && (
                    <View style={styles.verifiedBadge}>
                        <IconButton
                            name="shield-checkmark"
                            color="#fff"
                            backgroundColor={colors.primaryColor}
                            size={14}
                        />
                    </View>
                )}

                {/* Custom Badge Content */}
                {badgeContent && (
                    <View style={styles.customBadge}>{badgeContent as React.ReactNode}</View>
                )}

                {/* Overlay Content */}
                {overlayContent && (
                    <View style={styles.overlay}>{overlayContent as React.ReactNode}</View>
                )}
            </View>

            <View style={[
                styles.content,
                variant === 'compact' ? styles.compactContent : null,
                isFeatured ? styles.featuredContent : null,
            ]}>
                {/* Header with Title and Price */}
                <View style={styles.header}>
                    <View style={styles.titleContainer}>
                        <Text style={[
                            styles.title,
                            variant === 'compact' ? styles.compactTitle : null,
                            isFeatured ? styles.featuredTitle : null,
                        ]} numberOfLines={finalTitleLines}>
                            {propertyData.title}
                        </Text>
                        {shouldShowTypeIcon && propertyData.type && (
                            <IconButton
                                name={getPropertyTypeIcon(propertyData.type)}
                                size={14}
                                color={colors.primaryDark_1}
                                backgroundColor="transparent"
                                style={styles.typeIcon}
                            />
                        )}
                    </View>
                    {showPrice && propertyData.price && (
                        <Text style={[
                            styles.price,
                            variant === 'compact' ? styles.compactPrice : null,
                            isFeatured ? styles.featuredPrice : null,
                        ]}>
                            {propertyData.currency}{propertyData.price.toLocaleString()}
                            <Text style={styles.priceUnit}>/month</Text>
                        </Text>
                    )}
                </View>

                {/* Location */}
                {showLocation && propertyData.location && (
                    <Text style={[
                        styles.location,
                        variant === 'compact' ? styles.compactLocation : null,
                        isFeatured ? styles.featuredLocation : null,
                    ]} numberOfLines={finalLocationLines}>
                        {propertyData.location}
                    </Text>
                )}

                {/* Rating */}
                {shouldShowRating && propertyData.rating && (
                    <View style={styles.ratingContainer}>
                        <IconButton
                            name="star"
                            size={14}
                            color="#FFD700"
                            backgroundColor="transparent"
                        />
                        <Text style={styles.ratingText}>
                            {propertyData.rating.toFixed(1)}
                        </Text>
                        {propertyData.reviewCount && (
                            <Text style={styles.reviewCount}>
                                ({propertyData.reviewCount})
                            </Text>
                        )}
                    </View>
                )}

                {/* Features */}
                {shouldShowFeatures && (
                    <View style={styles.features}>
                        <View style={styles.feature}>
                            <Text style={styles.featureText}>
                                {propertyData.bedrooms} bed{propertyData.bedrooms !== 1 ? 's' : ''}
                            </Text>
                        </View>
                        <Text style={styles.featureSeparator}>•</Text>
                        <View style={styles.feature}>
                            <Text style={styles.featureText}>
                                {propertyData.bathrooms} bath{propertyData.bathrooms !== 1 ? 's' : ''}
                            </Text>
                        </View>
                        {propertyData.size && propertyData.size > 0 && (
                            <>
                                <Text style={styles.featureSeparator}>•</Text>
                                <View style={styles.feature}>
                                    <Text style={styles.featureText}>
                                        {propertyData.size} {sizeUnit}
                                    </Text>
                                </View>
                            </>
                        )}
                    </View>
                )}
            </View>

            {/* Footer Content */}
            {footerContent && (
                <View style={styles.footer}>{footerContent as React.ReactNode}</View>
            )}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.primaryLight,
        borderRadius: 12,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08,
        shadowRadius: 8,
        elevation: 3,
        marginBottom: 12,
        width: '100%',
        maxWidth: 350,
    },
    featuredCard: {
        borderWidth: 1,
        borderColor: '#e0e0e0',
        shadowOpacity: 0.12,
        shadowRadius: 12,
        elevation: 6,
    },
    imageContainer: {
        position: 'relative',
        height: 160,
        backgroundColor: '#f8f8f8',
    },
    featuredImageContainer: {
        height: 200,
    },
    image: {
        width: '100%',
        height: '100%',
    },
    saveButton: {
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 2,
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
    content: {
        padding: 10,
    },
    compactContent: {
        padding: 6,
    },
    featuredContent: {
        padding: 14,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 3,
    },
    titleContainer: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        flex: 1,
        marginRight: 6,
    },
    title: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.primaryDark,
        flex: 1,
        lineHeight: 18,
    },
    compactTitle: {
        fontSize: 12,
        fontWeight: '500',
    },
    featuredTitle: {
        fontSize: 16,
        fontWeight: '700',
    },
    typeIcon: {
        marginLeft: 4,
    },
    price: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    compactPrice: {
        fontSize: 12,
    },
    featuredPrice: {
        fontSize: 16,
    },
    priceUnit: {
        fontSize: 12,
        fontWeight: '400',
        color: colors.primaryDark_1,
    },
    location: {
        fontSize: 12,
        color: colors.primaryDark_1,
        marginBottom: 6,
        lineHeight: 16,
    },
    compactLocation: {
        fontSize: 11,
        marginBottom: 4,
    },
    featuredLocation: {
        fontSize: 14,
        marginBottom: 10,
    },
    ratingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 6,
    },
    ratingText: {
        fontSize: 12,
        fontWeight: '500',
        color: colors.primaryDark,
        marginLeft: 3,
    },
    reviewCount: {
        fontSize: 12,
        color: colors.primaryDark_1,
        marginLeft: 3,
    },
    features: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
    },
    feature: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    featureText: {
        fontSize: 12,
        color: colors.primaryDark_1,
    },
    featureSeparator: {
        fontSize: 12,
        color: colors.primaryDark_1,
        marginHorizontal: 4,
    },
    footer: {
        marginTop: 10,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: '#f0f0f0',
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
}); 