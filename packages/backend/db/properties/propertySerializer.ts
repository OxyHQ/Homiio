/**
 * Property wire serialization — flat Postgres columns back into the nested shape
 * the API has always returned.
 *
 * `db/schema/properties.ts` flattens TWELVE Mongo subdocuments into columns
 * (`longTermRent.monthlyAmount` → `long_term_rent_monthly_amount`) because they
 * are filter and sort targets. The wire contract did not change with them, so
 * exactly one module re-nests them, and this is it.
 *
 * ## Absence is a value here, and `null` is not the way to spell it
 *
 * Mongoose OMITS an unset path; `res.json` ships an explicit `null`. Those are
 * different bodies, and a frontend written against the first reads the second as
 * "the server told me there is no price" only if it happens to check for `null`
 * as well as `undefined`. So every optional field goes through
 * {@link withoutAbsent}, and a BLOCK whose discriminator is null is omitted
 * entirely rather than emitted full of nulls.
 *
 * Which blocks are optional is not a judgement call — it is measured, and
 * `db/schema/properties.ts` carries the measurement. The four priced blocks are
 * keyed on their discriminator (the same column the four offering-coherence
 * CHECKs are written over, so "the block is present" and "the offering is
 * declared" cannot disagree); `externalContact`, `listingFlags` and
 * `priceEthics` are absent on 5,174 / 9,594 / 133 of 17,644 production rows and
 * are keyed on "any member present"; `rating`, `accommodationDetails`,
 * `availability` and `rules` are present on ALL 17,644 and are always emitted.
 *
 * ## Three fields the wire genuinely loses, each already decided
 *
 * Recorded here because a reader comparing a response against the old one will
 * notice, and `db/MIGRATION-CONTRACT.md` is where each was decided:
 *
 *  - **`coverImageIndex`** is gone. It was `-1` on all 17,644 rows and its
 *    meaning moved to `property_images.is_primary`.
 *  - **`sourcedByPartner`** is now `sourcedByPartnerId`, renamed so
 *    `idShapedColumns` can see it — a column no gate can see is a column that
 *    can ship unconstrained. Absent on all 17,644 rows, so nothing observable
 *    changes.
 *  - **`moderation`** is emitted only when a jury has actually restricted the
 *    listing. The column is `NOT NULL DEFAULT false` (it has to be — the
 *    sub-object is absent on 17,642 of 17,644 rows), so emitting it
 *    unconditionally would ADD `{ restricted: false }` to every response that
 *    never carried one. The owner-visibility branch in `getPropertyById` reads
 *    the ROW, not this, so nothing depends on it being on the wire.
 *
 * `search_vector` never reaches this module at all — see
 * {@link propertySelection}.
 */

import type { InferSelectModel } from 'drizzle-orm';

import imageUploadService from '../../services/imageUploadService';
import { publicColumns } from '../schema/protectedColumns';
import { properties, propertyAvailabilityWindows, propertyDocuments, propertyImages } from '../schema';
import type { AddressWithGeoNames } from '../addresses/addressSerializer';
import { serializeAddressRow } from '../addresses/addressSerializer';

/**
 * The columns a property read selects.
 *
 * Two exclusions, for two different reasons:
 *
 *  - `publicColumns` drops `accommodation_details_wifi_password`, a credential
 *    for a real network. That exclusion is at the TYPE level, so a serializer
 *    that reads it fails `tsc` rather than shipping it.
 *  - `search_vector` is dropped here. It is a generated `tsvector` — an index
 *    artefact, not a field — and selecting it would ship a parsed second copy of
 *    every description to the application on every page, for a value nothing
 *    reads. It stays in the WHERE and ORDER BY clauses, where it belongs.
 *
 * An explicit selection object rather than a bare `select()`, which is also what
 * keeps `findImplicitWholeRowReads` from reporting this file.
 */
export function propertySelection() {
  const columns = publicColumns(properties);
  // Filtered rather than destructured-and-dropped, because the value really has
  // to be ABSENT from the object drizzle receives — a type-level `Omit` alone
  // would still leave the key on the runtime object and the column would still
  // be selected. The cast is what `Object.fromEntries` costs: it returns an
  // index signature, and this restores the per-column types the caller needs.
  const selectable = Object.entries(columns).filter(([name]) => name !== 'searchVector');
  return Object.fromEntries(selectable) as Omit<typeof columns, 'searchVector'>;
}

/** A property row as this module receives it — no wifi password, no tsvector. */
export type PropertyRow = Omit<
  InferSelectModel<typeof properties>,
  'accommodationDetailsWifiPassword' | 'searchVector'
>;

export type PropertyImageRow = InferSelectModel<typeof propertyImages>;
export type PropertyDocumentRow = InferSelectModel<typeof propertyDocuments>;
export type PropertyAvailabilityWindowRow = InferSelectModel<typeof propertyAvailabilityWindows>;

/** One property plus everything a response carries with it. */
export interface HydratedProperty {
  property: PropertyRow;
  address: AddressWithGeoNames;
  images: readonly PropertyImageRow[];
  documents: readonly PropertyDocumentRow[];
  availabilityWindows: readonly PropertyAvailabilityWindowRow[];
  /** Metres from the query point, when the read supplied one. */
  distance?: number;
}

/** Drop keys whose value is null/undefined, matching Mongoose's omission of unset paths. */
function withoutAbsent(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * A sub-object, or `undefined` when every member is absent.
 *
 * Used for the three blocks with no single discriminator column
 * (`externalContact`, `listingFlags`, `priceEthics`). The priced blocks do NOT
 * use it: their presence is decided by the discriminator the schema's coherence
 * CHECK is written over, so that a block can never serialize present while its
 * offering says absent.
 */
function blockIfAny(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const present = withoutAbsent(record);
  return Object.keys(present).length > 0 ? present : undefined;
}

/**
 * One `property_images` row in the historical `Property.images[]` read shape.
 *
 * Every URL goes through `resolveStoredImageUrl`, which rewrites a legacy
 * direct-S3 URL to the current delivery host. That rewrite is why the Mongo read
 * path ran `serializePropertyImages` over every response: the URLs are STORED,
 * so rows written before the delivery host changed still carry the old one, and
 * dropping the rewrite here would serve dead image links for those rows with
 * nothing to indicate why.
 */
function serializeImage(row: PropertyImageRow): Record<string, unknown> {
  const resolve = (url: string | null): string | null =>
    url === null ? null : imageUploadService.resolveStoredImageUrl(url);

  const urls = blockIfAny({
    original: resolve(row.urlsOriginal),
    small: resolve(row.urlsSmall),
    medium: resolve(row.urlsMedium),
    large: resolve(row.urlsLarge),
  });

  return withoutAbsent({
    id: row.id,
    imageId: row.imageId,
    url: resolve(row.url),
    caption: row.caption,
    isPrimary: row.isPrimary,
    order: row.order,
    urls,
  });
}

function serializeDocument(row: PropertyDocumentRow): Record<string, unknown> {
  return { id: row.id, name: row.name, url: row.url, type: row.type };
}

/**
 * A calendar window in the `{ start, end, status }` shape the contract in
 * `shared-types` specifies.
 *
 * The columns are `starts_at` / `ends_at` — renamed in the schema because `end`
 * is a reserved word — so the rename is undone here rather than on the wire.
 */
function serializeAvailabilityWindow(row: PropertyAvailabilityWindowRow): Record<string, unknown> {
  return { id: row.id, start: row.startsAt, end: row.endsAt, status: row.status };
}

/**
 * Build the API representation of one listing.
 *
 * The `address` is nested under `address` and there is no `addressId` on the
 * wire, reproducing `utils/helpers.transformAddressFields` — which existed
 * because Mongoose named the populated reference after the column. A join has
 * no such constraint, so the shape is simply built correctly here instead.
 */
export function serializeProperty(hydrated: HydratedProperty): Record<string, unknown> {
  const row = hydrated.property;

  const longTermRent = row.longTermRentMonthlyAmount === null ? undefined : withoutAbsent({
    monthlyAmount: row.longTermRentMonthlyAmount,
    currency: row.longTermRentCurrency,
    deposit: row.longTermRentDeposit,
    applicationFee: row.longTermRentApplicationFee,
    lateFee: row.longTermRentLateFee,
    utilities: row.longTermRentUtilities,
  });

  const shortTermRent = row.shortTermRentNightlyRate === null ? undefined : withoutAbsent({
    nightlyRate: row.shortTermRentNightlyRate,
    currency: row.shortTermRentCurrency,
    cleaningFee: row.shortTermRentCleaningFee,
    serviceFee: row.shortTermRentServiceFee,
    taxesPercent: row.shortTermRentTaxesPercent,
    minNights: row.shortTermRentMinNights,
    maxNights: row.shortTermRentMaxNights,
    instantBook: row.shortTermRentInstantBook,
    deposit: row.shortTermRentDeposit,
  });

  const sale = row.salePrice === null ? undefined : withoutAbsent({
    price: row.salePrice,
    currency: row.saleCurrency,
    pricePerSqm: row.salePricePerSqm,
    estimatedYield: row.saleEstimatedYield,
    isPriceReduced: row.saleIsPriceReduced,
    chainStatus: row.saleChainStatus,
  });

  // The exchange block carries its own calendar, which shares
  // `property_availability_windows` with the listing calendar under
  // `scope = 'exchange'`. Splitting by scope here is what lets ONE table and one
  // GiST index serve both, as the schema intends.
  const exchange = row.exchangeMode === null ? undefined : withoutAbsent({
    mode: row.exchangeMode,
    availabilityWindows: hydrated.availabilityWindows
      .filter((window) => window.scope === 'exchange')
      .map(serializeAvailabilityWindow),
    minStay: row.exchangeMinStay,
    maxStay: row.exchangeMaxStay,
    welcomeNote: row.exchangeWelcomeNote,
    languages: row.exchangeLanguages,
    mealsIncluded: row.exchangeMealsIncluded,
    requiresReciprocity: row.exchangeRequiresReciprocity,
  });

  return withoutAbsent({
    id: row.id,
    oxyUserId: row.oxyUserId,

    source: row.source,
    sourceId: row.sourceId,
    sourceUrl: row.sourceUrl,
    isExternal: row.isExternal,
    expiresAt: row.expiresAt,
    sourcedByPartnerId: row.sourcedByPartnerId,
    sourcedByReferralCode: row.sourcedByReferralCode,
    agencyId: row.agencyId,

    externalContact: blockIfAny({
      phone: row.externalContactPhone,
      email: row.externalContactEmail,
      whatsapp: row.externalContactWhatsapp,
      name: row.externalContactName,
      agencyName: row.externalContactAgencyName,
      kind: row.externalContactKind,
    }),

    listingFlags: blockIfAny({
      studentsOnly: row.listingFlagsStudentsOnly,
      roomNotFullUnit: row.listingFlagsRoomNotFullUnit,
      temporaryOnly: row.listingFlagsTemporaryOnly,
      genderRestricted: row.listingFlagsGenderRestricted,
      workersOnly: row.listingFlagsWorkersOnly,
      agencyFeePayable: row.listingFlagsAgencyFeePayable,
      noPets: row.listingFlagsNoPets,
      noSmoking: row.listingFlagsNoSmoking,
      noCouples: row.listingFlagsNoCouples,
      // Mongo spells this one `noDSS`; the column is `listing_flags_no_dss`.
      noDSS: row.listingFlagsNoDss,
      detectedLanguage: row.listingFlagsDetectedLanguage,
    }),

    title: row.title,
    description: row.description,
    address: serializeAddressRow(hydrated.address),
    showAddressNumber: row.showAddressNumber,

    type: row.type,
    housingType: row.housingType,
    layoutType: row.layoutType,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    squareFootage: row.squareFootage,
    floor: row.floor,
    yearBuilt: row.yearBuilt,

    hasElevator: row.hasElevator,
    hasBalcony: row.hasBalcony,
    hasGarden: row.hasGarden,
    utilitiesIncluded: row.utilitiesIncluded,
    petFriendly: row.petFriendly,
    proximityToTransport: row.proximityToTransport,
    proximityToSchools: row.proximityToSchools,
    proximityToShopping: row.proximityToShopping,
    isVerified: row.isVerified,
    isEcoFriendly: row.isEcoFriendly,

    offerings: row.offerings,
    longTermRent,
    shortTermRent,
    sale,
    exchange,

    amenities: row.amenities,
    furnishedStatus: row.furnishedStatus,
    petPolicy: row.petPolicy,
    petFee: row.petFee,
    parkingType: row.parkingType,
    parkingSpaces: row.parkingSpaces,
    availableFrom: row.availableFrom,
    leaseTerm: row.leaseTerm,
    cancellationPolicy: row.cancellationPolicy,

    smokingAllowed: row.smokingAllowed,
    partiesAllowed: row.partiesAllowed,
    guestsAllowed: row.guestsAllowed,
    maxGuests: row.maxGuests,

    availabilityWindows: hydrated.availabilityWindows
      .filter((window) => window.scope === 'listing')
      .map(serializeAvailabilityWindow),

    rules: {
      pets: row.rulesPets,
      smoking: row.rulesSmoking,
      parties: row.rulesParties,
      guests: row.rulesGuests,
      maxOccupancy: row.rulesMaxOccupancy,
    },

    images: hydrated.images.map(serializeImage),
    hasImages: row.hasImages,
    documents: hydrated.documents.map(serializeDocument),

    accommodationDetails: withoutAbsent({
      sleepingArrangement: row.accommodationDetailsSleepingArrangement,
      roommatePreferences: row.accommodationDetailsRoommatePreferences,
      colivingFeatures: row.accommodationDetailsColivingFeatures,
      hostelRoomType: row.accommodationDetailsHostelRoomType,
      campsiteType: row.accommodationDetailsCampsiteType,
      maxStay: row.accommodationDetailsMaxStay,
      minAge: row.accommodationDetailsMinAge,
      maxAge: row.accommodationDetailsMaxAge,
      languages: row.accommodationDetailsLanguages,
      culturalExchange: row.accommodationDetailsCulturalExchange,
      mealsIncluded: row.accommodationDetailsMealsIncluded,
      houseRules: row.accommodationDetailsHouseRules,
    }),

    availability: {
      isAvailable: row.availabilityIsAvailable,
      availableFrom: row.availabilityAvailableFrom,
      minimumStay: row.availabilityMinimumStay,
      maximumStay: row.availabilityMaximumStay,
    },

    lastSaved: row.lastSaved,
    parentPropertyId: row.parentPropertyId,
    status: row.status,

    // Only when a jury actually restricted it — see the module doc.
    moderation: row.moderationRestricted
      ? withoutAbsent({
          restricted: row.moderationRestricted,
          restrictedAt: row.moderationRestrictedAt,
          restrictedByDecisionId: row.moderationRestrictedByDecisionId,
        })
      : undefined,

    priceEthics: blockIfAny({
      ethicalSuggested: row.priceEthicsEthicalSuggested,
      ethicalMax: row.priceEthicsEthicalMax,
      withinEthical: row.priceEthicsWithinEthical,
      marketVerdict: row.priceEthicsMarketVerdict,
      percentDiffFromAvg: row.priceEthicsPercentDiffFromAvg,
      isFairPrice: row.priceEthicsIsFairPrice,
      fairnessScore: row.priceEthicsFairnessScore,
      scoredAt: row.priceEthicsScoredAt,
    }),

    rating: { average: row.ratingAverage, count: row.ratingCount },

    views: row.views,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,

    distance: hydrated.distance,
  });
}
