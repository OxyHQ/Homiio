/**
 * Review-related types shared across Homiio frontend and backend
 */

import { Types } from 'mongoose';

// Rating enums
export enum TemperatureRating {
  VERY_COLD = 'very_cold',
  COLD = 'cold',
  MODERATE = 'moderate',
  WARM = 'warm',
  VERY_WARM = 'very_warm'
}

export enum NoiseLevel {
  VERY_QUIET = 'very_quiet',
  QUIET = 'quiet',
  MODERATE = 'moderate',
  NOISY = 'noisy',
  VERY_NOISY = 'very_noisy'
}

export enum LightLevel {
  VERY_DARK = 'very_dark',
  DARK = 'dark',
  MODERATE = 'moderate',
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
  NEVER_RESPONDED = 'never_responded',
  VERY_SLOW = 'very_slow',
  SLOW = 'slow',
  REASONABLE = 'reasonable',
  FAST = 'fast',
  VERY_FAST = 'very_fast'
}

export enum NeighborRating {
  VERY_UNFRIENDLY = 'very_unfriendly',
  UNFRIENDLY = 'unfriendly',
  NEUTRAL = 'neutral',
  FRIENDLY = 'friendly',
  VERY_FRIENDLY = 'very_friendly'
}

export enum NeighborRelations {
  VERY_POOR = 'very_poor',
  POOR = 'poor',
  FAIR = 'fair',
  GOOD = 'good',
  EXCELLENT = 'excellent'
}

export enum CleaningRating {
  VERY_DIRTY = 'very_dirty',
  DIRTY = 'dirty',
  ACCEPTABLE = 'acceptable',
  CLEAN = 'clean',
  VERY_CLEAN = 'very_clean'
}

export enum TouristLevel {
  NONE = 'none',
  FEW = 'few',
  MODERATE = 'moderate',
  MANY = 'many',
  OVERWHELMING = 'overwhelming'
}

export enum SecurityLevel {
  VERY_UNSAFE = 'very_unsafe',
  UNSAFE = 'unsafe',
  NEUTRAL = 'neutral',
  SAFE = 'safe',
  VERY_SAFE = 'very_safe'
}

export enum ServiceType {
  INTERNET = 'internet',
  CABLE_TV = 'cable_tv',
  PARKING = 'parking',
  LAUNDRY = 'laundry',
  GYM = 'gym',
  POOL = 'pool',
  CONCIERGE = 'concierge',
  SECURITY = 'security',
  MAINTENANCE = 'maintenance',
  CLEANING = 'cleaning'
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
  // Address hierarchy
  addressId: string | Types.ObjectId; // Reference to the specific address level (building or unit)
  addressLevel: 'BUILDING' | 'UNIT'; // Level at which review is attached
  
  // Hierarchical address references for aggregation
  streetLevelId: string | Types.ObjectId; // Reference to street-level address
  buildingLevelId: string | Types.ObjectId; // Reference to building-level address  
  unitLevelId?: string | Types.ObjectId; // Reference to unit-level address (only for UNIT level reviews)
  
  // User reference
  profileId: string | Types.ObjectId;
  
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

export interface CreateReviewRequest extends Omit<Review, '_id' | 'createdAt' | 'updatedAt'> {
  // All review fields are inherited from Review interface
  // The addressId is required and will be used to determine hierarchical structure
  addressId: string;
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
