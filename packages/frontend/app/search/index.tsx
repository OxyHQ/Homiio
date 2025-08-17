import React, { useState, useRef, useEffect, useCallback, useMemo, useContext } from 'react';
import {
  View, StyleSheet, Dimensions, TextInput, TouchableOpacity,
  Platform, ActivityIndicator, ScrollView, FlatList, TouchableWithoutFeedback,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Map, { MapApi } from '@/components/Map';
import { PropertyCard } from '@/components/PropertyCard';
import { ThemedText } from '@/components/ThemedText';
import { Property } from '@homiio/shared-types';
import { propertyService } from '@/services/propertyService';
import { useMapState } from '@/context/MapStateContext';
import { colors } from '@/styles/colors';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { SaveSearchBottomSheet } from '@/components/SaveSearchBottomSheet';
import { SearchFiltersBottomSheet } from '@/components/SearchFiltersBottomSheet';
import { useSavedSearches } from '@/hooks/useSavedSearches';
import { useTranslation } from 'react-i18next';
import * as Location from 'expo-location';
import { useSearchMode } from '@/context/SearchModeContext';

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  searchContainerAbsolute: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 16 : 48,
    left: 16,
    right: 16,
    zIndex: 10,
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },
  searchContainerRelative: {
    padding: 16,
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },
  filtersToolbarContainer: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 120 : 152,
    left: 16,
    right: 16,
    zIndex: 10,
    maxWidth: 600,
    alignSelf: 'center',
  },
  filtersToolbar: {
    backgroundColor: 'white',
    borderRadius: 12,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
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
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'web' ? 8 : 4,
    flex: 1,
    marginRight: 8,
    position: 'relative',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: Platform.select({
    web: {
      flex: 1, fontSize: 16, color: '#333', paddingVertical: 8, borderWidth: 0, outline: 'none',
    },
    default: {
      flex: 1, fontSize: 16, color: '#333', paddingVertical: 8,
    },
  }),
  clearButton: {
    padding: 4,
  },
  searchResults: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginTop: 8,
    maxHeight: 300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    zIndex: 1000,
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
  },
  searchResultItem: {
    flexDirection: 'row', alignItems: 'center', padding: 12,
    borderBottomWidth: 1, borderBottomColor: '#f0f0f0',
  },
  locationIcon: {
    marginRight: 12,
  },
  searchResultText: {
    flex: 1,
  },
  primaryText: {
    fontSize: 16, color: '#333', marginBottom: 2,
  },
  secondaryText: {
    fontSize: 14, color: '#666',
  },


  listContainer: {
    flex: 1, padding: 16,
  },
  noResults: {
    textAlign: 'center', fontSize: 16, color: '#666', marginTop: 32,
  },
  propertyCarouselContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingVertical: 16,
    zIndex: 10,
  },
  carouselList: {
    paddingHorizontal: 16,
  },
  cardWrapper: {
    width: Dimensions.get('window').width * 0.85,
    marginRight: 12,
    maxWidth: 400,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },

  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    position: 'relative',
  },
  saveButton: {
    backgroundColor: colors.primaryLight,
    borderRadius: 35,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchHeaderContainer: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 16 : 48,
    left: 16,
    right: 16,
    zIndex: 10,
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  filterButton: {
    backgroundColor: colors.primaryLight,
    borderRadius: 35,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleButton: {
    backgroundColor: colors.primaryLight,
    borderRadius: 35,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

interface SearchResult {
  id: string; place_name: string; center: [number, number]; text: string;
  context?: { text: string }[]; bbox?: [number, number, number, number];
}

interface Filters {
  minPrice: number; maxPrice: number; bedrooms: number | string; bathrooms: number | string;
}

const defaultFilters: Filters = {
  minPrice: 0, maxPrice: 5000, bedrooms: 1, bathrooms: 1,
};




export default function SearchScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { getMapState, setMapState } = useMapState();
  const { saveSearch, isAuthenticated } = useSavedSearches();
  const bottomSheet = useContext(BottomSheetContext);
  const screenId = 'search-screen';

  // Restore saved state on mount
  const savedState = getMapState(screenId);

  const mapRef = useRef<MapApi>(null);
  const flatListRef = useRef<FlatList>(null);
  const [searchQuery, setSearchQuery] = useState(savedState?.searchQuery || '');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const { isMapMode, setIsMapMode } = useSearchMode();
  const [showMap, setShowMap] = useState(true);

  // Sync local showMap state with context isMapMode
  React.useEffect(() => {
    setIsMapMode(showMap);
  }, [showMap, setIsMapMode]);
  const [filters, setFilters] = useState<Filters>({
    minPrice: savedState?.filters?.minPrice || defaultFilters.minPrice,
    maxPrice: savedState?.filters?.maxPrice || defaultFilters.maxPrice,
    bedrooms: savedState?.filters?.bedrooms || defaultFilters.bedrooms,
    bathrooms: savedState?.filters?.bathrooms || defaultFilters.bathrooms,
  });
  const [properties, setProperties] = useState<Property[]>([]);
  const [isLoadingProperties, setIsLoadingProperties] = useState(false);
  const [highlightedPropertyId, setHighlightedPropertyId] = useState<string | null>(savedState?.highlightedMarkerId || null);
  const regionChangeDebounce = useRef<NodeJS.Timeout | null>(null);
  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  // Memoize markers to prevent unnecessary re-renders
  const mapMarkers = useMemo(() => {
    console.log('mapMarkers memo - properties length:', properties?.length);
    if (!properties || properties.length === 0) {
      console.log('No properties, returning empty markers');
      return [];
    }

    const validProperties = properties.filter(p => p?.location?.coordinates?.length === 2);
    console.log('Valid properties with coordinates:', validProperties.length);

    if (validProperties.length === 0 && properties.length > 0) {
      console.log('No valid properties found. Sample property location:', properties[0]?.location);
      console.log('Sample property coordinates:', properties[0]?.location?.coordinates);
    }

    const markers = validProperties.map(p => ({
      id: p._id,
      coordinates: p.location!.coordinates as [number, number],
      priceLabel: `€${p.rent?.amount?.toLocaleString() || 0}`,
    }));

    console.log('Generated markers:', markers.length, markers.slice(0, 2));
    return markers;
  }, [properties]);

  useEffect(() => {
    console.log('Search query changed:', searchQuery);
    if (!searchQuery.trim()) {
      console.log('Empty search query, clearing results');
      setSearchResults([]);
      setShowResults(false);
      return;
    }
    const searchPlaces = async () => {
      console.log('Starting search for:', searchQuery);
      setIsSearching(true);

      // Check if Mapbox token is available
      const mapboxToken = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
      if (!mapboxToken) {
        console.error('Mapbox token not found. Please check EXPO_PUBLIC_MAPBOX_TOKEN environment variable.');
        setIsSearching(false);
        return;
      }

      try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?access_token=${mapboxToken}`;
        console.log('Search URL:', url);
        const response = await fetch(url);
        const data = await response.json();
        console.log('Search response:', data);
        if (data.features) {
          console.log('Found features:', data.features.length);
          setSearchResults(data.features);
          setShowResults(true);
        } else {
          console.log('No features found in response');
          setSearchResults([]);
          setShowResults(false);
        }
      } catch (error) {
        console.error('Geocoding error:', error);
        setSearchResults([]);
        setShowResults(false);
      }
      finally {
        setIsSearching(false);
      }
    };
    const timeoutId = setTimeout(searchPlaces, 100);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const fetchProperties = useCallback(async (bounds: { west: number; south: number; east: number; north: number }) => {
    console.log('fetchProperties called with bounds:', bounds);
    setIsLoadingProperties(true);
    setHighlightedPropertyId(null);
    try {
      const response = await propertyService.findPropertiesInBounds(bounds, {
        minRent: filters.minPrice, maxRent: filters.maxPrice,
        bedrooms: typeof filters.bedrooms === 'string' ? 5 : filters.bedrooms,
        bathrooms: typeof filters.bathrooms === 'string' ? 4 : filters.bathrooms,
      });

      console.log('API response:', response);
      console.log('API response properties:', response.properties.length, 'properties');
      if (response.properties.length > 0) {
        console.log('First property sample:', response.properties[0]);
        console.log('First property location:', response.properties[0].location);
        console.log('First property coordinates:', response.properties[0].location?.coordinates);
      }

      // Only update properties if they've actually changed
      setProperties(prevProperties => {
        const newProperties = response.properties;

        // Check if properties have actually changed
        if (prevProperties.length !== newProperties.length) {
          console.log('Properties count changed, updating');
          return newProperties;
        }

        // Deep comparison to check if properties have actually changed
        const hasChanged = newProperties.some((newProp, index) => {
          const prevProp = prevProperties[index];
          return !prevProp ||
            prevProp._id !== newProp._id ||
            prevProp.rent?.amount !== newProp.rent?.amount ||
            JSON.stringify(prevProp.location?.coordinates) !== JSON.stringify(newProp.location?.coordinates);
        });

        if (hasChanged) {
          console.log('Properties content changed, updating');
        }
        return hasChanged ? newProperties : prevProperties;
      });
    } catch (error) {
      console.error('Error fetching properties:', error);
      setProperties([]);
    } finally {
      setIsLoadingProperties(false);
    }
  }, [filters]);

  useEffect(() => {
    mapRef.current?.highlightMarker(highlightedPropertyId);
  }, [highlightedPropertyId]);

  const handleSelectLocation = (result: SearchResult) => {
    const [lng, lat] = result.center;
    setSearchQuery(result.place_name);
    setShowResults(false);
    mapRef.current?.navigateToLocation(result.center, 14);
    const radius = 0.05;
    const bounds = result.bbox ? { west: result.bbox[0], south: result.bbox[1], east: result.bbox[2], north: result.bbox[3] }
      : { west: lng - radius, south: lat - radius, east: lng + radius, north: lat + radius };
    fetchProperties(bounds);

    // Save search query to state
    setMapState(screenId, { searchQuery: result.place_name });
  };

  const handleMarkerPress = ({ id }: { id: string; lngLat: [number, number] }) => {
    const index = properties.findIndex(p => p._id === id);
    if (index !== -1) {
      setHighlightedPropertyId(id);
      flatListRef.current?.scrollToIndex({ animated: true, index });

      // Save highlighted marker to state
      setMapState(screenId, { highlightedMarkerId: id });
    }
  };

  const handleRegionChange = useCallback(({ bounds }: { bounds: { west: number; south: number; east: number; north: number } }) => {
    if (regionChangeDebounce.current) clearTimeout(regionChangeDebounce.current);
    if (!bounds) return;

    // Increase debounce time to reduce API calls and prevent map reloading
    regionChangeDebounce.current = setTimeout(() => {
      // Only fetch if bounds have changed significantly (to prevent unnecessary API calls)
      const currentBounds = savedState?.bounds;
      if (currentBounds) {
        const boundsChanged = Math.abs(currentBounds.west - bounds.west) > 0.02 ||
          Math.abs(currentBounds.south - bounds.south) > 0.02 ||
          Math.abs(currentBounds.east - bounds.east) > 0.02 ||
          Math.abs(currentBounds.north - bounds.north) > 0.02;

        if (!boundsChanged) {
          return; // Skip API call if bounds haven't changed significantly
        }
      }

      fetchProperties(bounds);
    }, 500); // Increased to 500ms to reduce frequency
  }, [fetchProperties, savedState?.bounds]);

  const onViewableItemsChanged = useCallback(({ viewableItems }: { viewableItems: { item: Property }[] }) => {
    if (viewableItems.length > 0) {
      const visibleId = viewableItems[0].item._id;
      setHighlightedPropertyId(visibleId);
    }
  }, []);

  const handlePropertyPress = useCallback((property: Property) => {
    router.push(`/properties/${property._id}`);
  }, [router]);

  const handleResetMap = useCallback(() => {
    // Clear saved map state and reset to current location
    setMapState(screenId, {
      center: undefined,
      zoom: undefined,
      bounds: undefined,
      markers: undefined,
      highlightedMarkerId: undefined,
      searchQuery: '',
      filters: undefined,
    });
    // Force reload by updating a state
    setSearchQuery('');
  }, [setMapState, screenId]);

  const handleClickOutside = useCallback(() => {
    if (showResults) {
      console.log('Clicking outside search area, hiding results');
      setShowResults(false);
    }
  }, [showResults]);

  const handleRefreshLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.log('Location permission denied');
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        timeInterval: 10000,
        distanceInterval: 10,
      });

      const coordinates: [number, number] = [location.coords.longitude, location.coords.latitude];
      console.log('Refreshed location:', coordinates, 'accuracy:', location.coords.accuracy);

      // Navigate to the new location
      mapRef.current?.navigateToLocation(coordinates, 14);

      // Clear saved state to force fresh location
      setMapState(screenId, {
        center: coordinates,
        zoom: 14,
        bounds: undefined,
      });

    } catch (error) {
      console.warn('Failed to refresh location:', error);
    }
  }, [mapRef, setMapState, screenId]);

  // Initial fetch of properties when component mounts
  useEffect(() => {
    console.log('Initial fetch effect - properties length:', properties.length, 'savedState:', !!savedState);
    // Only fetch if we don't have properties and no saved state
    if (properties.length === 0 && !savedState) {
      console.log('Fetching initial properties for Barcelona area');
      // Fetch properties for a default area (Barcelona)
      const defaultBounds = {
        west: 2.0,
        south: 41.3,
        east: 2.3,
        north: 41.5,
      };
      fetchProperties(defaultBounds);
    }
  }, [properties.length, savedState, fetchProperties]);



  useEffect(() => {
    return () => {
      if (regionChangeDebounce.current) clearTimeout(regionChangeDebounce.current);
    };
  }, []);

  // Clear map state after a delay when component unmounts (to allow for quick navigation back)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      // Only clear state if user hasn't navigated back within 5 minutes
      // This allows for quick back/forward navigation while clearing stale state
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearTimeout(timeoutId);
  }, []);

  const handleFilterChange = useCallback((sectionId: string, value: any) => {
    setFilters(prev => {
      switch (sectionId) {
        case 'price':
          if (Array.isArray(value)) {
            return {
              ...prev,
              minPrice: value[0],
              maxPrice: value[1]
            };
          }
          return prev;
        case 'type':
          // Handle property type filter
          return prev;
        case 'bedrooms':
          return { ...prev, bedrooms: parseInt(value) };
        case 'bathrooms':
          return { ...prev, bathrooms: parseInt(value) };
        case 'amenities':
          // Handle amenities filter
          return prev;
        default:
          return prev;
      }
    });
  }, []);

  const handleOpenFilters = useCallback(() => {
    bottomSheet.openBottomSheet(
      <SearchFiltersBottomSheet
        filters={filters}
        onFilterChange={handleFilterChange}
        onApply={bottomSheet.closeBottomSheet}
        onClear={() => {
          setFilters(defaultFilters);
          bottomSheet.closeBottomSheet();
        }}
      />
    );
  }, [bottomSheet, filters, handleFilterChange]);

  const handleOpenSaveModal = useCallback(() => {
    if (!isAuthenticated) {
      router.push('/profile');
      return;
    }
    const currentFilters = {
      ...filters
    };
    bottomSheet.openBottomSheet(
      <SaveSearchBottomSheet
        defaultName={searchQuery || 'My Search'}
        query={searchQuery}
        filters={currentFilters}
        onClose={() => bottomSheet.closeBottomSheet()}
        onSaved={() => {
          // Handle successful save
        }}
      />,
    );
  }, [isAuthenticated, router, bottomSheet, searchQuery, filters]);

  const renderSearchHeader = () => (
    <View style={styles.searchHeader}>
      <View style={styles.searchInputContainer}>
        <Ionicons name="search" size={20} color="#666" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search for a city, neighborhood, or address..."
          value={searchQuery}
          onChangeText={(text) => {
            console.log('Search input changed (header):', text);
            setSearchQuery(text);
          }}
          returnKeyType="search"
          onFocus={() => {
            console.log('Search input focused (header)');
            setShowResults(true);
          }}
        />
        {isSearching ? <ActivityIndicator size="small" color="#666" style={styles.searchIcon} />
          : searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton}>
              <Ionicons name="close-circle" size={20} color="#999" />
            </TouchableOpacity>
          )}
      </View>

      {/* Search Results for Header */}
      {showResults && searchResults.length > 0 && (
        <View style={[styles.searchResults, { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000 }]}>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 300 }}>
            {searchResults.map((result) => (
              <TouchableOpacity key={result.id} style={styles.searchResultItem} onPress={() => handleSelectLocation(result)} >
                <Ionicons name="location-outline" size={20} color="#666" style={styles.locationIcon} />
                <View style={styles.searchResultText}>
                  <ThemedText style={styles.primaryText}>{result.text}</ThemedText>
                  <ThemedText style={styles.secondaryText}>{result.place_name.replace(`${result.text}, `, '')}</ThemedText>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
      {showResults && searchResults.length === 0 && searchQuery.trim() && !isSearching && (
        <View style={[styles.searchResults, { position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000, padding: 12 }]}>
          <ThemedText style={styles.secondaryText}>No results found</ThemedText>
        </View>
      )}

      <View style={styles.headerButtons}>
        <TouchableOpacity
          style={styles.filterButton}
          onPress={handleOpenFilters}
          accessibilityLabel={t('More Filters')}
        >
          <Ionicons name="options-outline" size={20} color={colors.primaryColor} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.saveButton}
          onPress={handleOpenSaveModal}
          accessibilityLabel={t('Save Search')}
        >
          <Ionicons name="bookmark-outline" size={20} color={colors.primaryColor} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toggleButton}
          onPress={handleRefreshLocation}
          accessibilityLabel={t('Refresh Location')}
        >
          <Ionicons
            name="location"
            size={20}
            color={colors.primaryColor}
          />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.toggleButton}
          onPress={() => setShowMap(!showMap)}
        >
          <Ionicons
            name={showMap ? 'list-outline' : 'map-outline'}
            size={20}
            color={colors.primaryColor}
          />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderPropertyList = () => (
    <ScrollView style={styles.listContainer}>
      {isLoadingProperties ? <ActivityIndicator size="large" color="#666" style={{ marginTop: 32 }} />
        : !properties || properties.length === 0 ? <ThemedText style={styles.noResults}>No properties found.</ThemedText>
          : properties.map((property) => (
            <PropertyCard key={property._id} property={property}
              onPress={() => handlePropertyPress(property)}
              showFavoriteButton showVerifiedBadge style={{ marginBottom: 16 }} />
          ))}
    </ScrollView>
  );

  const renderSearchBar = (containerStyle: any) => (
    <View style={containerStyle}>
      {/* Debug info */}
      {__DEV__ && (
        <View style={{ padding: 4, backgroundColor: '#f0f0f0', marginBottom: 4 }}>
          <ThemedText style={{ fontSize: 10 }}>
            Debug: query="{searchQuery}", results={searchResults.length}, show={showResults.toString()}, searching={isSearching.toString()}
          </ThemedText>
        </View>
      )}
      <View style={styles.searchInputContainer}>
        <Ionicons name="search" size={20} color="#666" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search for a city, neighborhood, or address..."
          value={searchQuery}
          onChangeText={(text) => {
            console.log('Search input changed (bar):', text);
            setSearchQuery(text);
          }}
          returnKeyType="search"
          onFocus={() => {
            console.log('Search input focused (bar)');
            setShowResults(true);
          }}
        />
        {isSearching ? <ActivityIndicator size="small" color="#666" style={styles.searchIcon} />
          : searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton}>
              <Ionicons name="close-circle" size={20} color="#999" />
            </TouchableOpacity>
          )}
      </View>

      {showResults && searchResults.length > 0 && (
        <ScrollView style={styles.searchResults} keyboardShouldPersistTaps="handled">
          {searchResults.map((result) => (
            <TouchableOpacity key={result.id} style={styles.searchResultItem} onPress={() => handleSelectLocation(result)} >
              <Ionicons name="location-outline" size={20} color="#666" style={styles.locationIcon} />
              <View style={styles.searchResultText}>
                <ThemedText style={styles.primaryText}>{result.text}</ThemedText>
                <ThemedText style={styles.secondaryText}>{result.place_name.replace(`${result.text}, `, '')}</ThemedText>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
      {showResults && searchResults.length === 0 && searchQuery.trim() && !isSearching && (
        <View style={[styles.searchResults, { padding: 12 }]}>
          <ThemedText style={styles.secondaryText}>No results found</ThemedText>
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      {showMap ? (
        <>
          <Map
            key="search-map"
            ref={mapRef}
            style={styles.map}
            screenId={screenId}
            startFromCurrentLocation={!savedState} // Use current location if no saved state
            initialZoom={savedState?.zoom || 12}
            markers={mapMarkers}
            onRegionChange={handleRegionChange}
            onMarkerPress={handleMarkerPress}
          />

          {/* Search Header with Save Button */}
          <View style={styles.searchHeaderContainer}>
            {renderSearchHeader()}
          </View>

          {/* Backdrop for search results */}
          {showResults && (
            <TouchableWithoutFeedback onPress={handleClickOutside}>
              <View style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0,0,0,0.1)',
                zIndex: 999,
              }} />
            </TouchableWithoutFeedback>
          )}

          {properties.length > 0 && (
            <View style={styles.propertyCarouselContainer}>
              <FlatList
                ref={flatListRef}
                data={properties}
                keyExtractor={(item) => item._id}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.carouselList}
                onViewableItemsChanged={onViewableItemsChanged}
                viewabilityConfig={viewabilityConfig}
                getItemLayout={(data, index) => (
                  { length: Dimensions.get('window').width * 0.85 + 12, offset: (Dimensions.get('window').width * 0.85 + 12) * index, index }
                )}
                renderItem={({ item }) => (
                  <View style={styles.cardWrapper}>
                    <PropertyCard
                      property={item}
                      variant="compact"
                      orientation="horizontal"
                      onPress={() => handlePropertyPress(item)}
                      style={{
                        backgroundColor: '#fff',
                        borderRadius: 12,
                        overflow: 'hidden',
                        borderWidth: item._id === highlightedPropertyId ? 2 : 0,
                        borderColor: '#007AFF',
                        padding: 10,
                      }}
                    />
                  </View>
                )}
              />
            </View>
          )}
        </>
      ) : (
        <>
          {renderSearchHeader()}
          {renderPropertyList()}
        </>
      )}
    </View>
  );
}