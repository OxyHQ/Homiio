/**
 * Review-related types shared across Homiio frontend and backend
 */

import { Types } from 'mongoose';

// Rating enums
export enum TemperatureRating {
  VERY_COLD = 'very_cold',
  COLD = 'cold',
  COMFORTABLE = 'comfortable',
  WARM = 'warm',
  VERY_WARM = 'very_warm'
}

export enum NoiseLevel {
  VERY_QUIET = 'very_quiet',
  QUIET = 'quiet',
  MODERATE = 'moderate',
  LOUD = 'loud',
  VERY_LOUD = 'very_loud'
}

export enum LightLevel {
  VERY_DARK = 'very_dark',
  DARK = 'dark',
  ADEQUATE = 'adequate',
  BRIGHT = 'bright',
  VERY_BRIGHT = 'very_bright'
}

export enum ConditionRating {
  VERY_POOR = 'very_poor',
  POOR = 'poor',
  FAIR = 'fair',
  GOOD = 'good',
  EXCELLENT = 'excellent'
}

export enum LandlordTreatment {
  VERY_POOR = 'very_poor',
  POOR = 'poor',
  FAIR = 'fair',
  GOOD = 'good',
  EXCELLENT = 'excellent'
}

export enum ResponseRating {
  VERY_SLOW = 'very_slow',
  SLOW = 'slow',
  ADEQUATE = 'adequate',
  FAST = 'fast',
  VERY_FAST = 'very_fast'
}

export enum SafetyRating {
  VERY_UNSAFE = 'very_unsafe',
  UNSAFE = 'unsafe',
  NEUTRAL = 'neutral',
  SAFE = 'safe',
  VERY_SAFE = 'very_safe'
}

export enum AccessibilityRating {
  VERY_POOR = 'very_poor',
  POOR = 'poor',
  FAIR = 'fair',
  GOOD = 'good',
  EXCELLENT = 'excellent'
}

export enum TransportRating {
  VERY_POOR = 'very_poor',
  POOR = 'poor',
  FAIR = 'fair',
  GOOD = 'good',
  EXCELLENT = 'excellent'
}

export enum ShoppingRating {
  VERY_POOR = 'very_poor',
  POOR = 'poor',
  FAIR = 'fair',
  GOOD = 'good',
  EXCELLENT = 'excellent'
}

export enum EducationRating {
  VERY_POOR = 'very_poor',
  POOR = 'poor',
  FAIR = 'fair',
  GOOD = 'good',
  EXCELLENT = 'excellent'
}

export enum CommunityRating {
  VERY_POOR = 'very_poor',
  POOR = 'poor',
  FAIR = 'fair',
  GOOD = 'good',
  EXCELLENT = 'excellent'
}

export enum ChildrenRating {
  VERY_POOR = 'very_poor',
  POOR = 'poor',
  FAIR = 'fair',
  GOOD = 'good',
  EXCELLENT = 'excellent'
}

export enum PetsRating {
  VERY_POOR = 'very_poor',
  POOR = 'poor',
  FAIR = 'fair',
  GOOD = 'good',
  EXCELLENT = 'excellent'
}

// Core review interface
export interface Review {
  // Reference fields
  profileId: string | Types.ObjectId;
  addressId: string | Types.ObjectId;
  
  // Basic information
  greenHouse?: string;
  price?: number;
  currency?: string;
  livedFrom?: Date;
  livedTo?: Date;
  recommendation?: boolean;
  opinion: string;
  positiveComment?: string;
  negativeComment?: string;
  
  // Apartment ratings (1-5 stars)
  apartmentSize?: number;
  apartmentKitchen?: number;
  apartmentBathroom?: number;
  apartmentBedroom?: number;
  apartmentStorage?: number;
  apartmentFurnishing?: number;
  
  // Apartment detailed ratings (enum values)
  apartmentTemperature?: TemperatureRating;
  apartmentNoise?: NoiseLevel;
  apartmentLight?: LightLevel;
  apartmentCondition?: ConditionRating;
  apartmentInternet?: number;
  apartmentCellReception?: number;
  
  // Community ratings (1-5 stars)
  communityMaintenance?: number;
  communityCleanliness?: number;
  communityManagement?: number;
  communityAmenities?: number;
  communityParking?: number;
  communitySafety?: number;
  
  // Landlord ratings (1-5 stars)
  landlordCommunication?: number;
  landlordFairness?: number;
  landlordMaintenance?: number;
  landlordTreatment?: LandlordTreatment;
  landlordResponse?: ResponseRating;
  
  // Area ratings (1-5 stars)
  areaSafety?: SafetyRating;
  areaAccessibility?: AccessibilityRating;
  areaTransport?: TransportRating;
  areaShopping?: ShoppingRating;
  areaEducation?: EducationRating;
  areaCommunity?: CommunityRating;
  areaChildren?: ChildrenRating;
  areaPets?: PetsRating;
  
  // Ethical review features
  isAnonymous?: boolean;
  confidenceScore?: number;
  evidenceUrls?: string[];
  tags?: string[];
  
  // Moderation fields
  flaggedCount?: number;
  isVerified?: boolean;
  moderatorNotes?: string;
  
  // Community interaction
  helpfulVotes?: number;
  unhelpfulVotes?: number;
  replies?: Types.ObjectId[];
}

export interface ReviewDocument extends Review {
  _id: string;
  id: string;
  createdAt: Date;
  updatedAt: Date;
  populatedAddress?: {
    _id: string;
    street: string;
    city: string;
    state?: string; // Made optional
    postal_code: string; // Renamed from zipCode
    country: string;
    countryCode: string; // Added country code
    fullAddress: string;
    location: string;
    // Legacy field for backward compatibility
    zipCode?: string;
  };
  populatedProfile?: {
    _id: string;
    name: string;
    isAnonymous?: boolean;
  };
}

export interface ReviewData extends Omit<Review, 'profileId' | 'addressId'> {
  profileId?: string;
  addressId?: string;
}

export interface CreateReviewRequest {
  addressId: string;
  review: ReviewData;
}

export interface UpdateReviewRequest {
  reviewId: string;
  review: Partial<ReviewData>;
}

export interface ReviewQuery {
  addressId?: string;
  profileId?: string;
  page?: number;
  limit?: number;
  sort?: 'newest' | 'oldest' | 'highest_rated' | 'lowest_rated';
}
