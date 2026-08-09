/**
 * Homiio listings, as universal material.
 *
 * A listing is a `commerce.listing` — one of the standard subject types, so no
 * custom namespace is needed. What travels is what a reporter and a jury both
 * actually look at: the title Homiio itself renders, the advertiser's own
 * description, the asking price, and where the home is.
 *
 * ## Location is evidence here, and it is deliberately COARSE
 *
 * Almost every other application sends location as an afterthought. For Homiio
 * it is often the reported thing: a listing that publishes the street and number
 * of an occupied home exposes whoever lives there, which is exactly what
 * `privacy.location_exposure` names.
 *
 * So a `location` resource travels — and the contract refuses coordinates with
 * more than two decimal places (about a kilometre), which is the point. A jury
 * asked "does this listing expose someone's home?" needs to see the LABEL the
 * listing publishes (street, and the building number when the advertiser chose
 * to show it), not a pin a reviewer could drive to. Sending the precise point
 * would reproduce the exposure inside the review, which is the one thing a
 * privacy review must not do. The label carries the claim; the coarse point
 * carries only the neighbourhood.
 *
 * The building number rides on `showAddressNumber`, the advertiser's own choice.
 * A listing that hides its number has not exposed one, and a snapshot that
 * revealed it anyway would put Homiio's own database in front of a jury as if it
 * were the advert.
 *
 * ## The read is the catalogue's own, and it removed a whole class of bug
 *
 * {@link findPropertyById} is the same `properties INNER JOIN addresses` + four
 * geo joins every catalogue read goes through, so a jury sees the listing the
 * app renders rather than a second, privately-spelled projection of it.
 *
 * With it goes the question "was the address populated?", which under Mongoose
 * was answerable three ways at once: `PropertySchema`'s `post(['find','findOne'])`
 * hook RENAMED a populated `addressId` to `address` (on `.lean()` reads too), so
 * a reader spelling it the other way silently lost the listing's location and
 * its entire location resource — and delivery still succeeded. There is no such
 * state left to detect: `properties.address_id` is `NOT NULL` behind an inner
 * join and `addresses.longitude` / `latitude` are `NOT NULL` with a range CHECK
 * that also rejects `NaN`, so a listing that resolves has an address and a
 * point, and the location resource always travels.
 *
 * ## What is NOT here, and why
 *
 * **Photos are declared, not attached — and cannot be attached today.** The
 * contract's `AssetRef` needs a bare Oxy file id AND a SHA-256 digest. Homiio
 * listing photos live in Homiio's own S3, served from `${publicUrl}/api/images/
 * file/...`; there is no Oxy file id anywhere in the pipeline, and neither
 * `images` nor `property_images` stores a digest of any kind. A URL on Homiio's
 * own host is not an acceptable substitute: a reviewer's browser fetching it
 * would tell Homiio which of its listings are under review, which attacks the
 * blind-jury property the whole design rests on. Inventing a digest is worse
 * still. So the photo COUNT is declared in metadata, which lets a jury see that
 * material exists it was not given and answer `insufficient_context` for the
 * right reason. Closing this means either routing listing media through the Oxy
 * media chokepoint or storing a digest at ingest — both real changes, neither of
 * them this one.
 *
 * **Ingest's listing flags travel as metadata, never as an allegation.** The
 * `listing_flags_*` columns record restrictions the ingest classifier read out of
 * the advert's own text — "no benefit claimants", "women only", "students only".
 * A jury weighing a misleading-listing claim needs to know the advert says that.
 * But a classifier's reading is not a person's claim, and promoting it to an
 * allegation would put a machine's guess in front of a jury as if a human had
 * asserted it. Metadata is the honest place for it.
 */

import { findPropertyById } from '../../../db/properties/propertyReads';
import type { HydratedProperty, PropertyRow } from '../../../db/properties/propertySerializer';
import type { AddressWithGeoNames } from '../../../db/addresses/addressSerializer';
import { generatePropertyTitle } from '../../../utils/propertyTitleGenerator';
import config from '../../../config';
import type {
  ModerationContextResource,
  ModerationResource,
  ModerationSubjectProvider,
  ModerationSubjectSnapshot,
} from './types';

/** Beyond this the description is truncated; the contract bounds it too. */
const MAX_DESCRIPTION_LENGTH = 4_000;
/** The contract refuses anything finer. Roughly a kilometre. */
const COARSE_COORDINATE_DECIMALS = 2;

function roundCoarse(value: number): number {
  const factor = 10 ** COARSE_COORDINATE_DECIMALS;
  return Math.round(value * factor) / factor;
}

/** A geo display name, or nothing when the chain did not resolve one. */
function geoName(name: string | null): string | undefined {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/**
 * The price a jury sees, and the currency it is in.
 *
 * A Homiio listing can carry three prices at once — a monthly rent, a nightly
 * rate and a sale price — and the `listing` resource holds one. The order below
 * is the order Homiio's own UI leads with, so what travels is what a reporter
 * was looking at when they pressed report.
 *
 * Price and currency must travel TOGETHER (the contract refuses one without the
 * other), so a listing with an amount and no currency sends neither rather than
 * guessing one from the country. `Number.isFinite` survives the port for a
 * reason that is now stronger than it was under Mongo: `double precision`
 * genuinely stores `NaN` and `Infinity`, and no CHECK on these columns forbids
 * either.
 */
function listingPrice(property: PropertyRow): { price: number; currency: string } | null {
  const candidates: readonly (readonly [number | null, string | null])[] = [
    [property.longTermRentMonthlyAmount, property.longTermRentCurrency],
    [property.shortTermRentNightlyRate, property.shortTermRentCurrency],
    [property.salePrice, property.saleCurrency],
  ];
  for (const [price, currency] of candidates) {
    if (price === null || !Number.isFinite(price) || price < 0) continue;
    const code = currency?.trim().toUpperCase();
    if (code === undefined || !/^[A-Z]{3}$/.test(code)) continue;
    return { price, currency: code };
  }
  return null;
}

/**
 * The address as the LISTING publishes it.
 *
 * The building number is included only when the advertiser chose to show it
 * (`showAddressNumber`). That flag is the whole point of the resource for a
 * privacy allegation: the question is what the advert exposed, not what Homiio
 * happens to store.
 */
function publishedAddressLabel(
  property: PropertyRow,
  address: AddressWithGeoNames,
): string | undefined {
  const street = address.street.trim();
  const number = address.number?.trim();
  const parts = [
    property.showAddressNumber && number ? `${street} ${number}` : street,
    geoName(address.neighborhoodName),
    geoName(address.cityName),
  ].filter((part): part is string => Boolean(part && part.length > 0));
  const label = parts.join(', ');
  return label.length > 0 ? label : undefined;
}

/**
 * Where the home is, coarsely, plus the label the advert publishes.
 *
 * Never absent, unlike its Mongo ancestor: the coordinates are `NOT NULL`
 * columns behind an inner join, so there is no "the address did not come back"
 * branch to take — see the module comment for what that branch used to hide.
 */
function locationContext(
  property: PropertyRow,
  address: AddressWithGeoNames,
): ModerationContextResource {
  const label = publishedAddressLabel(property, address);
  return {
    role: 'context',
    type: 'location',
    data: {
      ...(label === undefined ? {} : { label }),
      longitude: roundCoarse(address.longitude),
      latitude: roundCoarse(address.latitude),
    },
  };
}

/**
 * The flags ingest read out of the advert's own text. Facts, never findings.
 *
 * Named by the wire spelling rather than the column name — `noDSS`, whose column
 * is `listing_flags_no_dss` — because these keys reach a jury and reach the
 * envelope fingerprint, and renaming them there would be a contract change
 * dressed up as a schema detail.
 *
 * The order is fixed by this literal, and that is load-bearing rather than
 * tidy: the metadata bag is part of what ingress fingerprints, so a bag built by
 * iterating a row (or a Map, or a Set) could order two deliveries of one report
 * differently and turn a legitimate outbox retry into a permanent 409.
 *
 * `listing_flags_detected_language` is deliberately absent: it holds a language
 * code, not a restriction the advert placed on who may live there, and it never
 * travelled under Mongo either (the old loop emitted only members that were
 * literally `true`). A three-state flag that is `false` or unknown is absent
 * too — "the classifier did not read this restriction" and "the classifier read
 * that there is no such restriction" are different facts, and neither is
 * something a jury should be handed as a finding.
 */
function listingFlagMetadata(property: PropertyRow): Record<string, boolean> {
  const flags: readonly (readonly [string, boolean | null])[] = [
    ['studentsOnly', property.listingFlagsStudentsOnly],
    ['roomNotFullUnit', property.listingFlagsRoomNotFullUnit],
    ['temporaryOnly', property.listingFlagsTemporaryOnly],
    ['genderRestricted', property.listingFlagsGenderRestricted],
    ['workersOnly', property.listingFlagsWorkersOnly],
    ['agencyFeePayable', property.listingFlagsAgencyFeePayable],
    ['noPets', property.listingFlagsNoPets],
    ['noSmoking', property.listingFlagsNoSmoking],
    ['noCouples', property.listingFlagsNoCouples],
    ['noDSS', property.listingFlagsNoDss],
  ];
  const firing: Record<string, boolean> = {};
  for (const [name, value] of flags) {
    if (value === true) firing[`listingFlag_${name}`] = true;
  }
  return firing;
}

/**
 * The title Homiio renders for this listing.
 *
 * Generated rather than read: `properties.title` exists as a column and is
 * written by nothing — it is absent from every one of the 17,644 rows the
 * census measured, because `PropertySchema` never declared it — so the app
 * itself renders this same helper's output on every card. What a jury reads is
 * therefore what a reporter saw.
 */
function listingTitle(property: PropertyRow, address: AddressWithGeoNames): string {
  return generatePropertyTitle({
    type: property.type,
    address: { street: address.street },
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    geo: {
      city: geoName(address.cityName),
      neighborhood: geoName(address.neighborhoodName),
    },
  });
}

/** Where Homiio's own users see the listing. Never fetched by a jury. */
function permalink(property: PropertyRow): string {
  return `${config.web.baseUrl}/properties/${property.id}`;
}

function describe(hydrated: HydratedProperty): ModerationSubjectSnapshot {
  const { property, address } = hydrated;
  const price = listingPrice(property);
  const description = property.description?.trim();

  const content: ModerationResource = {
    type: 'listing',
    data: {
      title: listingTitle(property, address),
      ...(description ? { description: description.slice(0, MAX_DESCRIPTION_LENGTH) } : {}),
      ...(price === null ? {} : price),
    },
    createdAt: property.createdAt,
  };

  return {
    subject: {
      externalId: property.id,
      type: 'commerce.listing',
      permalink: permalink(property),
      /**
       * An aggregated listing has no `oxy_user_id` and gets NO author.
       *
       * The advert belongs to a portal, not to anyone with an Oxy identity, and
       * naming a principal Homiio cannot identify would attach a reputation
       * consequence to the wrong person — or to nobody, silently. `author` is
       * optional precisely so an application does not have to invent one.
       * Homiio can still restrict its own copy, which is the only thing it could
       * enforce here anyway.
       */
      ...(property.oxyUserId === null ? {} : { author: { oxyUserId: property.oxyUserId } }),
    },
    content,
    context: [locationContext(property, address)],
    metadata: {
      listingPhotos: hydrated.images.length,
      listingIsExternal: property.isExternal,
      ...(property.isExternal ? { listingSource: property.source } : {}),
      ...listingFlagMetadata(property),
    },
  };
}

export function createPropertySubjectProvider(input: {
  reportedType: string;
}): ModerationSubjectProvider {
  return {
    reportedType: input.reportedType,
    subjectType: 'commerce.listing',

    /**
     * No id-shape guard precedes this read, and that is deliberate — see
     * `db/ids.ts`. Post-cutover every listing created carries a uuid v7, for
     * which `isValidObjectId` is FALSE, so the guard that used to stand here
     * would have made every new listing silently un-reportable while a valid
     * report was answered "the object is gone". The query answers "no such row"
     * for every id shape, including a malformed one, because `properties.id` is
     * a `text` column that takes any string.
     */
    async snapshot(reportedId: string): Promise<ModerationSubjectSnapshot | null> {
      const hydrated = await findPropertyById(reportedId);
      return hydrated === null ? null : describe(hydrated);
    },
  };
}
