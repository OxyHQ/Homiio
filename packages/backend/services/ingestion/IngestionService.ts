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

import { and, eq, gte, isNull, lt, sql, type SQL } from 'drizzle-orm';
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
import { getDb } from '../../db/postgres';
import { addresses, properties, propertyImages } from '../../db/schema';
import {
  findPropertyBySource,
  insertProperty,
  replacePropertyImages,
  updateProperty,
  type PropertyWriteInput,
} from '../../db/properties/propertyWrites';
import { findOrCreateAgencyByName } from '../../db/agencies/agencyWrites';
import { ensureCover } from '../cityCoverSyncService';
import {
  findOrCreateCanonicalAddress,
  type AddressCanonicalInput,
} from '../addressService';
import { validateOfferings } from '../offeringValidation';
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

/** Projection of an existing listing considered as a dedup candidate. */
interface DuplicateCandidateRow {
  id: string;
  cityId: string | null;
  description: string | null;
  imageCount: number;
  type: string;
  bedrooms: number | null;
  squareFootage: number | null;
  longTermRentMonthlyAmount: number | null;
  longTermRentCurrency: string | null;
  shortTermRentNightlyRate: number | null;
  shortTermRentCurrency: string | null;
  salePrice: number | null;
  saleCurrency: string | null;
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
      const agency = await findOrCreateAgencyByName(listing.contact.agencyName);
      if (agency) fields.agencyId = agency.id;
    }

    const existing = await findPropertyBySource(listing.source, listing.sourceId);

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

    // New listings and listings that still have no images get their media
    // ingested; already-populated externals keep their re-hosted images on a
    // re-sync (a richer add/remove diff lands in a later phase).
    const needsMedia = !existing || existing.imageCount === 0;

    // Persist scalar fields first so the listing has an id for the `images`
    // rows, whose `entity_id` names it.
    const propertyId = existing
      ? ((await updateProperty(existing.id, fields))?.property.id ?? existing.id)
      : (await insertProperty(fields)).property.id;

    let imageCount = existing?.imageCount ?? 0;
    if (needsMedia && listing.remoteImages.length > 0) {
      const refs = await this.mediaIngest.ingestForProperty(propertyId, listing.remoteImages);
      await replacePropertyImages(propertyId, refs);
      imageCount = refs.length;
    }

    const [address] = await getDb()
      .select({ cityId: addresses.cityId })
      .from(addresses)
      .where(eq(addresses.id, addressId))
      .limit(1);
    if (address?.cityId) {
      void ensureCover(address.cityId);
    }

    const result: IngestResult = {
      status: existing ? 'updated' : 'created',
      propertyId,
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
    addressId: string,
  ): Promise<{ propertyId: string; imageCount: number } | null> {
    try {
      const [listingAddress] = await getDb()
        .select({ cityId: addresses.cityId })
        .from(addresses)
        .where(eq(addresses.id, addressId))
        .limit(1);
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
      // the address's `city_id`. The `$lookup` + `$addFields` + second `$match`
      // this replaces existed only because Mongo could not express a join in a
      // filter; here the city predicate is an ordinary join condition, so the
      // "same-city match must run BEFORE the limit" hazard the Mongo pipeline
      // had to be careful about cannot arise — the LIMIT applies to the joined,
      // fully-filtered result by construction.
      const candidates: DuplicateCandidateRow[] = await getDb()
        .select({
          id: properties.id,
          cityId: addresses.cityId,
          description: properties.description,
          // Aggregated over a LEFT JOIN, never a correlated subquery in the
          // projection: drizzle renders a column UNQUALIFIED inside a `sql`
          // template, so the correlation silently binds to the subquery's own
          // table and every count comes back 0. See the same note on
          // `findPropertyBySource`. Here it would have made "prefer the
          // duplicate with the most images" always pick the first candidate.
          imageCount: sql<number>`count(${propertyImages.id})::int`,
          type: properties.type,
          bedrooms: properties.bedrooms,
          squareFootage: properties.squareFootage,
          longTermRentMonthlyAmount: properties.longTermRentMonthlyAmount,
          longTermRentCurrency: properties.longTermRentCurrency,
          shortTermRentNightlyRate: properties.shortTermRentNightlyRate,
          shortTermRentCurrency: properties.shortTermRentCurrency,
          salePrice: properties.salePrice,
          saleCurrency: properties.saleCurrency,
        })
        .from(properties)
        .innerJoin(addresses, eq(properties.addressId, addresses.id))
        .leftJoin(propertyImages, eq(propertyImages.propertyId, properties.id))
        .where(
          and(
            eq(properties.isExternal, true),
            isNull(properties.deletedAt),
            eq(properties.type, incoming.type as 'apartment'),
            eq(properties.bedrooms, incoming.bedrooms),
            eq(properties.squareFootage, incoming.squareFootage),
            eq(addresses.cityId, cityId),
            this.buildPriceFilter(incoming),
          ),
        )
        // The photo LEFT JOIN multiplies each candidate by its photo count, so
        // the grouping is what keeps `LIMIT` counting CANDIDATES rather than
        // photo rows — a listing with 30 photos would otherwise consume the
        // whole budget on its own.
        .groupBy(
          properties.id,
          addresses.cityId,
          properties.description,
          properties.type,
          properties.bedrooms,
          properties.squareFootage,
          properties.longTermRentMonthlyAmount,
          properties.longTermRentCurrency,
          properties.shortTermRentNightlyRate,
          properties.shortTermRentCurrency,
          properties.salePrice,
          properties.saleCurrency,
        )
        .limit(DEDUP_CANDIDATE_LIMIT);
      if (candidates.length === 0) return null;

      let best: { propertyId: string; imageCount: number } | null = null;
      for (const candidate of candidates) {
        const comparable = toDedupComparable({
          type: candidate.type,
          cityId: candidate.cityId ?? undefined,
          bedrooms: candidate.bedrooms ?? undefined,
          squareFootage: candidate.squareFootage ?? undefined,
          description: candidate.description ?? undefined,
          longTermRent:
            candidate.longTermRentMonthlyAmount === null
              ? null
              : {
                  monthlyAmount: candidate.longTermRentMonthlyAmount,
                  currency: candidate.longTermRentCurrency ?? undefined,
                },
          shortTermRent:
            candidate.shortTermRentNightlyRate === null
              ? null
              : {
                  nightlyRate: candidate.shortTermRentNightlyRate,
                  currency: candidate.shortTermRentCurrency ?? undefined,
                },
          sale:
            candidate.salePrice === null
              ? null
              : { price: candidate.salePrice, currency: candidate.saleCurrency ?? undefined },
        });
        if (!comparable || !areDuplicateListings(incoming, comparable)) continue;
        if (!best || candidate.imageCount > best.imageCount) {
          best = { propertyId: candidate.id, imageCount: candidate.imageCount };
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
  private buildPriceFilter(comparable: DedupComparable): SQL {
    const low = comparable.amount - 0.5;
    const high = comparable.amount + 0.5;
    switch (comparable.offering) {
      case OfferingType.LONG_TERM_RENT:
        return and(
          gte(properties.longTermRentMonthlyAmount, low),
          lt(properties.longTermRentMonthlyAmount, high),
          eq(properties.longTermRentCurrency, comparable.currency as 'EUR'),
        ) as SQL;
      case OfferingType.SHORT_TERM_RENT:
        return and(
          gte(properties.shortTermRentNightlyRate, low),
          lt(properties.shortTermRentNightlyRate, high),
          eq(properties.shortTermRentCurrency, comparable.currency as 'EUR'),
        ) as SQL;
      case OfferingType.SALE:
        return and(
          gte(properties.salePrice, low),
          lt(properties.salePrice, high),
          eq(properties.saleCurrency, comparable.currency as 'EUR'),
        ) as SQL;
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
  private async resolveAddress(address: NormalizedListingAddress): Promise<string> {
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

    const resolved = await findOrCreateCanonicalAddress(addressInput);
    return resolved.id;
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
    addressId: string,
  ): PropertyWriteInput {
    const ttlDays = listing.ttlDays ?? this.defaultTtlDays;
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);

    const fields: PropertyWriteInput = {
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
      const externalContact: Record<string, unknown> = {};
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

    return fields;
  }
}
