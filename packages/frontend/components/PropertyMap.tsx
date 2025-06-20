import React, { useRef, useEffect, useState } from 'react';
import { View, StyleSheet, Platform, ActivityIndicator, Text } from 'react-native';
import { colors } from '@/styles/colors';

interface PropertyMapProps {
  latitude?: number;
  longitude?: number;
  address?: string;
  onLocationSelect?: (lat: number, lng: number, address: string) => void;
  height?: number;
  interactive?: boolean;
}

// Web-specific map component
const WebMap: React.FC<PropertyMapProps> = ({
  latitude = 40.7128,
  longitude = -74.0060,
  address = '',
  onLocationSelect,
  height = 300,
  interactive = true,
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!mapRef.current) return;

    // Load Leaflet CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    // Load Leaflet JS
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => {
      initializeMap();
    };
    script.onerror = () => {
      setError('Failed to load map library');
      setLoading(false);
    };
    document.head.appendChild(script);

    return () => {
      // Cleanup
      document.head.removeChild(link);
      document.head.removeChild(script);
    };
  }, []);

  const initializeMap = () => {
    if (!mapRef.current || !(window as any).L) return;

    const L = (window as any).L;
    let map: any, marker: any, searchTimeout: any;

    // Initialize map
    map = L.map(mapRef.current).setView([latitude, longitude], 13);

    // Add OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    // Add marker if coordinates are provided
    if (latitude && longitude) {
      marker = L.marker([latitude, longitude]).addTo(map);
    }

    if (interactive) {
      // Create search container
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
      searchInput.placeholder = 'Search for an address...';
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

      searchContainer.appendChild(searchInput);
      searchContainer.appendChild(searchResults);
      mapRef.current.appendChild(searchContainer);

      // Create location info
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
      mapRef.current.appendChild(locationInfo);

      // Search functionality
      searchInput.addEventListener('input', function () {
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

      async function searchAddress(query: string) {
        try {
          const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`);
          const data = await response.json();

          searchResults.innerHTML = '';

          if (data.length > 0) {
            data.forEach((result: any) => {
              const div = document.createElement('div');
              div.style.cssText = `
                                padding: 12px;
                                border-bottom: 1px solid #eee;
                                cursor: pointer;
                            `;
              div.textContent = result.display_name;
              div.onclick = () => {
                selectLocation(result.lat, result.lon, result.display_name);
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
      map.on('click', function (e: any) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;

        // Reverse geocode to get address
        fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
          .then(response => response.json())
          .then(data => {
            const address = data.display_name || 'Unknown location';
            selectLocation(lat, lng, address);
          })
          .catch(error => {
            console.error('Reverse geocoding error:', error);
            selectLocation(lat, lng, 'Selected location');
          });
      });

      function selectLocation(lat: number, lng: number, address: string) {
        // Update marker
        if (marker) {
          map.removeLayer(marker);
        }
        marker = L.marker([lat, lng]).addTo(map);
        map.setView([lat, lng], 16);

        // Update location info
        locationInfo.textContent = address;

        // Call the callback
        if (onLocationSelect) {
          onLocationSelect(lat, lng, address);
        }
      }

      // Close search results when clicking outside
      document.addEventListener('click', function (e) {
        if (!searchInput.contains(e.target as Node) && !searchResults.contains(e.target as Node)) {
          searchResults.style.display = 'none';
        }
      });
    }

    setLoading(false);
  };

  if (error) {
    return (
      <View style={[styles.container, { height }, styles.errorContainer]}>
        <Text style={styles.errorText}>Failed to load map</Text>
        <Text style={styles.errorSubtext}>{error}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { height }]}>
      <div
        ref={mapRef}
        style={{
          width: '100%',
          height: '100%',
          borderRadius: 8,
        }}
      />
      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.primaryColor} />
          <Text style={styles.loadingText}>Loading map...</Text>
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
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
          </style>
        </head>
        <body>
          <div id="map"></div>
          ${props.interactive ? `
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
          ` : ''}
          
          <script>
            let map, marker, searchTimeout;
            
            // Initialize map
            map = L.map('map').setView([${props.latitude}, ${props.longitude}], 13);
            
            // Add OpenStreetMap tiles
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
              attribution: '© OpenStreetMap contributors'
            }).addTo(map);
            
            // Add marker if coordinates are provided
            ${props.latitude && props.longitude ? `
              marker = L.marker([${props.latitude}, ${props.longitude}]).addTo(map);
              ${props.address ? `document.getElementById('locationInfo').textContent = '${props.address}';` : ''}
            ` : ''}
            
            ${props.interactive ? `
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
                  const response = await fetch(\`https://nominatim.openstreetmap.org/search?format=json&q=\${encodeURIComponent(query)}&limit=5\`);
                  const data = await response.json();
                  
                  searchResults.innerHTML = '';
                  
                  if (data.length > 0) {
                    data.forEach(result => {
                      const div = document.createElement('div');
                      div.className = 'search-result';
                      div.textContent = result.display_name;
                      div.onclick = () => {
                        selectLocation(result.lat, result.lon, result.display_name);
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
                fetch(\`https://nominatim.openstreetmap.org/reverse?format=json&lat=\${lat}&lon=\${lng}\`)
                  .then(response => response.json())
                  .then(data => {
                    const address = data.display_name || 'Unknown location';
                    selectLocation(lat, lng, address);
                  })
                  .catch(error => {
                    console.error('Reverse geocoding error:', error);
                    selectLocation(lat, lng, 'Selected location');
                  });
              });
              
              function selectLocation(lat, lng, address) {
                // Update marker
                if (marker) {
                  map.removeLayer(marker);
                }
                marker = L.marker([lat, lng]).addTo(map);
                map.setView([lat, lng], 16);
                
                // Update location info
                locationInfo.textContent = address;
                
                // Send message to React Native
                if (window.ReactNativeWebView) {
                  window.ReactNativeWebView.postMessage(JSON.stringify({
                    type: 'locationSelected',
                    latitude: lat,
                    longitude: lng,
                    address: address
                  }));
                }
              }
              
              // Close search results when clicking outside
              document.addEventListener('click', function(e) {
                if (!searchInput.contains(e.target) && !searchResults.contains(e.target)) {
                  searchResults.style.display = 'none';
                }
              });
            ` : ''}
            
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
        <Text style={styles.errorText}>Failed to load map</Text>
        <Text style={styles.errorSubtext}>{error}</Text>
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
          <Text style={styles.loadingText}>Loading map...</Text>
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