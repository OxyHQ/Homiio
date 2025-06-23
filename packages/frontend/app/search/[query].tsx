import React, { useState, useEffect, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TextInput,
    TouchableOpacity,
    FlatList,
    ActivityIndicator,
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

    // Property type options
    const propertyTypes = [
        { id: 'apartment', label: t('Apartment'), icon: 'business-outline' },
        { id: 'house', label: t('House'), icon: 'home-outline' },
        { id: 'room', label: t('Room'), icon: 'bed-outline' },
        { id: 'studio', label: t('Studio'), icon: 'square-outline' },
    ];

    // Amenity options
    const amenityOptions = [
        { id: 'wifi', label: t('WiFi'), icon: 'wifi-outline' },
        { id: 'parking', label: t('Parking'), icon: 'car-outline' },
        { id: 'gym', label: t('Gym'), icon: 'fitness-outline' },
        { id: 'pool', label: t('Pool'), icon: 'water-outline' },
        { id: 'balcony', label: t('Balcony'), icon: 'sunny-outline' },
        { id: 'furnished', label: t('Furnished'), icon: 'bed-outline' },
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
                    >
                        <Ionicons
                            name={type.icon as any}
                            size={16}
                            color={filters.type === type.id ? 'white' : colors.primaryColor}
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

    // Render price range filter
    const renderPriceFilter = () => (
        <View style={styles.filterSection}>
            <Text style={styles.filterSectionTitle}>{t('Price Range')}</Text>
            <View style={styles.priceInputs}>
                <View style={styles.priceInput}>
                    <Text style={styles.priceLabel}>{t('Min')}</Text>
                    <TextInput
                        style={styles.priceTextInput}
                        placeholder="0"
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
                        keyboardType="numeric"
                        value={filters.maxRent?.toString() || ''}
                        onChangeText={(text) => handleFilterChange('maxRent', text ? parseInt(text) : undefined)}
                    />
                </View>
            </View>
        </View>
    );

    // Render bedrooms/bathrooms filter
    const renderRoomsFilter = () => (
        <View style={styles.filterSection}>
            <Text style={styles.filterSectionTitle}>{t('Rooms')}</Text>
            <View style={styles.roomsInputs}>
                <View style={styles.roomInput}>
                    <Text style={styles.roomLabel}>{t('Bedrooms')}</Text>
                    <TextInput
                        style={styles.roomTextInput}
                        placeholder="Any"
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
                        keyboardType="numeric"
                        value={filters.bathrooms?.toString() || ''}
                        onChangeText={(text) => handleFilterChange('bathrooms', text ? parseInt(text) : undefined)}
                    />
                </View>
            </View>
        </View>
    );

    // Render amenities filter
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
                    >
                        <Ionicons
                            name={amenity.icon as any}
                            size={16}
                            color={filters.amenities?.includes(amenity.id) ? 'white' : colors.primaryColor}
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
                    <ActivityIndicator size="large" color={colors.primaryColor} />
                    <Text style={styles.loadingText}>{t('Searching properties...')}</Text>
                </View>
            );
        }

        if (error) {
            return (
                <View style={styles.errorContainer}>
                    <Ionicons name={"alert-circle-outline" as any} size={48} color={colors.COLOR_BLACK_LIGHT_3} />
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
                    <Ionicons name={"home-outline" as any} size={64} color={colors.COLOR_BLACK_LIGHT_3} />
                    <Text style={styles.emptyText}>{t('No properties found')}</Text>
                    <Text style={styles.emptySubtext}>
                        {t('Try adjusting your search criteria or filters')}
                    </Text>
                    <TouchableOpacity style={styles.clearFiltersButton} onPress={clearFilters}>
                        <Text style={styles.clearFiltersButtonText}>{t('Clear Filters')}</Text>
                    </TouchableOpacity>
                </View>
            );
        }

        return (
            <View style={styles.resultsContainer}>
                <View style={styles.resultsHeader}>
                    <Text style={styles.resultsCount}>
                        {t('{{count}} properties found', { count: apiData?.total || 0 })}
                    </Text>
                    {Object.keys(filters).length > 0 && (
                        <TouchableOpacity onPress={clearFilters}>
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
            {/* Header */}
            <View style={styles.header}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => router.back()}
                >
                    <Ionicons name={"arrow-back" as any} size={24} color={colors.primaryColor} />
                </TouchableOpacity>
                <Text style={styles.headerTitle} numberOfLines={1}>
                    {t('Search: {{query}}', { query: searchQuery })}
                </Text>
                <TouchableOpacity
                    style={styles.filterButton}
                    onPress={() => setShowFilters(!showFilters)}
                >
                    <Ionicons
                        name={showFilters ? "options" : "options-outline"}
                        size={24}
                        color={colors.primaryColor}
                    />
                </TouchableOpacity>
            </View>

            {/* Filters */}
            {showFilters && (
                <ScrollView style={styles.filtersContainer} showsVerticalScrollIndicator={false}>
                    {renderPropertyTypeFilter()}
                    {renderPriceFilter()}
                    {renderRoomsFilter()}
                    {renderAmenitiesFilter()}

                    <View style={styles.filterActions}>
                        <TouchableOpacity style={styles.clearFiltersButton} onPress={clearFilters}>
                            <Text style={styles.clearFiltersButtonText}>{t('Clear All')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={styles.applyFiltersButton}
                            onPress={() => setShowFilters(false)}
                        >
                            <Text style={styles.applyFiltersButtonText}>{t('Apply Filters')}</Text>
                        </TouchableOpacity>
                    </View>
                </ScrollView>
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
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: 'white',
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    },
    backButton: {
        padding: 8,
    },
    headerTitle: {
        flex: 1,
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
        marginHorizontal: 12,
    },
    filterButton: {
        padding: 8,
    },
    filtersContainer: {
        padding: 16,
    },
    filterSection: {
        marginBottom: 16,
    },
    filterSectionTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 8,
    },
    filterOptions: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    filterOption: {
        padding: 8,
        borderWidth: 1,
        borderColor: colors.primaryColor,
        borderRadius: 8,
        marginRight: 8,
    },
    filterOptionActive: {
        backgroundColor: colors.primaryColor,
    },
    filterOptionText: {
        fontSize: 14,
        color: colors.primaryDark_1,
    },
    filterOptionTextActive: {
        fontWeight: '600',
    },
    priceInputs: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    priceInput: {
        flex: 1,
        marginRight: 8,
    },
    priceLabel: {
        fontSize: 14,
        color: colors.primaryDark_1,
    },
    priceTextInput: {
        padding: 8,
        borderWidth: 1,
        borderColor: colors.primaryColor,
        borderRadius: 8,
    },
    roomsInputs: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    roomInput: {
        flex: 1,
        marginRight: 8,
    },
    roomLabel: {
        fontSize: 14,
        color: colors.primaryDark_1,
    },
    roomTextInput: {
        padding: 8,
        borderWidth: 1,
        borderColor: colors.primaryColor,
        borderRadius: 8,
    },
    amenitiesGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
    },
    amenityOption: {
        padding: 8,
        borderWidth: 1,
        borderColor: colors.primaryColor,
        borderRadius: 8,
        marginRight: 8,
        marginBottom: 8,
    },
    amenityOptionActive: {
        backgroundColor: colors.primaryColor,
    },
    amenityOptionText: {
        fontSize: 14,
        color: colors.primaryDark_1,
    },
    amenityOptionTextActive: {
        fontWeight: '600',
    },
    filterActions: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 16,
    },
    clearFiltersButton: {
        backgroundColor: colors.primaryColor,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
    },
    clearFiltersButtonText: {
        color: 'white',
        fontWeight: '600',
    },
    applyFiltersButton: {
        backgroundColor: colors.primaryColor,
        paddingHorizontal: 24,
        paddingVertical: 12,
        borderRadius: 8,
    },
    applyFiltersButtonText: {
        color: 'white',
        fontWeight: '600',
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
    },
}); 