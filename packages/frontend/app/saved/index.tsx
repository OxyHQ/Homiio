import React, { useState, useCallback, useMemo, useEffect, useContext } from 'react';
import { View, FlatList, StyleSheet, Dimensions, Alert, TouchableOpacity, TextInput, Text, RefreshControl } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import LoadingTopSpinner from '@/components/LoadingTopSpinner';
import { Header } from '@/components/Header';
import { PropertyCard } from '@/components/PropertyCard';
import { ListItem } from '@/components/ListItem';
import { colors } from '@/styles/colors';
import { useSEO } from '@/hooks/useDocumentTitle';
import { getPropertyTitle } from '@/utils/propertyUtils';
import { useFavorites } from '@/hooks/useFavorites';
import { useOxy } from '@oxyhq/services';
import { useDebounce } from '@/hooks/useDebounce';
import { Ionicons } from '@expo/vector-icons';

import savedPropertyService from '@/services/savedPropertyService';
import type { SavedProperty } from '@homiio/shared-types';
import { EmptyState } from '@/components/ui/EmptyState';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { EditNotesBottomSheet } from '@/components/EditNotesBottomSheet';

// Extended interface for saved properties
type SavedPropertyWithUI = SavedProperty;

const IconComponent = Ionicons as any;
const { width: screenWidth } = Dimensions.get('window');

// Types
export type SortOption = 'recent' | 'price-low' | 'price-high' | 'title' | 'notes';
export type ViewMode = 'list' | 'grid';
export type FilterCategory = 'all' | 'recent' | 'noted' | 'quick-saves' | 'folders';

// Constants
const SORT_OPTIONS = [
    { key: 'recent' as const, label: 'Recently Saved', icon: 'time-outline' },
    { key: 'price-low' as const, label: 'Price: Low to High', icon: 'arrow-up-outline' },
    { key: 'price-high' as const, label: 'Price: High to Low', icon: 'arrow-down-outline' },
    { key: 'title' as const, label: 'Property Name', icon: 'text-outline' },
    { key: 'notes' as const, label: 'Most Notes', icon: 'document-text-outline' },
];

const CATEGORIES = [
    { id: 'all', name: 'All', icon: 'grid-outline' },
    { id: 'recent', name: 'Recent', icon: 'time-outline' },
    { id: 'noted', name: 'With Notes', icon: 'document-text-outline' },
    { id: 'quick-saves', name: 'Quick Saves', icon: 'bookmark-outline' },
    { id: 'folders', name: 'Folders', icon: 'folder-outline' },
];

// Grid layout constants (style-based, no runtime calculations)
const GRID_GAP = 16; // desired gap between cards
const H_PADDING = 16; // desired outer padding

export default function SavedPropertiesScreen() {
    const { t } = useTranslation();
    const { oxyServices, activeSessionId } = useOxy();
    const bottomSheetContext = useContext(BottomSheetContext);

    // Use the new Zustand-based favorites system
    const {
        toggleFavorite,
        isPropertySaving,
        clearError: clearFavoritesError
    } = useFavorites();

    // Local state for saved properties
    const [savedProperties, setSavedProperties] = useState<SavedPropertyWithUI[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Local state
    const [searchQuery, setSearchQuery] = useState('');
    const { tab } = useLocalSearchParams<{ tab?: string }>();
    const parseTab = (value?: string): FilterCategory => (
        value === 'recent' || value === 'noted' || value === 'quick-saves' || value === 'folders' ? value : 'all'
    );
    const [selectedCategory, setSelectedCategory] = useState<FilterCategory>(parseTab(typeof tab === 'string' ? tab : undefined));
    useEffect(() => {
        const next = parseTab(typeof tab === 'string' ? tab : undefined);
        if (next !== selectedCategory) setSelectedCategory(next);
    }, [tab, selectedCategory]);
    const [sortBy, setSortBy] = useState<SortOption>('recent');
    const [viewMode, setViewMode] = useState<ViewMode>(screenWidth > 768 ? 'list' : 'grid');
    const [selectedProperties, setSelectedProperties] = useState<Set<string>>(new Set());
    const [bulkActionMode, setBulkActionMode] = useState(false);
    const [showSortOptions, setShowSortOptions] = useState(false);



    // Folder functionality
    const { folders, loadFolders } = useSavedPropertiesContext();

    // Debounced search
    const debouncedSearchQuery = useDebounce(searchQuery, 300);

    // Load saved properties
    const loadSavedProperties = useCallback(async () => {
        if (!oxyServices || !activeSessionId) return;

        try {
            setIsLoading(true);
            setError(null);
            const response = await savedPropertyService.getSavedProperties(oxyServices, activeSessionId);
            setSavedProperties(response.properties);
        } catch (error: any) {
            console.error('Failed to load saved properties:', error);
            setError(error.message || 'Failed to load saved properties');
        } finally {
            setIsLoading(false);
        }
    }, [oxyServices, activeSessionId]);

    // Load properties on mount
    useEffect(() => {
        if (oxyServices && activeSessionId) {
            loadSavedProperties();
            loadFolders();
        }
    }, [oxyServices, activeSessionId, loadSavedProperties, loadFolders]);

    // Memoized filtered properties
    const filteredProperties = useMemo(() => {
        let filtered = [...savedProperties];

        // Apply search filter
        if (debouncedSearchQuery.trim()) {
            const query = debouncedSearchQuery.toLowerCase().trim();
            filtered = filtered.filter(property => {
                const title = (getPropertyTitle(property) || '').toLowerCase();
                const city = property.address?.city?.toLowerCase() || '';
                const street = property.address?.street?.toLowerCase() || '';
                const notes = property.notes?.toLowerCase() || '';
                const type = property.type?.toLowerCase() || '';

                return title.includes(query) ||
                    city.includes(query) ||
                    street.includes(query) ||
                    notes.includes(query) ||
                    type.includes(query);
            });
        }

        // Apply category filter
        if (selectedCategory !== 'all') {
            const now = Date.now();
            filtered = filtered.filter(property => {
                switch (selectedCategory) {
                    case 'recent':
                        const savedTime = property.savedAt ? new Date(property.savedAt).getTime() : now;
                        return (now - savedTime) <= (7 * 24 * 60 * 60 * 1000); // 7 days
                    case 'noted':
                        return property.notes && property.notes.trim().length > 0;
                    case 'quick-saves':
                        return !property.notes || property.notes.trim().length === 0;
                    case 'folders':
                        return Boolean((property as any).folderId);
                    default:
                        return true;
                }
            });
        }

        // Apply sorting
        filtered.sort((a, b) => {
            switch (sortBy) {
                case 'recent':
                    const aTime = a.savedAt ? new Date(a.savedAt).getTime() : 0;
                    const bTime = b.savedAt ? new Date(b.savedAt).getTime() : 0;
                    return bTime - aTime;
                case 'price-low':
                    return (a.rent?.amount || 0) - (b.rent?.amount || 0);
                case 'price-high':
                    return (b.rent?.amount || 0) - (a.rent?.amount || 0);
                case 'title':
                    return getPropertyTitle(a).localeCompare(getPropertyTitle(b));
                case 'notes':
                    return (b.notes?.length || 0) - (a.notes?.length || 0);
                default:
                    return 0;
            }
        });

        return filtered;
    }, [savedProperties, debouncedSearchQuery, selectedCategory, sortBy]);

    // Memoized category counts
    const categoryCounts = useMemo(() => {
        const now = Date.now();
        return {
            all: savedProperties.length,
            recent: savedProperties.filter(p => {
                const savedTime = p.savedAt ? new Date(p.savedAt).getTime() : now;
                return (now - savedTime) <= (7 * 24 * 60 * 60 * 1000);
            }).length,
            noted: savedProperties.filter(p => p.notes && p.notes.trim().length > 0).length,
            'quick-saves': savedProperties.filter(p => !p.notes || p.notes.trim().length === 0).length,
            folders: folders.length,
        };
    }, [savedProperties, folders]);

    // Folders filtered for Folders tab
    const filteredFolders = useMemo(() => {
        if (!searchQuery.trim()) return folders;
        const q = searchQuery.toLowerCase().trim();
        return folders.filter(f =>
            f.name.toLowerCase().includes(q) ||
            (f.description || '').toLowerCase().includes(q)
        );
    }, [folders, searchQuery]);

    // SEO
    useSEO({
        title: t('saved.title'),
        description: t('saved.emptyDescription'),
        keywords: 'saved properties, property favorites, housing bookmarks, property notes',
        type: 'website'
    });

    // Handlers
    const handleRefresh = useCallback(async () => {
        if (!oxyServices || !activeSessionId) return;

        setError(null);
        clearFavoritesError();
        await loadSavedProperties();
    }, [oxyServices, activeSessionId, loadSavedProperties, clearFavoritesError]);

    // Using only bulk unsave for now; individual unsave action handled elsewhere

    const handleEditNotes = useCallback((property: SavedPropertyWithUI) => {
        if (!bottomSheetContext) return;

        const propertyId = property._id || property.id || '';
        const propertyTitle = getPropertyTitle(property);

        bottomSheetContext.openBottomSheet(
            <EditNotesBottomSheet
                propertyId={propertyId}
                propertyTitle={propertyTitle}
                property={property}
                currentNotes={property.notes || ''}
                onClose={() => {
                    bottomSheetContext?.closeBottomSheet();
                }}
                onSave={async (notes: string) => {
                    if (!oxyServices || !activeSessionId) return;

                    try {
                        await savedPropertyService.updateNotes(propertyId, notes, oxyServices, activeSessionId);

                        // Update the local state
                        setSavedProperties(prev =>
                            prev.map(p =>
                                (p._id || p.id) === propertyId
                                    ? { ...p, notes }
                                    : p
                            )
                        );
                    } catch (error) {
                        console.error('Failed to update notes:', error);
                        throw error; // Re-throw to let the bottom sheet handle the error
                    }
                }}
            />
        );
    }, [bottomSheetContext, oxyServices, activeSessionId]);



    const handlePropertyPress = useCallback((property: SavedPropertyWithUI) => {
        if (bulkActionMode) {
            const propertyId = property._id || property.id || '';
            if (propertyId) {
                setSelectedProperties(prev => {
                    const newSet = new Set(prev);
                    if (newSet.has(propertyId)) {
                        newSet.delete(propertyId);
                    } else {
                        newSet.add(propertyId);
                    }
                    return newSet;
                });
            }
        } else {
            const propertyId = property._id || property.id || '';
            if (propertyId) {
                router.push(`/properties/${propertyId}`);
            }
        }
    }, [bulkActionMode]);

    // Note: Long press functionality is now handled globally via FolderContext
    // No need for local handler here

    const handleBulkUnsave = useCallback(async () => {
        if (selectedProperties.size === 0 || !oxyServices || !activeSessionId) return;

        Alert.alert(
            'Unsave Properties',
            `Are you sure you want to unsave ${selectedProperties.size} properties?`,
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Unsave',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            // Unsave all selected properties
                            const unsavePromises = Array.from(selectedProperties).map(propertyId =>
                                toggleFavorite(propertyId)
                            );
                            await Promise.all(unsavePromises);

                            // Refresh the saved properties list
                            await loadSavedProperties();

                            setSelectedProperties(new Set());
                            setBulkActionMode(false);
                        } catch {
                            Alert.alert('Error', 'Failed to unsave some properties. Please try again.');
                        }
                    }
                }
            ]
        );
    }, [selectedProperties, oxyServices, activeSessionId, toggleFavorite, loadSavedProperties]);

    // Render functions
    const renderPropertyItem = useCallback(({ item }: { item: SavedPropertyWithUI }) => {
        const propertyId = item._id || item.id || '';
        const isProcessing = isPropertySaving(propertyId);
        const isSelected = selectedProperties.has(propertyId);

        return (
            <View style={viewMode === 'grid' ? styles.gridItemContainer : undefined}>
                <PropertyCard
                    property={item}
                    variant={viewMode === 'grid' ? 'compact' : 'saved'}
                    orientation={viewMode === 'grid' ? 'vertical' : 'horizontal'}
                    onPress={() => !isProcessing && handlePropertyPress(item)}
                    noteText={item.notes || ''}
                    onPressNote={() => !isProcessing && handleEditNotes(item)}
                    isSelected={isSelected}
                    isProcessing={isProcessing}
                    overlayContent={bulkActionMode ? (
                        <TouchableOpacity
                            style={styles.selectionButton}
                            onPress={() => handlePropertyPress(item)}
                        >
                            <View style={StyleSheet.flatten([
                                styles.selectionIndicator,
                                isSelected && styles.selectionIndicatorActive
                            ])}>
                                {isSelected && (
                                    <IconComponent
                                        name="checkmark"
                                        size={16}
                                        color="white"
                                    />
                                )}
                            </View>
                        </TouchableOpacity>
                    ) : null}
                />
            </View>
        );
    }, [viewMode, isPropertySaving, selectedProperties, bulkActionMode, handlePropertyPress, handleEditNotes]);

    const keyExtractor = useCallback((item: SavedPropertyWithUI) =>
        item._id || item.id || '', []
    );

    const getItemLayout = useCallback((data: any, index: number) => {
        const itemHeight = viewMode === 'grid' ? 260 : 340;
        if (viewMode === 'grid') {
            const rowIndex = Math.floor(index / 2);
            return {
                length: itemHeight,
                offset: itemHeight * rowIndex,
                index,
            };
        } else {
            return {
                length: itemHeight,
                offset: itemHeight * index,
                index,
            };
        }
    }, [viewMode]);

    const renderHeader = () => (
        <View style={styles.headerContent}>
            {/* Modern Search Bar */}
            <View style={styles.searchWrapper}>
                <View style={styles.searchContainer}>
                    <IconComponent name="search" size={20} color={colors.COLOR_BLACK_LIGHT_3} />
                    <TextInput
                        style={styles.searchInput}
                        placeholder="Search your saved properties..."
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        placeholderTextColor={colors.COLOR_BLACK_LIGHT_3}
                    />
                    {searchQuery.length > 0 && (
                        <TouchableOpacity onPress={() => setSearchQuery('')}>
                            <IconComponent name="close-circle" size={20} color={colors.COLOR_BLACK_LIGHT_3} />
                        </TouchableOpacity>
                    )}
                </View>
            </View>

            {/* Tabs */}
            <View style={styles.tabsContainer}>
                {CATEGORIES.map(category => {
                    const isActive = selectedCategory === category.id;
                    return (
                        <TouchableOpacity
                            key={category.id}
                            style={StyleSheet.flatten([
                                styles.tabItem,
                                isActive && styles.tabItemActive,
                            ])}
                            onPress={() => {
                                const next = category.id as FilterCategory;
                                setSelectedCategory(next);
                                try { router.setParams?.({ tab: next }); } catch { }
                            }}
                        >
                            <Text style={StyleSheet.flatten([
                                styles.tabText,
                                isActive && styles.tabTextActive,
                            ])}>
                                {category.name} ({(categoryCounts as any)[category.id] || 0})
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </View>

            {/* Folders tab now shows a proper list below; removed breakdown */}

            {/* Controls Bar */}
            <View style={styles.controlsBar}>
                <View style={styles.leftControls}>
                    <TouchableOpacity
                        accessibilityLabel="Sort"
                        style={StyleSheet.flatten([styles.viewToggle, showSortOptions && styles.controlButtonActive])}
                        onPress={() => setShowSortOptions(!showSortOptions)}
                    >
                        <IconComponent
                            name="filter"
                            size={18}
                            color={showSortOptions ? 'white' : colors.primaryColor}
                        />
                    </TouchableOpacity>

                    <TouchableOpacity
                        accessibilityLabel="Toggle view"
                        style={styles.viewToggle}
                        onPress={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
                    >
                        <IconComponent
                            name={viewMode === 'list' ? 'grid' : 'list'}
                            size={20}
                            color={colors.primaryColor}
                        />
                    </TouchableOpacity>
                </View>

                <View style={styles.rightControls}>
                    <TouchableOpacity
                        accessibilityLabel={bulkActionMode ? 'Cancel selection' : 'Select items'}
                        style={StyleSheet.flatten([styles.viewToggle, bulkActionMode && styles.controlButtonActive])}
                        onPress={() => {
                            setBulkActionMode(!bulkActionMode);
                            setSelectedProperties(new Set());
                        }}
                    >
                        <IconComponent
                            name="checkmark-circle"
                            size={18}
                            color={bulkActionMode ? 'white' : colors.primaryColor}
                        />
                    </TouchableOpacity>

                    <Text style={styles.resultCount}>
                        {filteredProperties.length} {filteredProperties.length === 1 ? 'property' : 'properties'}
                    </Text>
                </View>
            </View>

            {/* Sort Options Dropdown */}
            {showSortOptions && (
                <View style={styles.sortDropdown}>
                    {SORT_OPTIONS.map(option => (
                        <TouchableOpacity
                            key={option.key}
                            style={StyleSheet.flatten([
                                styles.sortOption,
                                sortBy === option.key && styles.sortOptionActive
                            ])}
                            onPress={() => {
                                setSortBy(option.key);
                                setShowSortOptions(false);
                            }}
                        >
                            <IconComponent
                                name={option.icon}
                                size={16}
                                color={sortBy === option.key ? 'white' : colors.primaryColor}
                            />
                            <Text style={StyleSheet.flatten([
                                styles.sortOptionText,
                                sortBy === option.key && styles.sortOptionTextActive
                            ])}>
                                {option.label}
                            </Text>
                            {sortBy === option.key && (
                                <IconComponent
                                    name="checkmark"
                                    size={16}
                                    color="white"
                                />
                            )}
                        </TouchableOpacity>
                    ))}
                </View>
            )}

            {/* Bulk Actions Bar */}
            {bulkActionMode && selectedProperties.size > 0 && (
                <View style={styles.bulkActionsBar}>
                    <Text style={styles.bulkActionsText}>
                        {`${selectedProperties.size} ${selectedProperties.size === 1 ? 'property' : 'properties'} selected`}
                    </Text>
                    <TouchableOpacity
                        style={styles.bulkActionButton}
                        onPress={handleBulkUnsave}
                    >
                        <IconComponent name="trash" size={16} color="white" />
                        <Text style={styles.bulkActionButtonText}>Remove</Text>
                    </TouchableOpacity>
                </View>
            )}
        </View>
    );

    const renderEmptyState = () => {
        if (searchQuery || selectedCategory !== 'all') {
            return (
                <EmptyState
                    icon="search"
                    title="No Properties Found"
                    description="Try adjusting your search or filter criteria"
                    actionText="Clear Filters"
                    actionIcon="refresh"
                    onAction={() => {
                        setSearchQuery('');
                        setSelectedCategory('all');
                    }}
                />
            );
        }

        return (
            <EmptyState
                icon="bookmark-outline"
                title="No Saved Properties"
                description="Start saving properties you love by tapping the heart icon. They'll appear here for easy access."
                actionText="Browse Properties"
                actionIcon="home"
                onAction={() => router.push('/properties')}
            />
        );
    };

    // Auth check
    if (!oxyServices || !activeSessionId) {
        return (
            <View style={styles.container}>
                <Header options={{ title: 'Saved Properties', showBackButton: true }} />
                <EmptyState
                    icon="lock-closed"
                    title="Sign In Required"
                    description="Please sign in to view and manage your saved properties"
                />
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <Header
                options={{
                    title: t('saved.title'),
                    titlePosition: 'left',
                    rightComponents: [
                        <TouchableOpacity
                            key="viewMode"
                            style={styles.headerButton}
                            onPress={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                        >
                            <IconComponent
                                name={viewMode === 'grid' ? 'list' : 'grid'}
                                size={24}
                                color={colors.COLOR_BLACK}
                            />
                        </TouchableOpacity>,
                        <TouchableOpacity
                            key="search"
                            style={styles.headerButton}
                            onPress={() => setSearchQuery('')}
                        >
                            <IconComponent
                                name="search"
                                size={24}
                                color={colors.COLOR_BLACK}
                            />
                        </TouchableOpacity>,
                    ],
                }}
            />

            {isLoading && savedProperties.length === 0 && <LoadingTopSpinner showLoading={true} />}

            {error && !isLoading && (
                <EmptyState
                    icon="alert-circle"
                    title="Something went wrong"
                    description={error}
                    actionText="Try Again"
                    actionIcon="refresh"
                    onAction={handleRefresh}
                />
            )}

            {!isLoading && !error && (
                selectedCategory === 'folders' ? (
                    <FlatList
                        data={filteredFolders}
                        keyExtractor={(item) => item._id}
                        renderItem={({ item }) => (
                            <ListItem
                                title={item.name}
                                description={item.description}
                                onPress={() => router.push(`/saved/${item._id}`)}
                                rightElement={<Text style={styles.folderCount}>{item.propertyCount}</Text>}
                            />
                        )}
                        contentContainerStyle={StyleSheet.flatten([
                            styles.listContent,
                            filteredFolders.length === 0 && styles.emptyListContent
                        ])}
                        ListHeaderComponent={renderHeader}
                        ListEmptyComponent={renderEmptyState}
                        refreshControl={
                            <RefreshControl
                                refreshing={isLoading}
                                onRefresh={handleRefresh}
                                colors={[colors.primaryColor]}
                                tintColor={colors.primaryColor}
                            />
                        }
                    />
                ) : (
                    <FlatList
                        data={filteredProperties}
                        renderItem={renderPropertyItem}
                        keyExtractor={keyExtractor}
                        getItemLayout={getItemLayout}
                        contentContainerStyle={StyleSheet.flatten([
                            styles.listContent,
                            filteredProperties.length === 0 && styles.emptyListContent
                        ])}
                        showsVerticalScrollIndicator={false}
                        numColumns={viewMode === 'grid' ? 2 : 1}
                        key={viewMode}
                        columnWrapperStyle={viewMode === 'grid' ? styles.gridRow : undefined}
                        ListHeaderComponent={renderHeader}
                        ListEmptyComponent={renderEmptyState}
                        refreshControl={
                            <RefreshControl
                                refreshing={isLoading}
                                onRefresh={handleRefresh}
                                colors={[colors.primaryColor]}
                                tintColor={colors.primaryColor}
                            />
                        }
                    />
                )
            )}


        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        backgroundColor: '#fafbfc',
    },
    headerButton: {
        padding: 8,
        borderRadius: 8,
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
    },
    listContent: {
        padding: 16,
        paddingBottom: 100,
    },
    emptyListContent: {
        flexGrow: 1,
        justifyContent: 'center',
    },
    headerContent: {
        marginBottom: 24,
    },

    // Modern Search
    searchWrapper: {
        marginBottom: 20,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'white',
        borderRadius: 16,
        paddingHorizontal: 16,
        paddingVertical: 14,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 8,
        elevation: 2,
        borderWidth: 1,
        borderColor: '#f1f3f4',
    },
    searchInput: {
        flex: 1,
        marginLeft: 12,
        fontSize: 16,
        color: colors.COLOR_BLACK,
        fontWeight: '500',
    },

    // Tabs
    tabsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#eaeaea',
        paddingHorizontal: 4,
        // Removed web-only sticky style to satisfy native style typing
    },
    tabItem: {
        paddingVertical: 10,
        paddingHorizontal: 4,
        marginRight: 8,
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
    },
    tabItemActive: {
        borderBottomColor: colors.COLOR_BLACK,
    },
    tabText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_4,
        fontWeight: '600',
    },
    tabTextActive: {
        color: colors.COLOR_BLACK,
    },

    // Controls Bar
    controlsBar: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 16,
    },
    leftControls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    rightControls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
    },
    controlButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'white',
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
        elevation: 1,
        borderWidth: 1,
        borderColor: '#f1f3f4',
    },
    controlButtonActive: {
        backgroundColor: colors.primaryColor,
        borderColor: colors.primaryColor,
    },
    controlButtonText: {
        marginLeft: 6,
        fontSize: 14,
        color: colors.primaryColor,
        fontWeight: '600',
    },
    controlButtonTextActive: {
        color: 'white',
    },
    viewToggle: {
        backgroundColor: 'white',
        borderRadius: 12,
        padding: 10,
        borderWidth: 1,
        borderColor: '#f1f3f4',
    },
    resultCount: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_3,
        fontWeight: '500',
    },

    // Sort Dropdown
    sortDropdown: {
        backgroundColor: 'white',
        borderRadius: 16,
        padding: 8,
        marginBottom: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 12,
        elevation: 4,
        borderWidth: 1,
        borderColor: '#f1f3f4',
    },
    sortOption: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingVertical: 12,
        borderRadius: 12,
        marginVertical: 2,
    },
    sortOptionActive: {
        backgroundColor: colors.primaryColor,
    },
    sortOptionText: {
        marginLeft: 12,
        fontSize: 15,
        color: colors.COLOR_BLACK,
        fontWeight: '500',
        flex: 1,
    },
    sortOptionTextActive: {
        color: 'white',
        fontWeight: '600',
    },

    // Bulk Actions
    bulkActionsBar: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: colors.primaryColor,
        borderRadius: 16,
        paddingHorizontal: 20,
        paddingVertical: 16,
        marginBottom: 20,
        shadowColor: colors.primaryColor,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 12,
        elevation: 6,
    },
    bulkActionsText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 16,
    },
    bulkActionButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 10,
        gap: 6,
    },
    bulkActionButtonText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 14,
    },

    // Property Cards
    propertyCardWrapper: {},
    gridItemContainer: {
        flex: 1,
        paddingHorizontal: 8,
        marginBottom: GRID_GAP,
    },
    gridRow: {
        justifyContent: 'space-between',
        paddingHorizontal: H_PADDING,
    },
    propertyCard: {
    },
    selectedCard: {},
    processingCard: {},

    // Selection
    selectionButton: {
        position: 'absolute',
        top: 12,
        right: 12,
        zIndex: 10,
    },
    selectionIndicator: {
        width: 24,
        height: 24,
        borderRadius: 12,
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 2,
        borderColor: colors.COLOR_BLACK_LIGHT_4,
    },
    selectionIndicatorActive: {
        backgroundColor: colors.primaryColor,
        borderColor: colors.primaryColor,
    },

    // List Footer (Notes) removed; notes now render inline inside PropertyCard
    processingOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(255, 255, 255, 0.8)',
        justifyContent: 'center',
        alignItems: 'center',
        borderRadius: 16,
    },
    processingText: {
        fontSize: 14,
        color: colors.primaryColor,
        fontWeight: '500',
    },

    // Grid Notes Indicator
    gridNotesIndicator: {
        position: 'absolute',
        bottom: 8,
        right: 8,
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        borderRadius: 12,
        padding: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },

    // Folder Section
    folderSection: {
        marginTop: 12,
        gap: 8,
    },
    folderHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    folderLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.COLOR_BLACK,
    },
    folderContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 8,
        paddingHorizontal: 12,
        backgroundColor: colors.primaryLight,
        borderRadius: 8,
    },
    folderText: {
        fontSize: 14,
        color: colors.primaryColor,
        fontWeight: '500',
        flex: 1,
    },

    // Folders list
    folderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'white',
        borderRadius: 14,
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderWidth: 1,
        borderColor: '#f1f3f4',
        marginBottom: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
        elevation: 1,
        gap: 12,
    },
    folderBadge: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
    },
    folderBadgeText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '700',
    },
    folderInfo: {
        flex: 1,
    },
    folderTitle: {
        fontSize: 15,
        fontWeight: '700',
        color: colors.COLOR_BLACK,
    },
    folderSubtitle: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_4,
        marginTop: 2,
    },
    folderCount: {
        fontSize: 13,
        color: colors.COLOR_BLACK_LIGHT_3,
        fontWeight: '600',
        marginRight: 6,
    },

    // Grid Indicators
    gridIndicators: {
        position: 'absolute',
        bottom: 8,
        right: 8,
        flexDirection: 'row',
        gap: 4,
    },
    gridFolderIndicator: {
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        borderRadius: 12,
        padding: 6,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
        elevation: 2,
    },





    // Removed old folder breakdown styles
}); 