import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Alert, TextInput, Modal, ScrollView, Dimensions } from 'react-native';
import { useOxy } from '@oxyhq/services';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ThemedView } from '@/components/ThemedView';
import { ThemedText } from '@/components/ThemedText';
import { PropertyCard } from '@/components/PropertyCard';
import Button from '@/components/Button';
import LoadingTopSpinner from '@/components/LoadingTopSpinner';
import { Header } from '@/components/Header';
import { IconButton } from '@/components/IconButton';
import { colors } from '@/styles/colors';
import type { Property } from '@/services/propertyService';
import { useSEO } from '@/hooks/useDocumentTitle';
import { getPropertyTitle } from '@/utils/propertyUtils';
import useSavedProperties from '@/hooks/useSavedPropertiesRedux';
import { useFavorites } from '@/hooks/useFavorites';
import { Ionicons } from '@expo/vector-icons';

const IconComponent = Ionicons as any;
const { width: screenWidth } = Dimensions.get('window');

interface SavedPropertyWithNotes extends Property {
    notes?: string;
    savedAt?: string;
    category?: string;
}

type SortOption = 'recent' | 'price-low' | 'price-high' | 'title' | 'notes';
type ViewMode = 'list' | 'grid';

const CATEGORIES = [
    { id: 'all', name: 'All Properties', icon: 'grid-outline' },
    { id: 'favorites', name: 'Top Favorites', icon: 'heart' },
    { id: 'considering', name: 'Considering', icon: 'eye' },
    { id: 'shortlist', name: 'Shortlist', icon: 'checkmark-circle' },
    { id: 'backup', name: 'Backup Options', icon: 'shield' },
];

export default function SavedPropertiesScreen() {
    const { t } = useTranslation();
    const { oxyServices, activeSessionId } = useOxy();

    // Use Redux-based saved properties hook
    const {
        properties: savedProperties = [],
        isLoading,
        isSaving,
        error,
        loadProperties,
        updateNotes,
        isPropertySaving,
        clearError
    } = useSavedProperties();

    // Use the same favorites hook that works on property cards
    const { toggleFavorite } = useFavorites();

    // Enhanced SEO for saved properties page
    useSEO({
        title: t('saved.title'),
        description: t('saved.emptyDescription'),
        keywords: 'saved properties, property favorites, housing bookmarks, property notes, real estate favorites',
        type: 'website'
    });

    // State management
    const [selectedProperty, setSelectedProperty] = useState<SavedPropertyWithNotes | null>(null);
    const [notesModalVisible, setNotesModalVisible] = useState(false);
    const [categoryModalVisible, setCategoryModalVisible] = useState(false);
    const [notesText, setNotesText] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [sortBy, setSortBy] = useState<SortOption>('recent');
    const [viewMode, setViewMode] = useState<ViewMode>(screenWidth > 768 ? 'list' : 'grid');
    const [selectedProperties, setSelectedProperties] = useState<Set<string>>(new Set());
    const [bulkActionMode, setBulkActionMode] = useState(false);
    const [showFilters, setShowFilters] = useState(false);

    // Filter and sort properties
    const filteredAndSortedProperties = useMemo(() => {
        let filtered = savedProperties as SavedPropertyWithNotes[];

        // Apply search filter
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            filtered = filtered.filter(property =>
                getPropertyTitle(property as any).toLowerCase().includes(query) ||
                property.address?.city?.toLowerCase().includes(query) ||
                property.address?.street?.toLowerCase().includes(query) ||
                property.notes?.toLowerCase().includes(query) ||
                property.type?.toLowerCase().includes(query)
            );
        }

        // Apply category filter (using smart logic since backend categories aren't implemented yet)
        if (selectedCategory !== 'all') {
            filtered = filtered.filter(property => {
                switch (selectedCategory) {
                    case 'favorites':
                        // Properties with notes are likely favorites
                        return property.notes && property.notes.length > 20;
                    case 'considering':
                        // Properties with notes but not extensive ones
                        return property.notes && property.notes.length <= 20;
                    case 'shortlist':
                        // Recent saves (within last 7 days) or higher price properties
                        const savedDate = property.savedAt ? new Date(property.savedAt) : new Date();
                        const daysSinceSaved = (new Date().getTime() - savedDate.getTime()) / (1000 * 3600 * 24);
                        const price = property.rent?.amount || 0;
                        return daysSinceSaved <= 7 || price > 2000;
                    case 'backup':
                        // Older saves or lower price properties
                        const savedDateBackup = property.savedAt ? new Date(property.savedAt) : new Date();
                        const daysSinceSavedBackup = (new Date().getTime() - savedDateBackup.getTime()) / (1000 * 3600 * 24);
                        const priceBackup = property.rent?.amount || 0;
                        return daysSinceSavedBackup > 7 || priceBackup <= 2000;
                    default:
                        return true;
                }
            });
        }

        // Apply sorting
        filtered.sort((a, b) => {
            switch (sortBy) {
                case 'recent':
                    return new Date(b.savedAt || '').getTime() - new Date(a.savedAt || '').getTime();
                case 'price-low':
                    return (a.rent?.amount || 0) - (b.rent?.amount || 0);
                case 'price-high':
                    return (b.rent?.amount || 0) - (a.rent?.amount || 0);
                case 'title':
                    return getPropertyTitle(a as any).localeCompare(getPropertyTitle(b as any));
                case 'notes':
                    return (b.notes?.length || 0) - (a.notes?.length || 0);
                default:
                    return 0;
            }
        });

        return filtered;
    }, [savedProperties, searchQuery, selectedCategory, sortBy]);

    // Category counts (using smart logic)
    const categoryCounts = useMemo(() => {
        const counts: Record<string, number> = { all: savedProperties.length };

        // Smart categorization logic
        counts.favorites = savedProperties.filter(p => p.notes && p.notes.length > 20).length;
        counts.considering = savedProperties.filter(p => p.notes && p.notes.length <= 20).length;

        counts.shortlist = savedProperties.filter(p => {
            const savedDate = p.savedAt ? new Date(p.savedAt) : new Date();
            const daysSinceSaved = (new Date().getTime() - savedDate.getTime()) / (1000 * 3600 * 24);
            const price = p.rent?.amount || 0;
            return daysSinceSaved <= 7 || price > 2000;
        }).length;

        counts.backup = savedProperties.filter(p => {
            const savedDate = p.savedAt ? new Date(p.savedAt) : new Date();
            const daysSinceSaved = (new Date().getTime() - savedDate.getTime()) / (1000 * 3600 * 24);
            const price = p.rent?.amount || 0;
            return daysSinceSaved > 7 || price <= 2000;
        }).length;

        return counts;
    }, [savedProperties]);

    const handleUnsaveProperty = useCallback(async (property: SavedPropertyWithNotes) => {
        const propertyId = property._id || property.id || '';

        if (!propertyId) {
            Alert.alert('Error', 'Unable to unsave property - missing ID.');
            return;
        }

        try {
            await toggleFavorite(propertyId);
        } catch (error) {
            Alert.alert(
                'Error',
                `Failed to unsave property. ${error instanceof Error ? error.message : 'Please try again.'}`
            );
        }
    }, [toggleFavorite]);

    const handleEditNotes = useCallback((property: SavedPropertyWithNotes) => {
        setSelectedProperty(property);
        setNotesText(property.notes || '');
        setNotesModalVisible(true);
    }, []);

    const handleEditCategory = useCallback((property: SavedPropertyWithNotes) => {
        setSelectedProperty(property);
        setCategoryModalVisible(true);
    }, []);

    const handleSaveNotes = useCallback(async () => {
        if (!selectedProperty) return;

        const propertyId = selectedProperty._id || selectedProperty.id || '';
        if (!propertyId) {
            Alert.alert('Error', 'Unable to update notes - missing property ID.');
            return;
        }

        try {
            await updateNotes(propertyId, notesText);
            setNotesModalVisible(false);
            setSelectedProperty(null);
            setNotesText('');
        } catch (error) {
            Alert.alert('Error', 'Failed to update notes. Please try again.');
        }
    }, [selectedProperty, notesText, updateNotes]);

    const handleSaveCategory = useCallback(async (categoryId: string) => {
        if (!selectedProperty) return;

        const propertyId = selectedProperty._id || selectedProperty.id || '';
        if (!propertyId) {
            Alert.alert('Error', 'Unable to update category - missing property ID.');
            return;
        }

        try {
            // TODO: Implement category update in the backend
            setCategoryModalVisible(false);
            setSelectedProperty(null);
        } catch (error) {
            Alert.alert('Error', 'Failed to update category. Please try again.');
        }
    }, [selectedProperty]);

    const handlePropertyPress = useCallback((property: SavedPropertyWithNotes) => {
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

    const handleRefresh = useCallback(async () => {
        clearError();
        await loadProperties();
    }, [clearError, loadProperties]);

    const handleBulkUnsave = useCallback(async () => {
        if (selectedProperties.size === 0) return;

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
                            for (const propertyId of selectedProperties) {
                                await toggleFavorite(propertyId);
                            }
                            setSelectedProperties(new Set());
                            setBulkActionMode(false);
                        } catch (error) {
                            Alert.alert('Error', 'Failed to unsave some properties. Please try again.');
                        }
                    }
                }
            ]
        );
    }, [selectedProperties, toggleFavorite]);

    const renderPropertyItem = useCallback(({ item }: { item: SavedPropertyWithNotes }) => {
        const propertyId = item._id || item.id || '';
        const isProcessing = isPropertySaving(propertyId);
        const isSelected = selectedProperties.has(propertyId);

        return (
            <View style={[
                viewMode === 'grid' ? styles.gridCardContainer : styles.cardContainer,
                isProcessing && styles.cardLoading,
                isSelected && styles.selectedCard
            ]}>
                {bulkActionMode && (
                    <TouchableOpacity
                        style={styles.selectionButton}
                        onPress={() => handlePropertyPress(item)}
                    >
                        <IconComponent
                            name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                            size={24}
                            color={isSelected ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
                        />
                    </TouchableOpacity>
                )}

                <PropertyCard
                    property={item as any}
                    variant={viewMode === 'grid' ? 'compact' : 'saved'}
                    onPress={() => !isProcessing && handlePropertyPress(item)}
                    footerContent={viewMode === 'list' ? (
                        <View style={styles.cardFooter}>
                            <View style={styles.propertyInfo}>
                                <View style={styles.categoryBadge}>
                                    <IconComponent
                                        name={CATEGORIES.find(c => c.id === item.category)?.icon || 'bookmark-outline'}
                                        size={12}
                                        color={colors.primaryColor}
                                    />
                                    <Text style={styles.categoryText}>
                                        {CATEGORIES.find(c => c.id === item.category)?.name || 'Saved'}
                                    </Text>
                                </View>
                                <View style={styles.notesSection}>
                                    <ThemedText style={styles.notesLabel}>My Notes:</ThemedText>
                                    <ThemedText style={styles.notesText} numberOfLines={2}>
                                        {item.notes || 'No notes yet. Tap to add some.'}
                                    </ThemedText>
                                </View>
                            </View>
                            <View style={styles.cardActions}>
                                <IconButton
                                    name="pricetag-outline"
                                    size={20}
                                    color={isProcessing ? colors.COLOR_BLACK_LIGHT_4 : colors.primaryColor}
                                    onPress={() => !isProcessing && handleEditCategory(item)}
                                />
                                <IconButton
                                    name="create-outline"
                                    size={20}
                                    color={isProcessing ? colors.COLOR_BLACK_LIGHT_4 : colors.primaryColor}
                                    onPress={() => !isProcessing && handleEditNotes(item)}
                                />
                                <Button
                                    onPress={() => !isProcessing && handleUnsaveProperty(item)}
                                    style={{
                                        ...styles.actionButton,
                                        ...(isProcessing ? styles.saveButtonDisabled : styles.unsaveButton)
                                    }}
                                    disabled={isProcessing}
                                >
                                    <Text style={styles.actionButtonText}>
                                        {isProcessing ? '...' : 'Unsave'}
                                    </Text>
                                </Button>
                            </View>
                        </View>
                    ) : null}
                />
                {isProcessing && (
                    <View style={styles.loadingOverlay}>
                        <ThemedText style={styles.loadingText}>
                            Processing...
                        </ThemedText>
                    </View>
                )}
            </View>
        );
    }, [isPropertySaving, handlePropertyPress, handleEditNotes, handleEditCategory, handleUnsaveProperty, viewMode, bulkActionMode, selectedProperties]);

    const keyExtractor = useCallback((item: SavedPropertyWithNotes) =>
        item._id || item.id || Math.random().toString(), []);

    const renderHeader = useCallback(() => (
        <View style={styles.headerControls}>
            {/* Search Bar */}
            <View style={styles.searchContainer}>
                <IconComponent name="search" size={20} color={colors.COLOR_BLACK_LIGHT_4} />
                <TextInput
                    style={styles.searchInput}
                    placeholder="Search saved properties..."
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    placeholderTextColor={colors.COLOR_BLACK_LIGHT_4}
                />
                {searchQuery.length > 0 && (
                    <TouchableOpacity onPress={() => setSearchQuery('')}>
                        <IconComponent name="close-circle" size={20} color={colors.COLOR_BLACK_LIGHT_4} />
                    </TouchableOpacity>
                )}
            </View>

            {/* Category Filter */}
            <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.categoryScroll}
                contentContainerStyle={styles.categoryContainer}
            >
                {CATEGORIES.map(category => (
                    <TouchableOpacity
                        key={category.id}
                        style={[
                            styles.categoryChip,
                            selectedCategory === category.id && styles.categoryChipActive
                        ]}
                        onPress={() => setSelectedCategory(category.id)}
                    >
                        <IconComponent
                            name={category.icon}
                            size={16}
                            color={selectedCategory === category.id ? 'white' : colors.primaryColor}
                        />
                        <Text style={[
                            styles.categoryChipText,
                            selectedCategory === category.id && styles.categoryChipTextActive
                        ]}>
                            {category.name} ({categoryCounts[category.id] || 0})
                        </Text>
                    </TouchableOpacity>
                ))}
            </ScrollView>

            {/* Controls Row */}
            <View style={styles.controlsRow}>
                <View style={styles.leftControls}>
                    <TouchableOpacity
                        style={styles.controlButton}
                        onPress={() => setShowFilters(!showFilters)}
                    >
                        <IconComponent name="funnel-outline" size={18} color={colors.primaryColor} />
                        <Text style={styles.controlButtonText}>Sort</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        style={styles.controlButton}
                        onPress={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')}
                    >
                        <IconComponent
                            name={viewMode === 'list' ? 'grid-outline' : 'list-outline'}
                            size={18}
                            color={colors.primaryColor}
                        />
                    </TouchableOpacity>
                </View>

                <View style={styles.rightControls}>
                    <TouchableOpacity
                        style={[styles.controlButton, bulkActionMode && styles.controlButtonActive]}
                        onPress={() => {
                            setBulkActionMode(!bulkActionMode);
                            setSelectedProperties(new Set());
                        }}
                    >
                        <IconComponent name="checkmark-circle-outline" size={18} color={bulkActionMode ? 'white' : colors.primaryColor} />
                        <Text style={[styles.controlButtonText, bulkActionMode && styles.controlButtonTextActive]}>
                            Select
                        </Text>
                    </TouchableOpacity>

                    <Text style={styles.countText}>
                        {filteredAndSortedProperties.length} properties
                    </Text>
                </View>
            </View>

            {/* Sort Options */}
            {showFilters && (
                <View style={styles.sortContainer}>
                    {[
                        { key: 'recent', label: 'Recently Saved', icon: 'time-outline' },
                        { key: 'price-low', label: 'Price: Low to High', icon: 'arrow-up-outline' },
                        { key: 'price-high', label: 'Price: High to Low', icon: 'arrow-down-outline' },
                        { key: 'title', label: 'Property Name', icon: 'text-outline' },
                        { key: 'notes', label: 'Most Notes', icon: 'document-text-outline' },
                    ].map(option => (
                        <TouchableOpacity
                            key={option.key}
                            style={[
                                styles.sortOption,
                                sortBy === option.key && styles.sortOptionActive
                            ]}
                            onPress={() => {
                                setSortBy(option.key as SortOption);
                                setShowFilters(false);
                            }}
                        >
                            <IconComponent
                                name={option.icon}
                                size={16}
                                color={sortBy === option.key ? 'white' : colors.primaryColor}
                            />
                            <Text style={[
                                styles.sortOptionText,
                                sortBy === option.key && styles.sortOptionTextActive
                            ]}>
                                {option.label}
                            </Text>
                        </TouchableOpacity>
                    ))}
                </View>
            )}

            {/* Bulk Actions */}
            {bulkActionMode && selectedProperties.size > 0 && (
                <View style={styles.bulkActionsContainer}>
                    <Text style={styles.bulkActionsText}>
                        {selectedProperties.size} selected
                    </Text>
                    <View style={styles.bulkActions}>
                        <Button
                            onPress={handleBulkUnsave}
                            style={styles.bulkActionButton}
                        >
                            <Text style={styles.bulkActionButtonText}>Unsave Selected</Text>
                        </Button>
                    </View>
                </View>
            )}
        </View>
    ), [searchQuery, selectedCategory, categoryCounts, showFilters, viewMode, bulkActionMode, selectedProperties, filteredAndSortedProperties.length, sortBy, handleBulkUnsave]);

    const renderEmptyState = useCallback(() => {
        if (searchQuery || selectedCategory !== 'all') {
            return (
                <View style={styles.emptyStateContainer}>
                    <View style={styles.emptyStateContent}>
                        <Text style={styles.emptyStateIcon}>🔍</Text>
                        <ThemedText style={styles.emptyStateTitle}>No Properties Found</ThemedText>
                        <ThemedText style={styles.emptyStateSubtitle}>
                            Try adjusting your search or filter criteria
                        </ThemedText>
                        <Button
                            onPress={() => {
                                setSearchQuery('');
                                setSelectedCategory('all');
                            }}
                            style={styles.browseButton}
                        >
                            <ThemedText style={styles.browseButtonText}>Clear Filters</ThemedText>
                        </Button>
                    </View>
                </View>
            );
        }

        return (
            <View style={styles.emptyStateContainer}>
                <View style={styles.emptyStateContent}>
                    <Text style={styles.emptyStateIcon}>🔖</Text>
                    <ThemedText style={styles.emptyStateTitle}>No Saved Properties Yet</ThemedText>
                    <ThemedText style={styles.emptyStateSubtitle}>
                        Save properties you love by tapping the bookmark icon. They'll appear here for easy access.
                    </ThemedText>
                    <Button
                        onPress={() => router.push('/properties')}
                        style={styles.browseButton}
                    >
                        <ThemedText style={styles.browseButtonText}>Start Browsing</ThemedText>
                    </Button>
                </View>
            </View>
        );
    }, [searchQuery, selectedCategory]);

    const renderAuthRequired = useCallback(() => (
        <View style={styles.emptyStateContainer}>
            <View style={styles.emptyStateContent}>
                <Text style={styles.emptyStateIcon}>🔒</Text>
                <ThemedText style={styles.emptyStateTitle}>Authentication Required</ThemedText>
                <ThemedText style={styles.emptyStateSubtitle}>
                    Please sign in to view and manage your saved properties
                </ThemedText>
            </View>
        </View>
    ), []);

    if (!oxyServices || !activeSessionId) {
        return (
            <ThemedView style={styles.container} lightColor="transparent" darkColor="transparent">
                <Header options={{ title: 'Saved Properties', showBackButton: true }} />
                {renderAuthRequired()}
            </ThemedView>
        );
    }

    return (
        <ThemedView style={styles.container} lightColor="transparent" darkColor="transparent">
            <Header
                options={{
                    title: 'Saved Properties',
                    showBackButton: true,
                    rightComponents: [
                        <IconButton
                            key="compare"
                            name="git-compare-outline"
                            size={20}
                            color={colors.primaryColor}
                            backgroundColor="transparent"
                            onPress={() => router.push('/properties/compare')}
                        />,
                        <IconButton
                            key="refresh"
                            name="refresh-outline"
                            size={20}
                            color={colors.primaryColor}
                            backgroundColor="transparent"
                            onPress={handleRefresh}
                        />
                    ]
                }}
            />

            {/* Show loading spinner when initially loading or when global save/unsave operations are happening */}
            {isLoading && <LoadingTopSpinner showLoading={true} />}

            {error && (
                <View style={styles.errorContainer}>
                    <ThemedText style={styles.errorText}>
                        Failed to load saved properties. Please try again.
                        {error && ` Error: ${error}`}
                    </ThemedText>
                    <Button onPress={handleRefresh}>
                        Retry
                    </Button>
                </View>
            )}

            {!isLoading && !error && (
                <FlatList
                    data={filteredAndSortedProperties}
                    renderItem={renderPropertyItem}
                    keyExtractor={keyExtractor}
                    contentContainerStyle={styles.listContainer}
                    showsVerticalScrollIndicator={false}
                    ListHeaderComponent={renderHeader}
                    ListEmptyComponent={renderEmptyState}
                    refreshing={isLoading}
                    onRefresh={handleRefresh}
                    numColumns={viewMode === 'grid' ? 2 : 1}
                    key={viewMode} // Force re-render when view mode changes
                />
            )}

            {/* Notes Modal */}
            <Modal
                visible={notesModalVisible}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setNotesModalVisible(false)}
            >
                <TouchableOpacity
                    style={styles.modalOverlay}
                    activeOpacity={1}
                    onPressOut={() => setNotesModalVisible(false)}
                >
                    <View style={styles.modalContent}>
                        <ThemedText style={styles.modalTitle}>Edit Notes</ThemedText>
                        <ThemedText style={styles.modalSubtitle}>
                            Add a personal note for "{selectedProperty ? getPropertyTitle(selectedProperty as any) : ''}"
                        </ThemedText>
                        <TextInput
                            style={styles.notesInput}
                            value={notesText}
                            onChangeText={setNotesText}
                            placeholder="e.g., 'Love the big kitchen, but the backyard is small.'"
                            placeholderTextColor={colors.primaryDark_2}
                            multiline
                        />
                        <View style={styles.modalActions}>
                            <Button
                                onPress={() => setNotesModalVisible(false)}
                                style={styles.cancelButton}
                            >
                                <ThemedText style={styles.cancelButtonText}>Cancel</ThemedText>
                            </Button>
                            <Button onPress={handleSaveNotes} style={styles.saveButton}>
                                <ThemedText style={styles.saveButtonText}>Save Notes</ThemedText>
                            </Button>
                        </View>
                    </View>
                </TouchableOpacity>
            </Modal>

            {/* Category Modal */}
            <Modal
                visible={categoryModalVisible}
                animationType="slide"
                transparent={true}
                onRequestClose={() => setCategoryModalVisible(false)}
            >
                <TouchableOpacity
                    style={styles.modalOverlay}
                    activeOpacity={1}
                    onPressOut={() => setCategoryModalVisible(false)}
                >
                    <View style={styles.modalContent}>
                        <ThemedText style={styles.modalTitle}>Change Category</ThemedText>
                        <ThemedText style={styles.modalSubtitle}>
                            Organize "{selectedProperty ? getPropertyTitle(selectedProperty as any) : ''}" into a category
                        </ThemedText>
                        <ScrollView style={styles.categoryList}>
                            {CATEGORIES.slice(1).map(category => (
                                <TouchableOpacity
                                    key={category.id}
                                    style={styles.categoryOption}
                                    onPress={() => handleSaveCategory(category.id)}
                                >
                                    <IconComponent name={category.icon} size={20} color={colors.primaryColor} />
                                    <Text style={styles.categoryOptionText}>{category.name}</Text>
                                </TouchableOpacity>
                            ))}
                        </ScrollView>
                        <Button
                            onPress={() => setCategoryModalVisible(false)}
                            style={styles.cancelButton}
                        >
                            <ThemedText style={styles.cancelButtonText}>Cancel</ThemedText>
                        </Button>
                    </View>
                </TouchableOpacity>
            </Modal>
        </ThemedView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    listContainer: {
        padding: 16,
    },
    cardContainer: {
        backgroundColor: 'white',
        borderRadius: 12,
        marginBottom: 16,
        overflow: 'hidden',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        position: 'relative',
    },
    gridCardContainer: {
        backgroundColor: 'white',
        borderRadius: 12,
        marginBottom: 16,
        marginHorizontal: 4,
        overflow: 'hidden',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        flex: 1,
        position: 'relative',
    },
    selectedCard: {
        borderWidth: 2,
        borderColor: colors.primaryColor,
    },
    selectionButton: {
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 10,
        backgroundColor: 'white',
        borderRadius: 12,
        padding: 4,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
    },
    headerControls: {
        marginBottom: 16,
    },
    searchContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'white',
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        marginBottom: 16,
        elevation: 1,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 2,
    },
    searchInput: {
        flex: 1,
        marginLeft: 12,
        fontSize: 16,
        color: colors.COLOR_BLACK,
    },
    categoryScroll: {
        marginBottom: 16,
    },
    categoryContainer: {
        paddingHorizontal: 4,
    },
    categoryChip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'white',
        borderRadius: 20,
        paddingHorizontal: 12,
        paddingVertical: 8,
        marginRight: 8,
        borderWidth: 1,
        borderColor: colors.primaryColor,
    },
    categoryChipActive: {
        backgroundColor: colors.primaryColor,
    },
    categoryChipText: {
        marginLeft: 6,
        fontSize: 12,
        color: colors.primaryColor,
        fontWeight: '500',
    },
    categoryChipTextActive: {
        color: 'white',
    },
    controlsRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 8,
    },
    leftControls: {
        flexDirection: 'row',
        gap: 8,
    },
    rightControls: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    controlButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'white',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderWidth: 1,
        borderColor: colors.primaryColor,
    },
    controlButtonActive: {
        backgroundColor: colors.primaryColor,
    },
    controlButtonText: {
        marginLeft: 4,
        fontSize: 14,
        color: colors.primaryColor,
        fontWeight: '500',
    },
    controlButtonTextActive: {
        color: 'white',
    },
    countText: {
        fontSize: 12,
        color: colors.COLOR_BLACK_LIGHT_4,
    },
    sortContainer: {
        backgroundColor: 'white',
        borderRadius: 12,
        padding: 8,
        marginBottom: 16,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    sortOption: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: 8,
        marginVertical: 2,
    },
    sortOptionActive: {
        backgroundColor: colors.primaryColor,
    },
    sortOptionText: {
        marginLeft: 8,
        fontSize: 14,
        color: colors.COLOR_BLACK,
    },
    sortOptionTextActive: {
        color: 'white',
    },
    bulkActionsContainer: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: colors.primaryColor,
        borderRadius: 12,
        paddingHorizontal: 16,
        paddingVertical: 12,
        marginBottom: 16,
    },
    bulkActionsText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 14,
    },
    bulkActions: {
        flexDirection: 'row',
        gap: 8,
    },
    bulkActionButton: {
        backgroundColor: 'white',
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    bulkActionButtonText: {
        color: colors.primaryColor,
        fontWeight: '500',
        fontSize: 12,
    },
    cardFooter: {
        padding: 12,
        borderTopWidth: 1,
        borderTopColor: '#f0f0f0',
    },
    propertyInfo: {
        marginBottom: 12,
    },
    categoryBadge: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.primaryLight,
        borderRadius: 12,
        paddingHorizontal: 8,
        paddingVertical: 4,
        alignSelf: 'flex-start',
        marginBottom: 8,
    },
    categoryText: {
        marginLeft: 4,
        fontSize: 10,
        color: colors.primaryColor,
        fontWeight: '600',
    },
    notesSection: {
        flex: 1,
    },
    notesLabel: {
        fontSize: 12,
        color: colors.primaryDark_2,
        marginBottom: 4,
        fontWeight: '500',
    },
    notesText: {
        fontSize: 14,
        color: colors.primaryDark_1,
    },
    cardActions: {
        flexDirection: 'row',
        gap: 8,
        alignItems: 'center',
    },
    actionButton: {
        borderRadius: 6,
        paddingHorizontal: 12,
        paddingVertical: 6,
    },
    unsaveButton: {
        backgroundColor: colors.COLOR_BLACK_LIGHT_4,
    },
    actionButtonText: {
        fontSize: 12,
        fontWeight: '500',
        color: 'white',
    },
    emptyStateContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 24,
        minHeight: 300,
    },
    emptyStateContent: {
        alignItems: 'center',
        textAlign: 'center',
    },
    emptyStateIcon: {
        fontSize: 48,
        marginBottom: 16,
    },
    emptyStateTitle: {
        fontSize: 22,
        fontWeight: '600',
        marginBottom: 8,
    },
    emptyStateSubtitle: {
        fontSize: 16,
        color: colors.primaryDark_2,
        marginBottom: 24,
        paddingHorizontal: 16,
        textAlign: 'center',
    },
    browseButton: {
        backgroundColor: colors.primaryColor,
        paddingVertical: 12,
        paddingHorizontal: 32,
        borderRadius: 50,
    },
    browseButtonText: {
        color: 'white',
        fontWeight: '600',
        fontSize: 16,
    },
    errorContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
    },
    errorText: {
        fontSize: 16,
        textAlign: 'center',
        marginBottom: 16,
        opacity: 0.7,
        color: colors.primaryDark_1,
    },
    modalOverlay: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    modalContent: {
        backgroundColor: 'white',
        borderRadius: 16,
        padding: 24,
        width: '90%',
        maxWidth: 400,
        maxHeight: '80%',
        elevation: 10,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
    },
    modalTitle: {
        fontSize: 20,
        fontWeight: '600',
        marginBottom: 8,
    },
    modalSubtitle: {
        fontSize: 14,
        color: colors.primaryDark_2,
        marginBottom: 16,
    },
    notesInput: {
        backgroundColor: '#f0f0f0',
        borderRadius: 8,
        padding: 16,
        minHeight: 100,
        fontSize: 16,
        textAlignVertical: 'top',
        marginBottom: 16,
    },
    modalActions: {
        flexDirection: 'row',
        gap: 12,
    },
    saveButton: {
        backgroundColor: colors.primaryColor,
        borderRadius: 8,
        paddingVertical: 12,
        flex: 1,
    },
    saveButtonText: {
        color: 'white',
        fontWeight: '600',
        textAlign: 'center',
    },
    cancelButton: {
        backgroundColor: colors.COLOR_BLACK_LIGHT_4,
        borderRadius: 8,
        paddingVertical: 12,
        flex: 1,
    },
    cancelButtonText: {
        color: 'white',
        fontWeight: '600',
        textAlign: 'center',
    },
    categoryList: {
        maxHeight: 200,
        marginBottom: 16,
    },
    categoryOption: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 8,
        marginVertical: 2,
        backgroundColor: '#f8f9fa',
    },
    categoryOptionText: {
        marginLeft: 12,
        fontSize: 16,
        color: colors.COLOR_BLACK,
    },
    cardLoading: {
        opacity: 0.5,
    },
    loadingOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
    },
    loadingText: {
        fontSize: 16,
        fontWeight: '600',
        color: 'white',
    },
    saveButtonDisabled: {
        backgroundColor: colors.COLOR_BLACK_LIGHT_4,
    },
}); 