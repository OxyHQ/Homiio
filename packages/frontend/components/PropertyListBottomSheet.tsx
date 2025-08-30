import React, { useMemo, useRef, useCallback } from 'react';
import { View, StyleSheet, FlatList, Dimensions, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Property } from '@homiio/shared-types';
import { PropertyCard } from '@/components/PropertyCard';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import { useTranslation } from 'react-i18next';

const { width: screenWidth, height: screenHeight } = Dimensions.get('window');

// Responsive column calculation for better grid layout
const getOptimalColumns = (width: number): number => {
    const minCardWidth = 180; // Increased minimum card width for better readability
    const padding = 32; // Total horizontal padding (16 on each side)
    const spacing = 12; // Increased spacing between columns

    const availableWidth = width - padding;
    const maxColumns = Math.floor((availableWidth + spacing) / (minCardWidth + spacing));

    // Ensure we have at least 1 column and at most 2 columns for better card size
    return Math.max(1, Math.min(2, maxColumns));
};

const HORIZONTAL_PADDING = 16;
const ITEM_SPACING = 12; // Increased spacing
const NUM_COLUMNS = getOptimalColumns(screenWidth);

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
    /** Filter functionality props */
    onOpenFilters?: () => void;
    onSaveSearch?: () => void;
    onRefreshLocation?: () => void;
}

/**
 * Google Maps-style bottom sheet component for displaying property results.
 * Clean, minimal design focused only on showing results with proper scrolling.
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

    return (
        <View style={styles.container}>
            {/* Header with Action Buttons */}
            <View style={styles.headerContainer}>
                <View style={styles.headerContent}>
                    <View style={styles.headerTitleSection}>
                        <ThemedText style={styles.headerTitle}>
                            {properties.length > 0
                                ? `${properties.length} properties found`
                                : t('No properties found')}
                        </ThemedText>
                        <ThemedText style={styles.headerSubtitle}>
                            {properties.length > 0 && totalCount && totalCount > properties.length
                                ? t('{{total}} total available - zoom out to see more', { total: totalCount })
                                : t('Try adjusting your search or moving the map')}
                        </ThemedText>
                    </View>
                    <View style={styles.headerActions}>
                        <TouchableOpacity
                            style={styles.headerActionButton}
                            onPress={onOpenFilters}
                            accessibilityLabel="Filters"
                            activeOpacity={0.7}
                        >
                            <Ionicons name="options-outline" size={20} color={colors.primaryColor} />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.headerActionButton}
                            onPress={onSaveSearch}
                            accessibilityLabel="Save Search"
                            activeOpacity={0.7}
                        >
                            <Ionicons name="bookmark-outline" size={20} color={colors.primaryColor} />
                        </TouchableOpacity>

                        <TouchableOpacity
                            style={styles.headerActionButton}
                            onPress={onRefreshLocation}
                            accessibilityLabel="My Location"
                            activeOpacity={0.7}
                        >
                            <Ionicons name="location" size={20} color={colors.primaryColor} />
                        </TouchableOpacity>
                    </View>
                </View>
            </View>

            {/* Properties Content */}
            {properties.length > 0 ? (
                <FlatList
                    ref={listRef}
                    data={properties}
                    keyExtractor={keyExtractor}
                    numColumns={NUM_COLUMNS}
                    showsVerticalScrollIndicator={true}
                    contentContainerStyle={styles.listContent}
                    onViewableItemsChanged={handleViewableItemsChanged}
                    viewabilityConfig={viewabilityConfig}
                    renderItem={renderPropertyCard}
                    initialNumToRender={6}
                    maxToRenderPerBatch={10}
                    windowSize={10}
                    removeClippedSubviews={true}
                    updateCellsBatchingPeriod={100}
                    legacyImplementation={false}
                    scrollEnabled={true}
                    nestedScrollEnabled={false}
                    columnWrapperStyle={NUM_COLUMNS > 1 ? styles.columnWrapper : undefined}
                    bounces={true}
                    alwaysBounceVertical={false}
                    scrollEventThrottle={16}
                    keyboardShouldPersistTaps="handled"
                    style={styles.flatListStyle}
                    automaticallyAdjustContentInsets={false}
                    contentInsetAdjustmentBehavior="never"
                />
            ) : (
                <View style={styles.emptyStateContainer}>
                    <View style={styles.emptyStateContent}>
                        <Ionicons name="home-outline" size={64} color="#ccc" />
                        <ThemedText style={styles.emptyStateTitle}>
                            No properties found in this area
                        </ThemedText>
                        <ThemedText style={styles.emptyStateSubtitle}>
                            Try moving the map to explore different areas or adjust your filters
                        </ThemedText>
                    </View>
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#fff',
        flex: 1,
    },
    // Header Styles
    headerContainer: {
        backgroundColor: '#fff',
        borderBottomWidth: 1,
        borderBottomColor: '#f0f0f0',
    },
    headerContent: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    headerTitleSection: {
        flex: 1,
        marginRight: 16,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: '600',
        color: '#333',
        marginBottom: 2,
    },
    headerSubtitle: {
        fontSize: 14,
        color: '#666',
    },
    headerActions: {
        flexDirection: 'row',
        gap: 8,
    },
    headerActionButton: {
        backgroundColor: '#f8f9fa',
        borderRadius: 10,
        padding: 10,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: '#e9ecef',
    },
    // Properties Content
    propertiesContent: {
        flex: 1,
    },
    flatListStyle: {
        flex: 1,
        minHeight: 400, // Ensure minimum height for scrolling
    },
    listContent: {
        paddingHorizontal: HORIZONTAL_PADDING,
        paddingBottom: 16,
        paddingTop: 8,
        flexGrow: 1, // Allow content to grow
    },
    columnWrapper: {
        justifyContent: 'space-between',
        marginBottom: ITEM_SPACING,
    },
    gridItem: {
        flex: 1,
        marginHorizontal: ITEM_SPACING / 2,
        minWidth: 0,
    },
    propertyCard: {
        backgroundColor: '#fff',
        borderRadius: 16,
        overflow: 'hidden',
        flex: 1,
        borderWidth: 1,
        borderColor: '#f0f0f0',
    },
    highlightedCard: {
        borderWidth: 2,
        borderColor: colors.primaryColor,
    },
    // Empty State Styles
    emptyStateContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 32,
        paddingVertical: 40,
    },
    emptyStateContent: {
        alignItems: 'center',
    },
    emptyStateTitle: {
        fontSize: 20,
        fontWeight: '600',
        color: '#333',
        marginTop: 16,
        marginBottom: 8,
        textAlign: 'center',
    },
    emptyStateSubtitle: {
        fontSize: 16,
        color: '#666',
        textAlign: 'center',
        lineHeight: 24,
    },
    // Loading Styles
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
});
