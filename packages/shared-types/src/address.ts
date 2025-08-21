/**
 * Address-related types shared across Homiio frontend and backend
 */

import { Coordinates } from './common';

export interface Address {
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  neighborhood?: string;
  coordinates?: Coordinates;
  showAddressNumber?: boolean;
}

export interface AddressDetail extends Address {
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
    type: 'restaurant' | 'grocery' | 'pharmacy' | 'school' | 'hospital' | 'park' | 'transit' | 'shopping';
    distance: number;
    rating?: number;
    address?: string;
    phone?: string;
  }>;
}

export interface AddressSuggestion {
  id: string;
  text: string;
  icon: string;
  lat?: number;
  lon?: number;
  address?: {
    street: string;
    city: string;
    state: string;
    country: string;
    postcode: string;
  };
}

export interface AddressCoordinates {
  latitude: number;
  longitude: number;
} 