import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TextInput,
    TouchableOpacity,
    FlatList,
    RefreshControl,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { PropertyCard } from '@/components/PropertyCard';
import { useSearchProperties } from '@/hooks/usePropertyQueries';
import { Property, PropertyFilters } from '@/services/propertyService';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { getPropertyImageSource } from '@/utils/propertyUtils';
import { Header } from '@/components/Header';
import LoadingSpinner from '@/components/LoadingSpinner';

const IconComponent = Ionicons as any;

interface SearchFilters {
    type?: string;
    minRent?: number;
    maxRent?: number;
    bedrooms?: number;
    bathrooms?: number;
    amenities?: string[];
}

export default function SearchResultsScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const params = useLocalSearchParams();

    // Get search query from URL params
    const searchQuery = params.query ? decodeURIComponent(params.query as string) : '';

    const [filters, setFilters] = useState<SearchFilters>({});
    const [showFilters, setShowFilters] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [properties, setProperties] = useState<Property[]>([]);
    const [loading, setLoading] = useState(true);

    // Property type options with colors
    const propertyTypes = [
        { id: 'apartment', label: t('Apartment'), icon: 'business-outline', color: '#3B82F6' },
        { id: 'house', label: t('House'), icon: 'home-outline', color: '#10B981' },
        { id: 'room', label: t('Room'), icon: 'bed-outline', color: '#F59E0B' },
        { id: 'studio', label: t('Studio'), icon: 'square-outline', color: '#8B5CF6' },
    ];

    // Enhanced amenity options
    const amenityOptions = [
        { id: 'wifi', label: t('WiFi'), icon: 'wifi-outline', color: '#3B82F6' },
        { id: 'parking', label: t('Parking'), icon: 'car-outline', color: '#10B981' },
        { id: 'gym', label: t('Gym'), icon: 'fitness-outline', color: '#EF4444' },
        { id: 'pool', label: t('Pool'), icon: 'water-outline', color: '#06B6D4' },
        { id: 'balcony', label: t('Balcony'), icon: 'sunny-outline', color: '#F59E0B' },
        { id: 'furnished', label: t('Furnished'), icon: 'bed-outline', color: '#8B5CF6' },
    ];

    // Convert search filters to API filters
    const apiFilters: PropertyFilters = {
        type: filters.type,
        minRent: filters.minRent,
        maxRent: filters.maxRent,
        bedrooms: filters.bedrooms,
        bathrooms: filters.bathrooms,
        available: true,
    };

    // Use the search hook
    const {
        data: apiData,
        isLoading,
        error,
        refetch,
    } = useSearchProperties(searchQuery, apiFilters);

    // Update properties when API data changes
    useEffect(() => {
        if (apiData?.properties) {
            setProperties(apiData.properties);
            setLoading(false);
        }
    }, [apiData]);

    // Handle refresh
    const handleRefresh = useCallback(async () => {
        setIsRefreshing(true);
        await refetch();
        setIsRefreshing(false);
    }, [refetch]);

    // Handle property selection
    const handlePropertyPress = (property: Property) => {
        router.push(`/properties/${property._id || property.id}`);
    };

    // Handle filter changes
    const handleFilterChange = (key: keyof SearchFilters, value: any) => {
        setFilters(prev => ({
            ...prev,
            [key]: value,
        }));
    };

    // Handle amenity toggle
    const handleAmenityToggle = (amenityId: string) => {
        setFilters(prev => ({
            ...prev,
            amenities: prev.amenities?.includes(amenityId)
                ? prev.amenities.filter(id => id !== amenityId)
                : [...(prev.amenities || []), amenityId],
        }));
    };

    // Clear all filters
    const clearFilters = () => {
        setFilters({});
    };

    // Get active filters count
    const getActiveFiltersCount = () => {
        let count = 0;
        if (filters.type) count++;
        if (filters.minRent || filters.maxRent) count++;
        if (filters.bedrooms) count++;
        if (filters.bathrooms) count++;
        if (filters.amenities && filters.amenities.length > 0) count++;
        return count;
    };

    // Render enhanced filter button
    const renderFilterButton = () => {
        const activeCount = getActiveFiltersCount();
        return (
            <TouchableOpacity
                style={[styles.filterToggleButton, showFilters && styles.filterToggleButtonActive]}
                onPress={() => setShowFilters(!showFilters)}
            >
                <IconComponent
                    name={showFilters ? "options" : "options-outline"}
                    size={20}
                    color={showFilters ? 'white' : colors.primaryColor}
                />
                <Text style={[styles.filterToggleText, showFilters && styles.filterToggleTextActive]}>
                    {t('Filters')}
                </Text>
                {activeCount > 0 && (
                    <View style={styles.filterBadge}>
                        <Text style={styles.filterBadgeText}>{activeCount}</Text>
                    </View>
                )}
            </TouchableOpacity>
        );
    };

    // Render property type filter
    const renderPropertyTypeFilter = () => (
        <View style={styles.filterSection}>
            <Text style={styles.filterSectionTitle}>{t('Property Type')}</Text>
            <View style={styles.filterOptions}>
                {propertyTypes.map(type => (
                    <TouchableOpacity
                        key={type.id}
                        style={[
                            styles.filterOption,
                            filters.type === type.id && styles.filterOptionActive,
                        ]}
                        onPress={() => handleFilterChange('type', filters.type === type.id ? undefined : type.id)}
                        activeOpacity={0.7}
                    >
                        <IconComponent
                            name={type.icon as any}
                            size={16}
                            color={filters.type === type.id ? 'white' : type.color}
                        />
                        <Text style={[
                            styles.filterOptionText,
                            filters.type === type.id && styles.filterOptionTextActive,
                        ]}>
                            {type.label}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>
        </View>
    );

    // Render enhanced price range filter
    const renderPriceFilter = () => (
        <View style={styles.filterSection}>
            <Text style={styles.filterSectionTitle}>{t('Price Range')}</Text>
            <View style={styles.priceInputs}>
                <View style={styles.priceInput}>
                    <Text style={styles.priceLabel}>{t('Min')}</Text>
                    <TextInput
                        style={styles.priceTextInput}
                        placeholder="0€"
                        placeholderTextColor={colors.COLOR_BLACK_LIGHT_4}
                        keyboardType="numeric"
                        value={filters.minRent?.toString() || ''}
                        onChangeText={(text) => handleFilterChange('minRent', text ? parseInt(text) : undefined)}
                    />
                </View>
                <View style={styles.priceInput}>
                    <Text style={styles.priceLabel}>{t('Max')}</Text>
                    <TextInput
                        style={styles.priceTextInput}
                        placeholder="∞"
                        placeholderTextColor={colors.COLOR_BLACK_LIGHT_4}
                        keyboardType="numeric"
                        value={filters.maxRent?.toString() || ''}
                        onChangeText={(text) => handleFilterChange('maxRent', text ? parseInt(text) : undefined)}
                    />
                </View>
            </View>
        </View>
    );

    // Render enhanced bedrooms/bathrooms filter
    const renderRoomsFilter = () => (
        <View style={styles.filterSection}>
            <Text style={styles.filterSectionTitle}>{t('Rooms')}</Text>
            <View style={styles.roomsInputs}>
                <View style={styles.roomInput}>
                    <Text style={styles.roomLabel}>{t('Bedrooms')}</Text>
                    <TextInput
                        style={styles.roomTextInput}
                        placeholder="Any"
                        placeholderTextColor={colors.COLOR_BLACK_LIGHT_4}
                        keyboardType="numeric"
                        value={filters.bedrooms?.toString() || ''}
                        onChangeText={(text) => handleFilterChange('bedrooms', text ? parseInt(text) : undefined)}
                    />
                </View>
                <View style={styles.roomInput}>
                    <Text style={styles.roomLabel}>{t('Bathrooms')}</Text>
                    <TextInput
                        style={styles.roomTextInput}
                        placeholder="Any"
                        placeholderTextColor={colors.COLOR_BLACK_LIGHT_4}
                        keyboardType="numeric"
                        value={filters.bathrooms?.toString() || ''}
                        onChangeText={(text) => handleFilterChange('bathrooms', text ? parseInt(text) : undefined)}
                    />
                </View>
            </View>
        </View>
    );

    // Render enhanced amenities filter
    const renderAmenitiesFilter = () => (
        <View style={styles.filterSection}>
            <Text style={styles.filterSectionTitle}>{t('Amenities')}</Text>
            <View style={styles.amenitiesGrid}>
                {amenityOptions.map(amenity => (
                    <TouchableOpacity
                        key={amenity.id}
                        style={[
                            styles.amenityOption,
                            filters.amenities?.includes(amenity.id) && styles.amenityOptionActive,
                        ]}
                        onPress={() => handleAmenityToggle(amenity.id)}
                        activeOpacity={0.7}
                    >
                        <IconComponent
                            name={amenity.icon as any}
                            size={16}
                            color={filters.amenities?.includes(amenity.id) ? 'white' : amenity.color}
                        />
                        <Text style={[
                            styles.amenityOptionText,
                            filters.amenities?.includes(amenity.id) && styles.amenityOptionTextActive,
                        ]}>
                            {amenity.label}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>
        </View>
    );

    // Render search results
    const renderSearchResults = () => {
        if (loading && !isRefreshing) {
            return (
                <View style={styles.loadingContainer}>
                    <LoadingSpinner size={32} text={t('Searching properties...')} />
                </View>
            );
        }

        if (error) {
            return (
                <View style={styles.errorContainer}>
                    <IconComponent name="alert-circle-outline" size={64} color={colors.COLOR_BLACK_LIGHT_3} />
                    <Text style={styles.errorText}>{t('Something went wrong')}</Text>
                    <Text style={styles.errorSubtext}>{t('Please try again later')}</Text>
                    <TouchableOpacity style={styles.retryButton} onPress={() => refetch()}>
                        <Text style={styles.retryButtonText}>{t('Retry')}</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        if (properties.length === 0) {
            return (
                <View style={styles.emptyContainer}>
                    <IconComponent name="home-outline" size={80} color={colors.COLOR_BLACK_LIGHT_3} />
                    <Text style={styles.emptyText}>{t('No properties found')}</Text>
                    <Text style={styles.emptySubtext}>
                        {t('Try adjusting your search criteria or filters')}
                    </Text>
                    {getActiveFiltersCount() > 0 && (
                        <TouchableOpacity style={styles.clearFiltersButton} onPress={clearFilters}>
                            <Text style={styles.clearFiltersButtonText}>{t('Clear Filters')}</Text>
                        </TouchableOpacity>
                    )}
                </View>
            );
        }

        return (
            <View style={styles.resultsContainer}>
                <View style={styles.resultsHeader}>
                    <Text style={styles.resultsCount}>
                        {t('{{count}} properties found', { count: apiData?.total || properties.length })}
                    </Text>
                    {getActiveFiltersCount() > 0 && (
                        <TouchableOpacity onPress={clearFilters} style={styles.clearAllButton}>
                            <Text style={styles.clearFiltersText}>{t('Clear all')}</Text>
                        </TouchableOpacity>
                    )}
                </View>

                <FlatList
                    data={properties}
                    keyExtractor={(item) => item._id || item.id || Math.random().toString()}
                    renderItem={({ item }) => (
                        <PropertyCard
                            property={item}
                            onPress={() => handlePropertyPress(item)}
                        />
                    )}
                    contentContainerStyle={styles.resultsList}
                    showsVerticalScrollIndicator={false}
                    refreshControl={
                        <RefreshControl
                            refreshing={isRefreshing}
                            onRefresh={handleRefresh}
                            colors={[colors.primaryColor]}
                        />
                    }
                />
            </View>
        );
    };

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            {/* Enhanced Header */}
            <Header
                options={{
                    title: searchQuery,
                    titlePosition: 'center',
                    showBackButton: true,
                    rightComponents: [renderFilterButton()]
                }}
            />

            {/* Enhanced Filters Panel */}
            {showFilters && (
                <View style={styles.filtersPanel}>
                    <ScrollView style={styles.filtersContainer} showsVerticalScrollIndicator={false}>
                        {renderPropertyTypeFilter()}
                        {renderPriceFilter()}
                        {renderRoomsFilter()}
                        {renderAmenitiesFilter()}

                        <View style={styles.filterActions}>
                            <TouchableOpacity
                                style={styles.clearFiltersActionButton}
                                onPress={clearFilters}
                                disabled={getActiveFiltersCount() === 0}
                            >
                                <Text style={[
                                    styles.clearFiltersActionButtonText,
                                    getActiveFiltersCount() === 0 && styles.clearFiltersActionButtonTextDisabled
                                ]}>
                                    {t('Clear All')}
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={styles.applyFiltersButton}
                                onPress={() => setShowFilters(false)}
                            >
                                <Text style={styles.applyFiltersButtonText}>
                                    {t('Show Results')} ({apiData?.total || properties.length})
                                </Text>
                            </TouchableOpacity>
                        </View>
                    </ScrollView>
                </View>
            )}

            {/* Search Results */}
            <View style={styles.content}>
                {renderSearchResults()}
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: colors.primaryLight,
    },
    filtersPanel: {
        backgroundColor: 'white',
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
        maxHeight: '70%',
    },
    filterToggleButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: colors.primaryColor,
        borderRadius: 20,
        gap: 6,
    },
    filterToggleButtonActive: {
        backgroundColor: colors.primaryColor,
    },
    filterToggleText: {
        fontSize: 14,
        color: colors.primaryColor,
        fontFamily: 'Inter-Medium',
    },
    filterToggleTextActive: {
        color: 'white',
        fontWeight: '600',
    },
    filterBadge: {
        backgroundColor: colors.primaryColor,
        borderRadius: 10,
        minWidth: 20,
        height: 20,
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: 4,
    },
    filterBadgeText: {
        fontSize: 12,
        fontWeight: '700',
        color: 'white',
        fontFamily: 'Inter-Bold',
    },
    filtersContainer: {
        padding: 20,
    },
    filterSection: {
        marginBottom: 24,
    },
    filterSectionTitle: {
        fontSize: 18,
        fontWeight: '700',
        color: colors.primaryDark,
        marginBottom: 16,
        fontFamily: 'Inter-Bold',
    },
    filterOptions: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    filterOption: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderWidth: 2,
        borderColor: colors.COLOR_BLACK_LIGHT_5,
        borderRadius: 24,
        backgroundColor: 'white',
        gap: 8,
    },
    filterOptionActive: {
        backgroundColor: colors.primaryColor,
        borderColor: colors.primaryColor,
    },
    filterOptionText: {
        fontSize: 14,
        color: colors.primaryDark,
        fontFamily: 'Inter-Medium',
    },
    filterOptionTextActive: {
        color: 'white',
        fontWeight: '600',
    },
    priceInputs: {
        flexDirection: 'row',
        gap: 12,
    },
    priceInput: {
        flex: 1,
    },
    priceLabel: {
        fontSize: 14,
        color: colors.primaryDark,
        fontWeight: '600',
        marginBottom: 8,
        fontFamily: 'Inter-SemiBold',
    },
    priceTextInput: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderWidth: 2,
        borderColor: colors.COLOR_BLACK_LIGHT_5,
        borderRadius: 12,
        fontSize: 16,
        color: colors.primaryDark,
        backgroundColor: 'white',
        fontFamily: 'Inter-Regular',
    },
    roomsInputs: {
        flexDirection: 'row',
        gap: 12,
    },
    roomInput: {
        flex: 1,
    },
    roomLabel: {
        fontSize: 14,
        color: colors.primaryDark,
        fontWeight: '600',
        marginBottom: 8,
        fontFamily: 'Inter-SemiBold',
    },
    roomTextInput: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderWidth: 2,
        borderColor: colors.COLOR_BLACK_LIGHT_5,
        borderRadius: 12,
        fontSize: 16,
        color: colors.primaryDark,
        backgroundColor: 'white',
        fontFamily: 'Inter-Regular',
    },
    amenitiesGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    amenityOption: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 10,
        borderWidth: 2,
        borderColor: colors.COLOR_BLACK_LIGHT_5,
        borderRadius: 24,
        backgroundColor: 'white',
        gap: 8,
    },
    amenityOptionActive: {
        backgroundColor: colors.primaryColor,
        borderColor: colors.primaryColor,
    },
    amenityOptionText: {
        fontSize: 14,
        color: colors.primaryDark,
        fontFamily: 'Inter-Medium',
    },
    amenityOptionTextActive: {
        color: 'white',
        fontWeight: '600',
    },
    filterActions: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 24,
        paddingTop: 20,
        borderTopWidth: 1,
        borderTopColor: colors.COLOR_BLACK_LIGHT_6,
    },
    clearFiltersButton: {
        backgroundColor: colors.primaryColor,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 12,
        shadowColor: colors.primaryColor,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    clearFiltersButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
        fontFamily: 'Inter-SemiBold',
    },
    applyFiltersButton: {
        flex: 2,
        backgroundColor: colors.primaryColor,
        paddingVertical: 14,
        paddingHorizontal: 20,
        borderRadius: 12,
        alignItems: 'center',
        shadowColor: colors.primaryColor,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 4,
    },
    applyFiltersButtonText: {
        fontSize: 16,
        fontWeight: '700',
        color: 'white',
        fontFamily: 'Inter-Bold',
    },
    content: {
        flex: 1,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40,
    },
    loadingText: {
        marginTop: 16,
        fontSize: 16,
        color: colors.primaryDark_1,
    },
    errorContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40,
    },
    errorText: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
        marginTop: 16,
        marginBottom: 8,
    },
    errorSubtext: {
        fontSize: 14,
        color: colors.primaryDark_1,
        textAlign: 'center',
        marginBottom: 24,
    },
    retryButton: {
        backgroundColor: colors.primaryColor,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
    },
    retryButtonText: {
        color: 'white',
        fontWeight: '600',
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40,
    },
    emptyText: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
        marginTop: 16,
        marginBottom: 8,
    },
    emptySubtext: {
        fontSize: 14,
        color: colors.primaryDark_1,
        textAlign: 'center',
        marginBottom: 24,
    },
    resultsContainer: {
        flex: 1,
    },
    resultsHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: 'white',
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    },
    resultsCount: {
        fontSize: 14,
        color: colors.primaryDark_1,
    },
    resultsList: {
        paddingVertical: 8,
    },
    clearFiltersText: {
        fontSize: 14,
        color: colors.primaryColor,
        fontWeight: '600',
        fontFamily: 'Inter-SemiBold',
    },
    clearAllButton: {
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: colors.primaryColor + '15',
    },
    clearFiltersActionButton: {
        flex: 1,
        backgroundColor: colors.COLOR_BLACK_LIGHT_5,
        paddingVertical: 14,
        paddingHorizontal: 20,
        borderRadius: 12,
        alignItems: 'center',
    },
    clearFiltersActionButtonText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
        fontFamily: 'Inter-SemiBold',
    },
    clearFiltersActionButtonTextDisabled: {
        color: colors.COLOR_BLACK_LIGHT_4,
    },
}); 