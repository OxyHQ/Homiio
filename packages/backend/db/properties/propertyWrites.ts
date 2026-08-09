/**
 * The property write repository — every listing INSERT, UPDATE and delete.
 *
 * `propertyReads.ts` said of itself that it "does not write … nothing here may
 * become the only writer of a Postgres row", because during the dual-run the
 * worker still ingested into Mongo. That period is over: Postgres is the single
 * authority for properties, and this module is the other half of that sentence.
 *
 * ## Why a deserializer exists, and why it is not the backfill's
 *
 * `db/backfill/dataPlan.ts` already maps a nested document onto these flat
 * columns, and reusing it here would be the obvious economy. It is the wrong
 * one. That mapper reads a MONGO DOCUMENT — it resolves schema defaults that
 * mongoose would have applied, logs a named resolution for each, and treats
 * every absent path as a fact about a document that already exists. This one
 * reads an API PAYLOAD that has been through `pickFields` and the offering
 * rules, where an absent key means "the caller did not mention it" and must
 * leave the stored value alone. Those are different questions with different
 * right answers, and the backfill is a one-shot copier that should be deletable
 * without taking the write path with it.
 *
 * ## A block is replaced wholesale, exactly as a subdocument was
 *
 * `Property.findByIdAndUpdate(id, { longTermRent: {...} })` REPLACED the whole
 * subdocument: a member the caller omitted came back unset, not preserved. The
 * flattened columns have to reproduce that or an edit that clears a deposit
 * would silently keep the old one. So {@link toPropertyColumns} works at BLOCK
 * granularity — mention `longTermRent` and all six of its columns are written,
 * from the block or as `null`; omit it and none of them are touched. The four
 * priced blocks are keyed on the same discriminator column the offering
 * coherence CHECKs are written over, so "the block is present" and "the
 * offering is declared" cannot disagree.
 *
 * ## What this module deliberately does NOT do
 *
 *  - **It does not write `has_images`.** `db/hasImages.ts` is the one writer,
 *    and the child-row functions here call {@link syncHasImages} after changing
 *    a listing's photos rather than assigning the column.
 *  - **It does not validate offerings.** `controllers/property/offeringRules.ts`
 *    is a pure module that already does, and it produces the 400 with the code
 *    the API contract names. Postgres's four coherence CHECKs are the backstop
 *    underneath, not a replacement for the message.
 *  - **It does not decide what a caller may set.** `editableFields.ts` does,
 *    before the payload reaches here. This module maps whatever it is given,
 *    which is why every caller must pick fields first.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';

import { getDb } from '../postgres';
import {
  properties,
  propertyAvailabilityWindows,
  propertyDocuments,
  propertyImages,
} from '../schema';
import { syncHasImages } from '../hasImages';
import { findPropertyById } from './propertyReads';
import type { HydratedProperty } from './propertySerializer';
import type { DatabaseOrTransaction } from '../postgres';

type PropertyInsert = typeof properties.$inferInsert;
type PropertyUpdate = Partial<PropertyInsert>;

/** A calendar window as the API states it, on either calendar. */
export interface AvailabilityWindowInput {
  start: Date | string;
  end: Date | string;
  status?: string;
}

/** One photo, in the shape `services/imageSerializer.toPropertyImages` produces. */
export interface PropertyImageInput {
  imageId: string;
  url?: string | null;
  caption?: string | null;
  isPrimary?: boolean;
  order?: number;
  urls?: {
    original?: string | null;
    small?: string | null;
    medium?: string | null;
    large?: string | null;
  } | null;
}

export interface PropertyDocumentInput {
  name: string;
  url: string;
  type?: string;
}

/**
 * The nested payload a write accepts — the shape the API has always taken.
 *
 * Deliberately loose (`Record<string, unknown>`-ish members rather than a
 * closed union per block): the values arrive from `pickFields`, which whitelists
 * KEYS and does not narrow types, and the column-level enums plus the CHECK
 * constraints are what actually reject a bad value. Typing this strictly here
 * would move the rejection to a place that cannot produce the API's error body.
 */
export interface PropertyWriteInput {
  [field: string]: unknown;
}

/** Values a block reader may see. */
type Block = Record<string, unknown> | null | undefined;

function asBlock(value: unknown): Block {
  if (value === null || value === undefined) return value as Block;
  return typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Read one member out of a block, mapping absence to `null`.
 *
 * `null` and not `undefined`, because these feed a block-granularity write:
 * `undefined` would leave the column at its previous value, which is exactly
 * the subdocument-replacement bug this module exists to avoid.
 */
function member(block: Block, key: string): never | unknown {
  if (!block) return null;
  const value = block[key];
  return value === undefined ? null : value;
}

/** Whether a payload mentions a key at all — `null` counts as mentioning it. */
function mentions(input: PropertyWriteInput, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

/**
 * Map the nested API payload onto flat columns.
 *
 * Only keys the payload MENTIONS produce columns, so the same function serves a
 * create (where the caller mentions everything it wants set) and a partial
 * update (where it mentions a few). The `as` casts are confined to the enum
 * columns and are what lets an invalid value reach the CHECK constraint that
 * actually names it, rather than being silently dropped by a type guard here.
 */
export function toPropertyColumns(input: PropertyWriteInput): PropertyUpdate {
  const columns: Record<string, unknown> = {};

  /** Copy a scalar column when the payload mentions it. */
  const scalar = (key: string, column: string = key): void => {
    if (mentions(input, key)) columns[column] = input[key];
  };

  for (const key of [
    'oxyUserId',
    'source',
    'sourceId',
    'sourceUrl',
    'isExternal',
    'expiresAt',
    'sourcedByReferralCode',
    'agencyId',
    'title',
    'description',
    'addressId',
    'showAddressNumber',
    'type',
    'housingType',
    'layoutType',
    'bedrooms',
    'bathrooms',
    'squareFootage',
    'floor',
    'yearBuilt',
    'hasElevator',
    'hasBalcony',
    'hasGarden',
    'utilitiesIncluded',
    'petFriendly',
    'proximityToTransport',
    'proximityToSchools',
    'proximityToShopping',
    'isVerified',
    'isEcoFriendly',
    'offerings',
    'amenities',
    'furnishedStatus',
    'petPolicy',
    'petFee',
    'parkingType',
    'parkingSpaces',
    'leaseTerm',
    'cancellationPolicy',
    'availableFrom',
    'smokingAllowed',
    'partiesAllowed',
    'guestsAllowed',
    'maxGuests',
    'lastSaved',
    'parentPropertyId',
    'status',
    'deletedAt',
  ]) {
    scalar(key);
  }

  // RENAMED from Mongo's `sourcedByPartner` — see the column's own doc. Both
  // spellings are accepted on the way in because `controllers/property/create`
  // resolves a referral code into the old name and the ingest uses the new one;
  // only one column exists to write.
  if (mentions(input, 'sourcedByPartnerId')) columns.sourcedByPartnerId = input.sourcedByPartnerId;
  else if (mentions(input, 'sourcedByPartner')) columns.sourcedByPartnerId = input.sourcedByPartner;

  if (mentions(input, 'externalContact')) {
    const block = asBlock(input.externalContact);
    columns.externalContactPhone = member(block, 'phone');
    columns.externalContactEmail = member(block, 'email');
    columns.externalContactWhatsapp = member(block, 'whatsapp');
    columns.externalContactName = member(block, 'name');
    columns.externalContactAgencyName = member(block, 'agencyName');
    columns.externalContactKind = member(block, 'kind');
  }

  if (mentions(input, 'listingFlags')) {
    const block = asBlock(input.listingFlags);
    columns.listingFlagsStudentsOnly = member(block, 'studentsOnly');
    columns.listingFlagsRoomNotFullUnit = member(block, 'roomNotFullUnit');
    columns.listingFlagsTemporaryOnly = member(block, 'temporaryOnly');
    columns.listingFlagsGenderRestricted = member(block, 'genderRestricted');
    columns.listingFlagsWorkersOnly = member(block, 'workersOnly');
    columns.listingFlagsAgencyFeePayable = member(block, 'agencyFeePayable');
    columns.listingFlagsNoPets = member(block, 'noPets');
    columns.listingFlagsNoSmoking = member(block, 'noSmoking');
    columns.listingFlagsNoCouples = member(block, 'noCouples');
    // Mongo spells this one `noDSS`; the column is `listing_flags_no_dss`.
    columns.listingFlagsNoDss = member(block, 'noDSS');
    columns.listingFlagsDetectedLanguage = member(block, 'detectedLanguage');
  }

  if (mentions(input, 'longTermRent')) {
    const block = asBlock(input.longTermRent);
    columns.longTermRentMonthlyAmount = member(block, 'monthlyAmount');
    columns.longTermRentCurrency = member(block, 'currency');
    columns.longTermRentDeposit = member(block, 'deposit');
    columns.longTermRentApplicationFee = member(block, 'applicationFee');
    columns.longTermRentLateFee = member(block, 'lateFee');
    columns.longTermRentUtilities = member(block, 'utilities');
  }

  if (mentions(input, 'shortTermRent')) {
    const block = asBlock(input.shortTermRent);
    columns.shortTermRentNightlyRate = member(block, 'nightlyRate');
    columns.shortTermRentCurrency = member(block, 'currency');
    columns.shortTermRentCleaningFee = member(block, 'cleaningFee');
    columns.shortTermRentServiceFee = member(block, 'serviceFee');
    columns.shortTermRentTaxesPercent = member(block, 'taxesPercent');
    columns.shortTermRentMinNights = member(block, 'minNights');
    columns.shortTermRentMaxNights = member(block, 'maxNights');
    columns.shortTermRentInstantBook = member(block, 'instantBook');
    columns.shortTermRentDeposit = member(block, 'deposit');
  }

  if (mentions(input, 'sale')) {
    const block = asBlock(input.sale);
    columns.salePrice = member(block, 'price');
    columns.saleCurrency = member(block, 'currency');
    columns.salePricePerSqm = member(block, 'pricePerSqm');
    columns.saleEstimatedYield = member(block, 'estimatedYield');
    columns.saleIsPriceReduced = member(block, 'isPriceReduced');
    columns.saleChainStatus = member(block, 'chainStatus');
  }

  if (mentions(input, 'exchange')) {
    const block = asBlock(input.exchange);
    columns.exchangeMode = member(block, 'mode');
    columns.exchangeMinStay = member(block, 'minStay');
    columns.exchangeMaxStay = member(block, 'maxStay');
    columns.exchangeWelcomeNote = member(block, 'welcomeNote');
    columns.exchangeLanguages = member(block, 'languages');
    columns.exchangeMealsIncluded = member(block, 'mealsIncluded');
    columns.exchangeRequiresReciprocity = member(block, 'requiresReciprocity');
  }

  // `accommodationDetails`, `availability` and `rules` are present on all
  // 17,644 production rows and their columns are NOT NULL with defaults, so a
  // member the caller omits falls back to the column default rather than to
  // `null` — writing `null` into `availability_is_available` would violate the
  // constraint the schema chose precisely because the block is never absent.
  if (mentions(input, 'accommodationDetails')) {
    const block = asBlock(input.accommodationDetails);
    columns.accommodationDetailsSleepingArrangement = member(block, 'sleepingArrangement');
    columns.accommodationDetailsHostelRoomType = member(block, 'hostelRoomType');
    columns.accommodationDetailsCampsiteType = member(block, 'campsiteType');
    columns.accommodationDetailsMaxStay = member(block, 'maxStay');
    columns.accommodationDetailsMinAge = member(block, 'minAge');
    columns.accommodationDetailsMaxAge = member(block, 'maxAge');
    columns.accommodationDetailsCulturalExchange = member(block, 'culturalExchange') ?? false;
    columns.accommodationDetailsMealsIncluded = member(block, 'mealsIncluded') ?? false;
    columns.accommodationDetailsWifiPassword = member(block, 'wifiPassword');
    columns.accommodationDetailsRoommatePreferences = member(block, 'roommatePreferences') ?? [];
    columns.accommodationDetailsColivingFeatures = member(block, 'colivingFeatures') ?? [];
    columns.accommodationDetailsLanguages = member(block, 'languages') ?? [];
    columns.accommodationDetailsHouseRules = member(block, 'houseRules') ?? [];
  }

  if (mentions(input, 'availability')) {
    const block = asBlock(input.availability);
    columns.availabilityIsAvailable = member(block, 'isAvailable') ?? true;
    columns.availabilityAvailableFrom = member(block, 'availableFrom');
    columns.availabilityMinimumStay = member(block, 'minimumStay');
    columns.availabilityMaximumStay = member(block, 'maximumStay');
  }

  if (mentions(input, 'rules')) {
    const block = asBlock(input.rules);
    columns.rulesPets = member(block, 'pets') ?? false;
    columns.rulesSmoking = member(block, 'smoking') ?? false;
    columns.rulesParties = member(block, 'parties') ?? false;
    columns.rulesGuests = member(block, 'guests') ?? true;
    columns.rulesMaxOccupancy = member(block, 'maxOccupancy');
  }

  if (mentions(input, 'priceEthics')) {
    const block = asBlock(input.priceEthics);
    columns.priceEthicsEthicalSuggested = member(block, 'ethicalSuggested');
    columns.priceEthicsEthicalMax = member(block, 'ethicalMax');
    columns.priceEthicsWithinEthical = member(block, 'withinEthical');
    columns.priceEthicsMarketVerdict = member(block, 'marketVerdict');
    columns.priceEthicsPercentDiffFromAvg = member(block, 'percentDiffFromAvg');
    columns.priceEthicsIsFairPrice = member(block, 'isFairPrice');
    columns.priceEthicsFairnessScore = member(block, 'fairnessScore');
    columns.priceEthicsScoredAt = member(block, 'scoredAt');
  }

  return columns as PropertyUpdate;
}

/** Windows carried on the payload's two calendars, ready for the child table. */
function windowRows(
  propertyId: string,
  scope: 'listing' | 'exchange',
  input: readonly AvailabilityWindowInput[],
): (typeof propertyAvailabilityWindows.$inferInsert)[] {
  return input.map((window) => ({
    propertyId,
    scope,
    startsAt: new Date(window.start),
    endsAt: new Date(window.end),
    // The column carries its own default; naming it only when the caller did
    // keeps a payload that omits `status` on the schema's answer.
    ...(window.status === undefined ? {} : { status: window.status as 'available' }),
  }));
}

function imageRows(
  propertyId: string,
  input: readonly PropertyImageInput[],
): (typeof propertyImages.$inferInsert)[] {
  return input.map((image, index) => ({
    propertyId,
    imageId: image.imageId,
    url: image.url ?? null,
    caption: image.caption ?? null,
    // `property_images_one_primary_key` is a PARTIAL unique on
    // `(property_id) WHERE is_primary`, so at most one row here may claim it.
    // The index is what enforces that; the caller's own ordering decides which.
    isPrimary: image.isPrimary ?? false,
    order: image.order ?? index,
    urlsOriginal: image.urls?.original ?? null,
    urlsSmall: image.urls?.small ?? null,
    urlsMedium: image.urls?.medium ?? null,
    urlsLarge: image.urls?.large ?? null,
  }));
}

/**
 * Replace a listing's photos, then re-derive `has_images`.
 *
 * A replace rather than a diff, because that is what the Mongo write did
 * (`property.set('images', refs)` assigned the whole array) and because the
 * partial unique index makes an incremental update of `is_primary` a two-
 * statement dance that can transiently hold two primaries. The rows are cheap
 * and the listing is locked by the enclosing transaction.
 */
export async function replacePropertyImages(
  propertyId: string,
  input: readonly PropertyImageInput[],
  db: DatabaseOrTransaction = getDb(),
): Promise<void> {
  await db.delete(propertyImages).where(eq(propertyImages.propertyId, propertyId));
  if (input.length > 0) {
    await db.insert(propertyImages).values(imageRows(propertyId, input));
  }
  await syncHasImages(db, propertyId);
}

export async function replacePropertyDocuments(
  propertyId: string,
  input: readonly PropertyDocumentInput[],
  db: DatabaseOrTransaction = getDb(),
): Promise<void> {
  await db.delete(propertyDocuments).where(eq(propertyDocuments.propertyId, propertyId));
  if (input.length === 0) return;
  await db.insert(propertyDocuments).values(
    input.map((document) => ({
      propertyId,
      name: document.name,
      url: document.url,
      ...(document.type === undefined ? {} : { type: document.type as 'other' }),
    })),
  );
}

/**
 * Replace ONE calendar's windows, leaving the other alone.
 *
 * The scope discriminator is what lets one table and one GiST index serve both
 * the listing calendar and the exchange calendar; deleting by property id alone
 * would have an edit to the listing calendar silently clear the exchange one.
 */
export async function replaceAvailabilityWindows(
  propertyId: string,
  scope: 'listing' | 'exchange',
  input: readonly AvailabilityWindowInput[],
  db: DatabaseOrTransaction = getDb(),
): Promise<void> {
  await db
    .delete(propertyAvailabilityWindows)
    .where(
      and(
        eq(propertyAvailabilityWindows.propertyId, propertyId),
        eq(propertyAvailabilityWindows.scope, scope),
      ),
    );
  if (input.length === 0) return;
  await db.insert(propertyAvailabilityWindows).values(windowRows(propertyId, scope, input));
}

/** Pull the child collections off a payload, so the scalar mapper never sees them. */
function childCollections(input: PropertyWriteInput): {
  images?: readonly PropertyImageInput[];
  documents?: readonly PropertyDocumentInput[];
  listingWindows?: readonly AvailabilityWindowInput[];
  exchangeWindows?: readonly AvailabilityWindowInput[];
} {
  const exchange = asBlock(input.exchange);
  return {
    images: Array.isArray(input.images) ? (input.images as PropertyImageInput[]) : undefined,
    documents: Array.isArray(input.documents)
      ? (input.documents as PropertyDocumentInput[])
      : undefined,
    listingWindows: Array.isArray(input.availabilityWindows)
      ? (input.availabilityWindows as AvailabilityWindowInput[])
      : undefined,
    // The exchange calendar rides INSIDE the exchange block on the wire, which
    // is why mentioning `exchange` at all replaces it — the block is replaced
    // wholesale and its calendar is part of the block.
    exchangeWindows: mentions(input, 'exchange')
      ? Array.isArray(exchange?.availabilityWindows)
        ? (exchange?.availabilityWindows as AvailabilityWindowInput[])
        : []
      : undefined,
  };
}

/**
 * Create a listing and everything that hangs off it, in ONE transaction.
 *
 * The transaction is not decoration: `property_images.property_id` is a
 * CASCADE reference, so a photo row inserted against a listing whose insert
 * later fails would be a foreign-key violation rather than an orphan — but the
 * calendar windows and documents would have committed, and a listing that
 * half-exists is worse than one that does not.
 *
 * @returns the hydrated listing, read back through the SAME repository every
 *   catalogue endpoint reads through — which is what makes "created rows are
 *   immediately visible to the catalogue" an observation rather than a hope.
 */
export async function insertProperty(input: PropertyWriteInput): Promise<HydratedProperty> {
  const children = childCollections(input);
  const columns = toPropertyColumns(input);

  const id = await getDb().transaction(async (tx) => {
    const [created] = await tx
      .insert(properties)
      .values(columns as PropertyInsert)
      .returning({ id: properties.id });

    if (children.images) await replacePropertyImages(created.id, children.images, tx);
    if (children.documents) await replacePropertyDocuments(created.id, children.documents, tx);
    if (children.listingWindows) {
      await replaceAvailabilityWindows(created.id, 'listing', children.listingWindows, tx);
    }
    if (children.exchangeWindows) {
      await replaceAvailabilityWindows(created.id, 'exchange', children.exchangeWindows, tx);
    }
    return created.id;
  });

  const hydrated = await findPropertyById(id);
  if (!hydrated) {
    // The row was just committed by this transaction; a miss here means the id
    // does not round-trip, which is a bug worth surfacing rather than a 404.
    throw new Error(`Property ${id} was inserted but could not be read back`);
  }
  return hydrated;
}

/**
 * Apply an update to a listing, optionally gated on its owner.
 *
 * `ownedBy` is the port of `Property.findOne({ _id, oxyUserId })` followed by a
 * write: expressed as a predicate on the UPDATE itself, so the ownership check
 * and the write are one statement and cannot interleave with a change of owner.
 *
 * @returns the hydrated listing, or `null` when no row matched — which covers
 *   both "no such listing" and "not yours", deliberately indistinguishable to
 *   the caller so a 404 does not confirm a listing exists.
 */
export async function updateProperty(
  propertyId: string,
  input: PropertyWriteInput,
  options: { ownedBy?: string } = {},
): Promise<HydratedProperty | null> {
  const children = childCollections(input);
  const columns = toPropertyColumns(input);

  const matched = await getDb().transaction(async (tx) => {
    const where = options.ownedBy
      ? and(eq(properties.id, propertyId), eq(properties.oxyUserId, options.ownedBy))
      : eq(properties.id, propertyId);

    // An update with no scalar columns still has to answer "did it match?", and
    // an empty `set` is not valid SQL — `updated_at` is the honest thing to
    // touch, since a child-collection change IS a change to the listing.
    const updated = await tx
      .update(properties)
      .set(Object.keys(columns).length > 0 ? { ...columns, updatedAt: new Date() } : { updatedAt: new Date() })
      .where(where)
      .returning({ id: properties.id });

    if (!updated[0]) return null;

    if (children.images) await replacePropertyImages(propertyId, children.images, tx);
    if (children.documents) await replacePropertyDocuments(propertyId, children.documents, tx);
    if (children.listingWindows) {
      await replaceAvailabilityWindows(propertyId, 'listing', children.listingWindows, tx);
    }
    if (children.exchangeWindows) {
      await replaceAvailabilityWindows(propertyId, 'exchange', children.exchangeWindows, tx);
    }
    return updated[0].id;
  });

  return matched ? findPropertyById(matched) : null;
}

/**
 * Soft-delete a listing: archived, and stamped with when.
 *
 * Never a DELETE. `property_images.image_id` is RESTRICT and every catalogue
 * read already filters `deleted_at IS NULL`, so archiving both preserves the
 * audit trail and removes the listing from every surface in one column.
 *
 * @returns whether a row matched — false covers "no such listing" and "not
 *   yours" together.
 */
export async function softDeleteProperty(
  propertyId: string,
  options: { ownedBy?: string } = {},
): Promise<boolean> {
  const where = options.ownedBy
    ? and(eq(properties.id, propertyId), eq(properties.oxyUserId, options.ownedBy))
    : eq(properties.id, propertyId);

  const updated = await getDb()
    .update(properties)
    .set({ status: 'archived', deletedAt: new Date(), updatedAt: new Date() })
    .where(where)
    .returning({ id: properties.id });
  return updated.length > 0;
}

/**
 * Increment a listing's view counter.
 *
 * In Mongo this was `$inc: { views: 1 }` against a path `PropertySchema` never
 * declared, so strict mode dropped it and every increment ever issued was a
 * no-op. `properties.views` is a real `NOT NULL DEFAULT 0` column, so this is
 * the first time the counter actually moves — stated because a reader comparing
 * production numbers before and after the port will see them start from zero
 * and climb, and would otherwise reasonably suspect the port broke something.
 *
 * Best-effort by contract: a failed increment must never fail the read that
 * triggered it, so callers do not await it in the response path.
 */
export async function incrementPropertyViews(propertyId: string): Promise<void> {
  await getDb()
    .update(properties)
    .set({ views: sql`${properties.views} + 1` })
    .where(eq(properties.id, propertyId));
}

/**
 * Look a listing up by its portal identity — the `(source, source_id)` upsert
 * probe every ingest starts with.
 *
 * `properties_source_source_id_key` is PARTIAL (`WHERE source_id IS NOT NULL`),
 * which is the port of Mongo's `partialFilterExpression`, so this is only ever
 * asked about a listing that HAS a source id.
 */
export async function findPropertyBySource(
  source: string,
  sourceId: string,
  db: DatabaseOrTransaction = getDb(),
): Promise<{ id: string; addressId: string; imageCount: number } | null> {
  const rows = await db
    .select({
      id: properties.id,
      addressId: properties.addressId,
      imageCount: sql<number>`(
        select count(*)::int from ${propertyImages}
        where ${propertyImages.propertyId} = ${properties.id}
      )`,
    })
    .from(properties)
    .where(and(eq(properties.source, source as 'internal'), eq(properties.sourceId, sourceId)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Archive an external listing that must no longer publish, by its portal
 * identity. The port of `worker.ts`'s `expireExternalListing`.
 *
 * `expires_at` is set alongside the status because `db/expiry.ts`'s sweep is
 * what replaces Mongo's TTL index, and a listing archived without a deadline
 * would sit in the table forever.
 *
 * @returns whether a row matched.
 */
export async function expireExternalProperty(
  source: string,
  sourceId: string,
): Promise<boolean> {
  const updated = await getDb()
    .update(properties)
    .set({ status: 'archived', expiresAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(properties.source, source as 'internal'),
        eq(properties.sourceId, sourceId),
        eq(properties.isExternal, true),
      ),
    )
    .returning({ id: properties.id });
  return updated.length > 0;
}

/**
 * Record a moderation restriction, or lift one.
 *
 * The three columns move together because they are one fact: a listing is
 * restricted BY a decision AT a time, and a restriction with no decision id is
 * an enforcement nobody can trace back to a jury. Lifting clears all three.
 */
export async function setPropertyModerationRestriction(
  propertyId: string,
  restriction: { restricted: true; decisionId: string } | { restricted: false },
): Promise<boolean> {
  const columns = restriction.restricted
    ? {
        moderationRestricted: true,
        moderationRestrictedAt: new Date(),
        moderationRestrictedByDecisionId: restriction.decisionId,
      }
    : {
        moderationRestricted: false,
        moderationRestrictedAt: null,
        moderationRestrictedByDecisionId: null,
      };

  const updated = await getDb()
    .update(properties)
    .set({ ...columns, updatedAt: new Date() })
    .where(eq(properties.id, propertyId))
    .returning({ id: properties.id });
  return updated.length > 0;
}

/** Persist a price-ethics verdict. Fire-and-forget by its caller's contract. */
export async function setPropertyPriceEthics(
  propertyId: string,
  priceEthics: Record<string, unknown>,
): Promise<void> {
  await getDb()
    .update(properties)
    .set({ ...toPropertyColumns({ priceEthics }), updatedAt: new Date() })
    .where(eq(properties.id, propertyId));
}

/**
 * Hard-delete external listings whose deadline has passed.
 *
 * The one DELETE in this module, and it is the port of
 * `scraperService`'s `deleteMany` rather than a new capability. Photo rows go
 * with the listing (`property_images.property_id` CASCADEs); the `images` rows
 * themselves are left, because they are addressed by entity id and a separate
 * sweep owns them.
 *
 * @returns how many listings went.
 */
export async function deleteExpiredExternalProperties(before: Date): Promise<number> {
  const deleted = await getDb()
    .delete(properties)
    .where(
      and(
        eq(properties.isExternal, true),
        sql`${properties.expiresAt} is not null and ${properties.expiresAt} < ${before}`,
      ),
    )
    .returning({ id: properties.id });
  return deleted.length;
}

/** How many external listings exist — the scraper health probe. */
export async function countExternalProperties(): Promise<number> {
  const [row] = await getDb()
    .select({ total: sql<number>`count(*)::int` })
    .from(properties)
    .where(eq(properties.isExternal, true));
  return row?.total ?? 0;
}

/** How many external listings the expiry sweep WOULD reap — the dry run. */
export async function countExpiredExternalProperties(before: Date): Promise<number> {
  const [row] = await getDb()
    .select({ total: sql<number>`count(*)::int` })
    .from(properties)
    .where(
      and(
        eq(properties.isExternal, true),
        sql`${properties.expiresAt} is not null and ${properties.expiresAt} < ${before}`,
      ),
    );
  return row?.total ?? 0;
}

/**
 * When the STALEST external listing was last touched — the other half of the
 * scraper health probe.
 *
 * A single `min()` rather than the Mongo `findOne().sort({updatedAt: 1})` it
 * replaces, which fetched a whole document to read one timestamp off it.
 */
export async function findOldestExternalPropertyUpdate(): Promise<Date | null> {
  const [row] = await getDb()
    .select({ oldest: sql<Date | null>`min(${properties.updatedAt})` })
    .from(properties)
    .where(eq(properties.isExternal, true));
  return row?.oldest ?? null;
}

/** Whether a listing exists at all, ignoring ownership and status. */
export async function propertyExists(propertyId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: properties.id })
    .from(properties)
    .where(eq(properties.id, propertyId))
    .limit(1);
  return rows.length > 0;
}

/**
 * The owner and current status of a listing — what a write path needs BEFORE
 * deciding whether a transition is allowed, without hydrating the whole
 * listing and its children.
 */
export async function findPropertyWriteContext(
  propertyId: string,
): Promise<{
  id: string;
  oxyUserId: string | null;
  status: string;
  sourcedByPartnerId: string | null;
  addressId: string;
} | null> {
  const rows = await getDb()
    .select({
      id: properties.id,
      oxyUserId: properties.oxyUserId,
      status: properties.status,
      sourcedByPartnerId: properties.sourcedByPartnerId,
      addressId: properties.addressId,
    })
    .from(properties)
    .where(and(eq(properties.id, propertyId), isNull(properties.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}
