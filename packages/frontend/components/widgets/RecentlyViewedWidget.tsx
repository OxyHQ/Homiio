import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';
import { useRecentlyViewedProperties } from '@/hooks/useUserQueries';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';

interface PropertyItem {
    id: string;
    title: string;
    location: string;
    price: string;
    imageUrl: string;
    isEcoCertified?: boolean;
}

export function RecentlyViewedWidget() {
    const { t } = useTranslation();
    const router = useRouter();

    const { data, isLoading, error } = useRecentlyViewedProperties();

    const recentProperties: PropertyItem[] = (data || []).map((property) => {
        // Generate title dynamically from property data
        const generatedTitle = generatePropertyTitle({
            type: property.type,
            address: property.address,
            bedrooms: property.bedrooms,
            bathrooms: property.bathrooms
        });

        return {
            id: (property._id || property.id) as string,
            title: generatedTitle,
            location: `${property.address?.city || 'Unknown'}, ${property.address?.state || ''}`,
            price: `$${property.rent?.amount || 0}/${property.rent?.paymentFrequency || 'month'}`,
            imageUrl: property.images?.[0] || 'https://via.placeholder.com/80',
            isEcoCertified:
                property.amenities?.includes('eco-friendly') ||
                property.amenities?.includes('green') ||
                property.amenities?.includes('solar') || false,
        };
    });

    const navigateToProperty = (propertyId: string) => {
        router.push(`/properties/${propertyId}`);
    };

    if (error) {
        return (
            <BaseWidget title={t("Recently Viewed")}
                icon={<Ionicons name="time-outline" size={22} color={colors.primaryColor} />}>
                <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>{error.message || 'Failed to load properties'}</Text>
                </View>
            </BaseWidget>
        );
    }

    return (
        <BaseWidget
            title={t("Recently Viewed")}
            icon={<Ionicons name="time-outline" size={22} color={colors.primaryColor} />}
        >
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.container}
                contentContainerStyle={styles.scrollContent}
            >
                {isLoading ? (
                    <View style={styles.loadingContainer}>
                        <ActivityIndicator size="small" color={colors.primaryColor} />
                    </View>
                ) : recentProperties.length === 0 ? (
                    <View style={styles.emptyContainer}>
                        <Ionicons name="time-outline" size={32} color={colors.COLOR_BLACK_LIGHT_4} />
                        <Text style={styles.emptyText}>No recently viewed properties</Text>
                        <Text style={styles.emptySubtext}>Start browsing to see your recent activity here</Text>
                    </View>
                ) : recentProperties.map((property) => (
                    <TouchableOpacity
                        key={property.id}
                        style={styles.propertyCard}
                        onPress={() => navigateToProperty(property.id)}
                    >
                        <Image
                            source={{ uri: property.imageUrl }}
                            style={styles.propertyImage}
                        />

                        <View style={styles.propertyInfo}>
                            <View style={styles.propertyHeader}>
                                <Text style={styles.propertyTitle} numberOfLines={1}>
                                    {property.title}
                                </Text>
                                {property.isEcoCertified && (
                                    <Ionicons name="leaf" size={14} color="green" />
                                )}
                            </View>

                            <Text style={styles.propertyLocation} numberOfLines={1}>
                                {property.location}
                            </Text>

                            <Text style={styles.propertyPrice}>
                                {property.price}
                            </Text>
                        </View>
                    </TouchableOpacity>
                ))}

                <TouchableOpacity
                    style={styles.viewAllButton}
                    onPress={() => router.push('/properties')}
                >
                    <Text style={styles.viewAllText}>View All</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.primaryColor} />
                </TouchableOpacity>
            </ScrollView>
        </BaseWidget>
    );
}

const styles = StyleSheet.create({
    container: {
        marginVertical: 5,
    },
    scrollContent: {
        paddingRight: 20,
    },
    propertyCard: {
        width: 140,
        marginRight: 12,
        borderRadius: 8,
        backgroundColor: 'white',
        shadowColor: colors.primaryDark,
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
        overflow: 'hidden',
    },
    propertyImage: {
        width: '100%',
        height: 90,
        backgroundColor: '#e1e1e1',
    },
    propertyInfo: {
        padding: 8,
    },
    propertyHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
    },
    propertyTitle: {
        fontSize: 13,
        fontWeight: '600',
        flex: 1,
        marginRight: 4,
    },
    propertyLocation: {
        fontSize: 11,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginBottom: 4,
    },
    propertyPrice: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.primaryColor,
    },
    viewAllButton: {
        width: 80,
        height: 140,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: colors.primaryLight,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_6,
        borderStyle: 'dashed',
        flexDirection: 'column',
    },
    viewAllText: {
        color: colors.primaryColor,
        fontSize: 12,
        fontWeight: '600',
        marginBottom: 4,
    },
    loadingContainer: {
        width: '100%',
        height: 140,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 30,
        paddingHorizontal: 20,
    },
    emptyText: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.COLOR_BLACK_LIGHT_4,
        marginTop: 8,
        textAlign: 'center',
    },
    emptySubtext: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginTop: 4,
        textAlign: 'center',
    },
    errorContainer: {
        padding: 15,
        alignItems: 'center',
    },
    errorText: {
        color: colors.COLOR_BLACK_LIGHT_4,
        fontSize: 12,
    },
});
