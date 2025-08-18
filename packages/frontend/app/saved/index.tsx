import React, { useState, useCallback, useMemo, useEffect, useContext, useRef } from 'react';
import {
  View,
  FlatList,
  StyleSheet,
  Dimensions,
  Alert,
  TouchableOpacity,
  TextInput,
  Text,
  RefreshControl,
  Platform,
  ScrollView,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import LoadingTopSpinner from '@/components/LoadingTopSpinner';
import { Header } from '@/components/Header';
import { PropertyCard } from '@/components/PropertyCard';
import { ListItem } from '@/components/ListItem';
import { colors } from '@/styles/colors';
import { getPropertyTitle } from '@/utils/propertyUtils';
import { useFavorites } from '@/hooks/useFavorites';
import { useOxy } from '@oxyhq/services';
import { useSavedNotesMutation } from '@/hooks/useSavedNotes';

import { Ionicons } from '@expo/vector-icons';

import savedPropertyService from '@/services/savedPropertyService';
import savedPropertyFolderService from '@/services/savedPropertyFolderService';
import type { SavedProperty } from '@homiio/shared-types';
import { EmptyState } from '@/components/ui/EmptyState';

// import { useSavedProfiles } from '@/context/SavedProfilesContext';
import { api } from '@/utils/api';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { useSavedSearches } from '@/hooks/useSavedSearches';
import { SavedSearchActionsBottomSheet } from '@/components/SavedSearchActionsBottomSheet';
import { EditNotesBottomSheet } from '@/components/EditNotesBottomSheet';
import { parseNotesString } from '@/utils/notes';

// Extended interface for saved properties
type SavedPropertyWithUI = SavedProperty;

const IconComponent = Ionicons as any;
const { width: screenWidth } = Dimensions.get('window');

// Types
export type SortOption = 'recent' | 'price-low' | 'price-high' | 'title' | 'notes';
export type ViewMode = 'list' | 'grid';
export type FilterCategory = 'all' | 'recent' | 'noted' | 'quick-saves' | 'folders' | 'profiles' | 'searches';

// Constants
const SORT_OPTIONS = [
  { key: 'recent' as const, label: 'Recently Saved', icon: 'time-outline' },
  { key: 'price-low' as const, label: 'Price: Low to High', icon: 'arrow-up-outline' },
  { key: 'price-high' as const, label: 'Price: High to Low', icon: 'arrow-down-outline' },
  { key: 'title' as const, label: 'Property Name', icon: 'text-outline' },
  { key: 'notes' as const, label: 'Most Notes', icon: 'document-text-outline' },
];

const CATEGORIES = [
  { id: 'all', name: 'saved.tabs.all', icon: 'grid-outline' },
  { id: 'recent', name: 'saved.tabs.recent', icon: 'time-outline' },
  { id: 'noted', name: 'saved.tabs.noted', icon: 'document-text-outline' },
  { id: 'quick-saves', name: 'saved.tabs.quickSaves', icon: 'bookmark-outline' },
  { id: 'searches', name: 'saved.tabs.searches', icon: 'bookmark-outline' },
  { id: 'folders', name: 'saved.tabs.folders', icon: 'folder-outline' },
  { id: 'profiles', name: 'saved.tabs.profiles', icon: 'person-circle-outline' },
];

// Grid layout constants (style-based, no runtime calculations)
const LIST_GAP = 16; // desired gap between list rows

export default function SavedPropertiesScreen() {
  const { t } = useTranslation();
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();
  const bottomSheetContext = useContext(BottomSheetContext);
  const { mutateAsync: updateNotesMutate } = useSavedNotesMutation();

  // Use the new Zustand-based favorites system
  const { toggleFavorite, clearError: clearFavoritesError } = useFavorites();

  // Use React Query directly for instant updates
  const { data: savedPropertiesData, isLoading: savedLoading } = useQuery({
    queryKey: ['savedProperties'],
    queryFn: () => savedPropertyService.getSavedProperties(oxyServices!, activeSessionId!),
    enabled: !!oxyServices && !!activeSessionId,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  });

  const { data: foldersData, isLoading: foldersLoading } = useQuery({
    queryKey: ['savedFolders'],
    queryFn: () => savedPropertyFolderService.getSavedPropertyFolders(oxyServices!, activeSessionId!),
    enabled: !!oxyServices && !!activeSessionId,
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 10,
  });

  const savedProperties: SavedPropertyWithUI[] = useMemo(
    () => savedPropertiesData?.properties || [],
    [savedPropertiesData?.properties],
  );
  const folders = useMemo(() => foldersData?.folders || [], [foldersData?.folders]);

  const [savedProfiles, setSavedProfiles] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Local state
  const [searchQuery, setSearchQuery] = useState('');
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const parseTab = (value?: string): FilterCategory =>
    value === 'recent' ||
      value === 'noted' ||
      value === 'quick-saves' ||
      value === 'searches' ||
      value === 'folders' ||
      value === 'profiles'
      ? value
      : 'all';
  const [selectedCategory, setSelectedCategory] = useState<FilterCategory>(
    parseTab(typeof tab === 'string' ? tab : undefined),
  );
  useEffect(() => {
    const next = parseTab(typeof tab === 'string' ? tab : undefined);
    if (next !== selectedCategory) setSelectedCategory(next);
  }, [tab, selectedCategory]);
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [viewMode, setViewMode] = useState<ViewMode>(screenWidth > 768 ? 'list' : 'grid');
  const [selectedProperties, setSelectedProperties] = useState<Set<string>>(new Set());
  const [bulkActionMode, setBulkActionMode] = useState(false);
  const [showSortOptions, setShowSortOptions] = useState(false);

  // Tabs horizontal scroll state (web arrows)
  const tabsScrollRef = useRef<any>(null);
  const [tabsContainerWidth, setTabsContainerWidth] = useState(0);
  const [tabsContentWidth, setTabsContentWidth] = useState(0);
  const [tabsScrollX, setTabsScrollX] = useState(0);
  const [tabsCanScrollLeft, setTabsCanScrollLeft] = useState(false);
  const [tabsCanScrollRight, setTabsCanScrollRight] = useState(false);

  // Saved searches (React Query-backed)
  const {
    searches: savedSearches,
    toggleNotifications: toggleSavedSearchNotifications,
    deleteSavedSearch: deleteSavedSearchHook,
  } = useSavedSearches();

  // Load saved profiles
  const refreshSavedProfiles = useCallback(async () => {
    if (!oxyServices || !activeSessionId) return;

    try {
      const res = await api.get('/api/profiles/me/saved-profiles', {
        oxyServices,
        activeSessionId,
      });
      setSavedProfiles(res.data?.data || res.data || []);
    } catch (error: any) {
      console.error('Failed to load saved profiles:', error);
    }
  }, [oxyServices, activeSessionId]);

  // Load profiles on mount
  useEffect(() => {
    if (oxyServices && activeSessionId) {
      refreshSavedProfiles();
    }
  }, [oxyServices, activeSessionId, refreshSavedProfiles]);

  // Memoized filtered properties
  const filteredProperties = useMemo(() => {
    let filtered = [...savedProperties];

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((property) => {
        const title = (getPropertyTitle(property) || '').toLowerCase();
        const city = property.address?.city?.toLowerCase() || '';
        const state = property.address?.state?.toLowerCase() || '';
        const street = property.address?.street?.toLowerCase() || '';
        const type = property.type?.toLowerCase() || '';
        const priceStr =
          `${property.rent?.amount ?? ''} ${property.rent?.currency ?? ''}`.toLowerCase();
        // Notes can be plain or JSON; parse for robust search
        const notesArr = parseNotesString(property.notes as any);
        const notesCombined = notesArr
          .map((n) => n.text)
          .join(' ')
          .toLowerCase();

        return (
          title.includes(query) ||
          city.includes(query) ||
          state.includes(query) ||
          street.includes(query) ||
          type.includes(query) ||
          priceStr.includes(query) ||
          notesCombined.includes(query)
        );
      });
    }

    // Apply category filter
    if (selectedCategory !== 'all') {
      const now = Date.now();
      filtered = filtered.filter((property) => {
        switch (selectedCategory) {
          case 'recent':
            const savedTime = property.savedAt ? new Date(property.savedAt).getTime() : now;
            return now - savedTime <= 7 * 24 * 60 * 60 * 1000; // 7 days
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
  }, [savedProperties, searchQuery, selectedCategory, sortBy]);

  // Memoized category counts
  const categoryCounts = useMemo(() => {
    const now = Date.now();
    const counts = {
      all: savedProperties.length,
      recent: savedProperties.filter((p) => {
        const savedTime = p.savedAt ? new Date(p.savedAt).getTime() : now;
        return now - savedTime <= 7 * 24 * 60 * 60 * 1000;
      }).length,
      noted: savedProperties.filter((p) => p.notes && p.notes.trim().length > 0).length,
      'quick-saves': savedProperties.filter((p) => !p.notes || p.notes.trim().length === 0).length,
      folders: folders.length,
      profiles: savedProfiles.length,
      searches: savedSearches.length,
    } as const;
    return counts;
  }, [savedProperties, folders, savedProfiles, savedSearches.length]);

  // Folders filtered for Folders tab
  const filteredFolders = useMemo(() => {
    if (!searchQuery.trim()) return folders;
    const q = searchQuery.toLowerCase().trim();
    return folders.filter(
      (f: any) => f.name.toLowerCase().includes(q) || (f.description || '').toLowerCase().includes(q),
    );
  }, [folders, searchQuery]);

  // Handlers
  const handleRefresh = useCallback(async () => {
    if (!oxyServices || !activeSessionId) return;

    setError(null);
    clearFavoritesError();
    await queryClient.invalidateQueries({ queryKey: ['savedProperties'] });
    await queryClient.invalidateQueries({ queryKey: ['savedFolders'] });
    await refreshSavedProfiles();
  }, [oxyServices, activeSessionId, queryClient, clearFavoritesError, refreshSavedProfiles]);

  // Using only bulk unsave for now; individual unsave action handled elsewhere

  const handleEditNotes = useCallback(
    (property: SavedPropertyWithUI) => {
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
            try {
              await updateNotesMutate({ propertyId, notes });
            } catch (error) {
              console.error('Failed to update notes:', error);
              throw error;
            }
          }}
        />,
      );
    },
    [bottomSheetContext, updateNotesMutate],
  );

  const handlePropertyPress = useCallback(
    (property: SavedPropertyWithUI) => {
      if (bulkActionMode) {
        const propertyId = property._id || property.id || '';
        if (propertyId) {
          setSelectedProperties((prev) => {
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
    },
    [bulkActionMode],
  );

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
              const unsavePromises = Array.from(selectedProperties).map((propertyId) =>
                toggleFavorite(propertyId),
              );
              await Promise.all(unsavePromises);

              // Refresh the saved properties list
              await queryClient.invalidateQueries({ queryKey: ['savedProperties'] });

              setSelectedProperties(new Set());
              setBulkActionMode(false);
            } catch {
              Alert.alert('Error', 'Failed to unsave some properties. Please try again.');
            }
          },
        },
      ],
    );
  }, [selectedProperties, oxyServices, activeSessionId, toggleFavorite, queryClient]);

  // Render functions
  const renderPropertyItem = useCallback(
    ({ item }: { item: SavedPropertyWithUI }) => {
      const propertyId = item._id || item.id || '';
      const isSelected = selectedProperties.has(propertyId);

      return (
        <View style={viewMode === 'grid' ? styles.gridItemContainer : undefined}>
          <PropertyCard
            property={item}
            variant={viewMode === 'grid' ? 'compact' : 'saved'}
            orientation={viewMode === 'grid' ? 'vertical' : 'horizontal'}
            onPress={() => handlePropertyPress(item)}
            noteText={
              (parseNotesString(item.notes as any)[0]?.text ?? '') +
              (parseNotesString(item.notes as any).length > 1
                ? ` (+${parseNotesString(item.notes as any).length - 1} more)`
                : '')
            }
            onPressNote={() => handleEditNotes(item)}
            isSelected={isSelected}
            overlayContent={
              bulkActionMode ? (
                <TouchableOpacity
                  style={styles.selectionButton}
                  onPress={() => handlePropertyPress(item)}
                >
                  <View
                    style={StyleSheet.flatten([
                      styles.selectionIndicator,
                      isSelected && styles.selectionIndicatorActive,
                    ])}
                  >
                    {isSelected && <IconComponent name="checkmark" size={16} color="white" />}
                  </View>
                </TouchableOpacity>
              ) : null
            }
          />
        </View>
      );
    },
    [
      viewMode,
      selectedProperties,
      bulkActionMode,
      handlePropertyPress,
      handleEditNotes,
    ],
  );

  const keyExtractor = useCallback((item: SavedPropertyWithUI) => item._id || item.id || '', []);

  const getItemLayout = useCallback(
    (data: any, index: number) => {
      const baseItemHeight = viewMode === 'grid' ? 260 : 340;
      if (viewMode === 'grid') {
        const rowIndex = Math.floor(index / 2);
        return {
          length: baseItemHeight,
          offset: baseItemHeight * rowIndex,
          index,
        };
      } else {
        const itemHeightWithGap = baseItemHeight + LIST_GAP;
        return {
          length: itemHeightWithGap,
          offset: itemHeightWithGap * index,
          index,
        };
      }
    },
    [viewMode],
  );

  const renderHeader = () => (
    <>
      {/* Modern Search Bar */}
      <View style={styles.searchWrapper}>
        <View style={styles.searchContainer}>
          <IconComponent name="search" size={20} color={colors.COLOR_BLACK_LIGHT_3} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('saved.searchPlaceholder', 'Search your saved items...')}
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
      <View
        style={styles.tabsContainer}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          setTabsContainerWidth(w);
          const canRight = tabsContentWidth > w + tabsScrollX + 1;
          if (canRight !== tabsCanScrollRight) setTabsCanScrollRight(canRight);
        }}
      >
        {Platform.OS === 'web' && tabsCanScrollLeft && (
          <TouchableOpacity
            style={StyleSheet.flatten([
              styles.scrollArrow,
              styles.scrollArrowLeft,
            ])}
            onPress={() => {
              const nextX = Math.max(0, tabsScrollX - Math.max(120, tabsContainerWidth * 0.8));
              tabsScrollRef.current?.scrollTo({ x: nextX, animated: true });
            }}
            accessibilityLabel="Scroll left"
          >
            <View style={styles.scrollArrowCircle}>
              <IconComponent
                name="chevron-back"
                size={18}
                color={colors.primaryColor}
              />
            </View>
          </TouchableOpacity>
        )}

        <ScrollView
          ref={tabsScrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabsContent}
          style={styles.tabsScroll}
          scrollEventThrottle={16}
          onContentSizeChange={(w) => {
            setTabsContentWidth(w);
            const canRight = w > tabsContainerWidth + tabsScrollX + 1;
            setTabsCanScrollRight(canRight);
          }}
          onScroll={(e) => {
            const x = e.nativeEvent.contentOffset.x;
            setTabsScrollX(x);
            const canLeft = x > 0;
            const canRight = x + tabsContainerWidth < tabsContentWidth - 1;
            if (canLeft !== tabsCanScrollLeft) setTabsCanScrollLeft(canLeft);
            if (canRight !== tabsCanScrollRight) setTabsCanScrollRight(canRight);
          }}
        >
          {CATEGORIES.map((category) => {
            const isActive = selectedCategory === category.id;
            return (
              <TouchableOpacity
                key={category.id}
                style={StyleSheet.flatten([styles.tabItem, isActive && styles.tabItemActive])}
                onPress={() => {
                  const next = category.id as FilterCategory;
                  setSelectedCategory(next);
                  try {
                    router.setParams?.({ tab: next });
                  } catch { }
                }}
              >
                <Text style={StyleSheet.flatten([styles.tabText, isActive && styles.tabTextActive])}>
                  {t(category.name as any)} ({(categoryCounts as any)[category.id] || 0})
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {Platform.OS === 'web' && tabsCanScrollRight && (
          <TouchableOpacity
            style={StyleSheet.flatten([
              styles.scrollArrow,
              styles.scrollArrowRight,
            ])}
            onPress={() => {
              const maxX = Math.max(0, tabsContentWidth - tabsContainerWidth);
              const nextX = Math.min(
                maxX,
                tabsScrollX + Math.max(120, tabsContainerWidth * 0.8),
              );
              tabsScrollRef.current?.scrollTo({ x: nextX, animated: true });
            }}
            accessibilityLabel="Scroll right"
          >
            <View style={styles.scrollArrowCircle}>
              <IconComponent
                name="chevron-forward"
                size={18}
                color={colors.primaryColor}
              />
            </View>
          </TouchableOpacity>
        )}
      </View>

      {/* Folders/Profiles tabs show custom lists below */}

      {/* Controls Bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.controlsBar}>
          <View style={styles.leftControls}>
            {/* Sort icon */}
            <TouchableOpacity
              accessibilityLabel="Sort"
              style={StyleSheet.flatten([styles.iconPill, showSortOptions && styles.iconPillActive])}
              onPress={() => setShowSortOptions(!showSortOptions)}
            >
              <IconComponent
                name="filter"
                size={16}
                color={showSortOptions ? 'white' : colors.primaryColor}
              />
            </TouchableOpacity>

            {/* View segmented control */}
            <View style={styles.segmented}>
              <TouchableOpacity
                accessibilityLabel={t('saved.view.list', 'List')}
                style={StyleSheet.flatten([
                  styles.segment,
                  viewMode === 'list' && styles.segmentActive,
                ])}
                onPress={() => setViewMode('list')}
              >
                <IconComponent
                  name="list"
                  size={14}
                  color={viewMode === 'list' ? 'white' : colors.primaryColor}
                />
                <Text
                  style={StyleSheet.flatten([
                    styles.segmentText,
                    viewMode === 'list' && styles.segmentTextActive,
                  ])}
                >
                  {t('saved.view.list', 'List')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                accessibilityLabel={t('saved.view.grid', 'Grid')}
                style={StyleSheet.flatten([
                  styles.segment,
                  viewMode === 'grid' && styles.segmentActive,
                ])}
                onPress={() => setViewMode('grid')}
              >
                <IconComponent
                  name="grid"
                  size={14}
                  color={viewMode === 'grid' ? 'white' : colors.primaryColor}
                />
                <Text
                  style={StyleSheet.flatten([
                    styles.segmentText,
                    viewMode === 'grid' && styles.segmentTextActive,
                  ])}
                >
                  {t('saved.view.grid', 'Grid')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.rightControls}>
            {/* Clear search if active */}
            {searchQuery.length > 0 && (
              <TouchableOpacity
                accessibilityLabel="Clear search"
                style={styles.iconPill}
                onPress={() => setSearchQuery('')}
              >
                <IconComponent name="close-circle" size={16} color={colors.primaryColor} />
              </TouchableOpacity>
            )}

            {/* Selection toggle */}
            <TouchableOpacity
              accessibilityLabel={bulkActionMode ? 'Cancel selection' : 'Select items'}
              style={StyleSheet.flatten([styles.iconPill, bulkActionMode && styles.iconPillActive])}
              onPress={() => {
                setBulkActionMode(!bulkActionMode);
                setSelectedProperties(new Set());
              }}
            >
              <IconComponent
                name="checkmark-circle"
                size={16}
                color={bulkActionMode ? 'white' : colors.primaryColor}
              />
            </TouchableOpacity>

            <Text style={styles.resultCount}>
              {selectedCategory === 'profiles'
                ? `${savedProfiles.length} ${t('saved.profilesLabel', 'profiles')}`
                : selectedCategory === 'searches'
                  ? `${savedSearches.length} ${t('search.savedSearches')}`
                  : `${filteredProperties.length} ${t('search.properties')}`}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Sort Options Dropdown */}
      {showSortOptions && (
        <View style={styles.sortDropdown}>
          {SORT_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.key}
              style={StyleSheet.flatten([
                styles.sortOption,
                sortBy === option.key && styles.sortOptionActive,
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
              <Text
                style={StyleSheet.flatten([
                  styles.sortOptionText,
                  sortBy === option.key && styles.sortOptionTextActive,
                ])}
              >
                {t(`saved.sort.${option.key}`, option.label)}
              </Text>
              {sortBy === option.key && <IconComponent name="checkmark" size={16} color="white" />}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Bulk Actions Bar */}
      {bulkActionMode && selectedProperties.size > 0 && (
        <View style={styles.bulkActionsBar}>
          <View style={styles.bulkLeft}>
            <Text style={styles.bulkActionsText}>{`${selectedProperties.size} selected`}</Text>
          </View>
          <View style={styles.bulkRight}>
            <TouchableOpacity
              style={styles.bulkIconBtn}
              onPress={handleBulkUnsave}
              accessibilityLabel="Remove"
            >
              <IconComponent name="trash" size={18} color={colors.primaryColor} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.bulkIconBtn}
              onPress={() => {
                setSelectedProperties(new Set());
                setBulkActionMode(false);
              }}
              accessibilityLabel="Cancel"
            >
              <IconComponent name="close" size={18} color={colors.primaryColor} />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </>
  );

  const renderEmptyState = () => {
    if (searchQuery || selectedCategory !== 'all') {
      return (
        <EmptyState
          icon="search"
          title={t('common.noResults')}
          description={t('saved.adjustFilters', 'Try adjusting your search or filter criteria')}
          actionText={t('common.clear')}
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
        <Header options={{ title: 'Saved', showBackButton: true }} />
        <EmptyState
          icon="lock-closed"
          title={t('profile.signInRequired')}
          description={t('profile.signInMessage')}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header
        options={{
          title: t('saved.header', 'Saved'),
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
              <IconComponent name="search" size={24} color={colors.COLOR_BLACK} />
            </TouchableOpacity>,
            <TouchableOpacity
              key="notes"
              style={styles.headerButton}
              onPress={() => router.push('/saved/notes')}
              accessibilityLabel="Open notes"
            >
              <IconComponent name="document-text-outline" size={24} color={colors.COLOR_BLACK} />
            </TouchableOpacity>,
          ],
        }}
      />

      {renderHeader()}

      {(savedLoading || foldersLoading) && savedProperties.length === 0 && <LoadingTopSpinner showLoading={true} />}

      {error && !savedLoading && !foldersLoading && (
        <EmptyState
          icon="alert-circle"
          title="Something went wrong"
          description={error}
          actionText="Try Again"
          actionIcon="refresh"
          onAction={handleRefresh}
        />
      )}

      {!savedLoading &&
        !foldersLoading &&
        !error &&
        (selectedCategory === 'folders' ? (
          <FlatList
            data={filteredFolders}
            keyExtractor={(item) => item._id}
            renderItem={({ item }) => (
              <ListItem
                title={`${item.icon || '📁'} ${item.name}`}
                description={item.description}
                onPress={() => router.push(`/saved/${item._id}`)}
                rightElement={<Text style={styles.folderCount}>{item.propertyCount}</Text>}
              />
            )}
            contentContainerStyle={StyleSheet.flatten([
              styles.listContent,
              filteredFolders.length === 0 && styles.emptyListContent,
            ])}
            ListEmptyComponent={renderEmptyState}
            refreshControl={
              <RefreshControl
                refreshing={savedLoading || foldersLoading}
                onRefresh={handleRefresh}
                colors={[colors.primaryColor]}
                tintColor={colors.primaryColor}
              />
            }
            removeClippedSubviews
            windowSize={7}
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            updateCellsBatchingPeriod={50}
          />
        ) : selectedCategory === 'profiles' ? (
          <FlatList
            data={savedProfiles}
            keyExtractor={(item) => String(item._id)}
            renderItem={({ item }) => (
              <ListItem
                title={
                  item.agencyProfile?.legalCompanyName ||
                  item.businessProfile?.legalCompanyName ||
                  item.cooperativeProfile?.legalName ||
                  item.personalProfile?.personalInfo?.bio ||
                  item.oxyUserId ||
                  'Profile'
                }
                description={item.profileType}
                onPress={() => router.push(`/profile/${item._id}`)}
                rightElement={<Text style={styles.folderCount}>↗</Text>}
              />
            )}
            contentContainerStyle={StyleSheet.flatten([
              styles.listContent,
              savedProfiles.length === 0 && styles.emptyListContent,
            ])}
            ListEmptyComponent={
              <EmptyState
                icon="person-circle-outline"
                title={t('saved.noProfilesTitle', 'No Saved Profiles')}
                description={t('saved.noProfilesDescription', 'Follow profiles to see them here')}
              />
            }
            refreshControl={
              <RefreshControl
                refreshing={savedLoading || foldersLoading}
                onRefresh={handleRefresh}
                colors={[colors.primaryColor]}
                tintColor={colors.primaryColor}
              />
            }
            removeClippedSubviews
            windowSize={7}
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            updateCellsBatchingPeriod={50}
          />
        ) : selectedCategory === 'searches' ? (
          <FlatList
            data={savedSearches as any}
            keyExtractor={(item: any) => item.id}
            renderItem={({ item }: any) => (
              <ListItem
                title={item.name}
                description={item.query}
                onPress={() => router.push(`/search/${encodeURIComponent(item.query)}`)}
                rightElement={
                  <TouchableOpacity
                    style={styles.bulkIconBtn}
                    onPress={() =>
                      bottomSheetContext?.openBottomSheet(
                        <SavedSearchActionsBottomSheet
                          search={{ id: item.id, name: item.name, query: item.query, notificationsEnabled: item.notifications }}
                          onClose={() => bottomSheetContext?.closeBottomSheet()}
                          onEdit={(s) => router.push(`/search/${encodeURIComponent(s.query)}`)}
                          onToggleNotifications={(s) =>
                            toggleSavedSearchNotifications(s.id, !s.notificationsEnabled)
                          }
                          onDelete={(s) => deleteSavedSearchHook(s.id, s.name)}
                        />,
                      )
                    }
                  >
                    <IconComponent name="ellipsis-vertical" size={18} color={colors.primaryColor} />
                  </TouchableOpacity>
                }
              />
            )}
            contentContainerStyle={StyleSheet.flatten([
              styles.listContent,
              (savedSearches as any).length === 0 && styles.emptyListContent,
            ])}
            ListEmptyComponent={renderEmptyState}
            refreshControl={
              <RefreshControl
                refreshing={savedLoading || foldersLoading}
                onRefresh={handleRefresh}
                colors={[colors.primaryColor]}
                tintColor={colors.primaryColor}
              />
            }
            removeClippedSubviews
            windowSize={7}
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            updateCellsBatchingPeriod={50}
          />
        ) : (
          <FlatList
            data={filteredProperties}
            renderItem={renderPropertyItem}
            keyExtractor={keyExtractor}
            getItemLayout={viewMode === 'grid' ? getItemLayout : undefined}
            contentContainerStyle={StyleSheet.flatten([
              styles.listContent,
              filteredProperties.length === 0 && styles.emptyListContent,
            ])}
            showsVerticalScrollIndicator={false}
            numColumns={viewMode === 'grid' ? 2 : 1}
            key={viewMode}
            columnWrapperStyle={viewMode === 'grid' ? styles.gridRow : undefined}
            ItemSeparatorComponent={
              viewMode === 'grid' ? undefined : () => <View style={{ height: LIST_GAP }} />
            }
            ListEmptyComponent={renderEmptyState}
            refreshControl={
              <RefreshControl
                refreshing={savedLoading || foldersLoading}
                onRefresh={handleRefresh}
                colors={[colors.primaryColor]}
                tintColor={colors.primaryColor}
              />
            }
            removeClippedSubviews
            windowSize={9}
            initialNumToRender={8}
            maxToRenderPerBatch={8}
            updateCellsBatchingPeriod={50}
          />
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  headerButton: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
  },
  listContent: {
    padding: 16,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  searchWrapper: {
    padding: 16,
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
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eaeaea',
    ...(Platform.OS === 'web' ? {
      position: 'sticky' as any,
      top: 50,
      backgroundColor: 'white',
      zIndex: 1000,
    } : {}),
  },
  tabsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 4,
  },
  tabsScroll: {
    // keep sticky container styles on wrapper; content styles in contentContainerStyle
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
    backgroundColor: 'white',
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginHorizontal: 12,
    borderWidth: 1,
    borderColor: '#eaeaea',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
    minWidth: '100%',
  },
  leftControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  rightControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
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
  iconPill: {
    backgroundColor: 'white',
    borderRadius: 100,
    padding: 6,
    borderWidth: 1,
    borderColor: '#eaeaea',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  iconPillActive: {
    backgroundColor: colors.primaryColor,
    borderColor: colors.primaryColor,
  },
  segmented: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 100,
    borderWidth: 1,
    borderColor: '#eaeaea',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  segmentActive: {
    backgroundColor: colors.primaryColor,
  },
  segmentText: {
    fontSize: 13,
    color: colors.primaryColor,
    fontWeight: '600',
  },
  segmentTextActive: {
    color: 'white',
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

  // Web-only tab scroll arrows
  scrollArrow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: 6,
    zIndex: 1100,
    ...Platform.select({
      web: {
        display: 'flex',
      },
      default: {
        display: 'none' as any,
      },
    }),
  },
  scrollArrowLeft: {
    left: 0,
  },
  scrollArrowRight: {
    right: 0,
  },
  scrollArrowDisabled: {
    opacity: 0.4,
  },
  scrollArrowCircle: {
    backgroundColor: 'white',
    borderRadius: 999,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#eaeaea',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 2,
  },

  // Bulk Actions
  bulkActionsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 100,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#eaeaea',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  bulkLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bulkRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bulkActionsText: {
    color: colors.COLOR_BLACK,
    fontWeight: '600',
    fontSize: 14,
  },
  bulkIconBtn: {
    backgroundColor: '#fff',
    borderRadius: 100,
    padding: 6,
    borderWidth: 1,
    borderColor: '#eaeaea',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 2,
    elevation: 2,
  },

  // Property Cards
  propertyCardWrapper: {},
  gridItemContainer: {
    flex: 1,
  },
  gridRow: {
    justifyContent: 'space-between',
    gap: 16,
  },
  propertyCard: {},
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
