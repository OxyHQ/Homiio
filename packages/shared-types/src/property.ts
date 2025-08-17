/**
 * Property-related types shared across Homiio frontend and backend
 */

import { 
  PropertyType, 
  PropertyStatus, 
  HousingType, 
  LayoutType, 
  PaymentFrequency, 
  UtilitiesIncluded, 
  PriceUnit,
  GeoJSONPoint,

  DeepPartial
} from './common';
import { Address } from './address';

export interface PropertyRent {
  amount: number;
  currency: string;
  paymentFrequency: PaymentFrequency;
  deposit: number;
  utilities: UtilitiesIncluded;
}

export interface PropertyEnergyStats {
  current: {
    voltage: number;
    current: number;
    power: number;
    powerFactor: number;
    frequency: number;
  };
  consumption: {
    daily: number;
    weekly: number;
    monthly: number;
    cost: {
      daily: number;
      weekly: number;
      monthly: number;
      currency: string;
    };
  };
}

export interface PropertyImage {
  url: string;
  caption?: string;
  isPrimary?: boolean;
}

export interface PropertyDocument {
  name: string;
  url: string;
  type: 'lease' | 'inspection' | 'insurance' | 'other';
}

export interface PropertyRules {
  petsAllowed?: boolean;
  smokingAllowed?: boolean;
  partiesAllowed?: boolean;
  guestsAllowed?: boolean;
  maxGuests?: number;
  quietHours?: {
    start: string;
    end: string;
  };
  additionalRules?: string[];
}

export interface PropertyAmenities {
  basic?: string[];
  luxury?: string[];
  accessibility?: string[];
  outdoor?: string[];
  parking?: string[];
  security?: string[];
}

export interface PropertyCharacteristics {
  type: PropertyType;
  housingType?: HousingType;
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  amenities: string[];
  location: {
    city: string;
    state: string;
  };
  floor?: number;
  hasElevator?: boolean;
  parkingSpaces?: number;
  yearBuilt?: number;
  isFurnished?: boolean;
  utilitiesIncluded?: boolean;
  petFriendly?: boolean;
  hasBalcony?: boolean;
  hasGarden?: boolean;
  proximityToTransport?: boolean;
  proximityToSchools?: boolean;
  proximityToShopping?: boolean;
}

export interface Property {
  _id: string; // MongoDB ObjectId
  id?: string; // Optional fallback
  profileId?: string; // Add profileId for landlord info
  address: Address;
  type: PropertyType;
  housingType?: HousingType;
  layoutType?: LayoutType;
  description?: string;
  squareFootage?: number;
  bedrooms?: number;
  bathrooms?: number;
  rent: PropertyRent;
  priceUnit?: PriceUnit;
  amenities?: string[];
  images?: string[] | PropertyImage[];
  status: PropertyStatus;
  ownerId: string;
  roomCount?: number;
  location?: GeoJSONPoint;
  energyStats?: PropertyEnergyStats;
  // Additional property details
  floor?: number;
  hasElevator?: boolean;
  parkingSpaces?: number;
  yearBuilt?: number;
  isFurnished?: boolean;
  utilitiesIncluded?: boolean;
  petFriendly?: boolean;
  hasBalcony?: boolean;
  hasGarden?: boolean;
  proximityToTransport?: boolean;
  proximityToSchools?: boolean;
  proximityToShopping?: boolean;
  rules?: PropertyRules;
  documents?: PropertyDocument[];
  coverImageIndex?: number;
  // Flags
  isVerified?: boolean;
  isEcoFriendly?: boolean;
  availableFrom?: string;
  leaseTerm?: string;
  maxGuests?: number;
  smokingAllowed?: boolean;
  partiesAllowed?: boolean;
  guestsAllowed?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePropertyData {
  address: Address;
  type: PropertyType;
  description?: string;
  squareFootage?: number;
  bedrooms?: number;
  bathrooms?: number;
  rent: PropertyRent;
  priceUnit?: PriceUnit;
  amenities?: string[];
  images?: string[];
  location?: GeoJSONPoint;
  // Additional comprehensive details for ethical pricing
  floor?: number;
  hasElevator?: boolean;
  parkingSpaces?: number;
  yearBuilt?: number;
  isFurnished?: boolean;
  utilitiesIncluded?: boolean;
  petFriendly?: boolean;
  hasBalcony?: boolean;
  hasGarden?: boolean;
  proximityToTransport?: boolean;
  proximityToSchools?: boolean;
  proximityToShopping?: boolean;
  // Accommodation-specific details
  accommodationDetails?: {
    sleepingArrangement?: 'couch' | 'air_mattress' | 'floor' | 'tent' | 'hammock';
    roommatePreferences?: string[];
    colivingFeatures?: string[];
    hostelRoomType?: 'dormitory' | 'private_room' | 'mixed_dorm' | 'female_dorm' | 'male_dorm';
    campsiteType?: 'tent_site' | 'rv_site' | 'cabin' | 'glamping' | 'backcountry';
    maxStay?: number;
    minAge?: number;
    maxAge?: number;
    languages?: string[];
    culturalExchange?: boolean;
    mealsIncluded?: boolean;
    wifiPassword?: string;
    houseRules?: string[];
  };
}

export interface PropertyFilters {
  type?: string;
  status?: string;
  available?: boolean;
  minRent?: number;
  maxRent?: number;
  bedrooms?: number;
  bathrooms?: number;
  search?: string;
  page?: number;
  limit?: number;
  // Location parameters
  lat?: number;
  lng?: number;
  radius?: number;
  city?: string;
  state?: string;
  country?: string;
  // Additional filters
  amenities?: string[];
  petFriendly?: boolean;
  furnished?: boolean;
  parking?: boolean;
  verified?: boolean;
  eco?: boolean;
}

export interface PropertyStructuredData {
  name: string;
  description: string;
  image: string;
  address: {
    streetAddress: string;
    addressLocality: string;
    addressRegion: string;
    postalCode: string;
    addressCountry: string;
  };
  price: number;
  priceCurrency: string;
  numberOfRooms: number;
  floorSize: number;
  floorSizeUnit: string;
  propertyType: string;
  availability: 'Available' | 'Rented' | 'Under Contract';
  url: string;
}

export interface SavedProperty extends Property {
  notes?: string;
  savedAt?: string;
}

export interface MapProperty extends Omit<Property, 'location'> {
  title: string;
  location: string;
}

export interface PropertyDetail {
  id: string;
  title: string;
  description: string;
  location: string;
  price: string;
  priceUnit: PriceUnit;
  bedrooms: number;
  bathrooms: number;
  size: number;
  isVerified: boolean;
  isEcoCertified: boolean;
  amenities: string[];
  landlordName: string;
  landlordRating: number;
  availableFrom: string;
  minStay: string;
  rating: number;
  energyRating: string;
  images: string[];
}

export interface PropertyDraft {
  id: string;
  title: string;
  address: Address;
  type: string;
  rent: {
    amount: number;
    currency: string;
  };
  lastSaved: Date;
  isDraft: boolean;
}

export type UpdatePropertyData = DeepPartial<Property>; 