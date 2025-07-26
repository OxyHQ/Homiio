/**
 * City-related types shared across Homiio frontend and backend
 */

import { Coordinates, Pagination } from './common';
import { Property } from './property';

export interface City {
  _id: string;
  name: string;
  state: string;
  country: string;
  coordinates?: Coordinates;
  timezone?: string;
  population?: number;
  description?: string;
  popularNeighborhoods?: string[];
  averageRent?: number;
  currency: string;
  isActive: boolean;
  propertiesCount: number;
  lastUpdated: string;
  createdAt: string;
  updatedAt: string;
  fullLocation?: string;
  displayName?: string;
}

export interface CityFilters {
  search?: string;
  state?: string;
  country?: string;
  limit?: number;
  page?: number;
}

export interface CityPropertiesResponse {
  city: City;
  properties: Property[];
  pagination: Pagination;
}

export interface CitiesResponse {
  data: City[];
  pagination: Pagination;
}

export interface NeighborhoodData {
  id: string;
  name: string;
  city: string;
  state: string;
  country: string;
  overallScore: number;
  ratings: NeighborhoodRating[];
  description?: string;
  population?: number;
  averageRent?: number;
  crimeRate?: number;
  walkScore?: number;
  transitScore?: number;
  bikeScore?: number;
  amenities?: {
    restaurants: number;
    cafes: number;
    bars: number;
    groceryStores: number;
    parks: number;
    schools: number;
    hospitals: number;
    shoppingCenters: number;
  };
  images?: string[];
  lastUpdated: string;
}

export interface NeighborhoodRating {
  category: string;
  score: number;
  weight: number;
  description: string;
} 