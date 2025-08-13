import { api } from '@/utils/api';
import { OxyServices } from '@oxyhq/services';

export interface NeighborhoodRating {
  category: string;
  score: number;
  icon: string;
  description?: string;
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

export interface NeighborhoodFilters {
  city?: string;
  state?: string;
  country?: string;
  minScore?: number;
  maxScore?: number;
}

class NeighborhoodService {
  /**
   * Get neighborhood data by coordinates or address
   */
  async getNeighborhoodByLocation(
    latitude: number,
    longitude: number,
    oxyServices?: OxyServices,
    activeSessionId?: string,
  ): Promise<NeighborhoodData> {
    try {
      const response = await api.get<NeighborhoodData>('/api/neighborhoods/by-location', {
        params: { latitude, longitude },
        oxyServices,
        activeSessionId,
      });
      return response.data;
    } catch (error) {
      console.error('Failed to fetch neighborhood by location:', error);
      // Return mock data for development
      return this.getMockNeighborhoodData();
    }
  }

  /**
   * Get neighborhood data by name
   */
  async getNeighborhoodByName(
    name: string,
    city?: string,
    state?: string,
    oxyServices?: OxyServices,
    activeSessionId?: string,
  ): Promise<NeighborhoodData> {
    try {
      const response = await api.get<NeighborhoodData>('/api/neighborhoods/by-name', {
        params: { name, city, state },
        oxyServices,
        activeSessionId,
      });
      return response.data;
    } catch (error) {
      console.error('Failed to fetch neighborhood by name:', error);
      // Return mock data for development
      return this.getMockNeighborhoodData(name, city, state);
    }
  }

  /**
   * Get neighborhood data by property ID
   */
  async getNeighborhoodByProperty(
    propertyId: string,
    oxyServices?: OxyServices,
    activeSessionId?: string,
  ): Promise<NeighborhoodData> {
    try {
      const response = await api.get<NeighborhoodData>(
        `/api/neighborhoods/by-property/${propertyId}`,
        {
          oxyServices,
          activeSessionId,
        },
      );
      return response.data;
    } catch (error) {
      console.error('Failed to fetch neighborhood by property:', error);
      // Return mock data for development
      return this.getMockNeighborhoodData();
    }
  }

  /**
   * Search neighborhoods
   */
  async searchNeighborhoods(
    filters: NeighborhoodFilters,
    oxyServices?: OxyServices,
    activeSessionId?: string,
  ): Promise<NeighborhoodData[]> {
    try {
      const response = await api.get<NeighborhoodData[]>('/api/neighborhoods/search', {
        params: filters,
        oxyServices,
        activeSessionId,
      });
      return response.data;
    } catch (error) {
      console.error('Failed to search neighborhoods:', error);
      // Return mock data for development
      return [this.getMockNeighborhoodData()];
    }
  }

  /**
   * Get popular neighborhoods for a city
   */
  async getPopularNeighborhoods(
    city: string,
    state?: string,
    limit: number = 10,
    oxyServices?: OxyServices,
    activeSessionId?: string,
  ): Promise<NeighborhoodData[]> {
    try {
      const response = await api.get<NeighborhoodData[]>('/api/neighborhoods/popular', {
        params: { city, state, limit },
        oxyServices,
        activeSessionId,
      });
      return response.data;
    } catch (error) {
      console.error('Failed to fetch popular neighborhoods:', error);
      // Return mock data for development
      return [
        this.getMockNeighborhoodData('El Born', city, state),
        this.getMockNeighborhoodData('Gothic Quarter', city, state),
        this.getMockNeighborhoodData('Eixample', city, state),
      ];
    }
  }

  /**
   * Mock data for development
   */
  private getMockNeighborhoodData(
    name: string = 'El Born',
    city: string = 'Barcelona',
    state: string = 'Catalonia',
  ): NeighborhoodData {
    return {
      id: `neighborhood-${Date.now()}`,
      name,
      city,
      state,
      country: 'Spain',
      overallScore: 4.2,
      description: `${name} is a vibrant neighborhood known for its historic architecture, trendy boutiques, and excellent dining scene.`,
      population: 15000,
      averageRent: 1200,
      crimeRate: 2.1,
      walkScore: 95,
      transitScore: 88,
      bikeScore: 92,
      amenities: {
        restaurants: 45,
        cafes: 23,
        bars: 18,
        groceryStores: 8,
        parks: 5,
        schools: 3,
        hospitals: 1,
        shoppingCenters: 2,
      },
      ratings: [
        {
          category: 'Safety',
          score: 4.5,
          icon: 'shield-checkmark-outline',
          description: 'Low crime rate, well-lit streets',
        },
        {
          category: 'Dining',
          score: 4.8,
          icon: 'restaurant-outline',
          description: 'Excellent variety of restaurants',
        },
        {
          category: 'Transit',
          score: 4.3,
          icon: 'subway-outline',
          description: 'Good public transportation access',
        },
        {
          category: 'Nightlife',
          score: 4.0,
          icon: 'wine-outline',
          description: 'Lively bars and entertainment',
        },
        {
          category: 'Shopping',
          score: 3.9,
          icon: 'bag-outline',
          description: 'Good mix of local and chain stores',
        },
        {
          category: 'Parks',
          score: 4.1,
          icon: 'leaf-outline',
          description: 'Several green spaces nearby',
        },
        {
          category: 'Schools',
          score: 4.2,
          icon: 'school-outline',
          description: 'Quality educational institutions',
        },
        {
          category: 'Healthcare',
          score: 4.4,
          icon: 'medical-outline',
          description: 'Access to medical facilities',
        },
      ],
      images: [
        'https://images.unsplash.com/photo-1539037116277-4db20889f2d4?w=400',
        'https://images.unsplash.com/photo-1555992336-03a23c7b20ee?w=400',
      ],
      lastUpdated: new Date().toISOString(),
    };
  }
}

export default new NeighborhoodService();
