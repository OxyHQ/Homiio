/**
 * External-listing deduplication fingerprint.
 *
 * The `(source, sourceId)` upsert key stops the SAME portal ad from being
 * ingested twice, but the SAME physical unit re-advertised under a NEW
 * `sourceId` (same agency re-posting, a portal recycling ids, or a cross-portal
 * repost) still slips through as a separate Property. This module defines the
 * conservative fingerprint that recognises those re-listings.
 *
 * Design rationale (validated against ~5.6k live external listings):
 *
 *  - Coordinates are UNRELIABLE for dedup. Portals like habitaclia/fotocasa
 *    geocode almost every listing to the city centroid (94-100% of listings
 *    share one point), so "coordinates within Nm" matches unrelated flats. We
 *    therefore never anchor on coordinates.
 *  - Two DIFFERENT flats routinely share price + m2 + bedrooms by chance (common
 *    configs at round prices) and AI-templated portal copy pushes their
 *    description similarity as high as ~0.91 across different neighbourhoods.
 *  - New-build developments and investment portfolios re-use a byte-identical
 *    brochure across genuinely different units - so description identity alone is
 *    NOT sufficient either.
 *
 * The fingerprint only declares a duplicate when ALL of the following hold, which
 * jointly separate true re-lists (observed jaccard cluster 0.96-1.0) from the
 * false-positive classes above with a clear margin:
 *
 *   1. same property `type`                 (an apartment is never a house)
 *   2. same `cityId`                        (excludes multi-city developments)
 *   3. same primary offering + identical price (amount + currency)
 *   4. same `bedrooms`, both > 0
 *   5. same `squareFootage`, both > 0       (never dedup on missing/zero m2)
 *   6. both descriptions carry >= {@link MIN_DESCRIPTION_TOKENS} tokens
 *   7. description token Jaccard >= {@link MIN_DESCRIPTION_JACCARD}
 *
 * Conservative by design: when any signal is missing or weak we do NOT dedup.
 */

import { OfferingType } from '@homiio/shared-types';

/** Minimum normalized-token count for a description to be usable as a signal. */
export const MIN_DESCRIPTION_TOKENS = 40;

/**
 * Minimum description-token Jaccard for two listings to count as the same unit.
 * Sits in the middle of the empirical safe plateau: cross-neighbourhood templated
 * false positives top out at ~0.91, true re-lists cluster at 0.96-1.0.
 */
export const MIN_DESCRIPTION_JACCARD = 0.95;

/** The three priced offerings a listing can carry, in dedup precedence order. */
export type DedupOffering =
  | OfferingType.LONG_TERM_RENT
  | OfferingType.SHORT_TERM_RENT
  | OfferingType.SALE;

/** Minimal priced-block shape shared by `NormalizedListing` and the Property doc. */
export interface PricingBlocks {
  longTermRent?: { monthlyAmount?: number | null; currency?: string | null } | null;
  shortTermRent?: { nightlyRate?: number | null; currency?: string | null } | null;
  sale?: { price?: number | null; currency?: string | null } | null;
}

/** The resolved primary price used as a fingerprint dimension. */
export interface PrimaryPricing {
  offering: DedupOffering;
  amount: number;
  currency: string;
}

/**
 * A listing reduced to its fingerprint dimensions. Produced by
 * {@link toDedupComparable}; `descriptionTokens` is precomputed so callers can
 * compare one candidate against many without re-tokenising.
 */
export interface DedupComparable {
  type: string;
  cityId: string;
  offering: DedupOffering;
  amount: number;
  currency: string;
  bedrooms: number;
  squareFootage: number;
  descriptionTokens: ReadonlySet<string>;
}

/** Raw listing fields needed to build a {@link DedupComparable}. */
export interface DedupListingInput extends PricingBlocks {
  type?: string | null;
  cityId?: string | null;
  bedrooms?: number | null;
  squareFootage?: number | null;
  description?: string | null;
}

/**
 * Pick the primary priced offering. Precedence long-term -> short-term -> sale
 * matches how listings are surfaced; a listing carries at most one meaningful
 * rent/sale block in practice, so precedence only breaks the rare tie.
 */
export function extractPrimaryPricing(blocks: PricingBlocks): PrimaryPricing | null {
  const ltr = blocks.longTermRent;
  if (ltr && typeof ltr.monthlyAmount === 'number' && ltr.monthlyAmount > 0) {
    return {
      offering: OfferingType.LONG_TERM_RENT,
      amount: Math.round(ltr.monthlyAmount),
      currency: (ltr.currency ?? '').toUpperCase(),
    };
  }
  const str = blocks.shortTermRent;
  if (str && typeof str.nightlyRate === 'number' && str.nightlyRate > 0) {
    return {
      offering: OfferingType.SHORT_TERM_RENT,
      amount: Math.round(str.nightlyRate),
      currency: (str.currency ?? '').toUpperCase(),
    };
  }
  const sale = blocks.sale;
  if (sale && typeof sale.price === 'number' && sale.price > 0) {
    return {
      offering: OfferingType.SALE,
      amount: Math.round(sale.price),
      currency: (sale.currency ?? '').toUpperCase(),
    };
  }
  return null;
}

const TOKEN_PATTERN = /[a-z0-9]+/g;
/** Unicode nonspacing marks — the decomposed accents left after NFD. */
const NONSPACING_MARKS = /\p{Mn}/gu;

/**
 * Normalize a description into a comparable token set: accent-stripped,
 * lowercased, words of length >= 3. Accent stripping keeps EU portals' diacritics
 * from splitting otherwise-identical copies.
 */
export function normalizeDescriptionTokens(description: string | null | undefined): Set<string> {
  if (!description) return new Set();
  const folded = description.normalize('NFD').replace(NONSPACING_MARKS, '').toLowerCase();
  const tokens = new Set<string>();
  for (const match of folded.matchAll(TOKEN_PATTERN)) {
    if (match[0].length >= 3) tokens.add(match[0]);
  }
  return tokens;
}

/** Jaccard similarity of two token sets (0 when either is empty). */
export function descriptionJaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of small) {
    if (large.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Reduce a listing to a {@link DedupComparable}, or `null` when it lacks the
 * strong signals the fingerprint requires (missing type/city/price, non-positive
 * m2 or bedrooms, or a too-thin description). A `null` result means "never a
 * dedup candidate" - the conservative default.
 */
export function toDedupComparable(input: DedupListingInput): DedupComparable | null {
  const type = input.type?.trim();
  const cityId = input.cityId?.trim();
  if (!type || !cityId) return null;

  const bedrooms = input.bedrooms;
  const squareFootage = input.squareFootage;
  if (typeof bedrooms !== 'number' || bedrooms <= 0) return null;
  if (typeof squareFootage !== 'number' || squareFootage <= 0) return null;

  const pricing = extractPrimaryPricing(input);
  if (!pricing || !pricing.currency) return null;

  const descriptionTokens = normalizeDescriptionTokens(input.description);
  if (descriptionTokens.size < MIN_DESCRIPTION_TOKENS) return null;

  return {
    type,
    cityId,
    offering: pricing.offering,
    amount: pricing.amount,
    currency: pricing.currency,
    bedrooms,
    squareFootage,
    descriptionTokens,
  };
}

/**
 * Whether two eligible comparables describe the same re-listed unit. Both inputs
 * must already be non-null {@link DedupComparable}s (i.e. individually eligible).
 */
export function areDuplicateListings(a: DedupComparable, b: DedupComparable): boolean {
  if (a.type !== b.type) return false;
  if (a.cityId !== b.cityId) return false;
  if (a.offering !== b.offering) return false;
  if (a.amount !== b.amount) return false;
  if (a.currency !== b.currency) return false;
  if (a.bedrooms !== b.bedrooms) return false;
  if (a.squareFootage !== b.squareFootage) return false;
  return descriptionJaccard(a.descriptionTokens, b.descriptionTokens) >= MIN_DESCRIPTION_JACCARD;
}
