import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';
import { useProperties } from '@/hooks/usePropertyQueries';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { getPropertyImageSource } from '@/utils/propertyUtils';
import { Ionicons } from '@expo/vector-icons';

const IconComponent = Ionicons as any;

export function FeaturedPropertiesWidget() {
    const { t } = useTranslation();
    const { data, isLoading, error } = useProperties({
        limit: 3,
        available: true
    });

    if (error) {
        return (
            <BaseWidget title={t("Featured Properties")}>
                <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>
                        {error?.message || 'Failed to load properties'}
                    </Text>
                </View>
            </BaseWidget>
        );
    }

    return (
        <BaseWidget title={t("Featured Properties")}>
            <View>
                {isLoading ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="small" color={colors.primaryColor} />
                        <Text style={styles.loadingText}>Loading properties...</Text>
                    </View>
                ) : (
                    <FeaturedProperties properties={data?.properties || []} />
                )}
            </View>
        </BaseWidget>
    );
}

function FeaturedProperties({ properties }: { properties: any[] }) {
    const router = useRouter();

    // Debug: Log the properties to see the actual structure
    console.log('FeaturedProperties received:', properties);

    // Map API data to display format
    const propertyItems = properties.map(property => {
        console.log('Mapping property:', property); // Debug each property

        // Generate title dynamically from property data
        const generatedTitle = generatePropertyTitle({
            type: property.type,
            address: property.address,
            bedrooms: property.bedrooms,
            bathrooms: property.bathrooms
        });

        return {
            id: property._id || property.id, // Use _id from MongoDB or fallback to id
            title: generatedTitle,
            location: `${property.address?.city || 'Unknown'}, ${property.address?.state || 'Unknown'}`,
            price: `$${property.rent?.amount || 0}/${property.rent?.paymentFrequency || 'month'}`,
            imageSource: getPropertyImageSource(property.images),
            isEcoCertified: property.amenities?.includes('eco-friendly') ||
                property.amenities?.includes('green') ||
                property.amenities?.includes('solar') || false,
            rating: 4.5 // Default rating since it's not in the API yet
        };
    });

    // Show message if no properties available
    if (propertyItems.length === 0) {
        return (
            <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No featured properties available at the moment</Text>
            </View>
        );
    }

    return (
        <>
            {propertyItems.map((property) => (
                <Link href={`/properties/${property.id}`} key={property.id} asChild>
                    <TouchableOpacity style={styles.propertyItem}>
                        <Image
                            source={property.imageSource}
                            style={styles.propertyImage}
                        />
                        <View style={styles.propertyContent}>
                            <View style={styles.propertyHeader}>
                                <Text style={styles.propertyTitle} numberOfLines={2}>{property.title}</Text>
                                {property.isEcoCertified && (
                                    <Text style={styles.ecoIcon}>🌿</Text>
                                )}
                            </View>
                            <Text style={styles.propertyLocation}>{property.location}</Text>
                            <View style={styles.propertyFooter}>
                                <Text style={styles.propertyPrice}>{property.price}</Text>
                                <View style={styles.ratingContainer}>
                                    <IconComponent name="star" size={14} color="#FFD700" />
                                    <Text style={styles.ratingText}>{property.rating}</Text>
                                </View>
                            </View>
                        </View>
                    </TouchableOpacity>
                </Link>
            ))}
            <TouchableOpacity
                onPress={() => router.push('/properties')}
                style={styles.showMoreButton}
                activeOpacity={0.7}>
                <Text style={styles.showMoreText}>
                    View All Properties
                </Text>
            </TouchableOpacity>
        </>
    );
}

const styles = StyleSheet.create({
    loadingContainer: {
        padding: 15,
        alignItems: 'center',
        borderRadius: 15,
        gap: 10,
    },
    loadingText: {
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    errorContainer: {
        padding: 15,
        alignItems: 'center',
        borderRadius: 15,
    },
    errorText: {
        color: '#ff6b6b',
        fontWeight: '500',
    },
    emptyContainer: {
        padding: 20,
        alignItems: 'center',
        borderRadius: 15,
    },
    emptyText: {
        color: colors.COLOR_BLACK_LIGHT_4,
        fontSize: 14,
        textAlign: 'center',
    },
    propertyItem: {
        flexDirection: 'row',
        marginBottom: 15,
        borderBottomWidth: 0.5,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
        paddingBottom: 15,
    },
    propertyImage: {
        width: 80,
        height: 80,
        borderRadius: 8,
    },
    propertyContent: {
        flex: 1,
        marginLeft: 10,
        justifyContent: 'space-between',
    },
    propertyHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    propertyTitle: {
        fontWeight: 'bold',
        fontSize: 15,
        flex: 1,
        marginRight: 5,
    },
    propertyLocation: {
        color: colors.COLOR_BLACK_LIGHT_4,
        fontSize: 13,
        marginTop: 4,
    },
    propertyFooter: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 8,
    },
    propertyPrice: {
        fontWeight: '600',
        color: colors.primaryColor,
    },
    ratingContainer: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    ratingText: {
        marginLeft: 3,
        fontSize: 13,
    },
    showMoreButton: {
        padding: 12,
        backgroundColor: '#f5f5f5',
        borderRadius: 35,
        alignItems: 'center',
        marginTop: 5,
    },
    showMoreText: {
        color: colors.primaryColor,
        fontWeight: '600',
    },
    ecoIcon: {
        fontSize: 16,
        marginLeft: 5,
    },
    starIcon: {
        fontSize: 14,
        color: '#FFD700',
    },
}); 