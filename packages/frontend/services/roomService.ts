import { api } from '@/utils/api';
import { OxyServices } from '@oxyhq/services';

export interface RoomFilters {
  minRent?: number;
  maxRent?: number;
  type?: string;
  furnished?: boolean;
  amenities?: string[];
  genderPreference?: 'male' | 'female' | 'any';
  minAge?: number;
  maxAge?: number;
  pets?: boolean;
  smoking?: boolean;
  city?: string;
  state?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface Room {
  id: string;
  propertyId: string;
  name: string;
  description?: string;
  type: string;
  floor: number;
  squareFootage: number;
  dimensions?: {
    length: number;
    width: number;
    height: number;
    unit: 'feet' | 'meters';
  };
  rent: {
    amount: number;
    currency: string;
    included: boolean;
  };
  amenities: string[];
  features: {
    name: string;
    description?: string;
  }[];
  images: {
    url: string;
    caption?: string;
    isPrimary: boolean;
  }[];
  availability: {
    isAvailable: boolean;
    availableFrom: Date;
    availableUntil?: Date;
  };
  occupancy: {
    maxOccupants: number;
    currentOccupants: number;
    occupantIds: string[];
    genderPreference?: 'male' | 'female' | 'any';
    ageRange?: {
      min: number;
      max: number;
    };
  };
  status: 'available' | 'occupied' | 'maintenance' | 'renovating' | 'unavailable';
}

export interface Property {
  id: string;
  title: string;
  address: {
    street: string;
    city: string;
    state: string;
    zipCode: string;
    country: string;
    neighborhood?: string;
  };
  type: string;
  images: {
    url: string;
    caption?: string;
    isPrimary: boolean;
  }[];
}

export interface RoomSearchResult {
  room: Room;
  property: Property;
  matchScore: number;
}

class RoomService {
  private baseUrl = '/api/rooms';

  // Get all available rooms with filters
  async searchRooms(
    filters?: RoomFilters,
    oxyServices?: OxyServices,
    activeSessionId?: string,
  ): Promise<{
    results: RoomSearchResult[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const response = await api.get(this.baseUrl, {
        params: filters,
        oxyServices,
        activeSessionId,
      });
      return response.data;
    } catch (error) {
      console.error('Error searching rooms:', error);
      return { results: [], total: 0, page: 1, totalPages: 1 };
    }
  }

  // Get room details by ID
  async getRoomById(
    roomId: string,
    oxyServices?: OxyServices,
    activeSessionId?: string,
  ): Promise<RoomSearchResult | null> {
    try {
      const response = await api.get(`${this.baseUrl}/${roomId}`, {
        oxyServices,
        activeSessionId,
      });
      return response.data.data;
    } catch (error) {
      console.error('Error fetching room details:', error);
      return null;
    }
  }

  // Get rooms by property ID
  async getRoomsByProperty(
    propertyId: string,
    filters?: RoomFilters,
    oxyServices?: OxyServices,
    activeSessionId?: string,
  ): Promise<{
    rooms: Room[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const response = await api.get(`/api/properties/${propertyId}/rooms`, {
        params: filters,
        oxyServices,
        activeSessionId,
      });
      return response.data;
    } catch (error) {
      console.error('Error fetching property rooms:', error);
      return { rooms: [], total: 0, page: 1, totalPages: 1 };
    }
  }

  // Calculate match score between room and roommate preferences
  calculateRoomMatchScore(room: Room, preferences: any): number {
    let score = 100;

    // Budget match
    if (preferences.budget) {
      const rentAmount = room.rent.amount;
      if (rentAmount < preferences.budget.min || rentAmount > preferences.budget.max) {
        score -= 20;
      }
    }

    // Gender preference match
    if (preferences.genderPreference && room.occupancy.genderPreference) {
      if (preferences.genderPreference !== room.occupancy.genderPreference &&
          room.occupancy.genderPreference !== 'any') {
        score -= 15;
      }
    }

    // Age range match
    if (preferences.ageRange) {
      const roomMinAge = room.occupancy.ageRange?.min || 0;
      const roomMaxAge = room.occupancy.ageRange?.max || 100;
      
      if (preferences.ageRange.min < roomMinAge || preferences.ageRange.max > roomMaxAge) {
        score -= 15;
      }
    }

    // Lifestyle match
    if (preferences.lifestyle) {
      // Pets
      if (preferences.lifestyle.pets && !room.amenities.includes('pet_friendly')) {
        score -= 10;
      }

      // Smoking
      if (!preferences.lifestyle.smoking && room.amenities.includes('smoking_allowed')) {
        score -= 10;
      }

      // Cleanliness (if room has cleaning service)
      if (preferences.lifestyle.cleanliness === 'very_clean' && 
          !room.amenities.includes('cleaning_service')) {
        score -= 5;
      }
    }

    // Move-in date match
    if (preferences.moveInDate && room.availability.availableFrom) {
      const preferredDate = new Date(preferences.moveInDate);
      const availableDate = new Date(room.availability.availableFrom);
      const diffDays = Math.abs(preferredDate.getTime() - availableDate.getTime()) / (1000 * 60 * 60 * 24);
      
      if (diffDays > 30) {
        score -= 15;
      }
    }

    // Amenities match
    if (preferences.desiredAmenities) {
      const matchedAmenities = preferences.desiredAmenities.filter((a: string) => 
        room.amenities.includes(a)
      );
      if (matchedAmenities.length < preferences.desiredAmenities.length / 2) {
        score -= 10;
      }
    }

    return Math.max(0, score);
  }

  // Format room price for display
  formatRoomPrice(room: Room): string {
    const amount = room.rent.amount.toLocaleString('en-US', {
      style: 'currency',
      currency: room.rent.currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
    return `${amount}/month`;
  }

  // Get primary image URL
  getPrimaryImageUrl(room: Room): string | null {
    const primaryImage = room.images.find(img => img.isPrimary);
    return primaryImage?.url || room.images[0]?.url || null;
  }

  // Check if room is available
  isRoomAvailable(room: Room): boolean {
    return room.status === 'available' && room.availability.isAvailable;
  }

  // Get room capacity status
  getRoomCapacityStatus(room: Room): {
    isFull: boolean;
    spotsLeft: number;
    capacityText: string;
  } {
    const spotsLeft = room.occupancy.maxOccupants - room.occupancy.currentOccupants;
    const isFull = spotsLeft <= 0;
    
    let capacityText = isFull 
      ? 'Room is full' 
      : `${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} left`;

    return {
      isFull,
      spotsLeft,
      capacityText
    };
  }
}

export const roomService = new RoomService();