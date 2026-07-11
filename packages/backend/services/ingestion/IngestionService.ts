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
  OfferingType,
  PropertyStatus,
  type NormalizedListing,
  type NormalizedListingAddress,
} from '@homiio/shared-types';
import {
  DEFAULT_MAX_REMOTE_IMAGES,
  ListingValidationError,
  validateNormalizedListing,
} from '@homiio/listing-providers';
import { Property, Address, Agency, type IProperty } from '../../models';
import { ensureCover } from '../cityCoverSyncService';
import type { AddressCanonicalInput } from '../../models/Address';
import { validateOfferings } from '../../models/schemas/offeringValidation';
import { forwardGeocode, reverseGeocode } from '../geocodingService';
import { resolveCityCentroid } from '../geoResolutionService';
import { sanitizeGeoJsonCoordinates } from '../../utils/geoCoordinates';
import { deriveStructuredFeatures } from './deriveFeatures';
import { classifyListingContent } from './classifyListingContent';
import { ExternalMediaIngest } from './ExternalMediaIngest';
import {
  areDuplicateListings,
  toDedupComparable,
  type DedupComparable,
} from './dedupeFingerprint';
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
  /**
   * `created`/`updated` follow the `(source, sourceId)` upsert. `skipped` means
   * the listing matched an existing external Property by the dedup fingerprint
   * (a re-listing of the same unit) and was NOT persisted — `propertyId` /
   * `duplicateOf` point at the retained original.
   */
  status: 'created' | 'updated' | 'skipped';
  propertyId: string;
  source: string;
  sourceId: string;
  imageCount: number;
  /** Set only on `skipped`: the id of the existing Property this duplicated. */
  duplicateOf?: string;
}

/** Raised when a {@link NormalizedListing} is structurally invalid. */
export class IngestionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestionValidationError';
  }
}

/** Max existing listings the dedup check inspects per incoming create. */
const DEDUP_CANDIDATE_LIMIT = 50;

/** Aggregation projection of an existing Property considered as a dedup candidate. */
interface DuplicateCandidateDoc {
  _id: Types.ObjectId;
  cityId?: Types.ObjectId;
  description?: string;
  images?: unknown[];
  type?: string;
  bedrooms?: number;
  squareFootage?: number;
  longTermRent?: { monthlyAmount?: number; currency?: string } | null;
  shortTermRent?: { nightlyRate?: number; currency?: string } | null;
  sale?: { price?: number; currency?: string } | null;
}

export interface IngestionServiceOptions {
  mediaIngest?: ExternalMediaIngest;
  logger?: Logger;
  /** Fallback TTL (days) applied when a listing omits `ttlDays`. */
  defaultTtlDays?: number;
  /**
   * Recognise and skip re-listings of the same unit under a new `sourceId`
   * (see {@link areDuplicateListings}). Defaults to env `LISTING_DEDUP_ENABLED`
   * and is OPT-IN (only the literal `true` enables it).
   *
   * Off by default because the description-Jaccard fingerprint has a known
   * false-positive class: new-build developments (e.g. immobilienscout24 Neubau
   * projects) list many DISTINCT units that share one developer brochure, so
   * their descriptions are near-identical at the same price/m²/bedrooms even
   * though they are different apartments. Until a development-safe signal exists,
   * enabling dedup broadly risks skipping legitimate units, so it stays opt-in.
   */
  dedupeEnabled?: boolean;
}

export class IngestionService {
  private readonly mediaIngest: ExternalMediaIngest;
  private readonly logger: Logger;
  private readonly defaultTtlDays: number;
  private readonly dedupeEnabled: boolean;

  constructor(options: IngestionServiceOptions = {}) {
    this.mediaIngest = options.mediaIngest ?? new ExternalMediaIngest();
    this.logger = options.logger ?? new Logger('IngestionService');
    this.defaultTtlDays = options.defaultTtlDays ?? DEFAULT_TTL_DAYS;
    this.dedupeEnabled = options.dedupeEnabled ?? process.env.LISTING_DEDUP_ENABLED === 'true';
  }

  /** Validate, upsert and re-host media for a single normalized listing. */
  async ingest(listing: NormalizedListing): Promise<IngestResult> {
    this.validate(listing);

    const addressId = await this.resolveAddress(listing.address);
    const fields = this.buildPropertyFields(listing, addressId);

    // Attribute the listing to a canonical Agency when the portal contact AJAX
    // exposed an agency name. `findOrCreateByName` is the sole Agency write path
    // and dedupes by normalized name — the raw string stays on `externalContact`.
    if (listing.contact?.agencyName) {
      const agency = await Agency.findOrCreateByName(listing.contact.agencyName);
      if (agency) fields.agencyId = agency._id;
    }

    const existing = await Property.findOne({ source: listing.source, sourceId: listing.sourceId });

    // Before minting a NEW Property, check whether this is the SAME unit
    // re-advertised under a different `sourceId` (best-effort; a failed check
    // never blocks ingest). The `(source, sourceId)` update path is untouched.
    if (!existing && this.dedupeEnabled) {
      const duplicate = await this.findDuplicate(listing, addressId);
      if (duplicate) {
        this.logger.info('Skipped duplicate external listing', {
          source: listing.source,
          sourceId: listing.sourceId,
          duplicateOf: duplicate.propertyId,
        });
        return {
          status: 'skipped',
          propertyId: duplicate.propertyId,
          duplicateOf: duplicate.propertyId,
          source: listing.source,
          sourceId: listing.sourceId,
          imageCount: duplicate.imageCount,
        };
      }
    }

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

  /**
   * Find an existing external Property that this listing duplicates (same unit,
   * different `sourceId`). Returns the retained original (preferring the one with
   * the most images) or `null`. Best-effort: any error is logged and treated as
   * "no duplicate" so a dedup fault never blocks ingest.
   */
  private async findDuplicate(
    listing: NormalizedListing,
    addressId: Types.ObjectId,
  ): Promise<{ propertyId: string; imageCount: number } | null> {
    try {
      const listingAddress = await Address.findById(addressId).select('cityId').lean<{
        cityId?: Types.ObjectId;
      } | null>();
      const cityId = listingAddress?.cityId;
      const incoming = toDedupComparable({
        type: listing.type,
        cityId: cityId ? String(cityId) : undefined,
        bedrooms: listing.bedrooms,
        squareFootage: listing.squareFootage,
        description: listing.description,
        longTermRent: listing.longTermRent,
        shortTermRent: listing.shortTermRent,
        sale: listing.sale,
      });
      if (!incoming || !cityId) return null;

      // Selective scalar prefilter (same type, bedrooms, m² and price) joined to
      // the Address `cityId`. The `$lookup` bypasses the Property post-find hook
      // that renames/mangles `addressId` on lean reads, so `cityId` is clean. The
      // same-city `$match` runs BEFORE `$limit` so a bounded candidate scan for a
      // common config never drops the actually-matching (same-city) listing.
      const candidates = await Property.aggregate<DuplicateCandidateDoc>([
        {
          $match: {
            isExternal: true,
            deletedAt: null,
            type: incoming.type,
            bedrooms: incoming.bedrooms,
            squareFootage: incoming.squareFootage,
            ...this.buildPriceFilter(incoming),
          },
        },
        { $lookup: { from: 'addresses', localField: 'addressId', foreignField: '_id', as: 'addr' } },
        { $addFields: { cityId: { $arrayElemAt: ['$addr.cityId', 0] } } },
        { $match: { cityId } },
        { $limit: DEDUP_CANDIDATE_LIMIT },
        {
          $project: {
            description: 1,
            images: 1,
            type: 1,
            bedrooms: 1,
            squareFootage: 1,
            longTermRent: 1,
            shortTermRent: 1,
            sale: 1,
            cityId: 1,
          },
        },
      ]);
      if (candidates.length === 0) return null;

      let best: { propertyId: string; imageCount: number } | null = null;
      for (const candidate of candidates) {
        const comparable = toDedupComparable({
          type: candidate.type,
          cityId: candidate.cityId ? String(candidate.cityId) : undefined,
          bedrooms: candidate.bedrooms,
          squareFootage: candidate.squareFootage,
          description: candidate.description,
          longTermRent: candidate.longTermRent,
          shortTermRent: candidate.shortTermRent,
          sale: candidate.sale,
        });
        if (!comparable || !areDuplicateListings(incoming, comparable)) continue;
        const imageCount = Array.isArray(candidate.images) ? candidate.images.length : 0;
        if (!best || imageCount > best.imageCount) {
          best = { propertyId: String(candidate._id), imageCount };
        }
      }
      return best;
    } catch (error) {
      this.logger.warn('Duplicate check failed; proceeding with ingest', {
        source: listing.source,
        sourceId: listing.sourceId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Mongo filter matching the primary offering's price + currency. `amount` is the
   * rounded integer from the comparable, but stored prices may carry decimals, so
   * the filter is a half-unit range `[amount - 0.5, amount + 0.5)` — every stored
   * value that rounds to `amount` matches (the exact per-listing equality is then
   * re-checked in {@link areDuplicateListings}). Exact equality here would miss a
   * stored `850.4` for an incoming `850`.
   */
  private buildPriceFilter(comparable: DedupComparable): Record<string, unknown> {
    const range = { $gte: comparable.amount - 0.5, $lt: comparable.amount + 0.5 };
    switch (comparable.offering) {
      case OfferingType.LONG_TERM_RENT:
        return {
          'longTermRent.monthlyAmount': range,
          'longTermRent.currency': comparable.currency,
        };
      case OfferingType.SHORT_TERM_RENT:
        return {
          'shortTermRent.nightlyRate': range,
          'shortTermRent.currency': comparable.currency,
        };
      case OfferingType.SALE:
        return {
          'sale.price': range,
          'sale.currency': comparable.currency,
        };
    }
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
   * Resolve coordinates for a listing that did NOT supply its own, WITHOUT ever
   * dropping the listing when its city is known.
   *
   *   1. Street-level forward geocode (accurate) — used when it succeeds.
   *   2. City centroid — {@link resolveCityCentroid} reuses a City doc we already
   *      own (zero external calls) or does one cached, throttled city geocode.
   *      This is the guaranteed fallback: an approximate city-centroid point is
   *      an acceptable location for an aggregator listing; losing the listing is
   *      not. It is also what makes ingest resilient to a Nominatim rate-limit
   *      flood — the failure mode that previously dropped ~10 providers wholesale
   *      because the per-listing street geocode AND its city retry both raced the
   *      same overloaded public endpoint.
   *
   * Only throws when the city itself cannot be resolved by ANY means — which,
   * since discovery is city-scoped, should be vanishingly rare.
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

    const centroid = await resolveCityCentroid({
      city: address.city,
      state: address.state,
      country: address.country,
      countryCode: address.countryCode,
    });
    if (centroid) {
      this.logger.warn('Using city-centroid coordinates for external listing (street geocode failed)', {
        street: address.street,
        city: address.city,
        fullQueryError: full.error,
      });
      // Use the postal fallback directly rather than reverse-geocoding the
      // centroid: the point is already the city center, so a reverse-geocoded
      // postal would belong to the city center, not this listing — and, being a
      // throttled, uncached-on-failure network call, it would re-introduce the
      // very 1-listing/sec bottleneck this fallback exists to avoid.
      return { coordinates: centroid, postalCode: EXTERNAL_POSTAL_FALLBACK };
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
