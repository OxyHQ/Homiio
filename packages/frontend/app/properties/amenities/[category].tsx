import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import {
    AMENITY_CATEGORIES,
    AMENITIES,
    getAmenitiesByCategory,
    getCategoryById,
    calculateAmenityValue
} from '@/constants/amenities';

const IconComponent = Ionicons as any;

export default function AmenitiesByCategoryPage() {
    const { t } = useTranslation();
    const router = useRouter();
    const { category } = useLocalSearchParams<{ category: string }>();
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<'name' | 'value'>('name');

    // Get category info and amenities
    const categoryInfo = getCategoryById(category || '');
    const categoryAmenities = getAmenitiesByCategory(category || '');

    // Filter and sort amenities
    const filteredAmenities = useMemo(() => {
        let filtered = categoryAmenities;

        // Filter by search query
        if (searchQuery.trim()) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(amenity =>
                amenity.name.toLowerCase().includes(query) ||
                amenity.description?.toLowerCase().includes(query)
            );
        }

        // Sort amenities
        filtered.sort((a, b) => {
            if (sortBy === 'value') {
                return (b.valueAdd || 0) - (a.valueAdd || 0);
            }
            return a.name.localeCompare(b.name);
        });

        return filtered;
    }, [categoryAmenities, searchQuery, sortBy]);

    // Calculate stats
    const stats = useMemo(() => {
        const totalValue = categoryAmenities.reduce((sum, amenity) => sum + (amenity.valueAdd || 0), 0);
        const premiumCount = categoryAmenities.filter(amenity => amenity.premium).length;
        const essentialCount = categoryAmenities.filter(amenity => !amenity.premium).length;

        return {
            total: categoryAmenities.length,
            totalValue,
            premiumCount,
            essentialCount,
            averageValue: categoryAmenities.length > 0 ? Math.round(totalValue / categoryAmenities.length) : 0
        };
    }, [categoryAmenities]);

    if (!categoryInfo) {
        return (
            <SafeAreaView style={styles.container} edges={['top']}>
                <Header
                    options={{
                        showBackButton: true,
                        title: 'Category Not Found',
                        titlePosition: 'center',
                    }}
                />
                <View style={styles.errorContainer}>
                    <Text style={styles.errorText}>Category not found</Text>
                    <TouchableOpacity style={styles.goBackButton} onPress={() => router.back()}>
                        <Text style={styles.goBackButtonText}>Go Back</Text>
                    </TouchableOpacity>
                </View>
            </SafeAreaView>
        );
    }

    const renderAmenityCard = (amenity: any) => (
        <TouchableOpacity
            key={amenity.id}
            style={[
                styles.amenityCard,
                amenity.premium && styles.premiumAmenityCard
            ]}
            onPress={() => {
                // Navigate to property search with this amenity filter
                router.push(`/properties/search?amenities=${amenity.id}`);
            }}
        >
            <View style={styles.amenityCardHeader}>
                <View style={[
                    styles.amenityIcon,
                    { backgroundColor: categoryInfo.color + '20' },
                    amenity.premium && styles.premiumAmenityIcon
                ]}>
                    <IconComponent
                        name={amenity.icon}
                        size={24}
                        color={amenity.premium ? '#FFD700' : categoryInfo.color}
                    />
                </View>
                <View style={styles.amenityInfo}>
                    <Text style={[
                        styles.amenityName,
                        amenity.premium && styles.premiumAmenityName
                    ]}>
                        {amenity.name}
                        {amenity.premium && (
                            <Text style={styles.premiumTag}> PREMIUM</Text>
                        )}
                    </Text>
                    {amenity.valueAdd && (
                        <Text style={styles.amenityValue}>
                            +${amenity.valueAdd}/month
                        </Text>
                    )}
                </View>
            </View>
            {amenity.description && (
                <Text style={styles.amenityDescription}>
                    {amenity.description}
                </Text>
            )}
        </TouchableOpacity>
    );

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            <Header
                options={{
                    showBackButton: true,
                    title: categoryInfo.name,
                    titlePosition: 'center',
                }}
            />

            <ScrollView style={styles.scrollView}>
                {/* Category Header */}
                <View style={[styles.categoryHeader, { backgroundColor: categoryInfo.color + '10' }]}>
                    <View style={[styles.categoryHeaderIcon, { backgroundColor: categoryInfo.color + '20' }]}>
                        <IconComponent
                            name={categoryInfo.icon}
                            size={32}
                            color={categoryInfo.color}
                        />
                    </View>
                    <Text style={styles.categoryTitle}>{categoryInfo.name}</Text>
                    <Text style={styles.categoryDescription}>
                        Discover {stats.total} amenities in this category
                    </Text>
                </View>

                {/* Stats Section */}
                <View style={styles.statsSection}>
                    <View style={styles.statsGrid}>
                        <View style={styles.statCard}>
                            <Text style={styles.statNumber}>{stats.total}</Text>
                            <Text style={styles.statLabel}>Total Amenities</Text>
                        </View>
                        <View style={styles.statCard}>
                            <Text style={styles.statNumber}>{stats.essentialCount}</Text>
                            <Text style={styles.statLabel}>Essential</Text>
                        </View>
                        <View style={styles.statCard}>
                            <Text style={styles.statNumber}>{stats.premiumCount}</Text>
                            <Text style={styles.statLabel}>Premium</Text>
                        </View>
                        <View style={styles.statCard}>
                            <Text style={styles.statNumber}>${stats.averageValue}</Text>
                            <Text style={styles.statLabel}>Avg Value/Mo</Text>
                        </View>
                    </View>
                </View>

                {/* Search and Sort */}
                <View style={styles.controlsSection}>
                    <View style={styles.searchContainer}>
                        <IconComponent name="search" size={20} color={colors.COLOR_BLACK_LIGHT_3} />
                        <TextInput
                            style={styles.searchInput}
                            placeholder="Search amenities..."
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                        />
                    </View>

                    <View style={styles.sortContainer}>
                        <TouchableOpacity
                            style={[styles.sortButton, sortBy === 'name' && styles.activeSortButton]}
                            onPress={() => setSortBy('name')}
                        >
                            <Text style={[styles.sortButtonText, sortBy === 'name' && styles.activeSortButtonText]}>
                                Name
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.sortButton, sortBy === 'value' && styles.activeSortButton]}
                            onPress={() => setSortBy('value')}
                        >
                            <Text style={[styles.sortButtonText, sortBy === 'value' && styles.activeSortButtonText]}>
                                Value
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Amenities List */}
                <View style={styles.amenitiesSection}>
                    {filteredAmenities.length > 0 ? (
                        filteredAmenities.map(renderAmenityCard)
                    ) : (
                        <View style={styles.emptyContainer}>
                            <IconComponent name="search-outline" size={48} color={colors.COLOR_BLACK_LIGHT_4} />
                            <Text style={styles.emptyText}>No amenities found</Text>
                            <Text style={styles.emptySubtext}>
                                Try adjusting your search query
                            </Text>
                        </View>
                    )}
                </View>

                {/* Value Explanation */}
                <View style={styles.infoSection}>
                    <Text style={styles.infoTitle}>About Amenity Values</Text>
                    <Text style={styles.infoText}>
                        The values shown represent the estimated monthly rental value each amenity adds to a property.
                        These are based on market research and help landlords price their properties fairly while
                        giving tenants insight into what they're paying for.
                    </Text>
                </View>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8f9fa',
    },
    scrollView: {
        flex: 1,
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
    },
    errorText: {
        fontSize: 18,
        color: colors.COLOR_BLACK_LIGHT_3,
        marginBottom: 20,
    },
    goBackButton: {
        backgroundColor: colors.primaryColor,
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 8,
    },
    goBackButtonText: {
        color: 'white',
        fontWeight: '600',
    },
    categoryHeader: {
        padding: 20,
        alignItems: 'center',
        marginBottom: 20,
    },
    categoryHeaderIcon: {
        width: 80,
        height: 80,
        borderRadius: 40,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    categoryTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 8,
        color: colors.COLOR_BLACK,
    },
    categoryDescription: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_3,
        textAlign: 'center',
    },
    statsSection: {
        padding: 20,
        backgroundColor: 'white',
        marginBottom: 10,
    },
    statsGrid: {
        flexDirection: 'row',
        justifyContent: 'space-between',
    },
    statCard: {
        alignItems: 'center',
        flex: 1,
    },
    statNumber: {
        fontSize: 20,
        fontWeight: 'bold',
        color: colors.primaryColor,
        marginBottom: 4,
    },
    statLabel: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_3,
        textAlign: 'center',
    },
    controlsSection: {
        padding: 20,
        backgroundColor: 'white',
        marginBottom: 10,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#f1f3f4',
        borderRadius: 25,
        paddingHorizontal: 15,
        paddingVertical: 12,
        marginBottom: 15,
    },
    searchInput: {
        flex: 1,
        marginLeft: 10,
        fontSize: 16,
    },
    sortContainer: {
        flexDirection: 'row',
        gap: 10,
    },
    sortButton: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 20,
        backgroundColor: '#f1f3f4',
    },
    activeSortButton: {
        backgroundColor: colors.primaryColor,
    },
    sortButtonText: {
        fontSize: 14,
        fontWeight: '500',
        color: colors.COLOR_BLACK_LIGHT_3,
    },
    activeSortButtonText: {
        color: 'white',
    },
    amenitiesSection: {
        padding: 20,
    },
    amenityCard: {
        backgroundColor: 'white',
        borderRadius: 12,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: '#e1e5e9',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.05,
        shadowRadius: 3,
        elevation: 2,
    },
    premiumAmenityCard: {
        borderColor: '#FFD700',
        borderWidth: 2,
        backgroundColor: '#FFF8DC',
    },
    amenityCardHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    amenityIcon: {
        width: 48,
        height: 48,
        borderRadius: 24,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    premiumAmenityIcon: {
        backgroundColor: '#FFD700' + '20',
    },
    amenityInfo: {
        flex: 1,
    },
    amenityName: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.COLOR_BLACK,
        marginBottom: 2,
    },
    premiumAmenityName: {
        color: '#B8860B',
    },
    premiumTag: {
        fontSize: 10,
        fontWeight: 'bold',
        color: '#B8860B',
    },
    amenityValue: {
        fontSize: 14,
        color: colors.primaryColor,
        fontWeight: '500',
    },
    amenityDescription: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        lineHeight: 20,
    },
    emptyContainer: {
        alignItems: 'center',
        paddingVertical: 40,
    },
    emptyText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.COLOR_BLACK_LIGHT_3,
        marginTop: 10,
    },
    emptySubtext: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginTop: 5,
    },
    infoSection: {
        padding: 20,
        backgroundColor: 'white',
        margin: 20,
        borderRadius: 12,
    },
    infoTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 8,
        color: colors.COLOR_BLACK,
    },
    infoText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        lineHeight: 20,
    },
}); 