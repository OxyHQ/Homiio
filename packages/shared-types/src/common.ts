/**
 * Common utility types and enums shared across Homiio frontend and backend
 */

// Common enums
export enum PropertyType {
  APARTMENT = 'apartment',
  HOUSE = 'house',
  ROOM = 'room',
  STUDIO = 'studio',
  COUCHSURFING = 'couchsurfing',
  ROOMMATES = 'roommates',
  COLIVING = 'coliving',
  HOSTEL = 'hostel',
  GUESTHOUSE = 'guesthouse',
  CAMPSITE = 'campsite',
  BOAT = 'boat',
  TREEHOUSE = 'treehouse',
  YURT = 'yurt',
  OTHER = 'other'
}

export enum PropertyStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  RESERVED = 'reserved',
  RENTED = 'rented',
  SOLD = 'sold',
  INACTIVE = 'inactive',
  /** Soft-deleted listing: hidden from all public queries, kept for audit. */
  ARCHIVED = 'archived'
}

export enum HousingType {
  PRIVATE = 'private',
  PUBLIC = 'public'
}

export enum LayoutType {
  OPEN = 'open',
  SHARED = 'shared',
  PARTITIONED = 'partitioned',
  TRADITIONAL = 'traditional',
  STUDIO = 'studio',
  OTHER = 'other'
}

export enum PaymentFrequency {
  MONTHLY = 'monthly',
  WEEKLY = 'weekly',
  DAILY = 'daily'
}

export enum UtilitiesIncluded {
  INCLUDED = 'included',
  EXCLUDED = 'excluded',
  PARTIAL = 'partial'
}

export enum PriceUnit {
  DAY = 'day',
  NIGHT = 'night',
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year'
}

/** Status of an availability window on the property calendar. */
export enum AvailabilityWindowStatus {
  AVAILABLE = 'available',
  BLOCKED = 'blocked',
  BOOKED = 'booked'
}

/**
 * The single axis describing how a listing is offered. A listing may carry
 * MULTIPLE offerings at once (e.g. `[LONG_TERM_RENT, SHORT_TERM_RENT]` for a
 * flat available both monthly and by the night). Each offering owns its own
 * priced block on the Property, so the unit (monthly vs nightly) is fixed per
 * block and never reinterpreted by browse mode.
 * - LONG_TERM_RENT: traditional monthly rent (Idealista-style)
 * - SHORT_TERM_RENT: vacation / by-the-night rental (Airbnb-style)
 * - SALE: property is for sale (buy)
 * - EXCHANGE: home swap and/or free hosting
 */
export enum OfferingType {
  LONG_TERM_RENT = 'long_term_rent',
  SHORT_TERM_RENT = 'short_term_rent',
  SALE = 'sale',
  EXCHANGE = 'exchange'
}

/**
 * How an EXCHANGE listing is offered.
 * - SWAP: reciprocal home swap (each party stays in the other's home)
 * - HOST: one-way free hosting (guest stays, no reciprocity required)
 * - BOTH: host accepts either a swap or a hosting arrangement
 */
export enum ExchangeMode {
  SWAP = 'swap',
  HOST = 'host',
  BOTH = 'both'
}

/** Lifecycle of an exchange (home-swap / hosting) request. */
export enum ExchangeRequestStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  DECLINED = 'declined',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed'
}

/** Vacation-rental cancellation policy presets (Airbnb-style). */
export enum CancellationPolicy {
  FLEXIBLE = 'flexible',
  MODERATE = 'moderate',
  STRICT = 'strict',
  SUPER_STRICT = 'super_strict'
}

/** ISO-8601 timestamp string (e.g. `2026-05-28T12:34:56.000Z`). */
export type ISODate = string;

/**
 * A single calendar window for a property. Empty arrays mean "always available".
 * Windows MUST be inclusive of start and exclusive of end (half-open intervals)
 * so that adjacent reservations don't collide.
 */
export interface AvailabilityWindow {
  start: ISODate;
  end: ISODate;
  status: AvailabilityWindowStatus;
}

export enum ProfileType {
  PERSONAL = 'personal',
  AGENCY = 'agency',
  BUSINESS = 'business',
  COOPERATIVE = 'cooperative'
}

export enum EmploymentStatus {
  EMPLOYED = 'employed',
  SELF_EMPLOYED = 'self_employed',
  STUDENT = 'student',
  RETIRED = 'retired',
  UNEMPLOYED = 'unemployed',
  OTHER = 'other'
}

export enum LeaseDuration {
  MONTHLY = 'monthly',
  THREE_MONTHS = '3_months',
  SIX_MONTHS = '6_months',
  YEARLY = 'yearly',
  FLEXIBLE = 'flexible'
}

export enum BusinessType {
  REAL_ESTATE_AGENCY = 'real_estate_agency',
  PROPERTY_MANAGEMENT = 'property_management',
  BROKERAGE = 'brokerage',
  DEVELOPER = 'developer',
  SMALL_BUSINESS = 'small_business',
  STARTUP = 'startup',
  FREELANCER = 'freelancer',
  CONSULTANT = 'consultant',
  OTHER = 'other'
}

// AI Assistant Types
export interface SindiSuggestion {
  text: string;
}

export enum ReferenceRelationship {
  LANDLORD = 'landlord',
  EMPLOYER = 'employer',
  PERSONAL = 'personal',
  OTHER = 'other'
}

export enum ReasonForLeaving {
  LEASE_ENDED = 'lease_ended',
  BOUGHT_HOME = 'bought_home',
  JOB_RELOCATION = 'job_relocation',
  FAMILY_REASONS = 'family_reasons',
  UPGRADE = 'upgrade',
  OTHER = 'other'
}

export enum ProfileVisibility {
  PUBLIC = 'public',
  PRIVATE = 'private',
  CONTACTS_ONLY = 'contacts_only'
}

export enum AgencyRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  AGENT = 'agent',
  VIEWER = 'viewer'
}

export enum CooperativeRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member'
}

export enum RecentlyViewedType {
  PROPERTY = 'property',
  ROOM = 'room',
  ROOMMATE = 'roommate'
}

export enum TrustScoreFactorType {
  VERIFICATION = 'verification',
  REVIEWS = 'reviews',
  PAYMENT_HISTORY = 'payment_history',
  COMMUNICATION = 'communication',
  RENTAL_HISTORY = 'rental_history',
  BASIC_INFO = 'basic_info',
  EMPLOYMENT = 'employment',
  REFERENCES = 'references',
  ROOMMATE_PREFERENCES = 'roommate_preferences',
  ROOMMATE_COMPATIBILITY = 'roommate_compatibility',
  AGENCY_BUSINESS = 'agency_business'
}

export enum GenderPreference {
  MALE = 'male',
  FEMALE = 'female',
  ANY = 'any'
}

// Common interfaces
export interface Coordinates {
  lat: number;
  lng: number;
}

export interface GeoJSONPoint {
  type: 'Point';
  coordinates: [number, number]; // [longitude, latitude]
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  message?: string;
  error?: string;
  data?: T;
}

export interface Timestamps {
  createdAt: string;
  updatedAt: string;
}

export interface Location {
  city: string;
  state: string;
  country?: string;
  radius?: number;
}

// Utility types
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
}; 