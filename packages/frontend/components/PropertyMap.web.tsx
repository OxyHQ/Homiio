import React, { useRef, useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text } from 'react-native';
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
    longitude = -74.0060,
    address = '',
    onLocationSelect,
    height = 300,
    interactive = true,
}) => {
    const mapRef = useRef<HTMLDivElement>(null);
    const leafletMap = useRef<any>(null);
    const markerRef = useRef<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Load Leaflet on mount
    useEffect(() => {
        if (!mapRef.current) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
        document.head.appendChild(link);
        const script = document.createElement('script');
        script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
        script.onload = () => initializeMap();
        script.onerror = () => {
            setError('Failed to load map library');
            setLoading(false);
        };
        document.head.appendChild(script);
        return () => {
            if (document.head.contains(link)) document.head.removeChild(link);
            if (document.head.contains(script)) document.head.removeChild(script);
        };
        // eslint-disable-next-line
    }, []);

    // Update map when latitude/longitude change
    useEffect(() => {
        if (leafletMap.current && (window as any).L && latitude && longitude) {
            const L = (window as any).L;
            if (markerRef.current) {
                leafletMap.current.removeLayer(markerRef.current);
            }
            markerRef.current = L.marker([latitude, longitude]).addTo(leafletMap.current);
            leafletMap.current.setView([latitude, longitude], 16);
        }
    }, [latitude, longitude]);

    // Initialize map
    const initializeMap = () => {
        if (!mapRef.current || !(window as any).L) return;
        const L = (window as any).L;
        leafletMap.current = L.map(mapRef.current).setView([latitude, longitude], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors'
        }).addTo(leafletMap.current);
        if (latitude && longitude) {
            markerRef.current = L.marker([latitude, longitude]).addTo(leafletMap.current);
        }
        if (interactive) {
            leafletMap.current.on('click', function (e: any) {
                const lat = e.latlng.lat;
                const lng = e.latlng.lng;
                fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`)
                    .then(response => response.json())
                    .then(data => {
                        const addr = data.display_name || 'Unknown location';
                        selectLocation(lat, lng, addr);
                    })
                    .catch(() => {
                        selectLocation(lat, lng, 'Selected location');
                    });
            });
        }
        setLoading(false);
    };

    // Select location from map click
    const selectLocation = (lat: number, lng: number, addr: string) => {
        if (leafletMap.current && (window as any).L) {
            const L = (window as any).L;
            if (markerRef.current) {
                leafletMap.current.removeLayer(markerRef.current);
            }
            markerRef.current = L.marker([lat, lng]).addTo(leafletMap.current);
            leafletMap.current.setView([lat, lng], 16);
        }
        if (onLocationSelect) onLocationSelect(lat, lng, addr);
    };

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