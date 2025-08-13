import { useState, useEffect, useCallback } from 'react';
import { Platform } from 'react-native';
import { useLocationStore } from '@/store/locationStore';
import { useNeighborhoodStore } from '@/store/neighborhoodStore';

export interface AddressCoordinates {
  lat: number;
  lng: number;
}

export interface AddressDetail {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  coordinates?: AddressCoordinates;
  formattedAddress: string;
  neighborhood?: {
    name: string;
    walkScore?: number;
    transitScore?: number;
    bikeScore?: number;
    crimeRate?: number;
    averageRent?: number;
  };
  nearbyAmenities?: Array<{
    name: string;
    type:
      | 'restaurant'
      | 'grocery'
      | 'pharmacy'
      | 'school'
      | 'hospital'
      | 'park'
      | 'transit'
      | 'shopping';
    distance: number;
    rating?: number;
    address?: string;
    phone?: string;
  }>;
}

export interface UseAddressDetailReturn {
  addressDetail: AddressDetail | null;
  loading: boolean;
  error: string | null;
  geocodeAddress: (address: string) => Promise<AddressCoordinates | null>;
  fetchNeighborhoodData: (coordinates: AddressCoordinates) => Promise<void>;
  fetchNearbyAmenities: (coordinates: AddressCoordinates, radius?: number) => Promise<void>;
  calculateDistance: (lat1: number, lng1: number, lat2: number, lng2: number) => number;
  initializeAddressDetail: (
    street: string,
    city: string,
    state: string,
    zipCode: string,
    country?: string,
    coordinates?: AddressCoordinates,
  ) => void;
}

export function useAddressDetail(): UseAddressDetailReturn {
  const [addressDetail, setAddressDetail] = useState<AddressDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { currentLocation } = useLocationStore();
  const { setCurrentNeighborhood, setNearbyNeighborhoods } = useNeighborhoodStore();

  // Geocode address to get coordinates
  const geocodeAddress = useCallback(
    async (address: string): Promise<AddressCoordinates | null> => {
      try {
        setLoading(true);
        setError(null);

        // Use Google Geocoding API (you'll need to add your API key)
        const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;
        if (!apiKey) {
          console.warn('Google Maps API key not found. Using fallback geocoding.');
          return null;
        }

        const response = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`,
        );

        const data = await response.json();

        if (data.status === 'OK' && data.results.length > 0) {
          const location = data.results[0].geometry.location;
          return {
            lat: location.lat,
            lng: location.lng,
          };
        }

        return null;
      } catch (err) {
        console.error('Geocoding error:', err);
        setError('Failed to geocode address');
        return null;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Fetch neighborhood data (Walk Score, Transit Score, etc.)
  const fetchNeighborhoodData = useCallback(
    async (coordinates: AddressCoordinates): Promise<void> => {
      try {
        setLoading(true);
        setError(null);

        // Mock neighborhood data - in production, you'd use real APIs
        const mockNeighborhoodData = {
          id: `neighborhood-${coordinates.lat}-${coordinates.lng}`,
          name: 'Downtown Area',
          city: 'New York',
          state: 'NY',
          country: 'USA',
          coordinates: {
            latitude: coordinates.lat,
            longitude: coordinates.lng,
          },
          stats: {
            averageRent: Math.floor(Math.random() * 2000) + 1500,
            crimeRate: Math.random() * 5,
            walkScore: Math.floor(Math.random() * 40) + 60,
            transitScore: Math.floor(Math.random() * 40) + 60,
            bikeScore: Math.floor(Math.random() * 40) + 60,
          },
        };

        setCurrentNeighborhood(mockNeighborhoodData);

        // Update address detail with neighborhood info
        setAddressDetail((prev) =>
          prev
            ? {
                ...prev,
                neighborhood: {
                  name: mockNeighborhoodData.name,
                  walkScore: mockNeighborhoodData.stats.walkScore,
                  transitScore: mockNeighborhoodData.stats.transitScore,
                  bikeScore: mockNeighborhoodData.stats.bikeScore,
                  crimeRate: mockNeighborhoodData.stats.crimeRate,
                  averageRent: mockNeighborhoodData.stats.averageRent,
                },
              }
            : null,
        );
      } catch (err) {
        console.error('Neighborhood data fetch error:', err);
        setError('Failed to fetch neighborhood data');
      } finally {
        setLoading(false);
      }
    },
    [setCurrentNeighborhood],
  );

  // Fetch nearby amenities
  const fetchNearbyAmenities = useCallback(
    async (coordinates: AddressCoordinates, radius: number = 1): Promise<void> => {
      try {
        setLoading(true);
        setError(null);

        // Mock amenities data - in production, you'd use Google Places API or similar
        const mockAmenities = [
          {
            name: 'Whole Foods Market',
            type: 'grocery' as const,
            distance: 0.3,
            rating: 4.5,
            address: '123 Main St',
            phone: '+1-555-0123',
          },
          {
            name: 'Starbucks',
            type: 'restaurant' as const,
            distance: 0.2,
            rating: 4.2,
            address: '456 Oak Ave',
            phone: '+1-555-0124',
          },
          {
            name: 'CVS Pharmacy',
            type: 'pharmacy' as const,
            distance: 0.4,
            rating: 4.0,
            address: '789 Pine St',
            phone: '+1-555-0125',
          },
          {
            name: 'Central Park',
            type: 'park' as const,
            distance: 0.8,
            rating: 4.8,
            address: 'Central Park',
            phone: '+1-555-0126',
          },
          {
            name: 'Metro Station',
            type: 'transit' as const,
            distance: 0.5,
            rating: 4.3,
            address: 'Subway Station',
            phone: '+1-555-0127',
          },
          {
            name: 'Public Library',
            type: 'school' as const,
            distance: 0.6,
            rating: 4.4,
            address: '321 Library Blvd',
            phone: '+1-555-0128',
          },
          {
            name: 'Shopping Center',
            type: 'shopping' as const,
            distance: 0.7,
            rating: 4.1,
            address: '654 Mall Dr',
            phone: '+1-555-0129',
          },
          {
            name: 'Local Hospital',
            type: 'hospital' as const,
            distance: 1.2,
            rating: 4.6,
            address: '987 Medical Center',
            phone: '+1-555-0130',
          },
        ];

        // Filter amenities within radius
        const nearbyAmenities = mockAmenities.filter((amenity) => amenity.distance <= radius);

        // Update address detail with amenities
        setAddressDetail((prev) =>
          prev
            ? {
                ...prev,
                nearbyAmenities,
              }
            : null,
        );
      } catch (err) {
        console.error('Amenities fetch error:', err);
        setError('Failed to fetch nearby amenities');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Calculate distance between two points using Haversine formula
  const calculateDistance = useCallback(
    (lat1: number, lng1: number, lat2: number, lng2: number): number => {
      const R = 3959; // Earth's radius in miles
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLng = ((lng2 - lng1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLng / 2) *
          Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    },
    [],
  );

  // Initialize address detail from components
  const initializeAddressDetail = useCallback(
    (
      street: string,
      city: string,
      state: string,
      zipCode: string,
      country: string = 'USA',
      coordinates?: AddressCoordinates,
    ) => {
      const detail: AddressDetail = {
        street,
        city,
        state,
        zipCode,
        country,
        coordinates,
        formattedAddress: `${street}, ${city}, ${state} ${zipCode}`,
      };

      setAddressDetail(detail);

      // If coordinates are provided, fetch additional data
      if (coordinates) {
        fetchNeighborhoodData(coordinates);
        fetchNearbyAmenities(coordinates);
      }
    },
    [fetchNeighborhoodData, fetchNearbyAmenities],
  );

  return {
    addressDetail,
    loading,
    error,
    geocodeAddress,
    fetchNeighborhoodData,
    fetchNearbyAmenities,
    calculateDistance,
    initializeAddressDetail,
  };
}
