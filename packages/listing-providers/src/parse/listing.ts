/**
 * Structural + price validation for {@link NormalizedListing} before DB upsert.
 */

import { OfferingType, type NormalizedListing } from '@homiio/shared-types';
import { stripHtmlToPlainText } from './htmlText';
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

/** Strip portal HTML from user-visible text fields on a normalized listing (in-place). */
export function sanitizeNormalizedListingTextFields(listing: NormalizedListing): void {
  if (listing.description !== undefined) {
    listing.description = stripHtmlToPlainText(listing.description);
  }

  if (listing.amenities) {
    listing.amenities = listing.amenities
      .map((item) => stripHtmlToPlainText(item) ?? '')
      .filter((item) => item.length > 0);
    if (listing.amenities.length === 0) {
      delete listing.amenities;
    }
  }

  if (listing.contact) {
    if (listing.contact.name !== undefined) {
      listing.contact.name = stripHtmlToPlainText(listing.contact.name);
    }
    if (listing.contact.agencyName !== undefined) {
      listing.contact.agencyName = stripHtmlToPlainText(listing.contact.agencyName);
    }
  }

  for (const image of listing.remoteImages) {
    if (image.caption !== undefined) {
      image.caption = stripHtmlToPlainText(image.caption);
    }
  }

  const address = listing.address;
  if (address.street !== undefined) {
    address.street = stripHtmlToPlainText(address.street) ?? address.street;
  }
  if (address.city !== undefined) {
    address.city = stripHtmlToPlainText(address.city) ?? address.city;
  }
  if (address.neighborhood !== undefined) {
    address.neighborhood = stripHtmlToPlainText(address.neighborhood);
  }
  if (address.state !== undefined) {
    address.state = stripHtmlToPlainText(address.state);
  }
}

/**
 * Validate a {@link NormalizedListing} before upsert. Throws {@link ListingValidationError}
 * with a clear reason on the first violation.
 */
export function validateNormalizedListing(
  listing: NormalizedListing,
  options: ValidateNormalizedListingOptions = {},
): void {
  sanitizeNormalizedListingTextFields(listing);

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
    listing.remoteImages = listing.remoteImages.slice(0, maxImages);
  }
  for (const image of listing.remoteImages) {
    if (!image.url?.trim()) {
      fail('remoteImages entries require a url');
    }
  }
}
