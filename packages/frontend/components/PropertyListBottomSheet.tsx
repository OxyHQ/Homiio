import React, { useMemo, useRef, useCallback } from 'react';
import { View, StyleSheet, FlatList, Dimensions, TextInput, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Property } from '@homiio/shared-types';
import { PropertyCard } from '@/components/PropertyCard';
import { ThemedText } from '@/components/ThemedText';
import { Header } from '@/components/Header';
import { colors } from '@/styles/colors';
import { useTranslation } from 'react-i18next';

const { width: screenWidth } = Dimensions.get('window');

// Responsive column calculation
const getOptimalColumns = (width: number): number => {
    const minCardWidth = 160; // Minimum card width for readability
    const padding = 32; // Total horizontal padding (16 on each side)
    const spacing = 8; // Spacing between columns

    const availableWidth = width - padding;
    const maxColumns = Math.floor((availableWidth + spacing) / (minCardWidth + spacing));

    // Ensure we have at least 1 column and at most 3 columns for optimal UX
    return Math.max(1, Math.min(3, maxColumns));
};

const HORIZONTAL_PADDING = 16;
const ITEM_SPACING = 8;
const NUM_COLUMNS = getOptimalColumns(screenWidth);

interface SearchResult {
    id: string;
    place_name: string;
    center: [number, number];
    text: string;
    context?: { text: string }[];
    bbox?: [number, number, number, number];
}

interface PropertyListBottomSheetProps {
    /** Array of properties to display */
    properties: Property[];
    /** Currently highlighted property ID */
    highlightedPropertyId: string | null;
    /** Callback when a property is pressed */
    onPropertyPress: (property: Property) => void;
    /** Loading state */
    isLoading?: boolean;
    /** Callback when viewable items change */
    onViewableItemsChanged?: (viewableItems: { item: Property }[]) => void;
    /** Optional ref to the FlatList */
    flatListRef?: React.RefObject<FlatList>;
    /** Current map bounds for displaying search results */
    _mapBounds?: { west: number; south: number; east: number; north: number } | null;
    /** Total count of available properties in the area */
    totalCount?: number;
    /** Search functionality props */
    searchQuery?: string;
    onSearchQueryChange?: (query: string) => void;
    searchResults?: SearchResult[];
    isSearching?: boolean;
    showSearchResults?: boolean;
    onSelectLocation?: (result: SearchResult) => void;
    /** Filter functionality props */
    onOpenFilters?: () => void;
    onSaveSearch?: () => void;
    onRefreshLocation?: () => void;
}

/**
 * Bottom sheet component that displays properties in a grid layout.
 * Shows properties currently visible within the map viewport for intuitive search results.
 */
export function PropertyListBottomSheet({
    properties,
    highlightedPropertyId,
    onPropertyPress,
    isLoading = false,
    onViewableItemsChanged,
    flatListRef,
    _mapBounds,
    totalCount,
    searchQuery = '',
    onSearchQueryChange,
    searchResults = [],
    isSearching = false,
    showSearchResults = false,
    onSelectLocation,
    onOpenFilters,
    onSaveSearch,
    onRefreshLocation,
}: PropertyListBottomSheetProps) {
    const { t } = useTranslation();
    const internalFlatListRef = useRef<FlatList>(null);
    const listRef = flatListRef || internalFlatListRef;

    // Memoize viewability config to prevent re-renders
    const viewabilityConfig = useMemo(() => ({
        itemVisiblePercentThreshold: 50,
    }), []);

    // Memoize the viewable items changed handler to prevent FlatList re-renders
    const handleViewableItemsChanged = useMemo(() => {
        if (!onViewableItemsChanged) return undefined;

        return ({ viewableItems }: { viewableItems: any[] }) => {
            if (viewableItems.length > 0) {
                onViewableItemsChanged(viewableItems);
            }
        };
    }, [onViewableItemsChanged]);

    // Render individual property card for grid
    const renderPropertyCard = useCallback(
        ({ item }: { item: Property }) => {
            const isHighlighted = item._id === highlightedPropertyId;

            return (
                <View style={styles.gridItem}>
                    <PropertyCard
                        property={item}
                        variant="compact"
                        orientation="vertical"
                        onPress={() => onPropertyPress(item)}
                        style={
                            isHighlighted
                                ? { ...styles.propertyCard, ...styles.highlightedCard }
                                : styles.propertyCard
                        }
                        showSaveButton
                        showVerifiedBadge
                        showSaveCount={false}
                    />
                </View>
            );
        },
        [highlightedPropertyId, onPropertyPress]
    );

    // Memoize key extractor
    const keyExtractor = useCallback((item: Property) => item._id, []);

    // Show loading state
    if (isLoading) {
        return (
            <View style={styles.container}>
                <View style={styles.loadingContainer}>
                    <ThemedText style={styles.loadingText}>
                        {t('Loading properties...')}
                    </ThemedText>
                </View>
            </View>
        );
    }

    // Show empty state with search functionality still visible
    if (!properties || properties.length === 0) {
        return (
            <View style={styles.container}>
                {/* Enhanced Header with count and area info */}
                <Header
                    options={{
                        title: t('No properties found in this area'),
                        subtitle: t('Try searching for a different location or adjusting your filters'),
                        titlePosition: 'left',
                        transparent: false,
                    }}
                />

                {/* Search Bar and Controls - Always visible */}
                <View style={styles.searchContainer}>
                    <View style={styles.searchHeader}>
                        <View style={styles.searchInputContainer}>
                            <Ionicons name="search" size={20} color="#666" style={styles.searchIcon} />
                            <TextInput
                                style={styles.searchInput}
                                placeholder="Search for a city, neighborhood, or address..."
                                value={searchQuery}
                                onChangeText={onSearchQueryChange}
                                returnKeyType="search"
                            />
                            {isSearching ? (
                                <View style={styles.loadingSpinner}>
                                    <View style={styles.spinner} />
                                </View>
                            ) : searchQuery.length > 0 && (
                                <TouchableOpacity onPress={() => onSearchQueryChange?.('')} style={styles.clearButton}>
                                    <Ionicons name="close-circle" size={20} color="#999" />
                                </TouchableOpacity>
                            )}
                        </View>

                        <View style={styles.headerButtons}>
                            <TouchableOpacity
                                style={styles.filterButton}
                                onPress={onOpenFilters}
                                accessibilityLabel="More Filters"
                            >
                                <Ionicons name="options-outline" size={20} color={colors.primaryColor} />
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.saveButton}
                                onPress={onSaveSearch}
                                accessibilityLabel="Save Search"
                            >
                                <Ionicons name="bookmark-outline" size={20} color={colors.primaryColor} />
                            </TouchableOpacity>

                            <TouchableOpacity
                                style={styles.refreshButton}
                                onPress={onRefreshLocation}
                                accessibilityLabel="Refresh Location"
                            >
                                <Ionicons name="location" size={20} color={colors.primaryColor} />
                            </TouchableOpacity>
                        </View>
                    </View>

                    {/* Search Results */}
                    {showSearchResults && searchResults.length > 0 && (
                        <View style={styles.searchResults}>
                            <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 200 }}>
                                {searchResults.map((result) => (
                                    <TouchableOpacity
                                        key={result.id}
                                        style={styles.searchResultItem}
                                        onPress={() => onSelectLocation?.(result)}
                                    >
                                        <Ionicons name="location-outline" size={20} color="#666" style={styles.locationIcon} />
                                        <View style={styles.searchResultText}>
                                            <ThemedText style={styles.primaryText}>{result.text}</ThemedText>
                                            <ThemedText style={styles.secondaryText}>
                                                {result.place_name.replace(`${result.text}, `, '')}
                                            </ThemedText>
                                        </View>
                                    </TouchableOpacity>
                                ))}
                            </ScrollView>
                        </View>
                    )}
                    {showSearchResults && searchResults.length === 0 && searchQuery.trim() && !isSearching && (
                        <View style={[styles.searchResults, { padding: 12 }]}>
                            <ThemedText style={styles.secondaryText}>No results found</ThemedText>
                        </View>
                    )}
                </View>

                <View style={styles.emptyContainer}>
                    <ThemedText style={styles.emptyText}>
                        {t('No properties found in this area')}
                    </ThemedText>
                    <ThemedText style={styles.emptySubtext}>
                        {t('Try moving the map to explore different areas or zoom out to see more results')}
                    </ThemedText>
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            {/* Enhanced Header with count and area info */}
            <Header
                options={{
                    title: properties.length > 0
                        ? `${properties.length} properties in this area`
                        : t('No properties found in this area'),
                    subtitle: totalCount && totalCount > properties.length
                        ? t('{{total}} total available - zoom out to see more', { total: totalCount })
                        : undefined,
                    titlePosition: 'left',
                    transparent: false,
                }}
            />

            {/* Search Bar and Controls */}
            <View style={styles.searchContainer}>
                <View style={styles.searchHeader}>
                    <View style={styles.searchInputContainer}>
                        <Ionicons name="search" size={20} color="#666" style={styles.searchIcon} />
                        <TextInput
                            style={styles.searchInput}
                            placeholder="Search for a city, neighborhood, or address..."
                            value={searchQuery}
                            onChangeText={onSearchQueryChange}
                            returnKeyType="search"
                        />
                        {isSearching ? (
                            <View style={styles.loadingSpinner}>
                                <View style={styles.spinner} />
                            </View>
                        ) : searchQuery.length > 0 && (
                            <TouchableOpacity onPress={() => onSearchQueryChange?.('')} style={styles.clearButton}>
                                <Ionicons name="close-circle" size={20} color="#999" />
                            </TouchableOpacity>
                        )}
                    </View>

                    <View style={styles.headerButtons}>
                        <TouchableOpacity
                            style={styles.filterButton}
                            onPress={onOpenFilters}
                            accessibilityLabel="More Filters"
                        >
                            <Ionicons name="options-outline" size={20} color={colors.primaryColor} />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.saveButton}
                            onPress={onSaveSearch}
                            accessibilityLabel="Save Search"
                        >
                            <Ionicons name="bookmark-outline" size={20} color={colors.primaryColor} />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.refreshButton}
                            onPress={onRefreshLocation}
                            accessibilityLabel="Refresh Location"
                        >
                            <Ionicons name="location" size={20} color={colors.primaryColor} />
                        </TouchableOpacity>
                    </View>
                </View>

                {/* Search Results */}
                {showSearchResults && searchResults.length > 0 && (
                    <View style={styles.searchResults}>
                        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 200 }}>
                            {searchResults.map((result) => (
                                <TouchableOpacity
                                    key={result.id}
                                    style={styles.searchResultItem}
                                    onPress={() => onSelectLocation?.(result)}
                                >
                                    <Ionicons name="location-outline" size={20} color="#666" style={styles.locationIcon} />
                                    <View style={styles.searchResultText}>
                                        <ThemedText style={styles.primaryText}>{result.text}</ThemedText>
                                        <ThemedText style={styles.secondaryText}>
                                            {result.place_name.replace(`${result.text}, `, '')}
                                        </ThemedText>
                                    </View>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                    </View>
                )}
                {showSearchResults && searchResults.length === 0 && searchQuery.trim() && !isSearching && (
                    <View style={[styles.searchResults, { padding: 12 }]}>
                        <ThemedText style={styles.secondaryText}>No results found</ThemedText>
                    </View>
                )}
            </View>

            {/* Property grid */}
            <FlatList
                ref={listRef}
                data={properties}
                keyExtractor={keyExtractor}
                numColumns={NUM_COLUMNS}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.listContent}
                onViewableItemsChanged={handleViewableItemsChanged}
                viewabilityConfig={viewabilityConfig}
                renderItem={renderPropertyCard}
                initialNumToRender={6}
                maxToRenderPerBatch={10}
                windowSize={10}
                removeClippedSubviews={true}
                // Performance optimizations
                updateCellsBatchingPeriod={100}
                legacyImplementation={false}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#fff',
        flex: 1,
    },
    listContent: {
        paddingHorizontal: HORIZONTAL_PADDING,
        paddingBottom: 16,
        paddingTop: 8,
    },
    gridItem: {
        flex: 1,
        marginHorizontal: ITEM_SPACING / 2,
        marginBottom: ITEM_SPACING,
        minWidth: 0, // Ensures flex works properly
    },
    propertyCard: {
        backgroundColor: '#fff',
        borderRadius: 12,
        overflow: 'hidden',
        flex: 1,
        // Shadow for elevation
        shadowColor: '#000',
        shadowOffset: {
            width: 0,
            height: 2,
        },
        shadowOpacity: 0.1,
        shadowRadius: 3.84,
        elevation: 5,
    },
    highlightedCard: {
        borderWidth: 2,
        borderColor: colors.primaryColor,
    },
    loadingContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 32,
    },
    loadingText: {
        fontSize: 16,
        color: colors.COLOR_BLACK_LIGHT_3,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
        paddingVertical: 32,
    },
    emptyText: {
        fontSize: 16,
        fontWeight: '600',
        color: colors.COLOR_BLACK_LIGHT_2,
        textAlign: 'center',
        marginBottom: 8,
    },
    emptySubtext: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        textAlign: 'center',
        lineHeight: 20,
    },
    // Search container styles
    searchContainer: {
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
    },
    searchHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    searchInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primaryLight,
        borderRadius: 24,
        paddingHorizontal: 12,
        paddingVertical: Platform.OS === 'web' ? 8 : 4,
        flex: 1,
        marginRight: 8,
    },
    searchIcon: {
        marginRight: 8,
    },
    searchInput: Platform.select({
        web: {
            flex: 1,
            fontSize: 16,
            color: '#333',
            paddingVertical: 8,
            borderWidth: 0,
        },
        default: {
            flex: 1,
            fontSize: 16,
            color: '#333',
            paddingVertical: 8,
        },
    }),
    clearButton: {
        padding: 4,
    },
    loadingSpinner: {
        width: 20,
        height: 20,
        justifyContent: 'center',
        alignItems: 'center',
    },
    spinner: {
        width: 16,
        height: 16,
        borderWidth: 2,
        borderColor: '#666',
        borderTopColor: 'transparent',
        borderRadius: 8,
    },
    headerButtons: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    filterButton: {
        backgroundColor: colors.primaryLight,
        borderRadius: 20,
        padding: 8,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 3,
        elevation: 2,
    },
    saveButton: {
        backgroundColor: colors.primaryLight,
        borderRadius: 20,
        padding: 8,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 3,
        elevation: 2,
    },
    refreshButton: {
        backgroundColor: colors.primaryLight,
        borderRadius: 20,
        padding: 8,
        alignItems: 'center',
        justifyContent: 'center',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 3,
        elevation: 2,
    },
    searchResults: {
        backgroundColor: '#fff',
        borderRadius: 12,
        marginTop: 8,
        maxHeight: 200,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 3,
    },
    searchResultItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
    },
    locationIcon: {
        marginRight: 12,
    },
    searchResultText: {
        flex: 1,
    },
    primaryText: {
        fontSize: 16,
        color: '#333',
        marginBottom: 2,
    },
    secondaryText: {
        fontSize: 14,
        color: '#666',
    },
});
