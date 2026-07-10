/**
 * Ingestion service.
 *
 * Turns a provider-agnostic {@link NormalizedListing} into a first-party Homiio
 * listing: it validates the listing, resolves the canonical Address, upserts a
 * Property by `(source, sourceId)` as an EXTERNAL aggregator listing
 * (`isExternal: true`, `status: 'published'`, always `sourceUrl`, no
 * `profileId`), and re-hosts every source image via {@link ExternalMediaIngest}
 * — never hotlinking a portal CDN.
 *
 * IDOR / mass-assignment: nothing here trusts a caller-supplied owner. Every
 * field written to the Property is either derived from the validated
 * `NormalizedListing` or set server-side; owner/lifecycle fields are fixed
 * (`profileId` never set, `status` fixed to published, `isExternal` fixed true).
 */

import type { Types } from 'mongoose';
import {
  PropertyStatus,
  type NormalizedListing,
  type NormalizedListingAddress,
} from '@homiio/shared-types';
import { Property, Address, type IProperty } from '../../models';
import type { AddressCanonicalInput } from '../../models/Address';
import { validateOfferings } from '../../models/schemas/offeringValidation';
import { forwardGeocode, reverseGeocode } from '../geocodingService';
import { ExternalMediaIngest } from './ExternalMediaIngest';
import { Logger } from '../../utils/logger';

/** Default TTL (days) for an ingested external listing when none is specified. */
const DEFAULT_TTL_DAYS = 30;

/** Outcome of ingesting one listing. */
export interface IngestResult {
  status: 'created' | 'updated';
  propertyId: string;
  source: string;
  sourceId: string;
  imageCount: number;
}

/** Raised when a {@link NormalizedListing} is structurally invalid. */
export class IngestionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestionValidationError';
  }
}

export interface IngestionServiceOptions {
  mediaIngest?: ExternalMediaIngest;
  logger?: Logger;
  /** Fallback TTL (days) applied when a listing omits `ttlDays`. */
  defaultTtlDays?: number;
}

export class IngestionService {
  private readonly mediaIngest: ExternalMediaIngest;
  private readonly logger: Logger;
  private readonly defaultTtlDays: number;

  constructor(options: IngestionServiceOptions = {}) {
    this.mediaIngest = options.mediaIngest ?? new ExternalMediaIngest();
    this.logger = options.logger ?? new Logger('IngestionService');
    this.defaultTtlDays = options.defaultTtlDays ?? DEFAULT_TTL_DAYS;
  }

  /** Validate, upsert and re-host media for a single normalized listing. */
  async ingest(listing: NormalizedListing): Promise<IngestResult> {
    this.validate(listing);

    const addressId = await this.resolveAddress(listing.address);
    const fields = this.buildPropertyFields(listing, addressId);

    const existing = await Property.findOne({ source: listing.source, sourceId: listing.sourceId });
    const property = existing ?? new Property();
    property.set(fields);

    // New listings and listings that still have no images get their media
    // ingested; already-populated externals keep their re-hosted images on a
    // re-sync (a richer add/remove diff lands in a later phase).
    const needsMedia = !existing || !property.images || property.images.length === 0;

    // Persist scalar fields first so the property has an `_id` for the Image docs.
    await property.save();

    let imageCount = property.images?.length ?? 0;
    if (needsMedia && listing.remoteImages.length > 0) {
      const refs = await this.mediaIngest.ingestForProperty(property._id, listing.remoteImages);
      property.set('images', refs);
      await property.save();
      imageCount = refs.length;
    }

    const result: IngestResult = {
      status: existing ? 'updated' : 'created',
      propertyId: String(property._id),
      source: listing.source,
      sourceId: listing.sourceId,
      imageCount,
    };
    this.logger.info('Ingested external listing', result);
    return result;
  }

  /** Structural validation before any DB work. */
  private validate(listing: NormalizedListing): void {
    if (!listing.source) {
      throw new IngestionValidationError('NormalizedListing.source is required');
    }
    if (!listing.sourceId || !listing.sourceId.trim()) {
      throw new IngestionValidationError('NormalizedListing.sourceId is required');
    }
    if (!listing.sourceUrl || !listing.sourceUrl.trim()) {
      throw new IngestionValidationError('NormalizedListing.sourceUrl is required');
    }
    if (!listing.address?.street?.trim() || !listing.address?.city?.trim()) {
      throw new IngestionValidationError('NormalizedListing.address requires street and city');
    }
    const offeringError = validateOfferings({
      offerings: listing.offerings,
      longTermRent: listing.longTermRent,
      shortTermRent: listing.shortTermRent,
      sale: listing.sale,
    });
    if (offeringError) {
      throw new IngestionValidationError(offeringError);
    }
  }

  /** Resolve the canonical building Address, geocoding coordinates if absent. */
  private async resolveAddress(address: NormalizedListingAddress): Promise<Types.ObjectId> {
    let coordinates: [number, number];
    let postalCode = address.postalCode?.trim() ?? '';

    if (address.coordinates) {
      coordinates = [address.coordinates.lng, address.coordinates.lat];
      if (!postalCode) {
        const reversed = await reverseGeocode(address.coordinates.lng, address.coordinates.lat);
        if (reversed.success && reversed.data?.postalCode?.trim()) {
          postalCode = reversed.data.postalCode.trim();
        }
      }
    } else {
      const query = [address.street, address.city, address.state, address.postalCode, address.country]
        .filter(Boolean)
        .join(', ');
      const geocoded = await forwardGeocode(query);
      const resolvedCoords = geocoded.success ? geocoded.data?.coordinates : undefined;
      if (!resolvedCoords) {
        throw new IngestionValidationError(
          `Could not resolve coordinates for external listing address: ${query}`,
        );
      }
      coordinates = resolvedCoords;
      if (!postalCode && geocoded.data?.postalCode?.trim()) {
        postalCode = geocoded.data.postalCode.trim();
      }
    }

    if (!postalCode) {
      throw new IngestionValidationError(
        `External listing address requires a postal code (street=${address.street}, city=${address.city})`,
      );
    }

    const addressInput: AddressCanonicalInput = {
      street: address.street,
      postal_code: postalCode,
      city: address.city,
      state: address.state ?? '',
      country: address.country ?? '',
      countryCode: address.countryCode,
      neighborhood: address.neighborhood ?? '',
      coordinates: { type: 'Point', coordinates },
    };

    const resolved = await Address.findOrCreateCanonical(addressInput);
    return resolved._id;
  }

  /**
   * Build the server-controlled Property field set from the listing. Only
   * derived/whitelisted fields are written; owner/lifecycle fields are fixed
   * (no `profileId`, `status` published, `isExternal` true).
   */
  private buildPropertyFields(
    listing: NormalizedListing,
    addressId: Types.ObjectId,
  ): Partial<IProperty> {
    const ttlDays = listing.ttlDays ?? this.defaultTtlDays;
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    const fields: Record<string, unknown> = {
      addressId,
      source: listing.source,
      sourceId: listing.sourceId,
      sourceUrl: listing.sourceUrl,
      isExternal: true,
      status: PropertyStatus.PUBLISHED,
      type: listing.type,
      offerings: listing.offerings,
      expiresAt,
    };

    if (listing.longTermRent) fields.longTermRent = listing.longTermRent;
    if (listing.shortTermRent) fields.shortTermRent = listing.shortTermRent;
    if (listing.sale) fields.sale = listing.sale;
    if (listing.description !== undefined) fields.description = listing.description;
    if (listing.bedrooms !== undefined) fields.bedrooms = listing.bedrooms;
    if (listing.bathrooms !== undefined) fields.bathrooms = listing.bathrooms;
    if (listing.squareFootage !== undefined) fields.squareFootage = listing.squareFootage;
    if (listing.floor !== undefined) fields.floor = listing.floor;
    if (listing.amenities !== undefined) fields.amenities = listing.amenities;
    if (listing.furnishedStatus !== undefined) fields.furnishedStatus = listing.furnishedStatus;

    return fields as Partial<IProperty>;
  }
}
