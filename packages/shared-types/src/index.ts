/**
 * Shared Types for Homiio
 * 
 * This package contains TypeScript interfaces and types that are shared
 * between the frontend and backend applications to ensure type consistency.
 */

// Common types and enums
export * from './common';

// Currency code sets (listing-price scope vs in-app payment scope)
export * from './currency';

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

// Local moderation-integration state (CrowdSource reports, decisions, enforcement)
export * from './moderation';

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

// Privacy-safe product observability: versioned event schema, central
// redaction, bucketing, query identity and the location/identity divergence
// invariants. Shared so the redaction rules have exactly one implementation.
export * from './observability';

// The canonical location contract (ADR 0002 §3): one `LocationSelection`, one
// `locationKey`, one `loc` URL token codec, one set of bounds validators.
export * from './location';

// `GeoPoint` and `GeoBounds` are declared BOTH in `./location` and in
// `./observability/queryIdentity`, which predates it, so the two `export *`
// lines above would otherwise be ambiguous (TS2308) and neither name would be
// exported at all. This resolves it towards the canonical contract, because
// ADR 0002 §3 is normative about the encoding and every other representation is
// converging on it. Nothing is deleted: the observability declarations keep
// their names and shapes at `@homiio/shared-types/observability/queryIdentity`,
// and folding them into this one is the migration change's job, not this file's.
//
// `GeoBounds` is structurally identical in both, so this rebinding is invisible
// to a consumer. `GeoPoint` is NOT — observability's is `{ lat, lng }` and the
// contract's is `{ longitude, latitude }`, which is exactly the transposable
// coordinate encoding ADR §1.2 counts three of inside this package.
export type { GeoPoint, GeoBounds } from './location';

// The Home surface's finite, explainable sections (#353). Depends on
// `./location` for the scope summary, so it is exported after it.
export * from './home';

// International formatting — money, units, dates, percentages. Pure, shared by
// frontend and backend so a price is never assembled by concatenation.
export * from './format/money';
export * from './format/units';
export * from './format/dates';
export * from './format/percentage';
export * from './format/numbers';
