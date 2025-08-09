import React, { useState, useCallback, useMemo, useEffect, useContext } from 'react';
import { View, FlatList, StyleSheet, Dimensions, Alert, TouchableOpacity, TextInput, ScrollView, Text, Modal, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import LoadingTopSpinner from '@/components/LoadingTopSpinner';
import { Header } from '@/components/Header';
import { IconButton } from '@/components/IconButton';
import { PropertyCard } from '@/components/PropertyCard';
import Button from '@/components/Button';
import { colors } from '@/styles/colors';
import { useSEO } from '@/hooks/useDocumentTitle';
import { getPropertyTitle } from '@/utils/propertyUtils';
import { useFavorites } from '@/hooks/useFavorites';
import { useOxy } from '@oxyhq/services';
import { useDebounce } from '@/hooks/useDebounce';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Property } from '@/services/propertyService';
import savedPropertyService, { SavedProperty } from '@/services/savedPropertyService';
import { EmptyState } from '@/components/ui/EmptyState';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { EditNotesBottomSheet } from '@/components/EditNotesBottomSheet';

// Extended interface for saved properties
interface SavedPropertyWithUI extends SavedProperty {
    // Additional UI-specific properties can be added here
}

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

export default function SavedPropertiesScreen() {
    const { t } = useTranslation();
    const { oxyServices, activeSessionId } = useOxy();
    const bottomSheetContext = useContext(BottomSheetContext);

    // Use the new Zustand-based favorites system
    const {
        favoriteIds,
        isLoading: favoritesLoading,
        error: favoritesError,
        isSaving,
        toggleFavorite,
        isFavorite,
        isPropertySaving,
        clearError: clearFavoritesError
    } = useFavorites();

    // Local state for saved properties
    const [savedProperties, setSavedProperties] = useState<SavedPropertyWithUI[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Local state
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState<FilterCategory>('all');
    const [sortBy, setSortBy] = useState<SortOption>('recent');
    const [viewMode, setViewMode] = useState<ViewMode>(screenWidth > 768 ? 'list' : 'grid');
    const [selectedProperties, setSelectedProperties] = useState<Set<string>>(new Set());
    const [bulkActionMode, setBulkActionMode] = useState(false);
    const [showSortOptions, setShowSortOptions] = useState(false);



    // Folder functionality
    const { folders, loadFolders } = useSavedPropertiesContext();
    const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

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
                        return property.folderId != null;
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
            folders: savedProperties.filter(p => p.folderId != null).length,
        };
    }, [savedProperties]);

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

    const handleUnsaveProperty = useCallback(async (propertyId: string) => {
        if (!oxyServices || !activeSessionId) return;

        try {
            await toggleFavorite(propertyId);
            // Refresh the saved properties list
            await loadSavedProperties();
        } catch (error) {
            Alert.alert(
                'Error',
                `Failed to unsave property. ${error instanceof Error ? error.message : 'Please try again.'}`
            );
        }
    }, [oxyServices, activeSessionId, toggleFavorite, loadSavedProperties]);

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
                        } catch (error) {
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
            <View style={StyleSheet.flatten([
                styles.propertyCardWrapper,
                viewMode === 'grid' && styles.gridCardWrapper
            ])}>
                <PropertyCard
                    property={item}
                    variant={viewMode === 'grid' ? 'compact' : 'saved'}
                    onPress={() => !isProcessing && handlePropertyPress(item)}
                    // Long press is now handled globally via FolderContext
                    style={StyleSheet.flatten([
                        styles.propertyCard,
                        isSelected && styles.selectedCard,
                        isProcessing && styles.processingCard
                    ])}
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
                    footerContent={viewMode === 'list' ? (
                        <View style={styles.listFooter}>
                            <View style={styles.notesSection}>
                                <View style={styles.notesHeader}>
                                    <Text style={styles.notesLabel}>My Notes</Text>
                                    <TouchableOpacity
                                        style={styles.editNotesButton}
                                        onPress={() => !isProcessing && handleEditNotes(item)}
                                        disabled={isProcessing}
                                    >
                                        <IconComponent
                                            name="create-outline"
                                            size={16}
                                            color={colors.primaryColor}
                                        />
                                    </TouchableOpacity>
                                </View>
                                <TouchableOpacity
                                    style={styles.notesContainer}
                                    onPress={() => !isProcessing && handleEditNotes(item)}
                                    disabled={isProcessing}
                                >
                                    <Text style={StyleSheet.flatten([
                                        styles.notesText,
                                        !item.notes && styles.notesPlaceholder
                                    ])} numberOfLines={2}>
                                        {item.notes || 'Tap to add notes about this property...'}
                                    </Text>
                                </TouchableOpacity>
                            </View>

                            {/* Folder indicator */}
                            {item.folderId && (
                                <View style={styles.folderSection}>
                                    <View style={styles.folderHeader}>
                                        <Text style={styles.folderLabel}>Folder</Text>
                                    </View>
                                    <View style={styles.folderContainer}>
                                        <IconComponent
                                            name="folder-outline"
                                            size={16}
                                            color={colors.primaryColor}
                                        />
                                        <Text style={styles.folderText} numberOfLines={1}>
                                            {(() => {
                                                const folder = folders.find(f => f._id === item.folderId);
                                                if (folder) {
                                                    return `${folder.name} (${folder.propertyCount} ${folder.propertyCount === 1 ? 'property' : 'properties'})`;
                                                }
                                                return 'Unknown Folder';
                                            })()}
                                        </Text>
                                    </View>
                                </View>
                            )}

                            {isProcessing && (
                                <View style={styles.processingOverlay}>
                                    <Text style={styles.processingText}>Processing...</Text>
                                </View>
                            )}
                        </View>
                    ) : (
                        viewMode === 'grid' && (item.notes || item.folderId) ? (
                            <View style={styles.gridIndicators}>
                                {item.notes && (
                                    <View style={styles.gridNotesIndicator}>
                                        <IconComponent
                                            name="document-text"
                                            size={12}
                                            color={colors.primaryColor}
                                        />
                                    </View>
                                )}
                                {item.folderId && (
                                    <View style={styles.gridFolderIndicator}>
                                        <IconComponent
                                            name="folder-outline"
                                            size={12}
                                            color={colors.primaryColor}
                                        />
                                    </View>
                                )}
                            </View>
                        ) : null
                    )}
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

            {/* Category Filter Pills */}
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.categoryContainer}
                style={styles.categoryScroll}
            >
                {CATEGORIES.map(category => (
                    <TouchableOpacity
                        key={category.id}
                        style={StyleSheet.flatten([
                            styles.categoryPill,
                            selectedCategory === category.id && styles.categoryPillActive
                        ])}
                        onPress={() => setSelectedCategory(category.id as FilterCategory)}
                    >
                        <IconComponent
                            name={category.icon}
                            size={16}
                            color={selectedCategory === category.id ? 'white' : colors.primaryColor}
                        />
                        <Text style={StyleSheet.flatten([
                            styles.categoryPillText,
                            selectedCategory === category.id && styles.categoryPillTextActive
                        ])}>
                            {category.name} ({(categoryCounts as any)[category.id] || 0})
                        </Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>

            {/* Folder Statistics */}
            {selectedCategory === 'folders' && folders.length > 0 && (
                <View style={styles.folderStats}>
                    <Text style={styles.folderStatsTitle}>Folder Breakdown:</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.folderStatsScroll}>
                        {folders.map(folder => (
                            <View key={folder._id} style={styles.folderStatItem}>
                                <View style={[styles.folderStatIcon, { backgroundColor: folder.color }]}>
                                    <Text style={styles.folderStatEmoji}>{folder.icon}</Text>
                                </View>
                                <Text style={styles.folderStatName}>{folder.name}</Text>
                                <Text style={styles.folderStatCount}>{folder.propertyCount}</Text>
                            </View>
                        ))}
                    </ScrollView>
                </View>
            )}

            {/* Controls Bar */}
            <View style={styles.controlsBar}>
                <View style={styles.leftControls}>
                    <TouchableOpacity
                        style={StyleSheet.flatten([styles.controlButton, showSortOptions && styles.controlButtonActive])}
                        onPress={() => setShowSortOptions(!showSortOptions)}
                    >
                        <IconComponent
                            name="filter"
                            size={18}
                            color={showSortOptions ? 'white' : colors.primaryColor}
                        />
                        <Text style={StyleSheet.flatten([
                            styles.controlButtonText,
                            showSortOptions && styles.controlButtonTextActive
                        ])}>
                            Sort
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
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
                        style={StyleSheet.flatten([styles.controlButton, bulkActionMode && styles.controlButtonActive])}
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
                        <Text style={StyleSheet.flatten([
                            styles.controlButtonText,
                            bulkActionMode && styles.controlButtonTextActive
                        ])}>
                            {bulkActionMode ? 'Cancel' : 'Select'}
                        </Text>
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
            )}


        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
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

    // Category Pills
    categoryScroll: {
        marginBottom: 20,
    },
    categoryContainer: {
        paddingHorizontal: 4,
        gap: 8,
    },
    categoryPill: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'white',
        borderRadius: 20,
        paddingHorizontal: 16,
        paddingVertical: 10,
        marginRight: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
        elevation: 1,
        borderWidth: 1,
        borderColor: '#f1f3f4',
    },
    categoryPillActive: {
        backgroundColor: colors.primaryColor,
        borderColor: colors.primaryColor,
        shadowOpacity: 0.15,
    },
    categoryPillText: {
        marginLeft: 6,
        fontSize: 14,
        color: colors.primaryColor,
        fontWeight: '600',
    },
    categoryPillTextActive: {
        color: 'white',
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
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.04,
        shadowRadius: 4,
        elevation: 1,
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
    propertyCardWrapper: {
        marginBottom: 16,
    },
    gridCardWrapper: {
        flex: 1,
        marginHorizontal: 4,
    },
    gridRow: {
        justifyContent: 'space-between',
        paddingHorizontal: 4,
    },
    propertyCard: {
        borderRadius: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.06,
        shadowRadius: 8,
        elevation: 3,
    },
    selectedCard: {
        borderWidth: 2,
        borderColor: colors.primaryColor,
        shadowColor: colors.primaryColor,
        shadowOpacity: 0.2,
    },
    processingCard: {
        opacity: 0.7,
    },

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

    // List Footer (Notes)
    listFooter: {
        backgroundColor: '#f8f9fa',
        borderBottomLeftRadius: 16,
        borderBottomRightRadius: 16,
        padding: 16,
        borderTopWidth: 1,
        borderTopColor: '#f1f3f4',
    },
    notesSection: {
        gap: 8,
    },
    notesHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    notesLabel: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.COLOR_BLACK,
    },
    editNotesButton: {
        padding: 4,
    },
    notesContainer: {
        minHeight: 40,
        justifyContent: 'center',
    },
    notesText: {
        fontSize: 14,
        color: colors.COLOR_BLACK_LIGHT_2,
        lineHeight: 20,
    },
    notesPlaceholder: {
        color: colors.COLOR_BLACK_LIGHT_4,
        fontStyle: 'italic',
    },
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





    // Folder Statistics
    folderStats: {
        marginTop: 16,
        marginBottom: 8,
    },
    folderStatsTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.COLOR_BLACK_LIGHT_2,
        marginBottom: 8,
    },
    folderStatsScroll: {
        marginBottom: 8,
    },
    folderStatItem: {
        alignItems: 'center',
        marginRight: 16,
        minWidth: 60,
    },
    folderStatIcon: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 4,
    },
    folderStatEmoji: {
        fontSize: 16,
        color: 'white',
    },
    folderStatName: {
        fontSize: 12,
        fontWeight: '500',
        color: colors.COLOR_BLACK_LIGHT_2,
        textAlign: 'center',
        marginBottom: 2,
    },
    folderStatCount: {
        fontSize: 14,
        fontWeight: '600',
        color: colors.COLOR_BLACK,
    },
}); 