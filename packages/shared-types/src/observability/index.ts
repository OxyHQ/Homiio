/**
 * Privacy-safe product observability for Homiio (#350).
 *
 * It lives in `@homiio/shared-types` because the redaction layer must be ONE
 * implementation. The event vocabulary spans both tiers — a permission
 * resolution and a map-area search happen on the client, a geocoder call and a
 * result set happen on the server — and a second copy of the rules is a second
 * place for them to drift, which for a privacy control means a second place to
 * be wrong silently. This package is dependency-free and already ships runtime
 * helpers of exactly this kind (`ethicalPricing`, `utils/propertyTitle`).
 *
 * Read `./schema` first: it is the privacy contract, not a data dictionary.
 */

export * from './buckets';
export * from './schema';
export * from './queryIdentity';
export * from './redaction';
export * from './emitter';
export * from './invariants';
