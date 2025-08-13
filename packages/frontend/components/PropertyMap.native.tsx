import React, { useRef, useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { colors } from '@/styles/colors';
import { ThemedText } from './ThemedText';

interface PropertyMapProps {
  latitude?: number;
  longitude?: number;
  address?: string;
  onLocationSelect?: (lat: number, lng: number, address: string) => void;
  height?: number;
  interactive?: boolean;
}

export const PropertyMap: React.FC<PropertyMapProps> = ({
  latitude = 40.7128,
  longitude = -74.006,
  address = '',
  onLocationSelect,
  height = 300,
  interactive = true,
}) => {
  const webViewRef = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // HTML content for the map
  const mapHtml = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <style>
            body { margin: 0; padding: 0; }
            #map { width: 100%; height: 100vh; }
        </style>
    </head>
    <body>
        <div id="map"></div>
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <script>
            const map = L.map('map').setView([${latitude}, ${longitude}], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors'
            }).addTo(map);
            
            let marker = null;
            if (${latitude} && ${longitude}) {
                marker = L.marker([${latitude}, ${longitude}]).addTo(map);
            }
            
            ${
              interactive
                ? `
            map.on('click', function(e) {
                const lat = e.latlng.lat;
                const lng = e.latlng.lng;
                
                fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng)
                    .then(response => response.json())
                    .then(data => {
                        const addr = data.display_name || 'Unknown location';
                        if (marker) map.removeLayer(marker);
                        marker = L.marker([lat, lng]).addTo(map);
                        map.setView([lat, lng], 16);
                        window.ReactNativeWebView.postMessage(JSON.stringify({
                            type: 'locationSelected',
                            lat: lat,
                            lng: lng,
                            address: addr
                        }));
                    })
                    .catch(() => {
                        if (marker) map.removeLayer(marker);
                        marker = L.marker([lat, lng]).addTo(map);
                        map.setView([lat, lng], 16);
                        window.ReactNativeWebView.postMessage(JSON.stringify({
                            type: 'locationSelected',
                            lat: lat,
                            lng: lng,
                            address: 'Selected location'
                        }));
                    });
            });
            `
                : ''
            }
            
            // Notify that map is loaded
            window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'mapLoaded'
            }));
        </script>
    </body>
    </html>
  `;

  // Handle messages from WebView
  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'mapLoaded') {
        setLoading(false);
      } else if (data.type === 'locationSelected' && onLocationSelect) {
        onLocationSelect(data.lat, data.lng, data.address);
      }
    } catch (error) {
      console.error('Error parsing WebView message:', error);
    }
  };

  // Function to update map location programmatically
  const updateMapLocation = (lat: number, lng: number) => {
    if (webViewRef.current) {
      const updateScript = `
                if (marker) map.removeLayer(marker);
                marker = L.marker([${lat}, ${lng}]).addTo(map);
                map.setView([${lat}, ${lng}], 16);
            `;
      webViewRef.current.injectJavaScript(updateScript);
    }
  };

  // Update map when coordinates change
  useEffect(() => {
    if (latitude && longitude && webViewRef.current) {
      updateMapLocation(latitude, longitude);
    }
  }, [latitude, longitude]);

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
      <WebView
        key={`${latitude}-${longitude}`}
        ref={webViewRef}
        source={{ html: mapHtml }}
        style={styles.webview}
        onMessage={handleMessage}
        onError={() => {
          setError('Failed to load map');
          setLoading(false);
        }}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        scalesPageToFit={true}
        bounces={false}
        scrollEnabled={false}
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
