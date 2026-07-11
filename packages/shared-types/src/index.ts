/**
 * Shared Types for Homiio
 * 
 * This package contains TypeScript interfaces and types that are shared
 * between the frontend and backend applications to ensure type consistency.
 */

// Common types and enums
export * from './common';

// Geo hierarchy entities (Country / Region / City / Neighborhood)
export * from './geo';

// Media / Image entities (reusable image collection backing all entity photos)
export * from './media';

// Address types
export * from './address';

// Property types
export * from './property';

// Profile types
export * from './profile';

// City types
export * from './city';

// Lease types
export * from './lease';

// Review types
export * from './review';

// Reservation types (vacation/short-term bookings)
export * from './reservation';

// Tenant application types (long-term rent flow)
export * from './application';

// Home-exchange types (swap / free hosting)
export * from './exchange';

// Listing report types (trust & safety flagging)
export * from './report';

// Eviction solidarity board types (public upcoming-eviction notices + RSVP)
export * from './eviction';

// Partner (agent) referral-commission types
export * from './partner';

// Listing-provider ingestion DTO (NormalizedListing + provider identifiers)
export * from './listing';

// Pure, dependency-free property-title helpers shared by frontend and backend
export * from './utils/propertyTitle';

// Ethical rental pricing calculator (shared frontend + backend)
export * from './ethicalPricing';
