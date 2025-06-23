import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { colors } from '@/styles/colors';
import { IconButton } from './IconButton';
import { Property } from '@/services/propertyService';
import { getPropertyTitle, getPropertyImageSource } from '@/utils/propertyUtils';

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

    // Display options
    variant?: PropertyCardVariant;
    showFavoriteButton?: boolean;
    showVerifiedBadge?: boolean;
    showTypeIcon?: boolean;
    showFeatures?: boolean;
    showPrice?: boolean;
    showLocation?: boolean;

    // State
    isFavorite?: boolean;
    isVerified?: boolean;

    // Actions
    onPress?: () => void;
    onFavoritePress?: () => void;
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
            };
        case 'featured':
            return {
                imageHeight: 250,
                titleLines: 2,
                locationLines: 1,
                showFeatures: true,
                showTypeIcon: true,
            };
        case 'saved':
            return {
                imageHeight: 200,
                titleLines: 2,
                locationLines: 1,
                showFeatures: true,
                showTypeIcon: true,
            };
        default:
            return {
                imageHeight: 200,
                titleLines: 2,
                locationLines: 1,
                showFeatures: true,
                showTypeIcon: true,
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
    currency = '⊜',
    type,
    imageSource,
    bedrooms,
    bathrooms,
    size,
    sizeUnit = 'm²',

    // Display options
    variant = 'default',
    showFavoriteButton = true,
    showVerifiedBadge = true,
    showTypeIcon = true,
    showFeatures = true,
    showPrice = true,
    showLocation = true,

    // State
    isFavorite = false,
    isVerified = false,

    // Actions
    onPress,
    onFavoritePress,
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
    };

    const isEco = Boolean(property && typeof property === 'object' && 'ecoCertified' in property && property.ecoCertified);
    const isFeatured = variant === 'featured' || Boolean(property && typeof property === 'object' && 'isFeatured' in property && property.isFeatured);

    // Get variant-specific styles
    const variantStyles = getVariantStyles(variant);
    const finalImageHeight = imageHeight || variantStyles.imageHeight;
    const finalTitleLines = titleLines || variantStyles.titleLines;
    const finalLocationLines = locationLines || variantStyles.locationLines;
    const shouldShowFeatures = showFeatures && variantStyles.showFeatures;
    const shouldShowTypeIcon = showTypeIcon && variantStyles.showTypeIcon;

    return (
        <TouchableOpacity
            style={[
                styles.container,
                style as ViewStyle,
                isFeatured ? styles.featuredCard : null,
            ]}
            onPress={onPress}
            onLongPress={onLongPress}
            activeOpacity={0.85}
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

                {/* Favorite Button */}
                {showFavoriteButton && (
                    <TouchableOpacity
                        style={styles.favoriteButton}
                        onPress={onFavoritePress}
                        accessibilityLabel={isFavorite ? 'Remove from favorites' : 'Save to favorites'}
                        accessibilityRole="button"
                    >
                        <IconButton
                            name={isFavorite ? 'heart' : 'heart-outline'}
                            color={isFavorite ? colors.chatUnreadBadge : colors.primaryColor}
                            backgroundColor={isFavorite ? '#fff' : 'rgba(255,255,255,0.85)'}
                            size={28}
                            style={styles.favoriteIcon}
                        />
                    </TouchableOpacity>
                )}

                {/* Eco Badge */}
                {isEco ? (
                    <View style={styles.ecoBadge}>
                        <IconButton
                            name="leaf-outline"
                            color="#4CAF50"
                            backgroundColor="#e8f5e9"
                            size={18}
                        />
                    </View>
                ) : null}

                {/* Verified Badge */}
                {showVerifiedBadge && (isVerified || propertyData.isVerified) ? (
                    <View style={styles.verifiedBadge}>
                        <IconButton
                            name="shield-checkmark"
                            color={colors.primaryLight}
                            backgroundColor={colors.primaryColor}
                            size={16}
                        />
                    </View>
                ) : null}

                {/* Custom Badge Content */}
                {badgeContent ? (
                    <View style={styles.customBadge}>{badgeContent as React.ReactNode}</View>
                ) : null}

                {/* Overlay Content */}
                {overlayContent ? (
                    <View style={styles.overlay}>{overlayContent as React.ReactNode}</View>
                ) : null}
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
                                size={16}
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

                {/* Features */}
                {shouldShowFeatures && (
                    <View style={styles.features}>
                        <View style={styles.feature}>
                            <IconButton
                                name="bed-outline"
                                size={16}
                                color={colors.primaryDark_1}
                                backgroundColor="transparent"
                            />
                            <Text style={styles.featureText}>{propertyData.bedrooms}</Text>
                        </View>
                        <View style={styles.feature}>
                            <IconButton
                                name="water-outline"
                                size={16}
                                color={colors.primaryDark_1}
                                backgroundColor="transparent"
                            />
                            <Text style={styles.featureText}>{propertyData.bathrooms}</Text>
                        </View>
                        <View style={styles.feature}>
                            <IconButton
                                name="resize-outline"
                                size={16}
                                color={colors.primaryDark_1}
                                backgroundColor="transparent"
                            />
                            <Text style={styles.featureText}>{propertyData.size} {sizeUnit}</Text>
                        </View>
                    </View>
                )}
            </View>

            {/* Footer Content */}
            {footerContent ? (
                <View style={styles.footer}>{footerContent as React.ReactNode}</View>
            ) : null}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.primaryLight,
        borderRadius: 16,
        overflow: 'hidden',
        shadowColor: colors.primaryDark,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 8,
        elevation: 4,
        marginBottom: 8,
    },
    featuredCard: {
        borderWidth: 2,
        borderColor: colors.primaryColor,
        shadowOpacity: 0.18,
        shadowRadius: 12,
        elevation: 8,
    },
    imageContainer: {
        position: 'relative',
        height: 200,
        backgroundColor: '#f4f4f4',
    },
    featuredImageContainer: {
        height: 260,
    },
    image: {
        width: '100%',
        height: '100%',
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
    },
    favoriteButton: {
        position: 'absolute',
        top: 10,
        right: 10,
        zIndex: 2,
    },
    favoriteIcon: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.18,
        shadowRadius: 4,
        elevation: 2,
    },
    ecoBadge: {
        position: 'absolute',
        top: 10,
        left: 10,
        zIndex: 2,
        backgroundColor: '#e8f5e9',
        borderRadius: 12,
        padding: 2,
    },
    verifiedBadge: {
        position: 'absolute',
        top: 10,
        left: 38,
        zIndex: 2,
    },
    content: {
        padding: 16,
    },
    compactContent: {
        padding: 10,
    },
    featuredContent: {
        padding: 20,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 4,
    },
    titleContainer: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        flex: 1,
        marginRight: 8,
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
        flex: 1,
    },
    compactTitle: {
        fontSize: 15,
        fontWeight: '500',
    },
    featuredTitle: {
        fontSize: 22,
        fontWeight: '700',
    },
    typeIcon: {
        marginLeft: 8,
    },
    price: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryColor,
    },
    compactPrice: {
        fontSize: 15,
    },
    featuredPrice: {
        fontSize: 22,
    },
    priceUnit: {
        fontSize: 14,
        fontWeight: '400',
        color: colors.primaryDark_1,
    },
    location: {
        fontSize: 14,
        color: colors.primaryDark_1,
        marginBottom: 12,
    },
    compactLocation: {
        fontSize: 12,
        marginBottom: 8,
    },
    featuredLocation: {
        fontSize: 16,
        marginBottom: 16,
    },
    features: {
        flexDirection: 'row',
        justifyContent: 'flex-start',
        gap: 16,
    },
    feature: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    featureText: {
        fontSize: 14,
        color: colors.primaryDark_1,
    },
    footer: {
        marginTop: 16,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: colors.primaryDark_1,
    },
    customBadge: {
        position: 'absolute',
        top: 8,
        right: 8,
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