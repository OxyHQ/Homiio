import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Link, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';
import { useProperties } from '@/hooks/usePropertyQueries';

export function FeaturedPropertiesWidget() {
    const { t } = useTranslation();
    const { data, isLoading, error } = useProperties({ 
        limit: 3, 
        status: 'available'
    });

    if (error) {
        return (
            <BaseWidget title={t("Featured Properties")}>
                <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>Failed to load properties</Text>
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

    // Use real API data, fall back to mock data if empty
    const propertyItems = properties.length > 0 ? properties.map(property => ({
        id: property.id,
        title: property.title,
        location: `${property.address?.city || 'Unknown'}, ${property.address?.state || 'Unknown'}`,
        price: `$${property.rent?.amount || 0}/${property.rent?.paymentFrequency || 'month'}`,
        isEcoCertified: property.amenities?.includes('eco-friendly') || false,
        rating: 4.5 // Default rating since it's not in the API yet
    })) : [
        {
            id: '1',
            title: 'Modern Studio in City Center',
            location: 'Barcelona, Spain',
            price: '$850/month',
            isEcoCertified: true,
            rating: 4.8
        },
        {
            id: '2',
            title: 'Co-living Space with Garden',
            location: 'Berlin, Germany',
            price: '$550/month',
            isEcoCertified: true,
            rating: 4.9
        }
    ];

    return (
        <>
            {propertyItems.map((property) => (
                <Link href={`/properties/${property.id}`} key={property.id} asChild>
                    <TouchableOpacity style={styles.propertyItem}>
                        <View style={styles.propertyImagePlaceholder}>
                            <Text style={styles.propertyImageText}>Property Image</Text>
                        </View>
                        <View style={styles.propertyContent}>
                            <View style={styles.propertyHeader}>
                                <Text style={styles.propertyTitle} numberOfLines={1}>{property.title}</Text>
                                {property.isEcoCertified && (
                                    <Ionicons name="leaf" size={16} color="green" />
                                )}
                            </View>
                            <Text style={styles.propertyLocation}>{property.location}</Text>
                            <View style={styles.propertyFooter}>
                                <Text style={styles.propertyPrice}>{property.price}</Text>
                                <View style={styles.ratingContainer}>
                                    <Ionicons name="star" size={14} color="#FFD700" />
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
    propertyItem: {
        flexDirection: 'row',
        marginBottom: 15,
        borderBottomWidth: 0.5,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
        paddingBottom: 15,
    },
    propertyImagePlaceholder: {
        width: 80,
        height: 80,
        backgroundColor: '#e1e1e1',
        borderRadius: 8,
        justifyContent: 'center',
        alignItems: 'center',
    },
    propertyImageText: {
        color: '#666',
        fontSize: 12,
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
}); 