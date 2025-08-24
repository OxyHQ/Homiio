/**
 * API Response Types
 * Common response interfaces for API calls
 */

export interface ApiResponse<T> {
  success: boolean;
  data: T | null;
  message?: string;
  error?: string;
}

export interface ApiError {
  message: string;
  code?: string;
  details?: any;
}

export interface PaginationResponse {
  currentPage: number;
  totalPages: number;
  totalItems: number;
  limit: number;
}

export interface ApiMetadata {
  timestamp: string;
  requestId?: string;
  version?: string;
}

// Review related types
export interface CreateReviewRequest {
  addressId: string;
  address: string;
  greenHouse?: string;
  price: number;
  currency: 'EUR' | 'USD' | 'GBP' | 'CAD';
  livedFrom: string; // ISO date string
  livedTo: string; // ISO date string
  recommendation: boolean;
  opinion: string;
  positiveComment?: string;
  negativeComment?: string;
  images?: string[];
  rating: number; // 1-5
  summerTemperature: string;
  winterTemperature: string;
  noise: string;
  light: string;
  conditionAndMaintenance: string;
  services: string[];
  landlordTreatment: string;
  problemResponse: string;
  depositReturned: boolean;
  staircaseNeighbors: string;
  touristApartments: boolean;
  neighborRelations: string;
  cleaning: string;
  areaTourists: string;
  areaSecurity: string;
}

export interface Review extends CreateReviewRequest {
  _id: string;
  userId: string;
  livedForMonths: number;
  humanDuration: string;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewStatistics {
  averageRating: number;
  totalReviews: number;
  recommendationPercentage: number;
  ratingDistribution: {
    [key: number]: number;
  };
  categoryAverages: {
    [category: string]: number;
  };
}
