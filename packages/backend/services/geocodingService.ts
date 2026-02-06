/**
 * Geocoding Service
 * Handles address lookup and reverse geocoding using Mapbox API
 */

import config from '../config';

const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN || config.mapbox?.token;

export interface AddressData {
  street?: string;
  houseNumber?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  fullAddress?: string;
}

export interface GeocodingResult {
  success: boolean;
  data?: AddressData;
  error?: string;
}

/**
 * Reverse geocode coordinates to get address information
 * @param longitude - Longitude coordinate
 * @param latitude - Latitude coordinate
 * @returns Promise<GeocodingResult>
 */
export async function reverseGeocode(longitude: number, latitude: number): Promise<GeocodingResult> {
  try {
    if (!MAPBOX_TOKEN) {
      return {
        success: false,
        error: 'Mapbox token not configured'
      };
    }

    // Validate coordinates
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
      return {
        success: false,
        error: 'Invalid coordinates provided'
      };
    }

    const response = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${MAPBOX_TOKEN}&types=address,poi,neighborhood&limit=1`
    );

    if (!response.ok) {
      throw new Error(`Mapbox API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const feature = data.features?.[0];

    if (!feature) {
      return {
        success: false,
        error: 'No address found for the provided coordinates'
      };
    }

    const context = feature.context || [];
    const addressData: AddressData = {
      street: feature.text || '',
      houseNumber: feature.address || '',
      neighborhood: context.find((c: any) => c.id.startsWith('neighborhood'))?.text || '',
      city: context.find((c: any) => c.id.startsWith('place'))?.text || '',
      state: context.find((c: any) => c.id.startsWith('region'))?.text || '',
      country: context.find((c: any) => c.id.startsWith('country'))?.text || '',
      postalCode: context.find((c: any) => c.id.startsWith('postcode'))?.text || '',
      fullAddress: feature.place_name || '',
    };

    return {
      success: true,
      data: addressData
    };

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Geocoding failed'
    };
  }
}

/**
 * Forward geocode address to get coordinates
 * @param address - Address string to geocode
 * @returns Promise<GeocodingResult>
 */
export async function forwardGeocode(address: string): Promise<GeocodingResult> {
  try {
    if (!MAPBOX_TOKEN) {
      return {
        success: false,
        error: 'Mapbox token not configured'
      };
    }

    if (!address || address.trim().length === 0) {
      return {
        success: false,
        error: 'Address is required'
      };
    }

    const response = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address.trim())}.json?access_token=${MAPBOX_TOKEN}&types=address,poi&limit=1`
    );

    if (!response.ok) {
      throw new Error(`Mapbox API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    const feature = data.features?.[0];

    if (!feature) {
      return {
        success: false,
        error: 'No coordinates found for the provided address'
      };
    }

    const coordinates = feature.center;
    const context = feature.context || [];
    
    const addressData: AddressData = {
      street: feature.text || '',
      houseNumber: feature.address || '',
      neighborhood: context.find((c: any) => c.id.startsWith('neighborhood'))?.text || '',
      city: context.find((c: any) => c.id.startsWith('place'))?.text || '',
      state: context.find((c: any) => c.id.startsWith('region'))?.text || '',
      country: context.find((c: any) => c.id.startsWith('country'))?.text || '',
      postalCode: context.find((c: any) => c.id.startsWith('postcode'))?.text || '',
      fullAddress: feature.place_name || '',
    };

    return {
      success: true,
      data: addressData
    };

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Geocoding failed'
    };
  }
}

export default {
  reverseGeocode,
  forwardGeocode
};
