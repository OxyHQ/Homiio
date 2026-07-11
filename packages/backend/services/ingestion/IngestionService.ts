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
import {
  DEFAULT_MAX_REMOTE_IMAGES,
  ListingValidationError,
  validateNormalizedListing,
} from '@homiio/listing-providers';
import { Property, Address, type IProperty } from '../../models';
import { ensureCover } from '../cityCoverSyncService';
import type { AddressCanonicalInput } from '../../models/Address';
import { validateOfferings } from '../../models/schemas/offeringValidation';
import { forwardGeocode, reverseGeocode } from '../geocodingService';
import { sanitizeGeoJsonCoordinates } from '../../utils/geoCoordinates';
import { deriveStructuredFeatures } from './deriveFeatures';
import { classifyListingContent } from './classifyListingContent';
import { ExternalMediaIngest } from './ExternalMediaIngest';
import { schedulePriceEthicsScore } from '../priceEthicsService';
import { Logger } from '../../utils/logger';

/** Default TTL (days) for an ingested external listing when none is specified. */
const DEFAULT_TTL_DAYS = 30;

/** Property schema cap for portal descriptions (must match PropertySchema). */
const MAX_EXTERNAL_DESCRIPTION_LENGTH = 2000;

/** When portals omit a postcode and geocoders return none (Address requires a value). */
const EXTERNAL_POSTAL_FALLBACK = '00000';

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

    const address = await Address.findById(property.addressId).select('cityId').lean();
    if (address?.cityId) {
      void ensureCover(address.cityId);
    }

    const result: IngestResult = {
      status: existing ? 'updated' : 'created',
      propertyId: String(property._id),
      source: listing.source,
      sourceId: listing.sourceId,
      imageCount,
    };
    schedulePriceEthicsScore(result.propertyId);
    this.logger.info('Ingested external listing', result);
    return result;
  }

  /** Structural validation before any DB work. */
  private validate(listing: NormalizedListing): void {
    try {
      validateNormalizedListing(listing, { maxRemoteImages: DEFAULT_MAX_REMOTE_IMAGES });
    } catch (error) {
      if (error instanceof ListingValidationError) {
        this.logger.warn('Skipping external listing (validation)', {
          source: error.source,
          sourceId: error.sourceId,
          reason: error.reason,
        });
        throw error;
      }
      throw error;
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
    let postalCode = address.postalCode?.trim() ?? '';
    let coordinates: [number, number];

    if (address.coordinates) {
      coordinates = [address.coordinates.lng, address.coordinates.lat];
    } else {
      const resolved = await this.resolveCoordinatesWithFallback(address);
      coordinates = resolved.coordinates;
      if (!postalCode && resolved.postalCode) {
        postalCode = resolved.postalCode;
      }
    }

    const sanitized = sanitizeGeoJsonCoordinates(coordinates);
    if (!sanitized) {
      throw new IngestionValidationError(
        `Invalid coordinates for external listing address: lat=${coordinates[1]} lng=${coordinates[0]}`,
      );
    }
    coordinates = sanitized;

    if (!postalCode) {
      const reversed = await reverseGeocode(coordinates[0], coordinates[1]);
      if (reversed.success && reversed.data?.postalCode?.trim()) {
        postalCode = reversed.data.postalCode.trim();
      }
    }

    if (!postalCode) {
      this.logger.warn('External listing address missing postal code; using fallback', {
        street: address.street,
        city: address.city,
      });
      postalCode = EXTERNAL_POSTAL_FALLBACK;
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
   * Forward-geocode a listing address, falling back to the city centroid when
   * the street-level query fails (common for partial portal addresses).
   */
  private async resolveCoordinatesWithFallback(
    address: NormalizedListingAddress,
  ): Promise<{ coordinates: [number, number]; postalCode?: string }> {
    const fullQuery = [address.street, address.city, address.state, address.postalCode, address.country]
      .filter(Boolean)
      .join(', ');

    const full = await forwardGeocode(fullQuery);
    if (full.success && full.data?.coordinates) {
      return {
        coordinates: full.data.coordinates,
        postalCode: full.data.postalCode?.trim() || undefined,
      };
    }

    const cityQuery = [address.city, address.state, address.country].filter(Boolean).join(', ');
    const city = await forwardGeocode(cityQuery);
    if (city.success && city.data?.coordinates) {
      this.logger.warn('Using city-centroid coordinates for external listing (street geocode failed)', {
        street: address.street,
        city: address.city,
        fullQueryError: full.error,
      });
      return {
        coordinates: city.data.coordinates,
        postalCode: city.data.postalCode?.trim() || undefined,
      };
    }

    throw new IngestionValidationError(
      `Could not resolve coordinates for external listing address: ${fullQuery}`,
    );
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
    if (listing.description !== undefined) {
      const description = listing.description.trim();
      fields.description =
        description.length > MAX_EXTERNAL_DESCRIPTION_LENGTH
          ? description.slice(0, MAX_EXTERNAL_DESCRIPTION_LENGTH)
          : description;
    }
    if (listing.bedrooms !== undefined) fields.bedrooms = listing.bedrooms;
    if (listing.bathrooms !== undefined) fields.bathrooms = listing.bathrooms;
    if (listing.squareFootage !== undefined) fields.squareFootage = listing.squareFootage;
    if (listing.floor !== undefined) fields.floor = listing.floor;
    if (listing.yearBuilt !== undefined) fields.yearBuilt = listing.yearBuilt;
    if (listing.amenities !== undefined) fields.amenities = listing.amenities;
    if (listing.parkingSpaces !== undefined) fields.parkingSpaces = listing.parkingSpaces;

    // Promote amenity tags to the structured feature columns the search filters
    // and UI read. A provider-explicit value always wins over derivation.
    const derived = deriveStructuredFeatures(listing.amenities);
    const hasElevator = listing.hasElevator ?? derived.hasElevator;
    if (hasElevator !== undefined) fields.hasElevator = hasElevator;
    const hasBalcony = listing.hasBalcony ?? derived.hasBalcony;
    if (hasBalcony !== undefined) fields.hasBalcony = hasBalcony;
    const hasGarden = listing.hasGarden ?? derived.hasGarden;
    if (hasGarden !== undefined) fields.hasGarden = hasGarden;
    const parkingType = listing.parkingType ?? derived.parkingType;
    if (parkingType !== undefined) fields.parkingType = parkingType;
    const furnishedStatus = listing.furnishedStatus ?? derived.furnishedStatus;
    if (furnishedStatus !== undefined) fields.furnishedStatus = furnishedStatus;

    // Classify the free-text description into restriction/nuance flags portals
    // never expose structurally (students-only, room-not-full-unit, temporary,
    // agency fee, …). Runs on the full pre-truncation description. Only stored
    // when at least one flag or a detected language fires.
    const listingFlags = classifyListingContent(listing.description);
    if (Object.keys(listingFlags).length > 0) fields.listingFlags = listingFlags;

    if (listing.contact) {
      const externalContact: NonNullable<IProperty['externalContact']> = {};
      if (listing.contact.phone) externalContact.phone = listing.contact.phone;
      if (listing.contact.email) externalContact.email = listing.contact.email;
      if (listing.contact.whatsapp) externalContact.whatsapp = listing.contact.whatsapp;
      if (listing.contact.name) externalContact.name = listing.contact.name;
      if (listing.contact.agencyName) externalContact.agencyName = listing.contact.agencyName;
      if (listing.contact.kind) externalContact.kind = listing.contact.kind;
      if (
        externalContact.phone ||
        externalContact.email ||
        externalContact.whatsapp ||
        externalContact.name ||
        externalContact.agencyName ||
        externalContact.kind
      ) {
        fields.externalContact = externalContact;
      }
    }

    return fields as Partial<IProperty>;
  }
}
