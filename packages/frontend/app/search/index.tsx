import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Dimensions,
  TextInput,
  TouchableOpacity,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Map from '@/components/Map';
import { PropertyCard } from '@/components/PropertyCard';
import { ThemedText } from '@/components/ThemedText';
import { Property, PaymentFrequency } from '@homiio/shared-types';
import { propertyService } from '@/services/propertyService';


const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  map: {
    width: '100%',
    height: '100%',
  },
  searchContainerAbsolute: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 16 : 48,
    left: 16,
    right: 16,
    zIndex: 1,
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
      flex: 1,
      fontSize: 16,
      color: '#333',
      paddingVertical: 8,
      outline: 'none',
    },
    default: {
      flex: 1,
      fontSize: 16,
      color: '#333',
      paddingVertical: 8,
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
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  locationIcon: {
    marginRight: 12,
  },
  searchResultText: {
    flex: 1,
  },
  primaryText: {
    fontSize: 16,
    color: '#333',
    marginBottom: 2,
  },
  secondaryText: {
    fontSize: 14,
    color: '#666',
  },
  controlsContainer: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 80 : 112,
    right: 16,
    zIndex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  filtersContainer: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 132 : 164,
    left: 16,
    right: 16,
    zIndex: 1,
    maxWidth: 600,
    alignSelf: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  filterLabel: {
    fontSize: 14,
    color: '#333',
    marginRight: 8,
  },
  filterValue: {
    fontSize: 14,
    color: '#666',
  },
  sliderContainer: {
    flex: 1,
    marginHorizontal: 8,
  },
  buttonGroup: {
    flexDirection: 'row',
    gap: 8,
  },
  button: {
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  buttonSelected: {
    backgroundColor: '#007AFF',
  },
  buttonText: {
    fontSize: 14,
    color: '#333',
  },
  buttonTextSelected: {
    color: '#fff',
  },
  listContainer: {
    flex: 1,
    padding: 16,
  },
  propertiesList: {
    flex: 1,
  },
  noResults: {
    textAlign: 'center',
    fontSize: 16,
    color: '#666',
    marginTop: 32,
  },
});

interface SearchResult {
  place_name: string;
  center: [number, number];
  text: string;
  context?: { text: string }[];
}

interface Filters {
  radius: number;
  minPrice: number;
  maxPrice: number;
  bedrooms: number;
  bathrooms: number;
}

const defaultFilters: Filters = {
  radius: 5,
  minPrice: 0,
  maxPrice: 5000,
  bedrooms: 1,
  bathrooms: 1,
};

export default function SearchScreen() {
  const { width: _width, height: _height } = Dimensions.get('window');
  const mapRef = useRef<{ navigateToLocation: (center: [number, number], zoom?: number) => void }>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [showMap, setShowMap] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [selectedLocation, setSelectedLocation] = useState<[number, number] | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [isLoadingProperties, setIsLoadingProperties] = useState(false);


  useEffect(() => {
    const searchPlaces = async () => {
      if (!searchQuery.trim()) {
        setSearchResults([]);
        return;
      }
      setIsSearching(true);
      try {
        const response = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?access_token=${process.env.EXPO_PUBLIC_MAPBOX_TOKEN}`
        );
        const data = await response.json();
        if (data.features) {
          setSearchResults(data.features);
          setShowResults(true);
        }
      } catch (error) {
        console.error('Geocoding error:', error);
      } finally {
        setIsSearching(false);
      }
    };

    const timeoutId = setTimeout(searchPlaces, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const fetchProperties = React.useCallback(async (location?: [number, number]) => {
    setIsLoadingProperties(true);
    try {
      let props;
      if (location) {
        props = await propertyService.findPropertiesInRadius(
          location[1],
          location[0],
          filters.radius
        );
      } else {
        props = await propertyService.getProperties({
          minRent: filters.minPrice,
          maxRent: filters.maxPrice,
          bedrooms: filters.bedrooms,
          bathrooms: filters.bathrooms,
        });
      }
      setProperties(Array.isArray(props) ? props : props.properties);
    } catch (error) {
      console.error('Error fetching properties:', error);
    } finally {
      setIsLoadingProperties(false);
    }
  }, [filters]);

  useEffect(() => {
    if (selectedLocation) {
      fetchProperties(selectedLocation);
    } else {
      fetchProperties();
    }
  }, [selectedLocation, filters, fetchProperties]);

  const handleSelectLocation = (result: SearchResult) => {
    mapRef.current?.navigateToLocation(result.center, 15);
    setShowResults(false);
    setSearchQuery(result.place_name);
    setSelectedLocation(result.center);
  };

  const handleMarkerPress = ({ lngLat }: { id: string; lngLat: [number, number] }) => {
    mapRef.current?.navigateToLocation(lngLat, 15);
  };

  const [lastRegionChange, setLastRegionChange] = useState<number>(0);
  const REGION_CHANGE_DELAY = 500; // ms

  const handleRegionChange = React.useCallback(({ center: _center, zoom: _zoom, bounds }: { center: [number, number]; zoom: number; bounds?: { west: number; south: number; east: number; north: number } }) => {
    const now = Date.now();
    if (now - lastRegionChange < REGION_CHANGE_DELAY || !bounds) {
      return;
    }
    setLastRegionChange(now);

    setIsLoadingProperties(true);
    propertyService.findPropertiesInBounds(bounds, {
      minRent: filters.minPrice,
      maxRent: filters.maxPrice,
      bedrooms: filters.bedrooms,
      bathrooms: filters.bathrooms,
    }).then(props => {
      setProperties(props.properties);
    }).catch(error => {
      console.error('Error fetching properties in bounds:', error);
    }).finally(() => {
      setIsLoadingProperties(false);
    });
  }, [lastRegionChange, filters.minPrice, filters.maxPrice, filters.bedrooms, filters.bathrooms]);

  const renderFilters = () => (
    <View style={styles.filtersContainer}>
      <View style={styles.filterRow}>
        <ThemedText style={styles.filterLabel}>Radius</ThemedText>
        <View style={styles.buttonGroup}>
          {[1, 2, 5, 10, 20, 50].map((value) => (
            <TouchableOpacity
              key={value}
              style={[
                styles.button,
                filters.radius === value && styles.buttonSelected,
              ]}
              onPress={() => setFilters({ ...filters, radius: value })}
            >
              <ThemedText style={[
                styles.buttonText,
                filters.radius === value && styles.buttonTextSelected,
              ]}>{value}km</ThemedText>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.filterRow}>
        <ThemedText style={styles.filterLabel}>Price Range</ThemedText>
        <View style={styles.buttonGroup}>
          {[500, 1000, 2000, 5000, 10000].map((value) => (
            <TouchableOpacity
              key={value}
              style={[
                styles.button,
                filters.maxPrice === value && styles.buttonSelected,
              ]}
              onPress={() => setFilters({ ...filters, maxPrice: value })}
            >
              <ThemedText style={[
                styles.buttonText,
                filters.maxPrice === value && styles.buttonTextSelected,
              ]}>€{value}</ThemedText>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.filterRow}>
        <ThemedText style={styles.filterLabel}>Bedrooms</ThemedText>
        <View style={styles.buttonGroup}>
          {[1, 2, 3, 4, '5+'].map((num) => (
            <TouchableOpacity
              key={num}
              style={[
                styles.button,
                filters.bedrooms === num && styles.buttonSelected,
              ]}
              onPress={() => setFilters({ ...filters, bedrooms: num as number })}
            >
              <ThemedText style={[
                styles.buttonText,
                filters.bedrooms === num && styles.buttonTextSelected,
              ]}>{num}</ThemedText>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.filterRow}>
        <ThemedText style={styles.filterLabel}>Bathrooms</ThemedText>
        <View style={styles.buttonGroup}>
          {[1, 2, 3, '4+'].map((num) => (
            <TouchableOpacity
              key={num}
              style={[
                styles.button,
                filters.bathrooms === num && styles.buttonSelected,
              ]}
              onPress={() => setFilters({ ...filters, bathrooms: num as number })}
            >
              <ThemedText style={[
                styles.buttonText,
                filters.bathrooms === num && styles.buttonTextSelected,
              ]}>{num}</ThemedText>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );

  const renderPropertyList = () => (
    <ScrollView style={styles.listContainer}>
      <View style={styles.propertiesList}>
        {isLoadingProperties ? (
          <ActivityIndicator size="large" color="#666" />
        ) : !properties || properties.length === 0 ? (
          <ThemedText style={styles.noResults}>No properties found</ThemedText>
        ) : (
          properties.map((property) => (
            <PropertyCard
              key={property._id}
              property={property}
              onPress={() => {
                if (property.location?.coordinates) {
                  mapRef.current?.navigateToLocation(property.location.coordinates as [number, number]);
                  setShowMap(true);
                }
              }}
              showFavoriteButton
              showVerifiedBadge
              style={{ marginBottom: 16 }}
            />
          ))
        )}
      </View>
    </ScrollView>
  );

  const renderSearchBar = (containerStyle: any) => (
    <View style={containerStyle}>
      <View style={styles.searchInputContainer}>
        <Ionicons name="search" size={20} color="#666" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search location..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
        />
        {isSearching ? (
          <ActivityIndicator size="small" color="#666" style={styles.searchIcon} />
        ) : searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')} style={styles.clearButton}>
            <Ionicons name="close-circle" size={20} color="#999" />
          </TouchableOpacity>
        )}
      </View>
      {showResults && searchResults.length > 0 && (
        <ScrollView style={styles.searchResults} keyboardShouldPersistTaps="handled">
          {searchResults.map((result, index) => (
            <TouchableOpacity
              key={index}
              style={styles.searchResultItem}
              onPress={() => handleSelectLocation(result)}
            >
              <Ionicons name="location" size={20} color="#666" style={styles.locationIcon} />
              <View style={styles.searchResultText}>
                <ThemedText style={styles.primaryText}>{result.text}</ThemedText>
                <ThemedText style={styles.secondaryText}>
                  {result.context?.map(c => c.text).join(', ') || result.place_name}
                </ThemedText>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );

  return (
    <View style={[styles.container]}>
      {showMap && renderSearchBar(styles.searchContainerAbsolute)}

      <View style={styles.controlsContainer}>
        <TouchableOpacity
          style={[styles.button, showFilters && styles.buttonSelected]}
          onPress={() => setShowFilters(!showFilters)}
        >
          <Ionicons
            name="options"
            size={20}
            color={showFilters ? '#fff' : '#333'}
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, showMap && styles.buttonSelected]}
          onPress={() => setShowMap(!showMap)}
        >
          <Ionicons
            name={showMap ? 'map' : 'list'}
            size={20}
            color={showMap ? '#fff' : '#333'}
          />
        </TouchableOpacity>
      </View>

      {showFilters && renderFilters()}

      {showMap ? (
        <Map
          ref={mapRef}
          startFromCurrentLocation
          markers={[
            ...(selectedLocation ? [{ id: 'search', coordinates: selectedLocation, priceLabel: '' }] : []),
            ...(properties || [])
              .filter(p => p?.location?.coordinates)
              .map(p => ({
                id: p._id,
                coordinates: p.location!.coordinates as [number, number],
                priceLabel: `${p.rent?.currency === 'EUR' ? '€' : p.rent?.currency === 'USD' ? '$' : p.rent?.currency === 'GBP' ? '£' : ''}${p.rent?.amount?.toLocaleString() || 0}${p.rent?.paymentFrequency === PaymentFrequency.MONTHLY ? '/mo' : p.rent?.paymentFrequency === PaymentFrequency.WEEKLY ? '/wk' : ''}`,
              })),
          ]}
          onMapPress={({ lngLat }) => console.log('map press', lngLat)}
          onRegionChange={handleRegionChange}
          onMarkerPress={handleMarkerPress}
          renderMarkerHover={({ id }) => {
            const property = (properties || []).find(p => p._id === id);
            if (!property) return null;
            return (
              <div style={{ padding: 8, minWidth: 300 }}>
                <PropertyCard
                  property={property}
                  variant="compact"
                  orientation="horizontal"
                  showFavoriteButton={false}
                  showVerifiedBadge={false}
                  style={{ backgroundColor: '#fff', borderRadius: 12, overflow: 'hidden' }}
                />
              </div>
            );
          }}
        />
      ) : (
        <>
          {renderSearchBar(styles.searchContainerRelative)}
          {renderPropertyList()}
        </>
      )}
    </View>
  );
}
