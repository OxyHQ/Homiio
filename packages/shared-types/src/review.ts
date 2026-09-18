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

/**
 * How a review's author is PUBLISHED — the three forms of
 * `docs/adr/0003-privacy-verification-publication.md` §5.2, chosen by the
 * author.
 *
 * Homiio always knows who wrote a review: `reviews.oxy_user_id` is `NOT NULL`
 * and stays that way, because the link is what makes correction, appeal and
 * abuse handling possible. What the author chooses is what a READER is told.
 */
export enum ReviewAuthorIdentity {
  /** The author's Oxy handle and display name. */
  IDENTIFIED = 'identified',
  /**
   * A pseudonym that is stable per author PER BUILDING.
   *
   * A reader can tell that the same person wrote two reviews about one
   * building; nobody can correlate an author across buildings, which would be
   * de-anonymisation with extra steps.
   */
  PSEUDONYMOUS = 'pseudonymous',
  /** Nothing at all beyond "a resident" — not even a per-building handle. */
  VERIFIED_ANONYMOUS_RESIDENT = 'verified_anonymous_resident',
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
  /**
   * How many DISTINCT people wrote them — the second half of ADR 0003 §4.4's
   * publication floor.
   *
   * Counted server-side over `reviews.oxy_user_id`, because that is the only
   * place the real author is known: a client counting published handles would
   * see one bucket per pseudonym, and a pseudonym is stable per BUILDING, so an
   * author who reviewed three of an agency's buildings would read as three
   * people and lift the set over a floor it does not clear.
   */
  distinctAuthors?: number;
}

/**
 * A rent published as a band rather than a figure — ADR 0003 §5.6.
 *
 * Half-open: `min` inclusive, `max` exclusive. `max` is ABSENT on the open top
 * band, which is the honest shape — "3000 or more" is what is known, and a
 * fabricated ceiling would read as a measurement.
 */
export interface ReviewPriceBand {
  min: number;
  max?: number;
  /** The review's own currency — a band is meaningless without it. */
  currency: string;
}

// ---------------------------------------------------------------------------
// Review — the TARGET model shared by frontend and backend.
// ---------------------------------------------------------------------------

export interface Review {
  // Address hierarchy
  //
  // A review is FILED at the finest address its author identified and
  // PUBLISHED at the building (ADR 0003 §5.1). To anybody but the author, the
  // three fields below therefore describe the place the review is published
  // against, not the row it is stored against.
  /**
   * The place this review is published against — the building, unless the
   * reader is the author, for whom it is the row the review is filed at.
   */
  addressId: string;
  /** Level of the place {@link Review.addressId} names. */
  addressLevel: 'BUILDING' | 'UNIT';
  /** Reference to the street-level address (for aggregation). */
  streetLevelId: string;
  /** Reference to the building-level address (for aggregation). */
  buildingLevelId: string;
  /**
   * The UNIT the review is filed against.
   *
   * Served to the AUTHOR only: the unit binding is tier R (ADR 0003 §2.1,
   * §9), so it is absent from every other reader's copy — including a reader
   * with a relation to the place.
   */
  unitLevelId?: string;
  /** Denormalized city reference for explore aggregation. */
  cityId?: string;
  /** Denormalized neighborhood reference for explore aggregation. */
  neighborhoodId?: string;

  // Author
  /**
   * Which of the three forms the author chose (ADR 0003 §5.2).
   *
   * Always published, because a reader has to know what they are looking at:
   * "a name" and "a per-building pseudonym" carry very different weight.
   */
  authorIdentity: ReviewAuthorIdentity;
  /**
   * The author's Oxy account.
   *
   * ABSENT for anybody but the author unless {@link Review.authorIdentity} is
   * `identified` — undisclosed is absent, never `null` (ADR 0003 §4.1.3).
   */
  oxyUserId?: string;
  /**
   * An opaque handle, stable for one author within one BUILDING.
   *
   * Present only under `pseudonymous`. `verified_anonymous_resident` publishes
   * nothing at all, so two such reviews of one building are indistinguishable —
   * which is what that form is for.
   */
  authorKey?: string;

  // Basic information
  title: string;
  /**
   * The exact monthly rent.
   *
   * Served to the AUTHOR only. A public reader gets {@link Review.priceBand}:
   * unit, tenancy dates and rent together narrow a household to one, and ADR
   * 0003 §5.6 bands the rent on any review published at building precision or
   * finer. The exact figure still feeds §4.4-compliant aggregates server-side.
   */
  price?: number;
  /** The band the rent falls in — what a public reader is served instead. */
  priceBand?: ReviewPriceBand;
  currency: string;
  /** Exact tenancy start. Author only — see {@link Review.livedFromMonth}. */
  livedFrom?: Date;
  /** Exact tenancy end. Author only. */
  livedTo?: Date;
  /** Tenancy start as `YYYY-MM`. ADR 0003 §5.6: never a day. */
  livedFromMonth: string;
  /** Tenancy end as `YYYY-MM`. */
  livedToMonth: string;
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
 * Serialized review returned by the API (`id`, timestamps, derived
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
    id: string;
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
  // Derived on the way OUT, never supplied: the pseudonym is minted server-side
  // and kept stable per building, and the band and the month-grained dates are
  // reductions of columns the author sends exactly (ADR 0003 §3.3, §5.6).
  | 'authorKey'
  | 'priceBand'
  | 'livedFromMonth'
  | 'livedToMonth'
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
  // `Required<…>`: `price`, `livedFrom` and `livedTo` are OPTIONAL on the read
  // model — they are the author's own copy of values a public reader is served
  // reduced — but every one of them is mandatory on the way IN, because the
  // reduction is computed from them.
  Required<
    Pick<
      CreatableReviewFields,
      'price' | 'currency' | 'livedFrom' | 'livedTo' | 'rating' | 'recommendation' | 'opinion'
    >
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
