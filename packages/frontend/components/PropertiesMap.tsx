import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  StyleSheet,
  Platform,
  ActivityIndicator,
  Text,
  TouchableOpacity,
} from 'react-native';
import { colors } from '@/styles/colors';
import { Property } from '@homiio/shared-types';
import { useMapState } from '@/context/MapStateContext';

interface MapProperty extends Property {
  title: string;
  // location is inherited from Property (GeoJSONPoint)
}

interface PropertiesMapProps {
  properties: MapProperty[];
  center?: { lat: number; lng: number };
  zoom?: number;
  height?: number;
  onPropertySelect?: (property: Property) => void;
  onPropertyPress?: (property: Property) => void;
  selectedPropertyId?: string;
  screenId?: string; // Unique identifier for the screen to persist state
}

// Web-specific properties map component
const WebPropertiesMap: React.FC<PropertiesMapProps> = ({
  properties,
  center,
  zoom = 12,
  height = 400,
  onPropertySelect,
  onPropertyPress,
  selectedPropertyId,
  screenId,
}) => {
  const { getMapState, setMapState } = useMapState();
  const mapRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [map, setMap] = useState<any>(null);
  const [markers, setMarkers] = useState<any[]>([]);

  // Get saved map state if screenId is provided
  const savedState = screenId ? getMapState(screenId) : null;

  // Calculate center if not provided
  const mapCenter =
    savedState?.center ? { lat: savedState.center[1], lng: savedState.center[0] } :
      center ||
      (() => {
        const validProperties = properties.filter(
          (p) => p.location?.coordinates && p.location.coordinates.length === 2,
        );

        if (validProperties.length > 0) {
          const avgLat =
            validProperties.reduce((sum, p) => sum + (p.location?.coordinates?.[1] || 0), 0) /
            validProperties.length;
          const avgLng =
            validProperties.reduce((sum, p) => sum + (p.location?.coordinates?.[0] || 0), 0) /
            validProperties.length;
          return { lat: avgLat, lng: avgLng };
        }

        return { lat: 41.38723, lng: 2.16538 }; // Default to Barcelona
      })();

  useEffect(() => {
    if (!mapRef.current) return;

    let linkElement: HTMLLinkElement | null = null;
    let scriptElement: HTMLScriptElement | null = null;

    const loadMap = async () => {
      try {
        // Check if Leaflet is already loaded
        if ((window as any).L) {
          initializeMap();
          return;
        }

        // Load Leaflet CSS
        linkElement = document.createElement('link');
        linkElement.rel = 'stylesheet';
        linkElement.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(linkElement);

        // Load Leaflet JS
        scriptElement = document.createElement('script');
        scriptElement.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';

        scriptElement.onload = () => {
          setTimeout(() => {
            initializeMap();
          }, 100); // Small delay to ensure everything is loaded
        };

        scriptElement.onerror = () => {
          setError('Failed to load map library');
          setLoading(false);
        };

        document.head.appendChild(scriptElement);
      } catch (err) {
        console.error('Error loading map:', err);
        setError('Failed to initialize map');
        setLoading(false);
      }
    };

    loadMap();

    return () => {
      // Cleanup
      if (linkElement && document.head.contains(linkElement)) {
        document.head.removeChild(linkElement);
      }
      if (scriptElement && document.head.contains(scriptElement)) {
        document.head.removeChild(scriptElement);
      }
    };
  }, []);

  const initializeMap = () => {
    try {
      if (!mapRef.current || !(window as any).L) {
        console.error('Map container or Leaflet not available');
        setError('Map initialization failed');
        setLoading(false);
        return;
      }

      const L = (window as any).L;

      // Initialize map
      const mapInstance = L.map(mapRef.current, {
        attributionControl: false,
        zoomControl: true,
      }).setView([mapCenter.lat, mapCenter.lng], savedState?.zoom || zoom);

      // Add OpenStreetMap tiles
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(mapInstance);

      setMap(mapInstance);

      // Add properties as markers
      addPropertyMarkers(mapInstance);

      setLoading(false);
    } catch (err) {
      console.error('Error initializing map:', err);
      setError('Failed to initialize map');
      setLoading(false);
    }
  };

  const addPropertyMarkers = (mapInstance: any) => {
    try {
      const newMarkers: any[] = [];
      const L = (window as any).L;

      properties.forEach((property) => {
        if (property.location?.coordinates && property.location.coordinates.length === 2) {
          const lat = property.location.coordinates[1];
          const lng = property.location.coordinates[0];

          // Create custom marker icon
          const markerIcon = L.divIcon({
            className: 'property-marker',
            html: `
            <div style="
              background-color: ${selectedPropertyId === property._id ? '#ff6b6b' : '#4CAF50'};
              color: white;
              border-radius: 50%;
              width: 30px;
              height: 30px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-weight: bold;
              font-size: 12px;
              border: 2px solid white;
              box-shadow: 0 2px 4px rgba(0,0,0,0.3);
              cursor: pointer;
            ">
              ${property.type === 'apartment' ? 'A' : property.type === 'house' ? 'H' : property.type === 'room' ? 'R' : 'S'}
            </div>
          `,
            iconSize: [30, 30],
            iconAnchor: [15, 15],
          });

          const marker = L.marker([lat, lng], { icon: markerIcon }).addTo(mapInstance);

          // Create popup content
          const popupContent = `
          <div style="padding: 8px; min-width: 200px;">
            <h3 style="margin: 0 0 8px 0; font-size: 16px; color: #333;">${property.title}</h3>
            <p style="margin: 0 0 8px 0; font-size: 12px; color: #666;">${property.location}</p>
            <p style="margin: 0 0 12px 0; font-size: 18px; font-weight: bold; color: #4CAF50;">
              $${property.rent.amount}/${property.priceUnit || property.rent.paymentFrequency}
            </p>
            <div style="display: flex; gap: 8px;">
              <button onclick="window.selectProperty('${property._id}')" style="
                background-color: #4CAF50;
                color: white;
                border: none;
                padding: 6px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
              ">Select</button>
              <button onclick="window.viewProperty('${property._id}')" style="
                background-color: transparent;
                color: #4CAF50;
                border: 1px solid #4CAF50;
                padding: 6px 12px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 12px;
              ">View</button>
            </div>
          </div>
        `;

          marker.bindPopup(popupContent);

          // Add click handlers
          marker.on('click', () => {
            if (onPropertySelect) {
              onPropertySelect(property);
            }
          });

          newMarkers.push(marker);
        }
      });

      setMarkers(newMarkers);

      // Add global functions for popup buttons
      (window as any).selectProperty = (propertyId: string) => {
        const property = properties.find((p) => p._id === propertyId);
        if (property && onPropertySelect) {
          onPropertySelect(property);
        }
      };

      (window as any).viewProperty = (propertyId: string) => {
        const property = properties.find((p) => p._id === propertyId);
        if (property && onPropertyPress) {
          onPropertyPress(property);
        }
      };
    } catch (err) {
      console.error('Error adding markers:', err);
    }
  };

  // Update markers when properties change
  useEffect(() => {
    if (map) {
      try {
        // Remove existing markers
        markers.forEach((marker) => {
          map.removeLayer(marker);
        });

        // Add new markers
        addPropertyMarkers(map);
      } catch (err) {
        console.error('Error updating markers:', err);
      }
    }
  }, [properties, selectedPropertyId]);

  // Update map center when center prop changes
  useEffect(() => {
    if (map && center) {
      try {
        map.setView([center.lat, center.lng], zoom);
      } catch (err) {
        console.error('Error updating map center:', err);
      }
    }
  }, [center, zoom]);

  // Add map move event to save state
  useEffect(() => {
    if (map && screenId) {
      const handleMoveEnd = () => {
        const center = map.getCenter();
        const zoom = map.getZoom();
        setMapState(screenId, {
          center: [center.lng, center.lat],
          zoom: zoom,
        });
      };

      map.on('moveend', handleMoveEnd);
      map.on('zoomend', handleMoveEnd);

      return () => {
        map.off('moveend', handleMoveEnd);
        map.off('zoomend', handleMoveEnd);
      };
    }
  }, [map, screenId, setMapState]);

  if (error) {
    return (
      <View style={[styles.container, { height }, styles.errorContainer]}>
        <Text style={styles.errorText}>Failed to load map</Text>
        <Text style={styles.errorSubtext}>{error}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => {
            setError(null);
            setLoading(true);
            // Force reload
            window.location.reload();
          }}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
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

// Mobile-specific properties map component
const MobilePropertiesMap: React.FC<PropertiesMapProps> = (props) => {
  const { WebView } = require('react-native-webview');
  const { getMapState, setMapState } = useMapState();
  const webViewRef = useRef<any>(null);
  const [mapHtml, setMapHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Get saved map state if screenId is provided
  const savedState = props.screenId ? getMapState(props.screenId) : null;

  // Calculate center if not provided
  const mapCenter =
    savedState?.center ? { lat: savedState.center[1], lng: savedState.center[0] } :
      props.center ||
      (() => {
        const validProperties = props.properties.filter(
          (p) => p.address?.coordinates?.lat && p.address?.coordinates?.lng,
        );

        if (validProperties.length > 0) {
          const avgLat =
            validProperties.reduce((sum, p) => sum + (p.address.coordinates?.lat || 0), 0) /
            validProperties.length;
          const avgLng =
            validProperties.reduce((sum, p) => sum + (p.address.coordinates?.lng || 0), 0) /
            validProperties.length;
          return { lat: avgLat, lng: avgLng };
        }

        return { lat: 41.38723, lng: 2.16538 }; // Default to Barcelona
      })();

  useEffect(() => {
    const propertiesData = props.properties
      .filter((p) => p.address?.coordinates?.lat && p.address?.coordinates?.lng)
      .map((p) => ({
        id: p._id,
        lat: p.address.coordinates!.lat,
        lng: p.address.coordinates!.lng,
        title: p.title,
        location: p.location,
        price: p.rent.amount,
        frequency: p.priceUnit || p.rent.paymentFrequency,
        type: p.type,
        isSelected: props.selectedPropertyId === p._id,
      }));

    const html = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
          <title>Properties Map</title>
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
            .property-marker {
              background-color: #4CAF50;
              color: white;
              border-radius: 50%;
              width: 30px;
              height: 30px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-weight: bold;
              font-size: 12px;
              border: 2px solid white;
              box-shadow: 0 2px 4px rgba(0,0,0,0.3);
            }
            .property-marker.selected {
              background-color: #ff6b6b;
            }
            .leaflet-popup-content {
              margin: 8px;
              min-width: 200px;
            }
            .leaflet-popup-content h3 {
              margin: 0 0 8px 0;
              font-size: 16px;
              color: #333;
            }
            .leaflet-popup-content p {
              margin: 0 0 8px 0;
              font-size: 12px;
              color: #666;
            }
            .leaflet-popup-content .price {
              margin: 0 0 12px 0;
              font-size: 18px;
              font-weight: bold;
              color: #4CAF50;
            }
            .leaflet-popup-content .buttons {
              display: flex;
              gap: 8px;
            }
            .leaflet-popup-content button {
              background-color: #4CAF50;
              color: white;
              border: none;
              padding: 6px 12px;
              border-radius: 4px;
              cursor: pointer;
              font-size: 12px;
            }
            .leaflet-popup-content button.secondary {
              background-color: transparent;
              color: #4CAF50;
              border: 1px solid #4CAF50;
            }
            .leaflet-control-attribution {
              display: none !important;
            }
          </style>
        </head>
        <body>
          <div id="map"></div>
          
          <script>
            const properties = ${JSON.stringify(propertiesData)};
            let map, markers = [];
            
            // Initialize map
            map = L.map('map', {
              zoomControl: true,
              attributionControl: false,
            }).setView([${mapCenter.lat}, ${mapCenter.lng}], ${savedState?.zoom || props.zoom || 12});
            
            // Add OpenStreetMap tiles
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
            
            // Add property markers
            properties.forEach(property => {
              const markerIcon = L.divIcon({
                className: 'property-marker' + (property.isSelected ? ' selected' : ''),
                html: '<div style="background-color: ' + (property.isSelected ? '#ff6b6b' : '#4CAF50') + '; color: white; border-radius: 50%; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.3);">' + 
                       (property.type === 'apartment' ? 'A' : property.type === 'house' ? 'H' : property.type === 'room' ? 'R' : 'S') + '</div>',
                iconSize: [30, 30],
                iconAnchor: [15, 15],
              });
              
              const marker = L.marker([property.lat, property.lng], { icon: markerIcon }).addTo(map);
              
              const popupContent = \`
                <div>
                  <h3>\${property.title}</h3>
                  <p>\${property.location}</p>
                  <p class="price">$\${property.price}/\${property.frequency}</p>
                  <div class="buttons">
                    <button onclick="selectProperty('\${property.id}')">Select</button>
                    <button class="secondary" onclick="viewProperty('\${property.id}')">View</button>
                  </div>
                </div>
              \`;
              
              marker.bindPopup(popupContent);
              markers.push(marker);
              
              marker.on('click', function() {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'propertySelected',
                  propertyId: property.id
                }));
              });
            });
            
            function selectProperty(propertyId) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'propertySelected',
                propertyId: propertyId
              }));
            }
            
            function viewProperty(propertyId) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'propertyPressed',
                propertyId: propertyId
              }));
            }
            
            // Notify that map is loaded
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'mapLoaded'
            }));
          </script>
        </body>
      </html>
    `;

    setMapHtml(html);
  }, [props.properties, props.selectedPropertyId, props.center, props.zoom]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'mapLoaded') {
        setLoading(false);
        setError(null);
      } else if (data.type === 'propertySelected' && props.onPropertySelect) {
        const property = props.properties.find((p) => p._id === data.propertyId);
        if (property) {
          props.onPropertySelect(property);
        }
      } else if (data.type === 'propertyPressed' && props.onPropertyPress) {
        const property = props.properties.find((p) => p._id === data.propertyId);
        if (property) {
          props.onPropertyPress(property);
        }
      } else if (data.type === 'mapMoved' && props.screenId) {
        // Save map state when map is moved
        setMapState(props.screenId, {
          center: [data.center.lng, data.center.lat],
          zoom: data.zoom,
        });
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

  if (error) {
    return (
      <View style={[styles.container, { height: props.height }, styles.errorContainer]}>
        <Text style={styles.errorText}>Failed to load map</Text>
        <Text style={styles.errorSubtext}>{error}</Text>
        <TouchableOpacity
          style={styles.retryButton}
          onPress={() => {
            setError(null);
            setLoading(true);
          }}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
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
export const PropertiesMap: React.FC<PropertiesMapProps> = (props) => {
  // Use web implementation for web platform
  if (Platform.OS === 'web') {
    return <WebPropertiesMap {...props} />;
  }

  // Use mobile implementation for iOS and Android
  return <MobilePropertiesMap {...props} />;
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
    backgroundColor: colors.primaryLight_1,
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
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: colors.primaryColor,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 25,
  },
  retryButtonText: {
    color: 'white',
    fontWeight: '600',
    fontSize: 14,
  },
  propertyPrice: {
    margin: 0,
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primaryDark,
  },
});
