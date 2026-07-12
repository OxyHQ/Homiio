/**
 * Review-related types shared across Homiio frontend and backend.
 *
 * This file is the single source of truth for the TARGET review model: the
 * enums are copied verbatim from the runtime Mongoose model
 * (`packages/backend/models/Review.ts`, which imports them back from here), and
 * the interfaces mirror the current model plus the planned reviucasa-style
 * fields (rich dimensions, agencies, moderation, helpful/report).
 *
 * Ids are plain `string`s: shared-types MUST NOT depend on mongoose. The
 * backend Review model declares its own `IReview` with `ObjectId` fields and
 * Mongoose transparently casts these string ids to `ObjectId` at the DB layer.
 */

import { ISODate } from './common';

// ---------------------------------------------------------------------------
// Dimension enums — the backend model is the authority; values are verbatim.
// ---------------------------------------------------------------------------

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
  POOR = 'poor',
  FAIR = 'fair',
  GOOD = 'good',
  VERY_GOOD = 'very_good',
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

// ---------------------------------------------------------------------------
// Planned enums (deposit outcome, moderation lifecycle, report reasons).
// ---------------------------------------------------------------------------

export enum DepositReturn {
  FULL = 'full',
  PARTIAL = 'partial',
  NO = 'no'
}

export enum ReviewModerationStatus {
  ACTIVE = 'active',
  UNDER_REVIEW = 'under_review',
  REMOVED = 'removed'
}

export enum ReviewReportReason {
  FAKE = 'fake',
  OFFENSIVE = 'offensive',
  PERSONAL_DATA = 'personal_data',
  SPAM = 'spam',
  OTHER = 'other'
}

// ---------------------------------------------------------------------------
// Agencies — the entity a review can be attributed to (property manager /
// landlord agency), reviucasa-style.
// ---------------------------------------------------------------------------

/** A property-management / landlord agency reviews can be attributed to. */
export interface Agency {
  id: string;
  name: string;
  slug: string;
  createdAt?: Date;
  updatedAt?: Date;
}

/** Denormalized agency projection embedded on a {@link ReviewDTO}. */
export interface AgencySummary {
  id: string;
  name: string;
  slug: string;
}

/** Aggregated review statistics for an agency profile / explore page. */
export interface AgencyStats {
  averageRating: number;
  totalReviews: number;
  recommendationPercentage: number;
  /** Percentage of reviews reporting a FULL deposit return (0-100). */
  depositFullPct?: number;
  /** Number of active Homiio listings currently attributed to the agency. */
  listingsCount?: number;
}

// ---------------------------------------------------------------------------
// Review — the TARGET model shared by frontend and backend.
// ---------------------------------------------------------------------------

export interface Review {
  // Address hierarchy
  /** Reference to the specific address level the review is attached to. */
  addressId: string;
  /** Level at which the review is attached. */
  addressLevel: 'BUILDING' | 'UNIT';
  /** Reference to the street-level address (for aggregation). */
  streetLevelId: string;
  /** Reference to the building-level address (for aggregation). */
  buildingLevelId: string;
  /** Reference to the unit-level address (only for UNIT level reviews). */
  unitLevelId?: string;
  /** Denormalized city reference for explore aggregation. */
  cityId?: string;
  /** Denormalized neighborhood reference for explore aggregation. */
  neighborhoodId?: string;

  // Author
  oxyUserId: string;

  // Basic information
  title: string;
  price: number;
  currency: string;
  livedFrom: Date;
  livedTo: Date;
  livedForMonths: number;

  // Overall opinion
  rating: number; // 1-5 stars
  recommendation: boolean;
  opinion: string;
  prosItems: string[];
  consItems: string[];
  adviceToAgency?: string;
  adviceToLandlord?: string;

  /** Relational link to the {@link Agency} this tenancy was managed by. */
  agencyId?: string;

  // Dimension ratings (existing model fields; all optional)
  summerTemperature?: TemperatureRating;
  winterTemperature?: TemperatureRating;
  noise?: NoiseLevel;
  light?: LightLevel;
  conditionAndMaintenance?: ConditionRating;
  services?: ServiceType[];
  landlordTreatment?: LandlordTreatment;
  problemResponse?: ResponseRating;
  staircaseNeighbors?: NeighborRating;
  touristApartments?: boolean;
  neighborRelations?: NeighborRelations;
  cleaning?: CleaningRating;
  areaTourists?: TouristLevel;
  areaSecurity?: SecurityLevel;

  // New dimension ratings
  areaNoise?: NoiseLevel;
  areaCleanliness?: CleaningRating;

  /** Deposit outcome at the end of the tenancy. */
  depositReturned?: DepositReturn;

  // Media & trust
  images: string[];
  verified: boolean;
  moderationStatus: ReviewModerationStatus;

  // Legacy read-only fields (retained for older documents, not written by the
  // new form). `positiveComment`/`negativeComment` superseded by
  // `prosItems`/`consItems`; `greenHouse` was a free-text descriptor.
  positiveComment?: string;
  negativeComment?: string;
  greenHouse?: string;
}

/**
 * Serialized review returned by the API (`_id` → `id`, timestamps, derived
 * helpful counters, and the optional populated agency + address projections).
 */
export interface ReviewDTO extends Review {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  /** Number of distinct users who marked this review helpful. */
  helpfulCount: number;
  /** Whether the requesting viewer has marked this review helpful. */
  viewerHasVotedHelpful: boolean;
  /** Denormalized agency projection (present when `agencyId` resolves). */
  agency?: AgencySummary;
  /** Populated address projection used by review lists / detail views. */
  populatedAddress?: {
    _id: string;
    street: string;
    city: string;
    state?: string;
    postal_code: string;
    country: string;
    countryCode: string;
    fullAddress: string;
    location: string;
    // Legacy field for backward compatibility.
    zipCode?: string;
  };
}

// ---------------------------------------------------------------------------
// Trust & safety / admin moderation.
// ---------------------------------------------------------------------------

/**
 * A single trust & safety report embedded on a review. This is INTERNAL
 * moderation data — the public {@link ReviewDTO} strips it (see
 * `controllers/review/toReviewDTO.ts`). It is exposed ONLY on the admin
 * moderation-queue projection {@link AdminReviewDTO}.
 */
export interface ReviewReport {
  /** Oxy user id of the reporter. */
  oxyUserId: string;
  reason: ReviewReportReason;
  /** Free-text context (present for `OTHER`, optional otherwise). */
  details?: string;
  createdAt: ISODate;
}

/**
 * Admin moderation-queue projection: the full review DTO PLUS the raw
 * `reports` array. Only ever returned by the admin moderation endpoints
 * (`GET /api/admin/moderation/reviews`) — never by a public review read.
 */
export interface AdminReviewDTO extends ReviewDTO {
  reports: ReviewReport[];
}

/**
 * Actions an admin may take on a queued review. `remove` hides it everywhere,
 * `restore` returns it to `active`, `dismiss_reports` clears the reports and
 * returns it to `active`. Single source of truth for the request enum on both
 * the backend allowlist and the frontend client.
 */
export const ADMIN_REVIEW_ACTIONS = ['remove', 'restore', 'dismiss_reports'] as const;
export type AdminReviewModerationAction = (typeof ADMIN_REVIEW_ACTIONS)[number];

// ---------------------------------------------------------------------------
// Write payloads.
// ---------------------------------------------------------------------------

/**
 * Nested address object the create endpoint accepts. The controller resolves
 * it into the canonical street/building/unit id chain server-side, so callers
 * supply human-readable place fields plus optional coordinates.
 */
export interface CreateReviewAddressInput {
  street: string;
  number?: string;
  building_name?: string;
  floor?: string;
  unit?: string;
  postal_code: string;
  city: string;
  state?: string;
  country: string;
  countryCode?: string;
  neighborhood?: string;
  latitude?: number;
  longitude?: number;
}

/**
 * The subset of {@link Review} a client may supply on create/update. Server-only
 * fields (address hierarchy ids, author, computed duration, agency link,
 * moderation, verification) are resolved by the backend and excluded here.
 */
export type CreatableReviewFields = Omit<
  Review,
  | 'addressId'
  | 'addressLevel'
  | 'streetLevelId'
  | 'buildingLevelId'
  | 'unitLevelId'
  | 'cityId'
  | 'neighborhoodId'
  | 'oxyUserId'
  | 'livedForMonths'
  | 'agencyId'
  | 'verified'
  | 'moderationStatus'
>;

/**
 * Create-review request body: the nested {@link CreateReviewAddressInput}, the
 * required core fields, any optional creatable fields, and an optional
 * `agencyName` the backend resolves/creates into an {@link Agency}.
 */
export type CreateReviewPayload = Partial<CreatableReviewFields> &
  Pick<
    CreatableReviewFields,
    'price' | 'currency' | 'livedFrom' | 'livedTo' | 'rating' | 'recommendation' | 'opinion'
  > & {
    address: CreateReviewAddressInput;
    agencyName?: string;
  };

/** Update-review request body: any creatable field, no address re-resolution. */
export type UpdateReviewPayload = Partial<CreatableReviewFields>;

// ---------------------------------------------------------------------------
// Explore DTOs (aggregated review coverage by geo level / building).
// ---------------------------------------------------------------------------

export interface ExploreCitySummary {
  cityId: string;
  name: string;
  reviewCount: number;
  averageRating: number;
}

export interface ExploreNeighborhoodSummary {
  neighborhoodId: string;
  name: string;
  reviewCount: number;
  averageRating: number;
}

export interface ExploreBuildingSummary {
  buildingLevelId: string;
  street: string;
  number?: string;
  reviewCount: number;
  averageRating: number;
  recommendationPercentage: number;
}
