import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { BaseWidget } from './BaseWidget';
import { PropertyCard } from '@/components/PropertyCard';
import { colors } from '@/styles/colors';
import type { Property } from '@/services/propertyService';

// Type assertion for Ionicons compatibility with React 19
const IconComponent = Ionicons as any;

export function RecentlyViewedWidget() {
    const { t } = useTranslation();
    const { properties: recentProperties, isLoading, error } = useRecentlyViewed();

    const navigateToProperty = (property: Property) => {
        router.push(`/properties/${property._id || property.id}`);
    };

    if (error) {
        return (
            <BaseWidget title={t("Recently Viewed")}
                icon={<IconComponent name="time-outline" size={22} color={colors.primaryColor} />}>
                <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>{error || 'Failed to load properties'}</Text>
                </View>
            </BaseWidget>
        );
    }

    return (
        <BaseWidget
            title={t("Recently Viewed")}
            icon={<IconComponent name="time-outline" size={22} color={colors.primaryColor} />}
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
                        <IconComponent name="time-outline" size={32} color={colors.COLOR_BLACK_LIGHT_4} />
                        <Text style={styles.emptyText}>No recently viewed properties</Text>
                        <Text style={styles.emptySubtext}>Start browsing to see your recent activity here</Text>
                    </View>
                ) : recentProperties.map((property) => (
                    <View key={property._id || property.id} style={styles.propertyCard}>
                        <PropertyCard
                            property={property}
                            variant="compact"
                            onPress={() => navigateToProperty(property)}
                            showFeatures={false}
                            showTypeIcon={false}
                            style={styles.compactCard}
                        />
                    </View>
                ))}

                <TouchableOpacity
                    style={styles.viewAllButton}
                    onPress={() => router.push('/properties/recently-viewed')}
                >
                    <Text style={styles.viewAllText}>View All</Text>
                    <IconComponent name="chevron-forward" size={16} color={colors.primaryColor} />
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
    compactCard: {
        width: '100%',
        height: '100%',
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
