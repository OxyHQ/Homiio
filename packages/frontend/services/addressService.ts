/**
 * Address Service
 * API calls for address-related operations
 */

import { ApiResponse } from '../types/api';

export interface AddressData {
  _id: string;
  street: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
  neighborhood?: string;
  coordinates: {
    type: 'Point';
    coordinates: [number, number]; // [longitude, latitude]
  };
  fullAddress: string;
  location: string;
  createdAt: string;
  updatedAt: string;
}

class AddressService {
  private baseUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

  /**
   * Get address by ID
   */
  async getAddressById(addressId: string): Promise<ApiResponse<{ address: AddressData }>> {
    try {
      const response = await fetch(`${this.baseUrl}/api/addresses/${addressId}`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: true,
        data: data,
        message: 'Address fetched successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch address',
        data: null
      };
    }
  }

  /**
   * Search addresses
   */
  async searchAddresses(
    query: string,
    page: number = 1,
    limit: number = 10
  ): Promise<ApiResponse<{ addresses: AddressData[] }>> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/addresses/search?q=${encodeURIComponent(query)}&page=${page}&limit=${limit}`
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: true,
        data: data,
        message: 'Addresses searched successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search addresses',
        data: null
      };
    }
  }

  /**
   * Get addresses near coordinates
   */
  async getNearbyAddresses(
    longitude: number,
    latitude: number,
    radius: number = 1000, // in meters
    limit: number = 10
  ): Promise<ApiResponse<{ addresses: AddressData[] }>> {
    try {
      const response = await fetch(
        `${this.baseUrl}/api/addresses/nearby?lng=${longitude}&lat=${latitude}&radius=${radius}&limit=${limit}`
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return {
        success: true,
        data: data,
        message: 'Nearby addresses fetched successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch nearby addresses',
        data: null
      };
    }
  }
}

export const addressService = new AddressService();
export default addressService;
