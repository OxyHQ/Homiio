/**
 * Property-related types shared across Homiio frontend and backend
 */

import {
  PropertyType,
  PropertyStatus,
  HousingType,
  LayoutType,
  PaymentFrequency,
  UtilitiesIncluded,
  PriceUnit,
  GeoJSONPoint,
  RentMode,
  AvailabilityWindow,
  CancellationPolicy,
  PriceBreakdown,
  ListingIntent,
  ExchangeMode,
  DeepPartial
} from './common';
import { Address } from './address';

export interface PropertyRent {
  amount: number;
  currency: string;
  paymentFrequency: PaymentFrequency;
  deposit: number;
  utilities: UtilitiesIncluded;
  hasIncomeBasedPricing?: boolean;
  hasSlidingScale?: boolean;
  hasUtilitiesIncluded?: boolean;
  hasReducedDeposit?: boolean;
}

/**
 * Sale pricing for a listing offered with the SALE intent (buy flow).
 * `pricePerSqm` is derived server-side from `price / squareFootage` when both
 * are known. `estimatedYield` is an optional gross rental-yield percentage.
 */
export interface PropertySale {
  price: number;
  currency: string;
  pricePerSqm?: number;
  estimatedYield?: number;
  isPriceReduced?: boolean;
  chainStatus?: 'no_chain' | 'chain' | 'unknown';
}

/**
 * Home-exchange offer for a listing with the EXCHANGE intent (swap / hosting).
 * Reuses the same {@link AvailabilityWindow} type as vacation rentals so the
 * calendar primitives stay consistent across intents.
 */
export interface PropertyExchange {
  mode: ExchangeMode;
  availabilityWindows: AvailabilityWindow[];
  /** Minimum number of nights for an exchange stay. */
  minStay?: number;
  /** Maximum number of nights for an exchange stay. */
  maxStay?: number;
  welcomeNote?: string;
  languages?: string[];
  mealsIncluded?: boolean;
  /** When true, the host expects a reciprocal stay (true swap, not one-way hosting). */
  requiresReciprocity?: boolean;
}

/**
 * Defaults that drive the mortgage affordability calculator on sale listings.
 * `defaultAnnualRate`/`defaultDownPaymentFraction` are fractions (e.g. 0.035 =
 * 3.5%, 0.20 = 20%); `termOptions` are mortgage lengths in years.
 */
export interface MortgageConfig {
  defaultAnnualRate: number;
  termOptions: number[];
  defaultDownPaymentFraction: number;
}

/** Canonical mortgage-calculator defaults shared by frontend and backend. */
export const DEFAULT_MORTGAGE_CONFIG: MortgageConfig = {
  defaultAnnualRate: 0.035,
  termOptions: [10, 15, 20, 25, 30],
  defaultDownPaymentFraction: 0.20
};

export interface PropertyImage {
  url: string;
  caption?: string;
  isPrimary?: boolean;
}

export interface PropertyDocument {
  name: string;
  url: string;
  type: 'lease' | 'inspection' | 'insurance' | 'other';
}

export interface PropertyRules {
  petsAllowed?: boolean;
  smokingAllowed?: boolean;
  partiesAllowed?: boolean;
  guestsAllowed?: boolean;
  maxGuests?: number;
  quietHours?: {
    start: string;
    end: string;
  };
  additionalRules?: string[];
}

export interface PropertyAmenities {
  basic?: string[];
  luxury?: string[];
  accessibility?: string[];
  outdoor?: string[];
  parking?: string[];
  security?: string[];
}

export interface PropertyCharacteristics {
  type: PropertyType;
  housingType?: HousingType;
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  amenities: string[];
  location: {
    city: string;
    state: string;
  };
  floor?: number;
  hasElevator?: boolean;
  parkingSpaces?: number;
  yearBuilt?: number;
  isFurnished?: boolean;
  utilitiesIncluded?: boolean;
  petFriendly?: boolean;
  hasBalcony?: boolean;
  hasGarden?: boolean;
  proximityToTransport?: boolean;
  proximityToSchools?: boolean;
  proximityToShopping?: boolean;
}

export interface Property {
  _id: string; // MongoDB ObjectId
  id?: string; // Optional fallback
  profileId?: string; // Optional for external properties
  // External sourcing metadata
  source?: string; // Source name (e.g., 'fotocasa', 'internal')
  sourceId?: string; // External source ID
  sourceUrl?: string; // URL to the property on the source website
  isExternal?: boolean; // Whether this property comes from external source
  expiresAt?: string; // TTL for external properties
  address: Address;
  type: PropertyType;
  housingType?: HousingType;
  layoutType?: LayoutType;
  description?: string;
  squareFootage?: number;
  bedrooms?: number;
  bathrooms?: number;
  rent: PropertyRent;
  priceUnit?: PriceUnit;
  amenities?: string[];
  images?: string[] | PropertyImage[];
  status: PropertyStatus;
  ownerId?: string; // Made optional since we use profileId
  roomCount?: number;
  location?: GeoJSONPoint;
  // Additional property details
  floor?: number;
  hasElevator?: boolean;
  parkingSpaces?: number;
  yearBuilt?: number;
  furnishedStatus?: 'furnished' | 'unfurnished' | 'partially_furnished';
  utilitiesIncluded?: boolean;
  petFriendly?: boolean;
  petPolicy?: 'allowed' | 'not_allowed' | 'case_by_case';
  petFee?: number;
  parkingType?: 'none' | 'street' | 'assigned' | 'garage';
  hasBalcony?: boolean;
  hasGarden?: boolean;
  proximityToTransport?: boolean;
  proximityToSchools?: boolean;
  proximityToShopping?: boolean;
  rules?: PropertyRules;
  documents?: PropertyDocument[];
  coverImageIndex?: number;
  // Availability
  availableFrom?: string;
  leaseTerm?: string;
  maxGuests?: number;
  smokingAllowed?: boolean;
  partiesAllowed?: boolean;
  guestsAllowed?: boolean;
  // Hybrid rental mode (long-term / vacation / both)
  rentMode?: RentMode;
  /**
   * Calendar windows for vacation/short-term mode.
   * Empty array (or undefined) = always available.
   * NOTE: persisted server-side as `availabilityWindows` to avoid colliding
   * with the legacy `availability` object subschema on the Property document.
   */
  availabilityWindows?: AvailabilityWindow[];
  /** Minimum number of nights guests can book. */
  minStay?: number;
  /** Maximum number of nights guests can book. */
  maxStay?: number;
  /** Vacation-mode cancellation policy. */
  cancellationPolicy?: CancellationPolicy;
  /** When true, vacation bookings confirm without host approval. */
  instantBook?: boolean;
  /** Optional vacation-mode fee breakdown. */
  priceBreakdown?: PriceBreakdown;
  // Multi-intent platform (rent / sale / exchange). All additive & optional;
  // a listing with no `intents` is treated as rent-only for back-compat.
  /** Ways this listing is offered. Defaults to `['rent']` when absent. */
  intents?: ListingIntent[];
  /** Sale pricing, present when `intents` includes `'sale'`. */
  sale?: PropertySale;
  /** Home-exchange offer, present when `intents` includes `'exchange'`. */
  exchange?: PropertyExchange;
  // Flags
  isVerified?: boolean;
  isEcoFriendly?: boolean;
  createdAt: string;
  updatedAt: string;
  // Accommodation-specific details
  accommodationDetails?: {
    sleepingArrangement?: 'couch' | 'air_mattress' | 'floor' | 'tent' | 'hammock';
    roommatePreferences?: string[];
    colivingFeatures?: string[];
    hostelRoomType?: 'dormitory' | 'private_room' | 'mixed_dorm' | 'female_dorm' | 'male_dorm';
    campsiteType?: 'tent_site' | 'rv_site' | 'cabin' | 'glamping' | 'backcountry';
    maxStay?: number;
    minAge?: number;
    maxAge?: number;
    languages?: string[];
    culturalExchange?: boolean;
    mealsIncluded?: boolean;
    wifiPassword?: string;
    houseRules?: string[];
  };
}

export interface CreatePropertyData {
  address: Address;
  type: PropertyType;
  description?: string;
  squareFootage?: number;
  bedrooms?: number;
  bathrooms?: number;
  rent: PropertyRent;
  priceUnit?: PriceUnit;
  amenities?: string[];
  images?: string[];
  location?: GeoJSONPoint;
  // Additional comprehensive details for ethical pricing
  floor?: number;
  hasElevator?: boolean;
  parkingSpaces?: number;
  yearBuilt?: number;
  furnishedStatus?: 'furnished' | 'unfurnished' | 'partially_furnished';
  utilitiesIncluded?: boolean;
  petFriendly?: boolean;
  petPolicy?: 'allowed' | 'not_allowed' | 'case_by_case';
  petFee?: number;
  parkingType?: 'none' | 'street' | 'assigned' | 'garage';
  hasBalcony?: boolean;
  hasGarden?: boolean;
  proximityToTransport?: boolean;
  proximityToSchools?: boolean;
  proximityToShopping?: boolean;
  // Availability
  availableFrom?: string;
  leaseTerm?: string;
  maxGuests?: number;
  smokingAllowed?: boolean;
  partiesAllowed?: boolean;
  guestsAllowed?: boolean;
  // Hybrid rental mode
  rentMode?: RentMode;
  availabilityWindows?: AvailabilityWindow[];
  minStay?: number;
  maxStay?: number;
  cancellationPolicy?: CancellationPolicy;
  instantBook?: boolean;
  priceBreakdown?: PriceBreakdown;
  // Multi-intent platform (rent / sale / exchange)
  intents?: ListingIntent[];
  sale?: PropertySale;
  exchange?: PropertyExchange;
  // Accommodation-specific details
  accommodationDetails?: {
    sleepingArrangement?: 'couch' | 'air_mattress' | 'floor' | 'tent' | 'hammock';
    roommatePreferences?: string[];
    colivingFeatures?: string[];
    hostelRoomType?: 'dormitory' | 'private_room' | 'mixed_dorm' | 'female_dorm' | 'male_dorm';
    campsiteType?: 'tent_site' | 'rv_site' | 'cabin' | 'glamping' | 'backcountry';
    maxStay?: number;
    minAge?: number;
    maxAge?: number;
    languages?: string[];
    culturalExchange?: boolean;
    mealsIncluded?: boolean;
    wifiPassword?: string;
    houseRules?: string[];
  };
}

export interface PropertyFilters {
  type?: string;
  status?: string;
  available?: boolean;
  minRent?: number;
  maxRent?: number;
  bedrooms?: number;
  bathrooms?: number;
  search?: string;
  page?: number;
  limit?: number;
  // Location parameters
  lat?: number;
  lng?: number;
  radius?: number;
  city?: string;
  state?: string;
  country?: string;
  // Additional filters
  amenities?: string[];
  petFriendly?: boolean;
  furnished?: boolean;
  parking?: boolean;
  verified?: boolean;
  eco?: boolean;
  // Hybrid filters
  /** Filter by rent mode. `'both'` listings match either `long_term` or `vacation` requests. */
  rentMode?: RentMode;
  instantBook?: boolean;
  /** Check-in date for vacation availability filtering (ISO-8601). */
  checkIn?: string;
  /** Check-out date for vacation availability filtering (ISO-8601). */
  checkOut?: string;
  /** Required number of guests the listing must accommodate. */
  guests?: number;
  // Multi-intent filters
  /** Restrict to listings carrying this intent (matches arrays containing it). */
  intent?: ListingIntent;
  /** Minimum sale price (only meaningful with `intent === 'sale'`). */
  minSalePrice?: number;
  /** Maximum sale price (only meaningful with `intent === 'sale'`). */
  maxSalePrice?: number;
  /** Exchange mode filter. A `'both'` listing matches a `swap` or `host` request. */
  exchangeMode?: ExchangeMode;
}

export interface PropertyStructuredData {
  name: string;
  description: string;
  image: string;
  address: {
    streetAddress: string;
    addressLocality: string;
    addressRegion: string;
    postalCode: string;
    addressCountry: string;
  };
  price: number;
  priceCurrency: string;
  numberOfRooms: number;
  floorSize: number;
  floorSizeUnit: string;
  propertyType: string;
  availability: 'Available' | 'Rented' | 'Under Contract';
  url: string;
}

export interface SavedProperty extends Property {
  notes?: string;
  savedAt?: string;
}

export interface MapProperty extends Omit<Property, 'location'> {
  title: string;
  location: string;
}

export interface PropertyDetail {
  id: string;
  title: string;
  description: string;
  location: string;
  price: string;
  priceUnit: PriceUnit;
  bedrooms: number;
  bathrooms: number;
  size: number;
  isVerified: boolean;
  isEcoCertified: boolean;
  amenities: string[];
  landlordName: string;
  landlordRating: number;
  availableFrom: string;
  minStay: string;
  rating: number;
  images: string[];
}

export interface PropertyDraft {
  id: string;
  title: string;
  address: Address;
  type: string;
  rent: {
    amount: number;
    currency: string;
  };
  lastSaved: Date;
}

export type UpdatePropertyData = DeepPartial<Property>;

/**
 * Verdict assigned to a listing's price relative to comparable homes in its
 * area. Mirrors the thresholds applied server-side in the area-insights
 * controller (negative percent = cheaper than the local average).
 */
export type AreaPriceVerdict =
  | 'good_deal'
  | 'below_average'
  | 'average'
  | 'above_average';

/** Scope the area comparison was computed against. */
export type AreaInsightsBasis = 'radius' | 'city';

/** Aggregate price comparison of the target listing against its comparables. */
export interface AreaPriceComparison {
  min: number;
  max: number;
  avg: number;
  median: number;
  /** The target property's own price (in the shared `priceUnit`). */
  thisPrice: number;
  /** Integer percent difference of `thisPrice` vs `avg` (negative = cheaper). */
  percentDiffFromAvg: number;
  verdict: AreaPriceVerdict;
}

/** A single bar in the area price-distribution histogram. */
export interface AreaPriceDistributionBucket {
  min: number;
  max: number;
  count: number;
}

/** Price-distribution histogram plus the bucket the target falls in. */
export interface AreaPriceDistribution {
  buckets: AreaPriceDistributionBucket[];
  /** Index of the bucket containing the target price, or -1 if outside range. */
  thisBucketIndex: number;
}

/** Target vs area average price-per-square-metre (only when both are known). */
export interface AreaPricePerSqm {
  this: number;
  areaAvg: number;
}

/** Neighborhood-vs-city average contrast (only when a distinct neighborhood exists). */
export interface AreaNeighborhoodVsCity {
  neighborhood: string;
  city: string;
  neighborhoodAvg: number;
  cityAvg: number;
  /** Integer percent difference of neighborhood vs city (positive = pricier). */
  percentDiff: number;
}

/**
 * Payload returned by `GET /api/properties/:propertyId/area-insights`.
 *
 * Compares the target listing's price to similar homes nearby (same
 * `priceUnit`, compatible `rentMode`, ±1 bedroom). `sampleSize === 0` signals
 * that no comparables were found — consumers must render a graceful
 * "not enough data" state rather than a fabricated range.
 */
export interface PropertyAreaInsights {
  basis: AreaInsightsBasis;
  /** Radius (km) used for the neighborhood-scale comparison. */
  radiusKm: number;
  /** Human label for the compared area (neighborhood for radius, city for fallback). */
  areaLabel: string;
  currency: string;
  /** Price unit the comparison is denominated in (e.g. `'month'`, `'night'`). */
  priceUnit: string;
  /** Number of comparable homes (excludes the target); can be 0. */
  sampleSize: number;
  comparison: AreaPriceComparison;
  pricePerSqm: AreaPricePerSqm | null;
  distribution: AreaPriceDistribution;
  neighborhoodVsCity: AreaNeighborhoodVsCity | null;
  /** Up to 12 nearest comparable listings, EXCLUDING the target property. */
  comparables: Property[];
}

/**
 * The fixed set of everyday-amenity categories the "nearby services" section
 * reports on. The endpoint ALWAYS returns every key (with `present: false`
 * when nothing of that kind is found nearby), so the frontend can render a
 * "not nearby" state without inferring which categories were checked.
 */
export type NearbyServiceKey =
  | 'pharmacy'
  | 'school'
  | 'hospital'
  | 'police'
  | 'fire_station'
  | 'supermarket'
  | 'transit'
  | 'park'
  | 'bank'
  | 'restaurant'
  | 'gym';

/**
 * Presence summary for a single service category near a property.
 *
 * This is deliberately aggregate-only (presence + count + nearest distance) and
 * never exposes individual place names: the section answers "is there a
 * pharmacy nearby?", not "which pharmacy?".
 */
export interface NearbyServiceCategory {
  key: NearbyServiceKey;
  /** Whether at least one place of this category exists within the radius. */
  present: boolean;
  /** Number of matching places found within the radius (0 when absent). */
  count: number;
  /** Straight-line distance, in metres, to the nearest match; null when absent. */
  nearestM: number | null;
}

/**
 * Payload returned by `GET /api/properties/:propertyId/nearby-services`.
 *
 * Reports, for a fixed set of everyday services (pharmacy, school, transit, …),
 * whether each is NEAR the property's coordinates — presence, count and the
 * distance to the nearest one — sourced from OpenStreetMap's Overpass API.
 *
 * `categories` ALWAYS contains every `NearbyServiceKey` (absent ones have
 * `present: false`). `partial` is true when the upstream lookup timed out or
 * failed (or the property has no coordinates) and the result is therefore a
 * degraded/empty snapshot rather than a confirmed "nothing nearby"; consumers
 * should treat a `partial` all-absent result as "unknown", not "none".
 */
export interface PropertyNearbyServices {
  /** Search radius, in metres, used around the property's coordinates. */
  radiusM: number;
  /** One entry per `NearbyServiceKey`; `present: false` when none were found. */
  categories: NearbyServiceCategory[];
  /** True when the lookup degraded (upstream failure/timeout or no coordinates). */
  partial: boolean;
}
