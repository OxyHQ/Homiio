import React, { useState, useRef, useEffect, useCallback, useMemo, useContext } from 'react';
import {
  View, StyleSheet,
  Platform,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Dimensions,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MapView, { MapApi } from '@/components/Map';
import { PropertyListBottomSheet } from '@/components/PropertyListBottomSheet';
import { Property } from '@homiio/shared-types';
import { propertyService } from '@/services/propertyService';
import { useMapState } from '@/context/MapStateContext';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { SaveSearchBottomSheet } from '@/components/SaveSearchBottomSheet';
import { SearchFiltersBottomSheet } from '@/components/SearchFiltersBottomSheet';
import { useSavedSearches } from '@/hooks/useSavedSearches';
import { onApplySavedSearch } from '@/utils/searchEvents';
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
  Extrapolation
} from 'react-native-reanimated';
import { useQueryClient } from '@tanstack/react-query';
import { useMapSearchStore } from '@/store/mapSearchStore';

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

const { width: screenWidth } = Dimensions.get('window');

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
    maxWidth: 600,
    alignSelf: 'center',
    marginHorizontal: screenWidth >= 600 ? 32 : 0,
  },
  searchBar: {
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingHorizontal: 12,
    paddingVertical: 8,
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
  // Bottom sheet search styles
  bottomSheetSearchContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  bottomSheetSearchHeader: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  bottomSheetSearchTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  bottomSheetSearchSubtitle: {
    fontSize: 14,
    color: '#666',
  },
  bottomSheetSearchResults: {
    flex: 1,
  },
  bottomSheetNoResults: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
  },
  bottomSheetNoResultsText: {
    fontSize: 18,
    fontWeight: '500',
    color: '#333',
    marginTop: 16,
    marginBottom: 8,
    textAlign: 'center',
  },
  bottomSheetNoResultsSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    lineHeight: 20,
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
  const queryClient = useQueryClient();
  const { getMapState, setMapState } = useMapState();
  const { isAuthenticated } = useSavedSearches();
  const bottomSheet = useContext(BottomSheetContext);
  const screenId = 'search-screen';

  // Bottom sheet state
  const bottomSheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => {
    return ['25%', '30%', '100%'];
  }, []);

  // Animated values for bottom sheet padding transition
  const animatedIndex = useSharedValue(0);
  const searchBarHeight = 80; // Height of search bar + padding

  // Restore saved state on mount
  const savedState = getMapState(screenId);

  // Get search query from URL params
  const urlQuery = params.query as string;

  const mapRef = useRef<MapApi>(null);
  const searchInputRef = useRef<TextInput>(null);
  const [searchQuery, setSearchQuery] = useState(urlQuery || savedState?.searchQuery || '');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  // Memoize gesture enable states to prevent infinite loops
  const enableHandlePanning = useMemo(() => {
    console.log('Gesture state update - isSearchFocused:', isSearchFocused, 'enableHandlePanning:', !isSearchFocused);
    return !isSearchFocused;
  }, [isSearchFocused]);
  const enableContentPanning = useMemo(() => {
    console.log('Gesture state update - isSearchFocused:', isSearchFocused, 'enableContentPanning:', !isSearchFocused);
    return !isSearchFocused;
  }, [isSearchFocused]);

  // Simple search query setter
  const setSearchQuerySafely = useCallback((query: string) => {
    setSearchQuery(query);
  }, []);

  // Handle search focus/blur
  const handleSearchFocus = useCallback(() => {
    setIsSearchFocused(true);
    console.log('Search focused - attempting to reach 100% snap point');
    // Move bottom sheet to 100% when search is focused
    // Use snapToIndex(3) directly to ensure we reach 100%
    if (bottomSheetRef.current) {
      // Use a delay to ensure the bottom sheet is ready and try multiple approaches
      setTimeout(() => {
        if (bottomSheetRef.current) {
          // First try snapToIndex(3)
          bottomSheetRef.current.snapToIndex(3);
          console.log('snapToIndex(3) called - should reach 100%');

          // Also try expand() as backup
          setTimeout(() => {
            if (bottomSheetRef.current) {
              try {
                bottomSheetRef.current.expand();
                console.log('expand() called as backup');
              } catch (error) {
                console.log('expand() backup failed:', error);
              }
            }
          }, 200);
        }
      }, 100);
    } else {
      console.log('bottomSheetRef.current is null');
    }
  }, []);

  const handleSearchBlur = useCallback(() => {
    // Don't unfocus immediately - let the user interact with results
    // We'll handle unfocusing when they actually select a result
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
  // Global accumulated properties for the map session
  const accumulatedProperties = useMapSearchStore((s) => s.properties);
  const mergeMapProperties = useMapSearchStore((s) => s.mergeProperties);
  const [isLoadingProperties, setIsLoadingProperties] = useState(false);
  const [highlightedPropertyId, setHighlightedPropertyId] = useState<string | null>(savedState?.highlightedMarkerId || null);
  // Keep track of last fetch center to trigger updates by distance moved
  const lastFetchCenterRef = useRef<[number, number] | null>(savedState?.center || null);
  const lastFetchZoomRef = useRef<number | null>(savedState?.zoom ?? null);
  const MIN_MOVE_DISTANCE_METERS = 500; // Minimum distance user must move to refetch
  const MIN_ZOOM_DELTA = 0.8; // Minimum zoom change to refetch
  const lastSelectedLocationRef = useRef<string>('');
  const [currentBounds, setCurrentBounds] = useState<{ west: number; south: number; east: number; north: number } | null>(savedState?.bounds || null);

  // Memoize markers to prevent unnecessary re-renders
  const mapMarkers = useMemo(() => {
    if (!accumulatedProperties || accumulatedProperties.length === 0) {
      return [];
    }

    const validProperties = accumulatedProperties.filter(p => {
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
  }, [accumulatedProperties]);

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
      // Quantize bounds to reduce cache key churn and leverage caching
      const round = (n: number, d = 3) => Math.round(n * Math.pow(10, d)) / Math.pow(10, d);
      const qb = { west: round(bounds.west), south: round(bounds.south), east: round(bounds.east), north: round(bounds.north) };
      const key = ['propertiesInBounds', qb, {
        minRent: filters.minPrice,
        maxRent: filters.maxPrice,
        bedrooms: typeof filters.bedrooms === 'string' ? 5 : filters.bedrooms,
        bathrooms: typeof filters.bathrooms === 'string' ? 4 : filters.bathrooms,
        type: filters.type || null,
        amenities: (filters.amenities || []).slice().sort(),
      }];

      const response = await queryClient.ensureQueryData({
        queryKey: key,
        queryFn: async () => propertyService.findPropertiesInBounds(bounds, {
          minRent: filters.minPrice,
          maxRent: filters.maxPrice,
          bedrooms: typeof filters.bedrooms === 'string' ? 5 : filters.bedrooms,
          bathrooms: typeof filters.bathrooms === 'string' ? 4 : filters.bathrooms,
          type: filters.type,
          amenities: filters.amenities,
        }),
        staleTime: 1000 * 60, // 1 min fresh
        gcTime: 1000 * 60 * 10,
      });

      // Merge fetched properties into the global map store
      mergeMapProperties(response.properties || []);
    } catch {
      // Keep existing properties on fetch error
    } finally {
      setIsLoadingProperties(false);
    }
  }, [filters, queryClient, mergeMapProperties]);

  useEffect(() => {
    mapRef.current?.highlightMarker(highlightedPropertyId);
  }, [highlightedPropertyId]);

  const handleSelectLocation = useCallback((result: SearchResult) => {
    const [lng, lat] = result.center;

    // Clear search results and hide results immediately
    setSearchResults([]);
    setShowResults(false);

    // Set the search query to the selected location name
    setSearchQuery(result.place_name);
    lastSelectedLocationRef.current = result.place_name;

    // Unfocus search and move bottom sheet back to default position
    setIsSearchFocused(false);

    // Use a small delay to ensure state is updated before moving bottom sheet
    setTimeout(() => {
      if (Platform.OS === 'web') {
        bottomSheetRef.current?.collapse();
      } else {
        bottomSheetRef.current?.snapToIndex(0);
      }

      // Force a re-render to ensure gesture states are updated
      setTimeout(() => {
        if (bottomSheetRef.current) {
          // Force the bottom sheet to refresh its gesture states
          bottomSheetRef.current.snapToIndex(0);
        }
      }, 50);
    }, 100);

    // Navigate map and fetch properties immediately
    mapRef.current?.navigateToLocation(result.center, 14);
    // Update last fetch baseline to avoid duplicate fetch on region end
    lastFetchCenterRef.current = result.center as [number, number];
    lastFetchZoomRef.current = 14;
    const radius = 0.05;
    const bounds = result.bbox ? { west: result.bbox[0], south: result.bbox[1], east: result.bbox[2], north: result.bbox[3] }
      : { west: lng - radius, south: lat - radius, east: lng + radius, north: lat + radius };
    fetchProperties(bounds);
  }, [fetchProperties]);

  // Apply saved search without navigation (no map reload)
  useEffect(() => {
    const unsubscribe = onApplySavedSearch(async (saved) => {
      try {
        // Update text field and filters first
        setSearchQuery(saved.query || '');
        lastSelectedLocationRef.current = saved.query || '';
        setFilters((prev) => ({
          minPrice: (saved.filters?.minPrice ?? prev.minPrice) as number,
          maxPrice: (saved.filters?.maxPrice ?? prev.maxPrice) as number,
          bedrooms: (saved.filters?.bedrooms ?? prev.bedrooms) as any,
          bathrooms: (saved.filters?.bathrooms ?? prev.bathrooms) as any,
          type: (saved.filters as any)?.type ?? prev.type,
          amenities: (saved.filters as any)?.amenities ?? prev.amenities,
        }));

        // Geocode query and move map, then fetch properties
        const mapboxToken = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
        if (!mapboxToken || !saved.query) return;

        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(saved.query)}.json?access_token=${mapboxToken}`;
        const resp = await fetch(url);
        const data = await resp.json();
        const feature = data?.features?.[0];
        if (feature) {
          handleSelectLocation(feature);
        }
      } catch {
        // Silent fail; UI remains unchanged
      }
    });
    return unsubscribe;
  }, [handleSelectLocation]);

  const handleMarkerPress = ({ id }: { id: string; lngLat: [number, number] }) => {
    const index = accumulatedProperties.findIndex(p => p._id === id);
    if (index !== -1) {
      setHighlightedPropertyId(id);

      // Save highlighted marker to state
      setMapState(screenId, { highlightedMarkerId: id });
    }
  };

  const handleRegionChange = useCallback(({ center, bounds, zoom, isFinal }: { center: [number, number]; bounds: { west: number; south: number; east: number; north: number }; zoom: number; isFinal?: boolean }) => {
    if (!bounds || !center) return;
    // Always update current bounds for bottom sheet filtering
    setCurrentBounds(bounds);
    // Only react when the gesture ends to avoid rapid updates while panning
    if (!isFinal) return;

    // Haversine distance in meters between two [lng, lat] points
    const distanceMeters = (a: [number, number], b: [number, number]) => {
      const toRad = (x: number) => (x * Math.PI) / 180;
      const R = 6371000; // meters
      const dLat = toRad(b[1] - a[1]);
      const dLon = toRad(b[0] - a[0]);
      const lat1 = toRad(a[1]);
      const lat2 = toRad(b[1]);
      const sinDLat = Math.sin(dLat / 2);
      const sinDLon = Math.sin(dLon / 2);
      const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon;
      return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
    };

    // Compute viewport diagonal in meters and adapt threshold to zoom level
    const diagonalMeters = distanceMeters([bounds.west, bounds.north], [bounds.east, bounds.south]);
    const adaptiveThreshold = Math.max(MIN_MOVE_DISTANCE_METERS, diagonalMeters * 0.3); // 30% of viewport diagonal

    // If first time, fetch immediately and set baseline
    if (!lastFetchCenterRef.current || lastFetchZoomRef.current === null) {
      lastFetchCenterRef.current = center;
      lastFetchZoomRef.current = zoom;
      fetchProperties(bounds);
      return;
    }

    const moved = distanceMeters(lastFetchCenterRef.current, center);
    const zoomChanged = Math.abs((lastFetchZoomRef.current ?? zoom) - zoom);

    if (moved >= adaptiveThreshold || zoomChanged >= MIN_ZOOM_DELTA) {
      lastFetchCenterRef.current = center;
      lastFetchZoomRef.current = zoom;
      fetchProperties(bounds);
    }
  }, [fetchProperties]);

  const onViewableItemsChanged = useMemo(() => {
    return (viewableItems: { item: Property }[]) => {
      if (viewableItems.length > 0) {
        const visibleId = viewableItems[0].item._id;
        setHighlightedPropertyId(visibleId);
      }
    };
  }, []);

  // Only show properties visible on screen in the list
  const visibleProperties = useMemo(() => {
    if (!currentBounds) return accumulatedProperties;
    const within = (lng: number, lat: number) => (
      lng >= currentBounds.west && lng <= currentBounds.east &&
      lat >= currentBounds.south && lat <= currentBounds.north
    );
    return accumulatedProperties.filter(p => {
      const coords = (p.address?.coordinates?.coordinates || p.location?.coordinates) as [number, number] | undefined;
      if (!coords || coords.length !== 2) return false;
      const [lng, lat] = coords;
      return typeof lng === 'number' && typeof lat === 'number' && within(lng, lat);
    });
  }, [accumulatedProperties, currentBounds]);

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
      // Update last fetch baseline to avoid duplicate fetch on region end
      lastFetchCenterRef.current = coordinates;
      lastFetchZoomRef.current = 14;

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
    if (accumulatedProperties.length === 0 && !savedState) {
      // Fetch properties for a default area (Barcelona)
      const defaultBounds = {
        west: 2.0,
        south: 41.3,
        east: 2.3,
        north: 41.5,
      };
      fetchProperties(defaultBounds);
    }
  }, [accumulatedProperties.length, savedState, fetchProperties]);

  // Auto-focus search input when screen opens (only if coming from home screen)
  useEffect(() => {
    console.log('Search screen mounted - urlQuery:', urlQuery, 'params:', params);
    // Only auto-focus if coming from home screen (fromHome=true parameter)
    if (params.fromHome === 'true') {
      console.log('Auto-focusing search input and expanding bottom sheet');
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
        // Expand bottom sheet to 100% when coming from home screen search
        handleSearchFocus();
        // Re-enable gestures after a short delay to allow dragging
        setTimeout(() => {
          setIsSearchFocused(false);
        }, 500);
      }, 300);
      return () => clearTimeout(timer);
    } else {
      console.log('Not coming from home - not auto-focusing');
    }
  }, [handleSearchFocus, params, urlQuery]);

  // Handle URL query changes
  useEffect(() => {
    if (urlQuery && urlQuery !== searchQuery) {
      setSearchQuery(urlQuery);
      setShowResults(true);
    }
  }, [urlQuery, searchQuery]);

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
      [0, 0, searchBarHeight], // padding values
      Extrapolation.CLAMP
    );

    return {
      paddingTop,
    };
  });

  // Animated style for bottom sheet handle opacity
  const animatedHandleStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      animatedIndex.value,
      [0, 1, 2, 3], // snap points indices
      [1, 0.3, 0, 0], // opacity values - hide when at top
      Extrapolation.CLAMP
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
      <MapView
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

      <View style={styles.searchBarContainer}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} style={styles.searchIcon} />
          <TextInput
            ref={searchInputRef}
            style={styles.searchInput}
            placeholder="Search cities, neighborhoods, streets, or addresses..."
            value={searchQuery}
            onChangeText={setSearchQuerySafely}
            onFocus={handleSearchFocus}
            onBlur={handleSearchBlur}
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



      {/* Property List Bottom Sheet */}
      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        enablePanDownToClose={false}
        enableOverDrag={false}
        enableHandlePanningGesture={enableHandlePanning}
        enableContentPanningGesture={enableContentPanning}
        backgroundStyle={{ backgroundColor: '#fff', }}
        style={{
          minHeight: 200,
          maxWidth: 600,
          alignSelf: 'center',
          marginHorizontal: screenWidth >= 600 ? 32 : 0,
        }}
        animatedIndex={animatedIndex}
        onAnimate={(fromIndex, toIndex) => {
          // Update animated index for handle opacity
          animatedIndex.value = toIndex;
          console.log('Bottom sheet animation - from:', fromIndex, 'to:', toIndex, 'snapPoints:', snapPoints);
        }}
        handleComponent={CustomHandle}
      >
        <BottomSheetView style={{ flex: 1 }}>
          <Animated.View style={[{ flex: 1 }, animatedBottomSheetPaddingStyle]}>
            {isSearchFocused ? (
              // Show search results in bottom sheet when search is focused
              <View style={styles.bottomSheetSearchContainer}>
                <View style={styles.bottomSheetSearchHeader}>
                  <ThemedText style={styles.bottomSheetSearchTitle}>
                    Search Results
                  </ThemedText>
                  <ThemedText style={styles.bottomSheetSearchSubtitle}>
                    {searchResults.length > 0
                      ? `${searchResults.length} results found`
                      : 'No results found'}
                  </ThemedText>
                </View>
                <ScrollView
                  style={styles.bottomSheetSearchResults}
                  showsVerticalScrollIndicator={true}
                  keyboardShouldPersistTaps="handled"
                >
                  {searchResults.length > 0 ? (
                    searchResults.map(renderSearchResult)
                  ) : (
                    <View style={styles.bottomSheetNoResults}>
                      <Ionicons name="search-outline" size={48} color="#ccc" />
                      <ThemedText style={styles.bottomSheetNoResultsText}>
                        No results found
                      </ThemedText>
                      <ThemedText style={styles.bottomSheetNoResultsSubtext}>
                        Try searching for a different location
                      </ThemedText>
                    </View>
                  )}
                </ScrollView>
              </View>
            ) : (
              // Show property list when search is not focused
              <PropertyListBottomSheet
                properties={visibleProperties}
                highlightedPropertyId={highlightedPropertyId}
                onPropertyPress={handlePropertyPress}
                isLoading={isLoadingProperties}
                onViewableItemsChanged={onViewableItemsChanged}
                _mapBounds={currentBounds || null}
                totalCount={undefined} // We can add this later if backend returns total count
                onOpenFilters={handleOpenFilters}
                onSaveSearch={handleOpenSaveModal}
                onRefreshLocation={handleRefreshLocation}
              />
            )}
          </Animated.View>
        </BottomSheetView>
      </BottomSheet>
    </View>
  );
}
