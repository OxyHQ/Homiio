import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View, StyleSheet, Dimensions, TextInput, TouchableOpacity,
  Platform, ActivityIndicator, ScrollView, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Map, { MapApi } from '@/components/Map';
import { PropertyCard } from '@/components/PropertyCard';
import { ThemedText } from '@/components/ThemedText';
import { Property } from '@homiio/shared-types';
import { propertyService } from '@/services/propertyService';
import { useMapState } from '@/context/MapStateContext';

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
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'web' ? 8 : 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
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
  controlsContainer: {
    position: 'absolute', top: Platform.OS === 'web' ? 80 : 112, right: 16, zIndex: 10,
    backgroundColor: '#fff', borderRadius: 12, padding: 8,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1,
    shadowRadius: 4, elevation: 3, flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  filtersContainer: {
    position: 'absolute', top: Platform.OS === 'web' ? 132 : 164, left: 16, right: 16,
    zIndex: 10, maxWidth: 600, alignSelf: 'center', backgroundColor: '#fff', borderRadius: 12,
    padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1, shadowRadius: 4, elevation: 3,
  },
  filterRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16,
  },
  filterLabel: {
    fontSize: 14, color: '#333', marginRight: 8,
  },
  buttonGroup: {
    flexDirection: 'row', gap: 8, flexWrap: 'wrap',
  },
  button: {
    backgroundColor: '#f0f0f0', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
  },
  buttonSelected: {
    backgroundColor: '#007AFF',
  },
  buttonText: {
    fontSize: 14, color: '#333',
  },
  buttonTextSelected: {
    color: '#fff',
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
  const router = useRouter();
  const { getMapState, setMapState } = useMapState();
  const screenId = 'search-screen';

  // Restore saved state on mount
  const savedState = getMapState(screenId);

  const mapRef = useRef<MapApi>(null);
  const flatListRef = useRef<FlatList>(null);
  const [searchQuery, setSearchQuery] = useState(savedState?.searchQuery || '');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [showMap, setShowMap] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
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
    if (!searchQuery.trim()) {
      setSearchResults([]); setShowResults(false); return;
    }
    const searchPlaces = async () => {
      setIsSearching(true);
      try {
        const response = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?access_token=${process.env.EXPO_PUBLIC_MAPBOX_TOKEN}`);
        const data = await response.json();
        if (data.features) {
          setSearchResults(data.features); setShowResults(true);
        }
      } catch (error) { console.error('Geocoding error:', error); }
      finally { setIsSearching(false); }
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

  // Add some test data if no properties are found (for debugging)
  useEffect(() => {
    if (properties.length === 0 && !isLoadingProperties) {
      console.log('No properties found, adding test data');
      const testProperties = [
        {
          _id: 'test1',
          address: { street: 'Test Street 1', city: 'Barcelona', state: 'Catalonia', country: 'Spain', zipCode: '08001' },
          rent: { amount: 1200, currency: 'EUR', paymentFrequency: 'monthly', deposit: 1200, utilities: 'included' },
          location: { type: 'Point', coordinates: [2.16538, 41.38723] } as any,
          type: 'apartment' as any,
          status: 'available' as any,
          ownerId: 'test-owner',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        {
          _id: 'test2',
          address: { street: 'Test Street 2', city: 'Barcelona', state: 'Catalonia', country: 'Spain', zipCode: '08002' },
          rent: { amount: 1500, currency: 'EUR', paymentFrequency: 'monthly', deposit: 1500, utilities: 'included' },
          location: { type: 'Point', coordinates: [2.17538, 41.39723] } as any,
          type: 'apartment' as any,
          status: 'available' as any,
          ownerId: 'test-owner',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
      ] as Property[];
      setProperties(testProperties);
    }
  }, [properties.length, isLoadingProperties]);

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

  const renderFilters = () => (
    <View style={styles.filtersContainer}>
      <View style={styles.filterRow}>
        <ThemedText style={styles.filterLabel}>Price up to</ThemedText>
        <View style={styles.buttonGroup}>
          {[500, 1000, 2000, 5000, 10000].map((value) => (
            <TouchableOpacity key={value} style={[styles.button, filters.maxPrice === value && styles.buttonSelected,]} onPress={() => setFilters({ ...filters, maxPrice: value })} >
              <ThemedText style={[styles.buttonText, filters.maxPrice === value && styles.buttonTextSelected,]}>€{value}</ThemedText>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <View style={styles.filterRow}>
        <ThemedText style={styles.filterLabel}>Bedrooms</ThemedText>
        <View style={styles.buttonGroup}>
          {[1, 2, 3, 4, '5+'].map((num) => (
            <TouchableOpacity key={num} style={[styles.button, filters.bedrooms === num && styles.buttonSelected,]} onPress={() => setFilters({ ...filters, bedrooms: num })}>
              <ThemedText style={[styles.buttonText, filters.bedrooms === num && styles.buttonTextSelected,]}>{num}</ThemedText>
            </TouchableOpacity>
          ))}
        </View>
      </View>
      <View style={styles.filterRow}>
        <ThemedText style={styles.filterLabel}>Bathrooms</ThemedText>
        <View style={styles.buttonGroup}>
          {[1, 2, 3, '4+'].map((num) => (
            <TouchableOpacity key={num} style={[styles.button, filters.bathrooms === num && styles.buttonSelected,]} onPress={() => setFilters({ ...filters, bathrooms: num })}>
              <ThemedText style={[styles.buttonText, filters.bathrooms === num && styles.buttonTextSelected,]}>{num}</ThemedText>
            </TouchableOpacity>
          ))}
        </View>
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
      <View style={styles.searchInputContainer}>
        <Ionicons name="search" size={20} color="#666" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search for a city, neighborhood, or address..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          onFocus={() => setShowResults(true)}
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
            startFromCurrentLocation={!savedState} // Only start from current location if no saved state
            markers={mapMarkers}
            onRegionChange={handleRegionChange}
            onMarkerPress={handleMarkerPress}
          />
          {renderSearchBar(styles.searchContainerAbsolute)}
          <View style={styles.controlsContainer}>
            <TouchableOpacity style={[styles.button, showFilters && styles.buttonSelected]} onPress={() => setShowFilters(!showFilters)}>
              <Ionicons name="options-outline" size={20} color={showFilters ? '#fff' : '#333'} />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, !showMap && styles.buttonSelected]} onPress={() => setShowMap(!showMap)}>
              <Ionicons name={showMap ? 'list-outline' : 'map-outline'} size={20} color={!showMap ? '#fff' : '#333'} />
            </TouchableOpacity>
          </View>
          {showFilters && renderFilters()}

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
          {renderSearchBar(styles.searchContainerRelative)}
          {renderPropertyList()}
        </>
      )}
    </View>
  );
}