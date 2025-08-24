/**
 * Address-related types shared across Homiio frontend and backend
 */

import { GeoJSONPoint } from './common';

export interface Address {
  // Core location fields
  street: string;
  city: string;
  state?: string; // Made optional for international support
  postal_code: string; // Renamed from zipCode
  country: string;
  countryCode: string; // ISO-2 country code
  
  // Detailed address components
  number?: string;
  building_name?: string;
  block?: string;
  entrance?: string;
  floor?: string;
  unit?: string;
  subunit?: string;
  district?: string;
  neighborhood?: string;
  address_lines?: string[];
  
  // Land plot information
  land_plot?: {
    block?: string;
    lot?: string;
    parcel?: string;
  };
  
  // Flexible additional data
  extras?: any;
  
  // Coordinates
  coordinates?: GeoJSONPoint;
}

export interface AddressDocument extends Address {
  _id: string;
  id: string;
  normalizedKey: string;
  fullAddress: string;
  location: string;
  createdAt: Date;
  updatedAt: Date;
}

// Legacy interface for backward compatibility
export interface LegacyAddress {
  street: string;
  city: string;
  state: string;
  zipCode: string; // Legacy field name
  country: string;
  neighborhood?: string;
  coordinates?: GeoJSONPoint;
}

export interface AddressDetail extends Omit<Address, 'neighborhood'> {
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
    state?: string; // Made optional
    country: string;
    postcode: string;
    countryCode?: string; // Added country code
  };
}

export interface AddressCoordinates {
  latitude: number;
  longitude: number;
}

// Input interface for address creation with aliases support
export interface AddressInput {
  // Core fields
  street: string;
  city: string;
  state?: string;
  postal_code?: string;
  country: string;
  countryCode?: string;
  
  // Extended fields
  number?: string;
  building_name?: string;
  block?: string;
  entrance?: string;
  floor?: string;
  unit?: string;
  subunit?: string;
  district?: string;
  neighborhood?: string;
  address_lines?: string[];
  land_plot?: {
    block?: string;
    lot?: string;
    parcel?: string;
  };
  extras?: any;
  coordinates?: GeoJSONPoint;
  
  // Legacy/alias fields for backward compatibility
  zipCode?: string;
  zip?: string;
  postcode?: string;
  codigo_postal?: string;
  puerta?: string;
  apartment?: string;
  suite?: string;
  apt?: string;
  piso?: string;
  bloque?: string;
  torre?: string;
  tower?: string;
  building?: string;
  planta?: string;
  nivel?: string;
  level?: string;
  line1?: string;
  line2?: string;
}