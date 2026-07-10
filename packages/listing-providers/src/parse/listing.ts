/**
 * Structural + price validation for {@link NormalizedListing} before DB upsert.
 */

import { OfferingType, type NormalizedListing } from '@homiio/shared-types';
import { validateOfferingPrices } from './price';

/** Default cap aligned with {@link ExternalMediaIngest} in the backend worker. */
export const DEFAULT_MAX_REMOTE_IMAGES = 12;

/** Raised when a normalized listing fails ingest-time quality gates. */
export class ListingValidationError extends Error {
  constructor(
    readonly source: string,
    readonly sourceId: string,
    readonly reason: string,
  ) {
    super(`${source}: rejecting listing ${sourceId}: ${reason}`);
    this.name = 'ListingValidationError';
  }
}

export interface ValidateNormalizedListingOptions {
  maxRemoteImages?: number;
}

function parseOfferings(raw: unknown): OfferingType[] | null {
  if (!Array.isArray(raw)) return null;
  const valid = raw.filter(
    (value): value is OfferingType =>
      typeof value === 'string' && Object.values(OfferingType).includes(value as OfferingType),
  );
  if (valid.length !== raw.length || valid.length === 0) return null;
  return Array.from(new Set(valid));
}

/**
 * Validate a {@link NormalizedListing} before upsert. Throws {@link ListingValidationError}
 * with a clear reason on the first violation.
 */
export function validateNormalizedListing(
  listing: NormalizedListing,
  options: ValidateNormalizedListingOptions = {},
): void {
  const source = listing.source?.trim();
  const sourceId = listing.sourceId?.trim();
  if (!source) {
    throw new ListingValidationError('unknown', sourceId ?? 'unknown', 'source is required');
  }
  if (!sourceId) {
    throw new ListingValidationError(source, 'unknown', 'sourceId is required');
  }

  const fail = (reason: string): never => {
    throw new ListingValidationError(source, sourceId, reason);
  };

  if (!listing.sourceUrl?.trim()) {
    fail('sourceUrl is required');
  }

  const street = listing.address?.street?.trim();
  const city = listing.address?.city?.trim();
  if (!street || !city) {
    fail('address requires street and city');
  }

  const offeringsParsed = parseOfferings(listing.offerings);
  if (offeringsParsed === null) {
    fail('offerings must be a non-empty array of valid offering types');
    return;
  }
  const offerings = offeringsParsed;

  const priceError = validateOfferingPrices({
    offerings,
    longTermRent: listing.longTermRent,
    shortTermRent: listing.shortTermRent,
    sale: listing.sale,
    bedrooms: listing.bedrooms,
  });
  if (priceError) {
    fail(priceError);
  }

  const maxImages = options.maxRemoteImages ?? DEFAULT_MAX_REMOTE_IMAGES;
  if (!Array.isArray(listing.remoteImages)) {
    fail('remoteImages must be an array');
  }
  if (listing.remoteImages.length > maxImages) {
    fail(`remoteImages exceeds cap of ${maxImages}`);
  }
  for (const image of listing.remoteImages) {
    if (!image.url?.trim()) {
      fail('remoteImages entries require a url');
    }
  }
}
