import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TextInput,
    TouchableOpacity,
    FlatList,
    ActivityIndicator,
    RefreshControl,
    Dimensions,
    ScrollView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { PropertyCard } from '@/components/PropertyCard';
import { useSearchProperties } from '@/hooks';
import { Property, PropertyFilters } from '@homiio/shared-types';
import { useSavedSearches } from '@/hooks/useSavedSearches';
import { useContext } from 'react';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { SaveSearchBottomSheet } from '@/components/SaveSearchBottomSheet';
import { FiltersBar } from '@/components/FiltersBar';
import { FiltersBottomSheet, FilterSection } from '@/components/FiltersBar/FiltersBottomSheet';
import { FilterChip } from '@/components/ui/FilterChip';

interface SearchFilters extends PropertyFilters {
    // Additional filters specific to search screen
    // All other properties are inherited from PropertyFilters
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

const QUICK_FILTERS = [
    { id: 'eco', label: 'Eco-friendly', icon: 'leaf-outline', color: '#16a34a' },
    { id: 'furnished', label: 'Furnished', icon: 'bed-outline', color: '#f59e0b' },
    { id: 'pets', label: 'Pets Allowed', icon: 'paw-outline', color: '#10b981' },
    { id: 'verified', label: 'Verified', icon: 'checkmark-circle-outline', color: '#059669' },
    { id: 'budget', label: '< €1000', icon: 'wallet-outline', color: '#3b82f6' },
    { id: 'coliving', label: 'Co-living', icon: 'people-outline', color: '#8b5cf6' },
];

export default function SearchScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const { query: initialQuery = '' } = useLocalSearchParams<{ query: string }>();

    const screenWidth = Dimensions.get('window').width;
    const isMobile = screenWidth < 600;

    const [searchQuery, setSearchQuery] = useState(decodeURIComponent(initialQuery));
    const [inputValue, setInputValue] = useState(decodeURIComponent(initialQuery));
    const [filters, setFilters] = useState<SearchFilters>({
        page: 1,
        limit: 10,
    });
    const [draftFilters, setDraftFilters] = useState<SearchFilters>({
        page: 1,
        limit: 10,
    });
    const [viewMode, setViewMode] = useState<'list' | 'grid'>(isMobile ? 'grid' : 'list');
    const [activeQuickFilters, setActiveQuickFilters] = useState<string[]>([]);

    const filterSections: FilterSection[] = useMemo(() => [
        {
            id: 'type',
            title: t('Property Type'),
            type: 'chips',
            options: PROPERTY_TYPES.map(type => ({
                id: type.id,
                label: t(type.label),
                value: type.id
            })),
            value: filters.type
        },
        {
            id: 'price',
            title: t('Price Range'),
            type: 'range',
            min: 0,
            max: 10000,
            value: filters.minRent || filters.maxRent ? [filters.minRent || 0, filters.maxRent || 10000] : undefined
        },
        {
            id: 'bedrooms',
            title: t('Bedrooms'),
            type: 'chips',
            options: [
                { id: '1', label: '1', value: '1' },
                { id: '2', label: '2', value: '2' },
                { id: '3', label: '3', value: '3' },
                { id: '4', label: '4', value: '4' },
                { id: '5', label: '5+', value: '5' },
            ],
            value: filters.bedrooms?.toString()
        },
        {
            id: 'bathrooms',
            title: t('Bathrooms'),
            type: 'chips',
            options: [
                { id: '1', label: '1', value: '1' },
                { id: '2', label: '2', value: '2' },
                { id: '3', label: '3', value: '3' },
                { id: '4', label: '4+', value: '4' },
            ],
            value: filters.bathrooms?.toString()
        },
        {
            id: 'amenities',
            title: t('Amenities'),
            type: 'chips',
            options: AMENITIES.map(amenity => ({
                id: amenity,
                label: t(amenity.replace('_', ' ')),
                value: amenity
            })),
            value: filters.amenities
        }
    ], [t, filters]);

    const { saveSearch, isAuthenticated } = useSavedSearches();
    const bottomSheet = useContext(BottomSheetContext);

    // Use the search hook (React Query)
    const rq = useSearchProperties(searchQuery.trim() || undefined, {
        ...filters,
    });
    const loading = rq.isLoading;
    const error = rq.error ? String((rq.error as any)?.message || rq.error) : null;
    const properties = (rq.data?.properties as any[]) || [];
    const totalResults = rq.data?.total || 0;

    const handleSearch = useCallback(() => {
        if (inputValue.trim()) {
            const newFilters: SearchFilters = {
                ...draftFilters,
                page: 1, // Reset to first page on new search
                limit: 10,
            };
            setFilters(newFilters);
            // Reflect the query in the route: /search/:query
            setSearchQuery(inputValue);
            router.push(`/search/${encodeURIComponent(inputValue)}`);
        }
    }, [router, inputValue, draftFilters, setFilters]);

    const handleLoadMore = () => {
        if (properties.length < totalResults) {
            setFilters((prev) => ({
                ...prev,
                page: (prev.page || 1) + 1,
            }));
        }
    };

    const handleFilterChange = useCallback((sectionId: string, value: any) => {
        setFilters(prev => {
            switch (sectionId) {
                case 'price':
                    if (Array.isArray(value)) {
                        return {
                            ...prev,
                            minRent: value[0],
                            maxRent: value[1]
                        };
                    }
                    return prev;
                case 'type':
                    return { ...prev, type: value };
                case 'bedrooms':
                    return { ...prev, bedrooms: parseInt(value) };
                case 'bathrooms':
                    return { ...prev, bathrooms: parseInt(value) };
                case 'amenities':
                    return { ...prev, amenities: value };
                default:
                    return prev;
            }
        });
    }, []);

    const handleOpenFilters = useCallback(() => {
        bottomSheet.openBottomSheet(
            <FiltersBottomSheet
                sections={filterSections}
                onFilterChange={handleFilterChange}
                onApply={bottomSheet.closeBottomSheet}
                onClear={() => {
                    setFilters({
                        page: 1,
                        limit: 10
                    });
                    bottomSheet.closeBottomSheet();
                }}
            />
        );
    }, [bottomSheet, filterSections, handleFilterChange]);

    const handleQuickFilterToggle = useCallback((filterId: string) => {
        setActiveQuickFilters(prev => {
            const newFilters = prev.includes(filterId)
                ? prev.filter(id => id !== filterId)
                : [...prev, filterId];

            // Apply quick filter logic
            let newSearchFilters = { ...filters };

            switch (filterId) {
                case 'eco':
                    newSearchFilters.eco = !prev.includes(filterId);
                    break;
                case 'furnished':
                    newSearchFilters.furnished = !prev.includes(filterId);
                    break;
                case 'pets':
                    newSearchFilters.petFriendly = !prev.includes(filterId);
                    break;
                case 'verified':
                    newSearchFilters.verified = !prev.includes(filterId);
                    break;
                case 'budget':
                    if (!prev.includes(filterId)) {
                        newSearchFilters.maxRent = 1000;
                    } else {
                        newSearchFilters.maxRent = undefined;
                    }
                    break;
                case 'coliving':
                    // Handle co-living filter logic
                    break;
            }

            setFilters(newSearchFilters);
            return newFilters;
        });
    }, [filters]);

    const getActiveFiltersCount = useCallback(() => {
        return Object.values(filters).filter(value =>
            value !== undefined &&
            value !== null &&
            value !== '' &&
            value !== 'newest' &&
            (Array.isArray(value) ? value.length > 0 : true)
        ).length - 2 + activeQuickFilters.length; // Subtract page and limit, add quick filters
    }, [filters, activeQuickFilters]);

    const clearAllFilters = useCallback(() => {
        setFilters({
            page: 1,
            limit: 10,
        });
        setActiveQuickFilters([]);
    }, []);

    // Keep local state in sync with route param
    useEffect(() => {
        const q = decodeURIComponent(initialQuery || '');
        setSearchQuery(q);
        setInputValue(q);
        // Reset to first page when query changes
        setFilters((prev) => ({ ...(prev || {}), page: 1, limit: 10 }));
    }, [initialQuery, setFilters]);

    // If navigated to /search/:query, update local state; the hook will refetch automatically
    useEffect(() => {
        const q = decodeURIComponent(initialQuery || '').trim();
        if (q) {
            const newFilters: SearchFilters = {
                ...filters,
                page: 1,
                limit: 10,
            };
            setFilters(newFilters);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [initialQuery]);

    const renderPropertyItem = ({ item }: { item: Property }) => (
        <PropertyCard
            property={item}
            variant={viewMode === 'grid' ? 'compact' : 'default'}
            onPress={() => router.push(`/properties/${item._id || item.id}`)}
            style={viewMode === 'grid' ? styles.gridCard : undefined}
        />
    );



    const handleOpenSaveModal = () => {
        if (!isAuthenticated) {
            router.push('/profile');
            return;
        }
        const currentFilters: SearchFilters = {
            ...filters
        };
        bottomSheet.openBottomSheet(
            <SaveSearchBottomSheet
                defaultName={searchQuery}
                query={searchQuery}
                filters={currentFilters}
                onClose={() => bottomSheet.closeBottomSheet()}
                onSaved={() => { }}
            />,
        );
    };

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
            <TouchableOpacity style={styles.retryButton} onPress={() => rq.refetch()}>
                <Text style={styles.retryButtonText}>{t('Retry')}</Text>
            </TouchableOpacity>
        </View>
    );

    const renderFiltersToolbar = () => (
        <View style={styles.filtersToolbar}>
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.filtersScrollContent}
            >
                {/* Quick Filters */}
                {QUICK_FILTERS.map((filter) => (
                    <FilterChip
                        key={filter.id}
                        label={filter.label}
                        selected={activeQuickFilters.includes(filter.id)}
                        onPress={() => handleQuickFilterToggle(filter.id)}
                        style={{
                            ...styles.quickFilterChip,
                            ...(activeQuickFilters.includes(filter.id) ? {
                                backgroundColor: filter.color,
                                borderColor: filter.color,
                            } : {})
                        }}
                        textStyle={activeQuickFilters.includes(filter.id) ? styles.quickFilterTextActive : undefined}
                    />
                ))}
            </ScrollView>

            {/* Advanced Filters Button */}
            <View style={styles.advancedFiltersContainer}>
                <TouchableOpacity
                    style={[styles.advancedFiltersButton, getActiveFiltersCount() > 0 && styles.advancedFiltersButtonActive]}
                    onPress={handleOpenFilters}
                >
                    <Ionicons
                        name="options-outline"
                        size={18}
                        color={getActiveFiltersCount() > 0 ? '#fff' : colors.primaryColor}
                    />
                    <Text style={[
                        styles.advancedFiltersText,
                        getActiveFiltersCount() > 0 && styles.advancedFiltersTextActive
                    ]}>
                        {getActiveFiltersCount() > 0 ? `${getActiveFiltersCount()} Filters` : 'More Filters'}
                    </Text>
                </TouchableOpacity>

                {getActiveFiltersCount() > 0 && (
                    <TouchableOpacity
                        style={styles.clearFiltersButton}
                        onPress={clearAllFilters}
                    >
                        <Ionicons name="close-circle" size={16} color={colors.COLOR_BLACK_LIGHT_4} />
                    </TouchableOpacity>
                )}
            </View>
        </View>
    );

    return (
        <SafeAreaView style={styles.container} edges={['top']}>
            {/* Search Header */}
            <View style={styles.header}>
                <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
                    <Ionicons name="arrow-back" size={24} color={colors.primaryColor} />
                </TouchableOpacity>

                <View style={styles.searchContainer}>
                    <View style={styles.searchInputContainer}>
                        <Ionicons name="search" size={20} color={colors.COLOR_BLACK_LIGHT_4} />
                        <TextInput
                            style={styles.searchInput}
                            placeholder={t('Search properties...')}
                            value={inputValue}
                            onChangeText={setInputValue}
                            onSubmitEditing={handleSearch}
                            returnKeyType="search"
                        />
                        {searchQuery.length > 0 && (
                            <TouchableOpacity
                                onPress={() => {
                                    setInputValue('');
                                    setSearchQuery('');
                                }}
                            >
                                <Ionicons name="close-circle" size={20} color={colors.COLOR_BLACK_LIGHT_4} />
                            </TouchableOpacity>
                        )}
                    </View>

                    <TouchableOpacity
                        style={styles.saveButton}
                        onPress={handleOpenSaveModal}
                        accessibilityLabel={t('Save Search')}
                    >
                        <Ionicons name="bookmark-outline" size={20} color={colors.primaryColor} />
                        {!isMobile && <Text style={styles.saveButtonText}>{t('Save')}</Text>}
                    </TouchableOpacity>
                </View>
            </View>

            {/* Filters Toolbar */}
            {renderFiltersToolbar()}

            {/* Results Count */}
            {searchQuery && (
                <View style={styles.resultsHeader}>
                    <Text style={styles.resultsCount}>
                        {loading ? t('Searching...') : t('{{count}} properties found', { count: totalResults })}
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
                            onRefresh={() => rq.refetch()}
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

            {/* Save handled via BottomSheet */}
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
    saveButton: {
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderWidth: 1,
        borderColor: colors.primaryColor,
        borderRadius: 20,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        marginLeft: 6,
        backgroundColor: colors.primaryLight,
    },
    saveButtonText: {
        color: colors.primaryColor,
        fontWeight: '600',
    },
    filtersToolbar: {
        backgroundColor: 'white',
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
    },
    filtersScrollContent: {
        paddingHorizontal: 16,
        gap: 8,
    },
    quickFilterChip: {
        borderWidth: 1,
        borderColor: colors.COLOR_BLACK_LIGHT_5,
        backgroundColor: colors.primaryLight,
    },
    quickFilterTextActive: {
        color: 'white',
        fontWeight: '600',
    },
    advancedFiltersContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingTop: 12,
        borderTopWidth: 1,
        borderTopColor: colors.COLOR_BLACK_LIGHT_6,
        marginTop: 12,
    },
    advancedFiltersButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 20,
        backgroundColor: colors.primaryLight,
        borderWidth: 1,
        borderColor: colors.primaryColor,
        gap: 6,
    },
    advancedFiltersButtonActive: {
        backgroundColor: colors.primaryColor,
    },
    advancedFiltersText: {
        fontSize: 14,
        color: colors.primaryColor,
        fontWeight: '500',
    },
    advancedFiltersTextActive: {
        color: 'white',
    },
    clearFiltersButton: {
        padding: 4,
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
