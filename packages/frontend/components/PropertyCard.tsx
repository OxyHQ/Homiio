import React, { useMemo } from 'react';
import { View, Image, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { colors } from '@/styles/colors';
import { IconButton } from './IconButton';
import { Property, PropertyType, PriceUnit } from '@homiio/shared-types';
import { getPropertyTitle, getPropertyImageSource } from '@/utils/propertyUtils';

import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';

import { SaveButton } from './SaveButton';
import { CurrencyFormatter } from './CurrencyFormatter';
import { ThemedText } from '@/components/ThemedText';
import { Ionicons } from '@expo/vector-icons';



export type PropertyCardVariant = 'default' | 'compact' | 'featured' | 'saved';
export type PropertyCardOrientation = 'vertical' | 'horizontal';

type PropertyCardProps = {
    // Core data - can pass either individual props or a Property object
    property?: Property;
    id?: string;
    title?: string;
    location?: string;
    price?: number;
    currency?: string;
    priceUnit?: PriceUnit;
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
    orientation?: PropertyCardOrientation;
    showFavoriteButton?: boolean;
    showVerifiedBadge?: boolean;
    showTypeIcon?: boolean;
    showFeatures?: boolean;
    showPrice?: boolean;
    showLocation?: boolean;
    showRating?: boolean;

    // State
    isVerified?: boolean;
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
    switch (variant) {
        case 'compact':
            return {
                imageHeight: 100,
                showFeatures: false,
                showTypeIcon: false,
                showRating: false,
            };
        case 'featured':
            return {
                imageHeight: 140,
                showFeatures: true,
                showTypeIcon: true,
                showRating: true,
            };
        default:
            return {
                imageHeight: 120,
                showFeatures: true,
                showTypeIcon: false,
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
    priceUnit = PriceUnit.MONTH,
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
    orientation = 'vertical',
    showFavoriteButton = true,
    showVerifiedBadge = true,
    showTypeIcon = true,
    showFeatures = true,
    showPrice = true,
    showLocation = true,
    showRating = true,

    // State
    isVerified = false,
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

    // Use property object if provided, otherwise use individual props
    const propertyData = property ? {
        id: property._id || property.id,
        title: getPropertyTitle(property),
        location: `${property.address?.city || ''}, ${property.address?.state || ''}`,
        price: property.rent.amount,
        currency: property.rent.currency,
        type: property.type === 'room' ? 'apartment' : property.type === 'studio' ? 'apartment' : property.type === 'house' ? 'house' : 'apartment' as PropertyType,
        imageSource: getPropertyImageSource(property),
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
    const isPropertySavedState = propertyData.id && isInitialized ? isPropertySaved(propertyData.id) : false;

    // Get variant-specific styles
    const variantStyles = getVariantStyles(variant);
    const finalTitleLines = useMemo(() => {
        if (titleLines !== undefined) return titleLines;

        switch (variant) {
            case 'compact':
                return 1;
            case 'featured':
                return 2;
            default:
                return 2; // Allow 2 lines for better readability
        }
    }, [titleLines, variant]);
    const finalLocationLines = useMemo(() => {
        switch (variant) {
            case 'compact':
                return 1;
            case 'featured':
                return 2;
            default:
                return 1;
        }
    }, [variant]);
    const shouldShowFeatures = showFeatures && variantStyles.showFeatures;
    const shouldShowRating = showRating && variantStyles.showRating;







    return (
        <TouchableOpacity
            style={[
                styles.container,
                orientation === 'horizontal' ? styles.horizontalContainer : null,
                style as ViewStyle,
                isFeatured ? styles.featuredCard : null,
                isProcessing ? { opacity: 0.7 } : null,
            ]}
            onPress={onPress}
            onLongPress={onLongPress}
            activeOpacity={0.9}
        >
            <View style={[
                styles.imageContainer,
                orientation === 'horizontal' ? styles.horizontalImageContainer : null,
                isFeatured ? styles.featuredImageContainer : null,
                isSelected ? styles.selectedImage : null,
            ]}>
                <Image
                    source={propertyData.imageSource}
                    style={styles.image}
                    resizeMode="cover"
                />

                {/* Save Button and Rating Container */}
                {/* Rating - moved to top-left */}
                {shouldShowRating && propertyData.rating && (
                    <View style={styles.ratingBadge}>
                        <ThemedText style={styles.ratingBadgeText}>
                            {propertyData.rating.toFixed(1)}
                        </ThemedText>
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
                orientation === 'horizontal' ? styles.horizontalContent : null,
                variant === 'compact' ? styles.compactContent : null,
                isFeatured ? styles.featuredContent : null,
            ]}>
                {/* Title - Airbnb style */}
                <ThemedText style={[
                    styles.title,
                    variant === 'compact' ? styles.compactTitle : null,
                    isFeatured ? styles.featuredTitle : null,
                    orientation === 'horizontal' ? styles.horizontalTitle : null,
                ]} numberOfLines={orientation === 'horizontal' ? undefined : finalTitleLines}>
                    {propertyData.title}
                </ThemedText>

                {/* Location */}
                {showLocation && propertyData.location && (
                    <ThemedText style={[
                        styles.location,
                        variant === 'compact' ? styles.compactLocation : null,
                        isFeatured ? styles.featuredLocation : null,
                        orientation === 'horizontal' ? styles.horizontalLocation : null,
                    ]} numberOfLines={finalLocationLines}>
                        {propertyData.location}
                    </ThemedText>
                )}

                {/* Features */}
                {shouldShowFeatures && (
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
                                        {`${propertyData.size} ${sizeUnit}`}
                                    </ThemedText>
                                </View>
                            </>
                        )}
                    </View>
                )}

                {/* Price - Airbnb style at bottom */}
                {showPrice && propertyData.price && (
                    <View style={styles.priceContainer}>
                        <ThemedText style={[
                            styles.price,
                            variant === 'compact' ? styles.compactPrice : null,
                            isFeatured ? styles.featuredPrice : null,
                        ]}>
                            <CurrencyFormatter
                                amount={propertyData.price}
                                originalCurrency={propertyData.currency}
                                showConversion={false}
                            />
                            <ThemedText style={styles.priceUnit}> / {priceUnit}</ThemedText>
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
            {footerContent && (
                <View style={styles.footer}>{footerContent as React.ReactNode}</View>
            )}
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        width: '100%',
        height: 'auto',
    },
    horizontalContainer: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
    },
    featuredCard: {
        // No border or shadow here
    },
    imageContainer: {
        position: 'relative',
        width: '100%',
        aspectRatio: 1,
        backgroundColor: '#f8f8f8',
        borderRadius: 25,
        overflow: 'hidden',
    },
    horizontalImageContainer: {
        width: 120,
        height: 120,
        aspectRatio: 1,
        flexShrink: 0,
    },
    featuredImageContainer: {
    },
    image: {
        width: '100%',
        height: '100%',
        aspectRatio: 1,
    },
    saveButton: {
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 2,
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderRadius: 20,
        padding: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
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
        // padding: 10, // Remove padding for flush alignment
        flex: 1,
        justifyContent: 'space-between',
        marginTop: 10, // Add gap between image and content
    },
    horizontalContent: {
        flex: 1,
        marginTop: 0,
        justifyContent: 'space-between',
        minHeight: 120,
    },
    compactContent: {
        // padding: 8, // Remove padding for flush alignment
    },
    featuredContent: {
        // padding: 12, // Remove padding for flush alignment
    },
    title: {
        fontSize: 14,
        fontWeight: '600',
        color: '#222222',
        lineHeight: 18,
        marginBottom: 3,
    },
    compactTitle: {
        fontSize: 13,
        fontWeight: '500',
    },
    featuredTitle: {
        fontSize: 15,
        fontWeight: '700',
    },
    horizontalTitle: {
        fontSize: 20,
        fontWeight: '600',
        lineHeight: 32,
        marginBottom: 4,
    },
    location: {
        fontSize: 12,
        color: '#717171',
        marginBottom: 4,
        lineHeight: 16,
    },
    horizontalLocation: {
        fontSize: 14,
        color: '#717171',
        marginBottom: 6,
        lineHeight: 18,
    },
    compactLocation: {
        fontSize: 11,
        marginBottom: 3,
    },
    featuredLocation: {
        fontSize: 13,
        marginBottom: 6,
    },
    ratingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 6,
    },
    ratingText: {
        fontSize: 12,
        fontWeight: '500',
        color: '#222222',
        marginLeft: 3,
    },
    reviewCount: {
        fontSize: 12,
        color: '#717171',
        marginLeft: 3,
    },
    features: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        marginBottom: 6,
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
        fontSize: 14,
        fontWeight: '600',
        color: '#222222',
    },
    compactPrice: {
        fontSize: 13,
    },
    featuredPrice: {
        fontSize: 15,
    },
    priceUnit: {
        fontSize: 12,
        fontWeight: '400',
        color: '#717171',
    },
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
    noteContainer: {
        marginTop: 8,
        backgroundColor: '#ffffff',
        borderRadius: 12,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderWidth: 1,
        borderColor: '#efefef',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 3,
        elevation: 1,
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
    compactNoteContainer: {
        paddingVertical: 6,
        paddingHorizontal: 8,
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
    compactNoteText: {
        fontSize: 12,
        lineHeight: 16,
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
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
        justifyContent: 'center',
    },
    ratingBadgeText: {
        fontSize: 12,
        fontWeight: '600',
        color: '#222222',
        marginRight: 1,
        fontFamily: 'Phudu',
    },
}); 