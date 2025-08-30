import React, { useState, useRef, useEffect, useCallback, useMemo, useContext } from 'react';
import {
  View, StyleSheet,
  Platform,
  TextInput,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import Map, { MapApi } from '@/components/Map';
import { PropertyListBottomSheet } from '@/components/PropertyListBottomSheet';
import { Property } from '@homiio/shared-types';
import { propertyService } from '@/services/propertyService';
import { useMapState } from '@/context/MapStateContext';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { SaveSearchBottomSheet } from '@/components/SaveSearchBottomSheet';
import { SearchFiltersBottomSheet } from '@/components/SearchFiltersBottomSheet';
import { useSavedSearches } from '@/hooks/useSavedSearches';
import * as Location from 'expo-location';
import { useSearchMode } from '@/context/SearchModeContext';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  interpolate,
  Extrapolate
} from 'react-native-reanimated';

// Small helper to apply platform-appropriate shadows (uses boxShadow on web)
const _shadow = (level: 'sm' | 'md' = 'md') => Platform.select({
  web: {
    boxShadow: level === 'md'
      ? '0 2px 4px rgba(0,0,0,0.1)'
      : '0 1px 3px rgba(0,0,0,0.08)',
  },
  default: level === 'md'
    ? {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 3,
    }
    : {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 3,
      elevation: 2,
    },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8f9fa',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  // Google Maps-style search bar
  searchBarContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    left: 16,
    right: 16,
    zIndex: 1000,
  },
  searchBar: {
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    ..._shadow('md'),
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  searchIcon: {
    marginRight: 12,
    color: '#666',
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#333',
    paddingVertical: 4,
  },
  searchClearButton: {
    padding: 4,
  },
  searchResultsContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 120 : 100,
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 12,
    maxHeight: 300,
    zIndex: 999,
    ..._shadow('md'),
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  searchResultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  searchResultIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f8f9fa',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  searchResultText: {
    flex: 1,
  },
  searchResultTitle: {
    fontSize: 16,
    color: '#333',
    fontWeight: '500',
    marginBottom: 2,
  },
  searchResultSubtitle: {
    fontSize: 14,
    color: '#666',
  },
  // Animated search bar container
  animatedSearchBarContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 1000,
  },
});

interface SearchResult {
  id: string; place_name: string; center: [number, number]; text: string;
  context?: { text: string }[]; bbox?: [number, number, number, number];
  place_type?: string[];
}

interface Filters {
  minPrice: number;
  maxPrice: number;
  bedrooms: number | string;
  bathrooms: number | string;
  type?: string;
  amenities?: string[];
}

const defaultFilters: Filters = {
  minPrice: 0,
  maxPrice: 5000,
  bedrooms: 1,
  bathrooms: 1,
  type: undefined,
  amenities: [],
};

export default function SearchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const { getMapState, setMapState } = useMapState();
  const { isAuthenticated } = useSavedSearches();
  const bottomSheet = useContext(BottomSheetContext);
  const screenId = 'search-screen';

  // Bottom sheet state
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ['25%', '50%', '90%'], []);

  // Animated values for bottom sheet padding transition
  const animatedIndex = useSharedValue(0);
  const searchBarHeight = 80; // Height of search bar + padding

  // Restore saved state on mount
  const savedState = getMapState(screenId);

  // Get search query from URL params
  const urlQuery = params.query as string;

  const mapRef = useRef<MapApi>(null);
  const [searchQuery, setSearchQuery] = useState(urlQuery || savedState?.searchQuery || '');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);

  // Simple search query setter
  const setSearchQuerySafely = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);
  const { setIsMapMode } = useSearchMode();

  // Set to map mode since we're always showing the map now
  React.useEffect(() => {
    setIsMapMode(true);
  }, [setIsMapMode]);
  const [filters, setFilters] = useState<Filters>({
    minPrice: savedState?.filters?.minPrice || defaultFilters.minPrice,
    maxPrice: savedState?.filters?.maxPrice || defaultFilters.maxPrice,
    bedrooms: savedState?.filters?.bedrooms || defaultFilters.bedrooms,
    bathrooms: savedState?.filters?.bathrooms || defaultFilters.bathrooms,
    type: (savedState?.filters as any)?.type || defaultFilters.type,
    amenities: (savedState?.filters as any)?.amenities || defaultFilters.amenities,
  });
  const [properties, setProperties] = useState<Property[]>([]);
  const [isLoadingProperties, setIsLoadingProperties] = useState(false);
  const [highlightedPropertyId, setHighlightedPropertyId] = useState<string | null>(savedState?.highlightedMarkerId || null);
  const regionChangeDebounce = useRef<NodeJS.Timeout | null>(null);
  const lastSelectedLocationRef = useRef<string>('');

  // Memoize markers to prevent unnecessary re-renders
  const mapMarkers = useMemo(() => {
    if (!properties || properties.length === 0) {
      return [];
    }

    const validProperties = properties.filter(p => {
      // Check both new structure (address.coordinates) and old structure (location)
      const hasNewCoordinates = p?.address?.coordinates?.coordinates?.length === 2;
      const hasOldCoordinates = p?.location?.coordinates?.length === 2;
      return hasNewCoordinates || hasOldCoordinates;
    });

    const markers = validProperties.map(p => {
      // Use new structure if available, otherwise fall back to old structure
      const coordinates = p.address?.coordinates?.coordinates || p.location?.coordinates;

      // Ensure coordinates are valid numbers
      if (!coordinates || coordinates.length !== 2 ||
        typeof coordinates[0] !== 'number' || typeof coordinates[1] !== 'number') {
        return null;
      }

      return {
        id: p._id,
        coordinates: coordinates as [number, number],
        priceLabel: `€${p.rent?.amount?.toLocaleString() || 0}`,
      };
    }).filter((marker): marker is { id: string; coordinates: [number, number]; priceLabel: string } => marker !== null); // Remove any null markers

    return markers;
  }, [properties]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    // Don't search if the query matches the last selected location
    if (searchQuery === lastSelectedLocationRef.current) {
      return;
    }

    const searchPlaces = async () => {
      setIsSearching(true);

      // Check if Mapbox token is available
      const mapboxToken = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
      if (!mapboxToken) {
        setIsSearching(false);
        return;
      }

      try {
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?access_token=${mapboxToken}`;
        const response = await fetch(url);
        const data = await response.json();
        if (data.features) {
          setSearchResults(data.features);
          setShowResults(true);
        } else {
          setSearchResults([]);
          setShowResults(false);
        }
      } catch {
        setSearchResults([]);
        setShowResults(false);
      }
      finally {
        setIsSearching(false);
      }
    };

    const timeoutId = setTimeout(searchPlaces, 300); // Increased debounce to 300ms
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const fetchProperties = useCallback(async (bounds: { west: number; south: number; east: number; north: number }) => {
    setIsLoadingProperties(true);
    setHighlightedPropertyId(null);
    try {
      const response = await propertyService.findPropertiesInBounds(bounds, {
        minRent: filters.minPrice,
        maxRent: filters.maxPrice,
        bedrooms: typeof filters.bedrooms === 'string' ? 5 : filters.bedrooms,
        bathrooms: typeof filters.bathrooms === 'string' ? 4 : filters.bathrooms,
        type: filters.type,
        amenities: filters.amenities,
      });

      // Only update properties if they've actually changed
      setProperties(prevProperties => {
        const newProperties = response.properties;

        // Check if properties have actually changed
        if (prevProperties.length !== newProperties.length) {
          return newProperties;
        }

        // Deep comparison to check if properties have actually changed
        const hasChanged = newProperties.some((newProp, index) => {
          const prevProp = prevProperties[index];
          if (!prevProp || prevProp._id !== newProp._id || prevProp.rent?.amount !== newProp.rent?.amount) {
            return true;
          }

          // Compare coordinates from both structures
          const prevNewCoords = JSON.stringify(prevProp.address?.coordinates?.coordinates);
          const newNewCoords = JSON.stringify(newProp.address?.coordinates?.coordinates);
          const prevOldCoords = JSON.stringify(prevProp.location?.coordinates);
          const newOldCoords = JSON.stringify(newProp.location?.coordinates);

          return prevNewCoords !== newNewCoords || prevOldCoords !== newOldCoords;
        });

        return hasChanged ? newProperties : prevProperties;
      });
    } catch {
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

    // Clear search results and hide results immediately
    setSearchResults([]);
    setShowResults(false);

    // Set the search query to the selected location name
    setSearchQuery(result.place_name);
    lastSelectedLocationRef.current = result.place_name;

    // Navigate map and fetch properties immediately
    mapRef.current?.navigateToLocation(result.center, 14);
    const radius = 0.05;
    const bounds = result.bbox ? { west: result.bbox[0], south: result.bbox[1], east: result.bbox[2], north: result.bbox[3] }
      : { west: lng - radius, south: lat - radius, east: lng + radius, north: lat + radius };
    fetchProperties(bounds);
  };

  const handleMarkerPress = ({ id }: { id: string; lngLat: [number, number] }) => {
    const index = properties.findIndex(p => p._id === id);
    if (index !== -1) {
      setHighlightedPropertyId(id);

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

  const onViewableItemsChanged = useMemo(() => {
    return (viewableItems: { item: Property }[]) => {
      if (viewableItems.length > 0) {
        const visibleId = viewableItems[0].item._id;
        setHighlightedPropertyId(visibleId);
      }
    };
  }, []);

  const handlePropertyPress = useCallback((property: Property) => {
    router.push(`/properties/${property._id}`);
  }, [router]);

  const _handleResetMap = useCallback(() => {
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

  const handleRefreshLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
        timeInterval: 10000,
        distanceInterval: 10,
      });

      const coordinates: [number, number] = [location.coords.longitude, location.coords.latitude];

      // Navigate to the new location
      mapRef.current?.navigateToLocation(coordinates, 14);

      // Clear saved state to force fresh location
      setMapState(screenId, {
        center: coordinates,
        zoom: 14,
        bounds: undefined,
      });

    } catch {
      // Handle location error silently
    }
  }, [mapRef, setMapState, screenId]);

  // Initial fetch of properties when component mounts
  useEffect(() => {
    // Only fetch if we don't have properties and no saved state
    if (properties.length === 0 && !savedState) {
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

  // Handle URL query changes
  useEffect(() => {
    if (urlQuery && urlQuery !== searchQuery) {
      setSearchQuery(urlQuery);
      setShowResults(true);
    }
  }, [urlQuery, searchQuery]);

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
          return { ...prev, type: value };
        case 'bedrooms':
          return { ...prev, bedrooms: parseInt(value) };
        case 'bathrooms':
          return { ...prev, bathrooms: parseInt(value) };
        case 'amenities':
          // Handle amenities filter - toggle the amenity in the array
          const currentAmenities = prev.amenities || [];
          const amenityValue = value as string;
          const newAmenities = currentAmenities.includes(amenityValue)
            ? currentAmenities.filter(a => a !== amenityValue)
            : [...currentAmenities, amenityValue];
          return { ...prev, amenities: newAmenities };
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

  // Animated style for bottom sheet top padding
  const animatedBottomSheetPaddingStyle = useAnimatedStyle(() => {
    const paddingTop = interpolate(
      animatedIndex.value,
      [0, 1, 2], // snap points indices
      [0, searchBarHeight * 0.3, searchBarHeight], // padding values
      Extrapolate.CLAMP
    );

    return {
      paddingTop,
    };
  });

  // Animated style for bottom sheet handle opacity
  const animatedHandleStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      animatedIndex.value,
      [0, 1, 2], // snap points indices
      [1, 0.3, 0], // opacity values - hide when at top
      Extrapolate.CLAMP
    );

    console.log('Animated opacity:', opacity, 'for index:', animatedIndex.value);

    return {
      opacity,
    };
  }, []);

  // Custom handle component with animated opacity
  const CustomHandle = useCallback(() => {
    return (
      <Animated.View style={[{
        width: 40,
        height: 4,
        backgroundColor: '#000',
        borderRadius: 2,
        alignSelf: 'center',
        marginTop: 8,
        marginBottom: 8,
      }, animatedHandleStyle]} />
    );
  }, [animatedHandleStyle]);

  // Render search result item
  const renderSearchResult = useCallback((result: SearchResult) => {
    const getIcon = () => {
      const placeTypes = result.place_type || [];
      if (placeTypes.includes('place') || placeTypes.includes('city')) {
        return 'business';
      } else if (placeTypes.includes('neighborhood') || placeTypes.includes('locality')) {
        return 'location';
      } else if (placeTypes.includes('address') || placeTypes.includes('street')) {
        return 'map';
      } else if (placeTypes.includes('poi')) {
        return 'home';
      }
      return 'location-outline';
    };

    return (
      <TouchableOpacity
        key={result.id}
        style={styles.searchResultItem}
        onPress={() => handleSelectLocation(result)}
        activeOpacity={0.7}
      >
        <View style={styles.searchResultIcon}>
          <Ionicons name={getIcon()} size={20} color={colors.primaryColor} />
        </View>
        <View style={styles.searchResultText}>
          <ThemedText style={styles.searchResultTitle}>{result.text}</ThemedText>
          <ThemedText style={styles.searchResultSubtitle}>
            {result.place_name.replace(`${result.text}, `, '')}
          </ThemedText>
        </View>
        <Ionicons name="chevron-forward" size={16} color="#ccc" />
      </TouchableOpacity>
    );
  }, [handleSelectLocation]);

  return (
    <View style={styles.container}>
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

      {/* Google Maps-style Search Bar */}
      <View style={styles.searchBarContainer}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search cities, neighborhoods, streets, or addresses..."
            value={searchQuery}
            onChangeText={setSearchQuerySafely}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
          {isSearching && (
            <View style={{ width: 20, height: 20, justifyContent: 'center', alignItems: 'center' }}>
              <View style={{ width: 16, height: 16, borderWidth: 2, borderColor: '#666', borderTopColor: 'transparent', borderRadius: 8 }} />
            </View>
          )}
        </View>
      </View>

      {/* Search Results Dropdown */}
      {showResults && searchResults.length > 0 && (
        <View style={styles.searchResultsContainer}>
          <ScrollView showsVerticalScrollIndicator={false}>
            {searchResults.map(renderSearchResult)}
          </ScrollView>
        </View>
      )}

      {/* Property List Bottom Sheet */}
      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        enablePanDownToClose={false}
        enableOverDrag={false}
        backgroundStyle={{ backgroundColor: '#fff' }}
        style={{ minHeight: 200 }}
        animatedIndex={animatedIndex}
        onAnimate={(fromIndex, toIndex) => {
          // Update animated index for handle opacity
          animatedIndex.value = toIndex;
          console.log('Bottom sheet index:', toIndex, 'Opacity should be:', toIndex === 2 ? 0 : toIndex === 1 ? 0.3 : 1);
        }}
        handleComponent={CustomHandle}
      >
        <BottomSheetView style={{ flex: 1 }}>
          <Animated.View style={[{ flex: 1 }, animatedBottomSheetPaddingStyle]}>
            <PropertyListBottomSheet
              properties={properties}
              highlightedPropertyId={highlightedPropertyId}
              onPropertyPress={handlePropertyPress}
              isLoading={isLoadingProperties}
              onViewableItemsChanged={onViewableItemsChanged}
              _mapBounds={savedState?.bounds || null}
              totalCount={undefined} // We can add this later if backend returns total count
              onOpenFilters={handleOpenFilters}
              onSaveSearch={handleOpenSaveModal}
              onRefreshLocation={handleRefreshLocation}
            />
          </Animated.View>
        </BottomSheetView>
      </BottomSheet>
    </View>
  );
}