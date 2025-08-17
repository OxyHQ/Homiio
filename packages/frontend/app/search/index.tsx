import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, StyleSheet, Dimensions, TextInput, TouchableOpacity,
  Platform, ActivityIndicator, ScrollView, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Map, { MapApi } from '@/components/Map';
import { PropertyCard } from '@/components/PropertyCard';
import { ThemedText } from '@/components/ThemedText';
import { Property, PaymentFrequency } from '@homiio/shared-types';
import { propertyService } from '@/services/propertyService';

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
  const mapRef = useRef<MapApi>(null);
  const flatListRef = useRef<FlatList>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [showMap, setShowMap] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [properties, setProperties] = useState<Property[]>([]);
  const [isLoadingProperties, setIsLoadingProperties] = useState(false);
  const [highlightedPropertyId, setHighlightedPropertyId] = useState<string | null>(null);
  const regionChangeDebounce = useRef<NodeJS.Timeout | null>(null);
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 70 }).current;

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
    const timeoutId = setTimeout(searchPlaces, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const fetchProperties = useCallback(async (bounds: { west: number; south: number; east: number; north: number }) => {
    setIsLoadingProperties(true);
    setHighlightedPropertyId(null);
    try {
      const response = await propertyService.findPropertiesInBounds(bounds, {
        minRent: filters.minPrice, maxRent: filters.maxPrice,
        bedrooms: typeof filters.bedrooms === 'string' ? 5 : filters.bedrooms,
        bathrooms: typeof filters.bathrooms === 'string' ? 4 : filters.bathrooms,
      });
      setProperties(response.properties);
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
  };

  const handleMarkerPress = ({ id }: { id: string; lngLat: [number, number] }) => {
    const index = properties.findIndex(p => p._id === id);
    if (index !== -1) {
      setHighlightedPropertyId(id);
      flatListRef.current?.scrollToIndex({ animated: true, index });
    }
  };

  const handleRegionChange = useCallback(({ bounds }) => {
    if (regionChangeDebounce.current) clearTimeout(regionChangeDebounce.current);
    if (!bounds) return;
    regionChangeDebounce.current = setTimeout(() => {
      fetchProperties(bounds);
    }, 500);
  }, [fetchProperties]);

  const onViewableItemsChanged = useCallback(({ viewableItems }) => {
    if (viewableItems.length > 0) {
      const visibleId = viewableItems[0].item._id;
      setHighlightedPropertyId(visibleId);
    }
  }, []);

  useEffect(() => {
    return () => { if (regionChangeDebounce.current) clearTimeout(regionChangeDebounce.current); };
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
              onPress={() => {
                if (property.location?.coordinates) {
                  mapRef.current?.navigateToLocation(property.location.coordinates as [number, number]);
                  setShowMap(true);
                }
              }}
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
            ref={mapRef}
            style={styles.map}
            startFromCurrentLocation
            markers={(properties || []).filter(p => p?.location?.coordinates?.length === 2).map(p => ({
              id: p._id,
              coordinates: p.location!.coordinates as [number, number],
              priceLabel: `€${p.rent?.amount?.toLocaleString() || 0}`,
            }))}
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
                      style={{
                        backgroundColor: '#fff',
                        borderRadius: 12,
                        overflow: 'hidden',
                        borderWidth: item._id === highlightedPropertyId ? 2 : 0,
                        borderColor: '#007AFF',
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