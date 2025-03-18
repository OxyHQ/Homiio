import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity, ViewStyle } from 'react-native';
import { colors } from '@/styles/colors';
import { IconButton } from './IconButton';

export type PropertyType = 'apartment' | 'house' | 'coliving' | 'eco';

type PropertyCardProps = {
    id: string;
    title: string;
    location: string;
    price: number;
    currency?: string;
    type: PropertyType;
    imageUrl: string;
    bedrooms: number;
    bathrooms: number;
    size: number;
    sizeUnit?: string;
    isFavorite?: boolean;
    isVerified?: boolean;
    onPress?: () => void;
    onFavoritePress?: () => void;
    style?: ViewStyle;
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

export function PropertyCard({
    title,
    location,
    price,
    currency = '⊜',
    type,
    imageUrl,
    bedrooms,
    bathrooms,
    size,
    sizeUnit = 'm²',
    isFavorite = false,
    isVerified = false,
    onPress,
    onFavoritePress,
    style,
}: PropertyCardProps) {
    return (
        <TouchableOpacity
            style={[styles.container, style]}
            onPress={onPress}
            activeOpacity={0.8}
        >
            <View style={styles.imageContainer}>
                <Image
                    source={{ uri: imageUrl }}
                    style={styles.image}
                    resizeMode="cover"
                />
                <TouchableOpacity
                    style={styles.favoriteButton}
                    onPress={onFavoritePress}
                >
                    <IconButton
                        name={isFavorite ? 'heart' : 'heart-outline'}
                        color={isFavorite ? colors.chatUnreadBadge : colors.primaryLight}
                        backgroundColor="transparent"
                        size={24}
                    />
                </TouchableOpacity>
                {isVerified && (
                    <View style={styles.verifiedBadge}>
                        <IconButton
                            name="shield-checkmark"
                            color={colors.primaryLight}
                            backgroundColor={colors.primaryColor}
                            size={16}
                        />
                    </View>
                )}
            </View>

            <View style={styles.content}>
                <View style={styles.header}>
                    <View style={styles.titleContainer}>
                        <Text style={styles.title} numberOfLines={1}>{title}</Text>
                        <IconButton
                            name={getPropertyTypeIcon(type)}
                            size={16}
                            color={colors.primaryDark_1}
                            backgroundColor="transparent"
                            style={styles.typeIcon}
                        />
                    </View>
                    <Text style={styles.price}>
                        {currency}{price.toLocaleString()}
                        <Text style={styles.priceUnit}>/month</Text>
                    </Text>
                </View>

                <Text style={styles.location} numberOfLines={1}>{location}</Text>

                <View style={styles.features}>
                    <View style={styles.feature}>
                        <IconButton
                            name="bed-outline"
                            size={16}
                            color={colors.primaryDark_1}
                            backgroundColor="transparent"
                        />
                        <Text style={styles.featureText}>{bedrooms}</Text>
                    </View>
                    <View style={styles.feature}>
                        <IconButton
                            name="water-outline"
                            size={16}
                            color={colors.primaryDark_1}
                            backgroundColor="transparent"
                        />
                        <Text style={styles.featureText}>{bathrooms}</Text>
                    </View>
                    <View style={styles.feature}>
                        <IconButton
                            name="resize-outline"
                            size={16}
                            color={colors.primaryDark_1}
                            backgroundColor="transparent"
                        />
                        <Text style={styles.featureText}>{size} {sizeUnit}</Text>
                    </View>
                </View>
            </View>
        </TouchableOpacity>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: colors.primaryLight,
        borderRadius: 12,
        overflow: 'hidden',
        shadowColor: colors.primaryDark,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    imageContainer: {
        position: 'relative',
        height: 200,
    },
    image: {
        width: '100%',
        height: '100%',
    },
    favoriteButton: {
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 1,
    },
    verifiedBadge: {
        position: 'absolute',
        top: 8,
        left: 8,
        zIndex: 1,
    },
    content: {
        padding: 16,
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: 4,
    },
    titleContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        flex: 1,
        marginRight: 8,
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
        flex: 1,
    },
    typeIcon: {
        marginLeft: 8,
    },
    price: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryColor,
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
}); 