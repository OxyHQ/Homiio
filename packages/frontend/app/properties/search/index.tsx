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
    Platform,
    Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { PropertyCard } from '@/components/PropertyCard';
import { useSearchProperties } from '@/hooks';
import { Property, PropertyFilters } from '@/services/propertyService';

interface SearchFilters extends PropertyFilters {
    amenities?: string[];
    furnished?: boolean;
    petsAllowed?: boolean;
    ecoFriendly?: boolean;
    verified?: boolean;
}

const AMENITIES = [
    'wifi',
    'parking',
    'gym',
    'pool',
    'balcony',
    'garden',
    'elevator',
    'air_conditioning',
    'heating',
    'dishwasher',
    'washing_machine',
];

const PROPERTY_TYPES = [
    { id: 'apartment', label: 'Apartments', icon: 'business-outline' },
    { id: 'house', label: 'Houses', icon: 'home-outline' },
    { id: 'room', label: 'Rooms', icon: 'bed-outline' },
    { id: 'studio', label: 'Studios', icon: 'square-outline' },
];

export default function SearchScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const { query: initialQuery = '' } = useLocalSearchParams<{ query: string }>();

    const screenWidth = Dimensions.get('window').width;
    const isMobile = screenWidth < 600;

    const [searchQuery, setSearchQuery] = useState(decodeURIComponent(initialQuery));
    const [filters, setFilters] = useState<SearchFilters>({
        page: 1,
        limit: 10,
    });
    const [showFilters, setShowFilters] = useState(false);
    const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
    const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
    const [viewMode, setViewMode] = useState<'list' | 'grid'>(isMobile ? 'grid' : 'list');

    // Use the search hook
    const { searchResults, pagination, loading, error, search, clearSearchResults } = useSearchProperties();

    const properties = searchResults || [];
    const totalResults = pagination.total || 0;

    const handleSearch = useCallback(() => {
        if (searchQuery.trim()) {
            const newFilters: SearchFilters = {
                ...filters,
                amenities: selectedAmenities.length > 0 ? selectedAmenities : undefined,
                type: selectedTypes.length > 0 ? selectedTypes.join(',') : undefined,
                page: 1, // Reset to first page on new search
            };
            setFilters(newFilters);
        }
    }, [searchQuery, filters, selectedAmenities, selectedTypes]);

    const handleLoadMore = () => {
        if (properties.length < totalResults) {
            setFilters(prev => ({
                ...prev,
                page: (prev.page || 1) + 1,
            }));
        }
    };

    const toggleAmenity = (amenity: string) => {
        setSelectedAmenities(prev =>
            prev.includes(amenity)
                ? prev.filter(a => a !== amenity)
                : [...prev, amenity]
        );
    };

    const togglePropertyType = (type: string) => {
        setSelectedTypes(prev =>
            prev.includes(type)
                ? prev.filter(t => t !== type)
                : [...prev, type]
        );
    };

    const clearFilters = () => {
        setSelectedAmenities([]);
        setSelectedTypes([]);
        setFilters({
            page: 1,
            limit: 10,
        });
    };

    // Trigger search whenever filters change (including pagination)
    useEffect(() => {
        if (searchQuery.trim()) {
            search(searchQuery, filters);
        } else {
            clearSearchResults();
        }
    }, [filters]);

    // Run initial search if query param provided
    useEffect(() => {
        if (initialQuery) {
            search(initialQuery, { ...filters, page: 1 });
        }
    }, []);

    const renderPropertyItem = ({ item }: { item: Property }) => (
        <PropertyCard
            property={item}
            variant={viewMode === 'grid' ? 'compact' : 'default'}
            onPress={() => router.push(`/properties/${item._id || item.id}`)}
            style={viewMode === 'grid' ? styles.gridCard : undefined}
        />
    );

    const renderFilterSection = () => (
        <View style={styles.filterSection}>
            <View style={styles.filterHeader}>
                <Text style={styles.filterTitle}>{t('Filters')}</Text>
                <TouchableOpacity onPress={clearFilters}>
                    <Text style={styles.clearFiltersText}>{t('Clear All')}</Text>
                </TouchableOpacity>
            </View>

            {/* Property Types */}
            <View style={styles.filterGroup}>
                <Text style={styles.filterGroupTitle}>{t('Property Type')}</Text>
                <View style={styles.filterChips}>
                    {PROPERTY_TYPES.map((type) => (
                        <TouchableOpacity
                            key={type.id}
                            style={[
                                styles.filterChip,
                                selectedTypes.includes(type.id) && styles.filterChipActive,
                            ]}
                            onPress={() => togglePropertyType(type.id)}
                        >
                            <Ionicons
                                name={type.icon as any}
                                size={16}
                                color={selectedTypes.includes(type.id) ? 'white' : colors.primaryColor}
                            />
                            <Text
                                style={[
                                    styles.filterChipText,
                                    selectedTypes.includes(type.id) && styles.filterChipTextActive,
                                ]}
                            >
                                {t(type.label)}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>

            {/* Amenities */}
            <View style={styles.filterGroup}>
                <Text style={styles.filterGroupTitle}>{t('Amenities')}</Text>
                <View style={styles.filterChips}>
                    {AMENITIES.map((amenity) => (
                        <TouchableOpacity
                            key={amenity}
                            style={[
                                styles.filterChip,
                                selectedAmenities.includes(amenity) && styles.filterChipActive,
                            ]}
                            onPress={() => toggleAmenity(amenity)}
                        >
                            <Text
                                style={[
                                    styles.filterChipText,
                                    selectedAmenities.includes(amenity) && styles.filterChipTextActive,
                                ]}
                            >
                                {t(amenity.replace('_', ' '))}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            </View>

            {/* Price Range */}
            <View style={styles.filterGroup}>
                <Text style={styles.filterGroupTitle}>{t('Price Range')}</Text>
                <View style={styles.priceInputs}>
                    <TextInput
                        style={styles.priceInput}
                        placeholder={t('Min')}
                        keyboardType="numeric"
                        value={filters.minRent?.toString() || ''}
                        onChangeText={(text) =>
                            setFilters(prev => ({
                                ...prev,
                                minRent: text ? parseInt(text) : undefined,
                            }))
                        }
                    />
                    <Text style={styles.priceSeparator}>-</Text>
                    <TextInput
                        style={styles.priceInput}
                        placeholder={t('Max')}
                        keyboardType="numeric"
                        value={filters.maxRent?.toString() || ''}
                        onChangeText={(text) =>
                            setFilters(prev => ({
                                ...prev,
                                maxRent: text ? parseInt(text) : undefined,
                            }))
                        }
                    />
                </View>
            </View>

            {/* Bedrooms & Bathrooms */}
            <View style={styles.filterGroup}>
                <Text style={styles.filterGroupTitle}>{t('Rooms')}</Text>
                <View style={styles.roomInputs}>
                    <View style={styles.roomInput}>
                        <Text style={styles.roomLabel}>{t('Bedrooms')}</Text>
                        <TextInput
                            style={styles.roomTextInput}
                            placeholder="Any"
                            keyboardType="numeric"
                            value={filters.bedrooms?.toString() || ''}
                            onChangeText={(text) =>
                                setFilters(prev => ({
                                    ...prev,
                                    bedrooms: text ? parseInt(text) : undefined,
                                }))
                            }
                        />
                    </View>
                    <View style={styles.roomInput}>
                        <Text style={styles.roomLabel}>{t('Bathrooms')}</Text>
                        <TextInput
                            style={styles.roomTextInput}
                            placeholder="Any"
                            keyboardType="numeric"
                            value={filters.bathrooms?.toString() || ''}
                            onChangeText={(text) =>
                                setFilters(prev => ({
                                    ...prev,
                                    bathrooms: text ? parseInt(text) : undefined,
                                }))
                            }
                        />
                    </View>
                </View>
            </View>

            <TouchableOpacity style={styles.applyFiltersButton} onPress={handleSearch}>
                <Text style={styles.applyFiltersButtonText}>{t('Apply Filters')}</Text>
            </TouchableOpacity>
        </View>
    );

    const renderEmptyState = () => (
        <View style={styles.emptyContainer}>
            <Ionicons name="search-outline" size={60} color={colors.COLOR_BLACK_LIGHT_3} />
            <Text style={styles.emptyTitle}>
                {searchQuery ? t('No properties found') : t('Start your search')}
            </Text>
            <Text style={styles.emptySubtitle}>
                {searchQuery
                    ? t('Try adjusting your search criteria or filters')
                    : t('Enter a location, property type, or use filters to find your perfect home')}
            </Text>
        </View>
    );

    const renderErrorState = () => (
        <View style={styles.emptyContainer}>
            <Ionicons name="alert-circle-outline" size={60} color={colors.COLOR_BLACK_LIGHT_3} />
            <Text style={styles.emptyTitle}>{t('Search Error')}</Text>
            <Text style={styles.emptySubtitle}>{t('Something went wrong. Please try again.')}</Text>
            <TouchableOpacity style={styles.retryButton} onPress={() => search(searchQuery, filters)}>
                <Text style={styles.retryButtonText}>{t('Retry')}</Text>
            </TouchableOpacity>
        </View>
    );

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            {/* Search Header */}
            <View style={styles.header}>
                <TouchableOpacity
                    style={styles.backButton}
                    onPress={() => router.back()}
                >
                    <Ionicons name="arrow-back" size={24} color={colors.primaryColor} />
                </TouchableOpacity>

                <View style={styles.searchContainer}>
                    <View style={styles.searchInputContainer}>
                        <Ionicons name="search" size={20} color={colors.COLOR_BLACK_LIGHT_4} />
                        <TextInput
                            style={styles.searchInput}
                            placeholder={t('Search properties...')}
                            value={searchQuery}
                            onChangeText={setSearchQuery}
                            onSubmitEditing={handleSearch}
                            returnKeyType="search"
                        />
                        {searchQuery.length > 0 && (
                            <TouchableOpacity onPress={() => setSearchQuery('')}>
                                <Ionicons name="close-circle" size={20} color={colors.COLOR_BLACK_LIGHT_4} />
                            </TouchableOpacity>
                        )}
                    </View>

                    <TouchableOpacity
                        style={styles.filterButton}
                        onPress={() => setShowFilters(!showFilters)}
                    >
                        <Ionicons
                            name={showFilters ? 'options' : 'options-outline'}
                            size={24}
                            color={colors.primaryColor}
                        />
                    </TouchableOpacity>
                </View>
            </View>

            {/* Results Count */}
            {searchQuery && (
                <View style={styles.resultsHeader}>
                    <Text style={styles.resultsCount}>
                        {loading
                            ? t('Searching...')
                            : t('{{count}} properties found', { count: totalResults })}
                    </Text>
                    <View style={styles.viewModeToggle}>
                        <TouchableOpacity
                            style={[styles.toggleButton, viewMode === 'grid' && styles.toggleButtonActive]}
                            onPress={() => setViewMode('grid')}
                        >
                            <Ionicons
                                name="grid-outline"
                                size={20}
                                color={viewMode === 'grid' ? 'white' : colors.primaryColor}
                            />
                        </TouchableOpacity>
                        <TouchableOpacity
                            style={[styles.toggleButton, viewMode === 'list' && styles.toggleButtonActive]}
                            onPress={() => setViewMode('list')}
                        >
                            <Ionicons
                                name="list-outline"
                                size={20}
                                color={viewMode === 'list' ? 'white' : colors.primaryColor}
                            />
                        </TouchableOpacity>
                    </View>
                </View>
            )}

            {/* Filters Panel */}
            {showFilters && renderFilterSection()}

            {/* Properties List */}
            {error ? (
                renderErrorState()
            ) : (
                <FlatList
                    data={properties}
                    renderItem={renderPropertyItem}
                    keyExtractor={(item) => item._id || item.id || Math.random().toString()}
                    key={viewMode}
                    numColumns={viewMode === 'grid' ? 2 : 1}
                    columnWrapperStyle={viewMode === 'grid' ? styles.gridRow : undefined}
                    contentContainerStyle={styles.listContainer}
                    refreshControl={
                        <RefreshControl
                            refreshing={loading && properties.length === 0}
                            onRefresh={() => search(searchQuery, filters)}
                            colors={[colors.primaryColor]}
                        />
                    }
                    ListEmptyComponent={
                        loading && properties.length === 0 ? (
                            <View style={styles.loadingContainer}>
                                <ActivityIndicator size="large" color={colors.primaryColor} />
                                <Text style={styles.loadingText}>{t('Searching properties...')}</Text>
                            </View>
                        ) : (
                            renderEmptyState()
                        )
                    }
                    onEndReached={handleLoadMore}
                    onEndReachedThreshold={0.1}
                    ListFooterComponent={
                        loading && properties.length > 0 ? (
                            <View style={styles.loadingMoreContainer}>
                                <ActivityIndicator size="small" color={colors.primaryColor} />
                                <Text style={styles.loadingMoreText}>{t('Loading more...')}</Text>
                            </View>
                        ) : null
                    }
                />
            )}
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
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: 'white',
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    },
    backButton: {
        marginRight: 12,
        padding: 4,
    },
    searchContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    searchInputContainer: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primaryLight,
        borderRadius: 24,
        paddingHorizontal: 12,
        marginRight: 8,
        height: 40,
    },
    searchInput: {
        flex: 1,
        marginLeft: 8,
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    filterButton: {
        padding: 8,
    },
    resultsHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 8,
        backgroundColor: 'white',
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    },
    resultsCount: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
        fontWeight: '500',
    },
    filterSection: {
        backgroundColor: 'white',
        padding: 16,
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    },
    filterHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    filterTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: colors.primaryDark,
    },
    clearFiltersText: {
        fontSize: 14,
        color: colors.primaryColor,
        fontWeight: '500',
    },
    filterGroup: {
        marginBottom: 20,
    },
    filterGroupTitle: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.primaryDark,
        marginBottom: 12,
    },
    filterChips: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
    },
    filterChip: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 20,
        backgroundColor: colors.primaryLight,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_5,
        gap: 6,
    },
    filterChipActive: {
        backgroundColor: colors.primaryColor,
        borderColor: colors.primaryColor,
    },
    filterChipText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    filterChipTextActive: {
        color: 'white',
        fontWeight: '500',
    },
    priceInputs: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    priceInput: {
        flex: 1,
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 8,
        backgroundColor: colors.primaryLight,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_5,
        fontSize: 16,
    },
    priceSeparator: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    roomInputs: {
        flexDirection: 'row',
        gap: 16,
    },
    roomInput: {
        flex: 1,
    },
    roomLabel: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginBottom: 8,
    },
    roomTextInput: {
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 8,
        backgroundColor: colors.primaryLight,
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_5,
        fontSize: 16,
    },
    applyFiltersButton: {
        backgroundColor: colors.primaryColor,
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
        marginTop: 8,
    },
    applyFiltersButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
    },
    listContainer: {
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40,
    },
    emptyTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: colors.primaryDark,
        marginTop: 16,
        marginBottom: 8,
        textAlign: 'center',
    },
    emptySubtitle: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_4,
        textAlign: 'center',
        lineHeight: 24,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 40,
    },
    loadingText: {
        marginTop: 12,
        fontSize: 16,
        color: colors.primaryDark_1,
    },
    loadingMoreContainer: {
        paddingVertical: 20,
        alignItems: 'center',
    },
    loadingMoreText: {
        marginTop: 8,
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    retryButton: {
        backgroundColor: colors.primaryColor,
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 8,
        marginTop: 16,
    },
    retryButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
    },
    viewModeToggle: {
        flexDirection: 'row',
        backgroundColor: colors.primaryLight_1,
        borderRadius: 100,
        borderWidth: 1,
        borderColor: colors.primaryColor,
        overflow: 'hidden',
    },
    toggleButton: {
        paddingVertical: 6,
        paddingHorizontal: 10,
    },
    toggleButtonActive: {
        backgroundColor: colors.primaryColor,
    },
    gridRow: {
        justifyContent: 'space-between',
        paddingHorizontal: 4,
    },
    gridCard: {
        width: (Dimensions.get('window').width - 48) / 2,
        marginHorizontal: 4,
    },
});
