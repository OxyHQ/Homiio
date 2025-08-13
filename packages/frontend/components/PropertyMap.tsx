import React, { useRef, useEffect, useState } from 'react';
import { View, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import { colors } from '@/styles/colors';
import { ThemedText } from './ThemedText';

interface PropertyMapProps {
  latitude?: number;
  longitude?: number;
  address?: string;
  onLocationSelect?: (lat: number, lng: number, address: string) => void;
  height?: number;
  interactive?: boolean;
  showMarker?: boolean;
}

// Web-specific map component using Leaflet
const WebMap: React.FC<PropertyMapProps> = ({
  latitude = 40.7128,
  longitude = -74.006,
  address = '',
  onLocationSelect,
  height = 300,
  interactive = true,
  showMarker = true,
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [map, setMap] = useState<any>(null);
  const [marker, setMarker] = useState<any>(null);

  useEffect(() => {
    if (!mapRef.current || typeof window === 'undefined') return;

    const initializeMap = () => {
      try {
        // Dynamically import Leaflet
        const L = (window as any).L;
        if (!L) {
          setError('Leaflet not loaded');
          return;
        }

        const leafletMap = L.map(mapRef.current!).setView([latitude, longitude], 13);
        let mapMarker: any = null;

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors',
        }).addTo(leafletMap);

        // Add initial marker if coordinates are provided and showMarker is true
        if (latitude && longitude && showMarker) {
          mapMarker = L.marker([latitude, longitude]).addTo(leafletMap);
        }

        setMap(leafletMap);
        setMarker(mapMarker);

        // Add search functionality if interactive
        if (interactive) {
          const searchContainer = document.createElement('div');
          searchContainer.style.cssText = `
            position: absolute;
            top: 10px;
            left: 10px;
            right: 10px;
            z-index: 1000;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            padding: 10px;
          `;

          const searchInput = document.createElement('input');
          searchInput.type = 'text';
          searchInput.placeholder = 'Search for a location...';
          searchInput.style.cssText = `
            width: 100%;
            padding: 12px;
            border: 1px solid #ddd;
            border-radius: 6px;
            font-size: 16px;
            box-sizing: border-box;
          `;

          const searchResults = document.createElement('div');
          searchResults.style.cssText = `
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            background: white;
            border-radius: 6px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            max-height: 200px;
            overflow-y: auto;
            z-index: 1001;
            display: none;
          `;

          const locationInfo = document.createElement('div');
          locationInfo.style.cssText = `
            position: absolute;
            bottom: 10px;
            left: 10px;
            right: 10px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            padding: 10px;
            z-index: 1000;
            font-size: 14px;
            color: #333;
          `;
          locationInfo.textContent = address || 'Click on the map to select a location';

          searchContainer.appendChild(searchInput);
          searchContainer.appendChild(searchResults);
          leafletMap.getContainer().appendChild(searchContainer);
          leafletMap.getContainer().appendChild(locationInfo);

          // Search input handler
          let searchTimeout: ReturnType<typeof setTimeout>;
          searchInput.addEventListener('input', (e) => {
            const query = (e.target as HTMLInputElement).value;

            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(async () => {
              if (query.length >= 3) {
                try {
                  const response = await fetch(
                    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=10&addressdetails=1&extratags=1&namedetails=1&countrycodes=es,us,ca,mx,gb,fr,de,it,pt,nl,be,ch,at&exclude_place_ids=`,
                  );
                  const data = await response.json();

                  // Filter out businesses and focus on residential addresses
                  const residentialResults = data
                    .filter((result: any) => {
                      // Include residential addresses, houses, apartments
                      const type = result.type || '';
                      const classType = result.class || '';
                      const address = result.address || {};

                      // Accept residential types
                      const isResidential =
                        type === 'house' ||
                        type === 'residential' ||
                        type === 'apartments' ||
                        type === 'house_number' ||
                        classType === 'place' ||
                        classType === 'boundary';

                      // Exclude business types
                      const isBusiness =
                        type === 'shop' ||
                        type === 'amenity' ||
                        type === 'office' ||
                        type === 'commercial' ||
                        type === 'restaurant' ||
                        type === 'cafe' ||
                        type === 'bar' ||
                        type === 'hotel' ||
                        type === 'bank' ||
                        type === 'pharmacy' ||
                        type === 'supermarket' ||
                        type === 'fuel' ||
                        type === 'industrial';

                      // Check if it has a house number (more likely to be residential)
                      const hasHouseNumber =
                        address.house_number ||
                        address.housenumber ||
                        result.display_name.match(/\d+/);

                      return isResidential && !isBusiness && hasHouseNumber;
                    })
                    .slice(0, 5); // Limit to 5 results after filtering

                  searchResults.innerHTML = '';
                  if (residentialResults.length > 0) {
                    residentialResults.forEach((result: any) => {
                      const div = document.createElement('div');
                      div.style.cssText = `
                        padding: 12px;
                        border-bottom: 1px solid #eee;
                        cursor: pointer;
                      `;
                      div.textContent = result.display_name;
                      div.onclick = () => {
                        selectLocation(result.lat, result.lon, result.display_name, result);
                        searchResults.style.display = 'none';
                        searchInput.value = result.display_name;
                      };
                      searchResults.appendChild(div);
                    });
                    searchResults.style.display = 'block';
                  } else {
                    searchResults.style.display = 'none';
                  }
                } catch (error) {
                  console.error('Search error:', error);
                }
              } else {
                searchResults.style.display = 'none';
              }
            }, 400);
          });

          // Map click handler
          leafletMap.on('click', async function (e: any) {
            const lat = e.latlng.lat;
            const lng = e.latlng.lng;

            try {
              const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`,
              );
              const data = await response.json();
              const address = data.display_name || 'Unknown location';

              // Pass detailed address information
              const detailedAddress = {
                display_name: data.display_name,
                address: data.address || {},
                lat: lat,
                lon: lng,
              };

              selectLocation(lat, lng, address, detailedAddress);
            } catch (error) {
              console.error('Reverse geocoding error:', error);
              // Create a fallback address with coordinates
              const fallbackAddress = `Location at ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
              selectLocation(lat, lng, fallbackAddress);
            }
          });

          function selectLocation(lat: number, lng: number, address: string, detailedData?: any) {
            console.log('PropertyMap selectLocation called:', { lat, lng, address, detailedData });

            // Normalize coordinates
            const normalizedLat = Math.max(-90, Math.min(90, lat));
            const normalizedLng = ((lng + 180) % 360) - 180;

            // Update marker
            if (mapMarker) {
              leafletMap.removeLayer(mapMarker);
            }
            mapMarker = L.marker([normalizedLat, normalizedLng]).addTo(leafletMap);
            leafletMap.setView([normalizedLat, normalizedLng], 16);

            // Update location info
            locationInfo.textContent = address;

            // Call the callback with detailed data if available
            if (onLocationSelect) {
              if (detailedData) {
                // Create a more detailed address string with structured data
                const detailedAddress = {
                  display_name: detailedData.display_name,
                  street: detailedData.address?.road || '',
                  city:
                    detailedData.address?.city ||
                    detailedData.address?.town ||
                    detailedData.address?.village ||
                    '',
                  state: detailedData.address?.state || detailedData.address?.province || '',
                  country: detailedData.address?.country || '',
                  postcode: detailedData.address?.postcode || '',
                  house_number: detailedData.address?.house_number || '',
                  lat: normalizedLat,
                  lon: normalizedLng,
                };
                console.log('Calling onLocationSelect with detailed data:', detailedAddress);
                onLocationSelect(normalizedLat, normalizedLng, JSON.stringify(detailedAddress));
              } else {
                console.log('Calling onLocationSelect with simple address:', address);
                onLocationSelect(normalizedLat, normalizedLng, address);
              }
            } else {
              console.warn('onLocationSelect callback not provided');
            }
          }

          // Close search results when clicking outside
          document.addEventListener('click', function (e) {
            if (
              !searchInput.contains(e.target as Node) &&
              !searchResults.contains(e.target as Node)
            ) {
              searchResults.style.display = 'none';
            }
          });
        }

        setLoading(false);
      } catch (err) {
        setError('Failed to initialize map');
        setLoading(false);
      }
    };

    // Load Leaflet CSS and JS
    const loadLeaflet = () => {
      return new Promise<void>((resolve, reject) => {
        // Check if Leaflet is already loaded
        if ((window as any).L) {
          resolve();
          return;
        }

        // Load CSS
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        link.onload = () => {
          // Load JS
          const script = document.createElement('script');
          script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
          script.onload = () => resolve();
          script.onerror = reject;
          document.head.appendChild(script);
        };
        link.onerror = reject;
        document.head.appendChild(link);
      });
    };

    loadLeaflet()
      .then(() => {
        setTimeout(() => {
          initializeMap();
        }, 500);
      })
      .catch(() => {
        setError('Failed to load map library');
        setLoading(false);
      });
  }, [latitude, longitude, address, interactive, onLocationSelect]);

  // Update map when props change
  useEffect(() => {
    if (map && latitude && longitude) {
      map.setView([latitude, longitude], 16);
      if (marker) {
        map.removeLayer(marker);
      }
      const L = (window as any).L;
      if (L) {
        const newMarker = L.marker([latitude, longitude]).addTo(map);
        setMarker(newMarker);
      }
    }
  }, [latitude, longitude, map]);

  if (error) {
    return (
      <View style={[styles.container, { height }, styles.errorContainer]}>
        <ThemedText style={styles.errorText}>Failed to load map</ThemedText>
        <ThemedText style={styles.errorSubtext}>{error}</ThemedText>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      {React.createElement('div', {
        ref: mapRef,
        style: {
          width: '100%',
          height: '100%',
          borderRadius: 8,
        },
      })}
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primaryColor} />
          <ThemedText style={styles.loadingText}>Loading map...</ThemedText>
        </View>
      )}
    </View>
  );
};

// Mobile-specific map component using WebView
const MobileMap: React.FC<PropertyMapProps> = (props) => {
  const { WebView } = require('react-native-webview');
  const webViewRef = useRef<any>(null);
  const [mapHtml, setMapHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
          <title>Property Map</title>
          <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
          <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
          <style>
            body { 
              margin: 0; 
              padding: 0; 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            }
            #map { 
              width: 100%; 
              height: 100%; 
              z-index: 1;
            }
            .search-container {
              position: absolute;
              top: 10px;
              left: 10px;
              right: 10px;
              z-index: 1000;
              background: white;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              padding: 10px;
            }
            .search-input {
              width: 100%;
              padding: 12px;
              border: 1px solid #ddd;
              border-radius: 6px;
              font-size: 16px;
              box-sizing: border-box;
            }
            .search-results {
              position: absolute;
              top: 100%;
              left: 0;
              right: 0;
              background: white;
              border-radius: 6px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              max-height: 200px;
              overflow-y: auto;
              z-index: 1001;
            }
            .search-result {
              padding: 12px;
              border-bottom: 1px solid #eee;
              cursor: pointer;
            }
            .search-result:hover {
              background: #f5f5f5;
            }
            .search-result:last-child {
              border-bottom: none;
            }
            .location-info {
              position: absolute;
              bottom: 10px;
              left: 10px;
              right: 10px;
              background: white;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              padding: 10px;
              z-index: 1000;
              font-size: 14px;
              color: #333;
            }
            .leaflet-control-attribution {
              display: none !important;
            }
          </style>
        </head>
        <body>
          <div id="map"></div>
          ${
            props.interactive
              ? `
            <div class="search-container">
              <input 
                type="text" 
                class="search-input" 
                placeholder="Search for an address..."
                id="searchInput"
              />
              <div class="search-results" id="searchResults" style="display: none;"></div>
            </div>
            <div class="location-info" id="locationInfo">
              ${props.address || 'Click on the map to select a location'}
            </div>
          `
              : ''
          }
          
          <script>
            let map, marker, searchTimeout;
            
            // Initialize map and disable the default attribution control
            map = L.map('map', {
                zoomControl: ${props.interactive},
                attributionControl: false,
            }).setView([${props.latitude}, ${props.longitude}], 13);
            
            // Add OpenStreetMap tiles without any attribution text
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
            
            // Add marker if coordinates are provided and showMarker is true
            ${
              props.latitude && props.longitude && props.showMarker !== false
                ? `
              marker = L.marker([${props.latitude}, ${props.longitude}]).addTo(map);
              ${props.address ? `document.getElementById('locationInfo').textContent = '${props.address}';` : ''}
            `
                : ''
            }
            
            ${
              props.interactive
                ? `
              // Search functionality
              const searchInput = document.getElementById('searchInput');
              const searchResults = document.getElementById('searchResults');
              const locationInfo = document.getElementById('locationInfo');
              
              searchInput.addEventListener('input', function() {
                clearTimeout(searchTimeout);
                const query = this.value.trim();
                
                if (query.length < 3) {
                  searchResults.style.display = 'none';
                  return;
                }
                
                searchTimeout = setTimeout(() => {
                  searchAddress(query);
                }, 500);
              });
              
              async function searchAddress(query) {
                try {
                  const response = await fetch(\`https://nominatim.openstreetmap.org/search?format=json&q=\${encodeURIComponent(query)}&limit=10&addressdetails=1&extratags=1&namedetails=1&countrycodes=es,us,ca,mx,gb,fr,de,it,pt,nl,be,ch,at&exclude_place_ids=\`);
                  const data = await response.json();
                  
                  // Filter out businesses and focus on residential addresses
                  const residentialResults = data.filter(result => {
                    // Include residential addresses, houses, apartments
                    const type = result.type || '';
                    const classType = result.class || '';
                    const address = result.address || {};
                    
                    // Accept residential types
                    const isResidential = type === 'house' || 
                                        type === 'residential' || 
                                        type === 'apartments' || 
                                        type === 'house_number' ||
                                        classType === 'place' ||
                                        classType === 'boundary';
                    
                    // Exclude business types
                    const isBusiness = type === 'shop' || 
                                     type === 'amenity' || 
                                     type === 'office' || 
                                     type === 'commercial' ||
                                     type === 'restaurant' ||
                                     type === 'cafe' ||
                                     type === 'bar' ||
                                     type === 'hotel' ||
                                     type === 'bank' ||
                                     type === 'pharmacy' ||
                                     type === 'supermarket' ||
                                     type === 'fuel' ||
                                     type === 'industrial';
                    
                    // Check if it has a house number (more likely to be residential)
                    const hasHouseNumber = address.house_number || 
                                         address.housenumber || 
                                         result.display_name.match(/\\d+/);
                    
                    return isResidential && !isBusiness && hasHouseNumber;
                  }).slice(0, 5); // Limit to 5 results after filtering
                  
                  searchResults.innerHTML = '';
                  
                  if (residentialResults.length > 0) {
                    residentialResults.forEach(result => {
                      const div = document.createElement('div');
                      div.className = 'search-result';
                      div.textContent = result.display_name;
                      div.onclick = () => {
                        selectLocation(result.lat, result.lon, result.display_name, result);
                        searchResults.style.display = 'none';
                        searchInput.value = result.display_name;
                      };
                      searchResults.appendChild(div);
                    });
                    searchResults.style.display = 'block';
                  } else {
                    searchResults.style.display = 'none';
                  }
                } catch (error) {
                  console.error('Search error:', error);
                }
              }
              
              // Map click handler
              map.on('click', function(e) {
                const lat = e.latlng.lat;
                const lng = e.latlng.lng;
                
                // Reverse geocode to get address
                fetch(\`https://nominatim.openstreetmap.org/reverse?format=json&lat=\${lat}&lon=\${lng}&addressdetails=1\`)
                  .then(response => response.json())
                  .then(data => {
                    const address = data.display_name || 'Unknown location';
                    selectLocation(lat, lng, address, data);
                  })
                  .catch(error => {
                    console.error('Reverse geocoding error:', error);
                    selectLocation(lat, lng, 'Selected location');
                  });
              });
              
              function selectLocation(lat, lng, address, detailedData) {
                console.log('Mobile PropertyMap selectLocation called:', { lat, lng, address, detailedData });
                
                // Normalize coordinates
                const normalizedLat = Math.max(-90, Math.min(90, lat));
                const normalizedLng = ((lng + 180) % 360) - 180;
                
                // Update marker
                if (marker) {
                  map.removeLayer(marker);
                }
                marker = L.marker([normalizedLat, normalizedLng]).addTo(map);
                map.setView([normalizedLat, normalizedLng], 16);
                
                // Update location info
                locationInfo.textContent = address;
                
                // Send message to React Native with detailed data
                if (window.ReactNativeWebView) {
                  const messageData = {
                    type: 'locationSelected',
                    latitude: normalizedLat,
                    longitude: normalizedLng,
                    address: detailedData ? JSON.stringify({
                      display_name: detailedData.display_name,
                      street: detailedData.address?.road || '',
                      city: detailedData.address?.city || detailedData.address?.town || detailedData.address?.village || '',
                      state: detailedData.address?.state || detailedData.address?.province || '',
                      country: detailedData.address?.country || '',
                      postcode: detailedData.address?.postcode || '',
                      house_number: detailedData.address?.house_number || '',
                      lat: normalizedLat,
                      lon: normalizedLng
                    }) : address
                  };
                  console.log('Sending message to React Native:', messageData);
                  window.ReactNativeWebView.postMessage(JSON.stringify(messageData));
                }
              }
              
              // Close search results when clicking outside
              document.addEventListener('click', function(e) {
                if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                  searchResults.style.display = 'none';
                }
              });
            `
                : ''
            }
            
            // Notify React Native that map is loaded
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'mapLoaded'
              }));
            }
          </script>
        </body>
      </html>
    `;

    setMapHtml(html);
  }, [props.latitude, props.longitude, props.address, props.interactive]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'locationSelected' && props.onLocationSelect) {
        props.onLocationSelect(data.latitude, data.longitude, data.address);
      } else if (data.type === 'mapLoaded') {
        setLoading(false);
        setError(null);
      }
    } catch (error) {
      console.error('Error parsing map message:', error);
    }
  };

  const handleError = (syntheticEvent: any) => {
    const { nativeEvent } = syntheticEvent;
    setError(nativeEvent.description || 'Failed to load map');
    setLoading(false);
  };

  const handleLoadEnd = () => {
    // Fallback loading state
    setTimeout(() => {
      if (loading) {
        setLoading(false);
      }
    }, 3000);
  };

  if (error) {
    return (
      <View style={[styles.container, { height: props.height }, styles.errorContainer]}>
        <ThemedText style={styles.errorText}>Failed to load map</ThemedText>
        <ThemedText style={styles.errorSubtext}>{error}</ThemedText>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height: props.height }]}>
      <WebView
        ref={webViewRef}
        source={{ html: mapHtml }}
        style={styles.webview}
        onMessage={handleMessage}
        onError={handleError}
        onLoadEnd={handleLoadEnd}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        scalesPageToFit={true}
        bounces={false}
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
      />
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primaryColor} />
          <ThemedText style={styles.loadingText}>Loading map...</ThemedText>
        </View>
      )}
    </View>
  );
};

// Main component that chooses the right implementation
export const PropertyMap: React.FC<PropertyMapProps> = (props) => {
  // Use web implementation for web platform
  if (Platform.OS === 'web') {
    return <WebMap {...props} />;
  }

  // Use mobile implementation for iOS and Android
  return <MobileMap {...props} />;
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.primaryLight_1,
  },
  webview: {
    flex: 1,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 8,
    fontSize: 14,
    color: colors.primaryDark,
  },
  errorContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.primaryLight,
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.primaryDark,
    marginBottom: 4,
  },
  errorSubtext: {
    fontSize: 14,
    color: colors.primaryDark_1,
    textAlign: 'center',
  },
});
