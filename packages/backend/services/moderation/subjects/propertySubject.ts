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
 * ## What is NOT here, and why
 *
 * **Photos are declared, not attached — and cannot be attached today.** The
 * contract's `AssetRef` needs a bare Oxy file id AND a SHA-256 digest. Homiio
 * listing photos live in Homiio's own S3, served from `${publicUrl}/api/images/
 * file/...`; there is no Oxy file id anywhere in the pipeline, and `ImageSchema`
 * stores `format`, `bytes`, `width` and `height` but no digest of any kind. A
 * URL on Homiio's own host is not an acceptable substitute: a reviewer's browser
 * fetching it would tell Homiio which of its listings are under review, which
 * attacks the blind-jury property the whole design rests on. Inventing a digest
 * is worse still. So the photo COUNT is declared in metadata, which lets a jury
 * see that material exists it was not given and answer `insufficient_context`
 * for the right reason. Closing this means either routing listing media through
 * the Oxy media chokepoint or storing a digest at ingest — both real changes,
 * neither of them this one.
 *
 * **Ingest's listing flags travel as metadata, never as an allegation.**
 * `Property.listingFlags` records restrictions the ingest classifier read out of
 * the advert's own text — "no benefit claimants", "women only", "students only".
 * A jury weighing a misleading-listing claim needs to know the advert says that.
 * But a classifier's reading is not a person's claim, and promoting it to an
 * allegation would put a machine's guess in front of a jury as if a human had
 * asserted it. Metadata is the honest place for it.
 */

import mongoose from 'mongoose';
import { Property } from '../../../models';
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

/** A populated geo ref as a lean address carries it, or a bare id. */
type GeoRef = mongoose.Types.ObjectId | string | { name?: unknown } | null | undefined;

interface SnapshotAddress {
  street?: string;
  number?: string;
  postal_code?: string;
  countryCode?: string;
  cityId?: GeoRef;
  neighborhoodId?: GeoRef;
  coordinates?: { coordinates?: number[] };
}

interface SnapshotProperty {
  _id: mongoose.Types.ObjectId;
  oxyUserId?: string;
  isExternal?: boolean;
  source?: string;
  sourceUrl?: string;
  description?: string;
  type?: string;
  bedrooms?: number;
  bathrooms?: number;
  showAddressNumber?: boolean;
  offerings?: string[];
  longTermRent?: { monthlyAmount?: number; currency?: string };
  shortTermRent?: { nightlyRate?: number; currency?: string };
  sale?: { price?: number; currency?: string };
  images?: unknown[];
  listingFlags?: Record<string, unknown>;
  createdAt?: Date | string;
  /**
   * The POPULATED address, under the name every Property read sees it by.
   *
   * `PropertySchema` carries a `post(['find','findOne'])` hook that renames a
   * populated `addressId` to `address` and deletes the original key — and it
   * runs on `.lean()` queries too, which is exactly where a `.lean()` reader
   * would expect it not to. Reading `addressId` here returns `undefined` for
   * every listing, which does not throw: the snapshot simply loses its title's
   * location and its entire location resource, and delivery succeeds. Caught
   * only because the tests assert on the coordinates.
   */
  address?: SnapshotAddress;
  /** Still a bare id when the populate did not run, so the hook left it alone. */
  addressId?: SnapshotAddress | mongoose.Types.ObjectId | null;
}

const SNAPSHOT_PROJECTION =
  'oxyUserId isExternal source sourceUrl description type bedrooms bathrooms ' +
  'showAddressNumber offerings longTermRent shortTermRent sale images listingFlags createdAt addressId';

/** The populated `{ name }` on a geo ref, or nothing when it is a bare id. */
function geoName(ref: GeoRef): string | undefined {
  if (ref && typeof ref === 'object' && !(ref instanceof mongoose.Types.ObjectId)) {
    const name: unknown = (ref as { name?: unknown }).name;
    if (typeof name === 'string' && name.trim()) return name.trim();
  }
  return undefined;
}

/**
 * The address, only when it was actually populated.
 *
 * `address` first, because the schema's post-find hook has already moved it
 * there — see {@link SnapshotProperty}. The `addressId` branch covers the case
 * where the populate did not run at all, which the hook leaves untouched.
 */
function populatedAddress(property: SnapshotProperty): SnapshotAddress | null {
  if (property.address) return property.address;
  const address = property.addressId;
  if (!address || address instanceof mongoose.Types.ObjectId) return null;
  return address;
}

function roundCoarse(value: number): number {
  const factor = 10 ** COARSE_COORDINATE_DECIMALS;
  return Math.round(value * factor) / factor;
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
 * guessing one from the country.
 */
function listingPrice(
  property: SnapshotProperty,
): { price: number; currency: string } | null {
  const candidates = [
    property.longTermRent?.monthlyAmount === undefined
      ? null
      : { price: property.longTermRent.monthlyAmount, currency: property.longTermRent.currency },
    property.shortTermRent?.nightlyRate === undefined
      ? null
      : { price: property.shortTermRent.nightlyRate, currency: property.shortTermRent.currency },
    property.sale?.price === undefined
      ? null
      : { price: property.sale.price, currency: property.sale.currency },
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!Number.isFinite(candidate.price) || candidate.price < 0) continue;
    const currency = candidate.currency?.trim().toUpperCase();
    if (currency === undefined || !/^[A-Z]{3}$/.test(currency)) continue;
    return { price: candidate.price, currency };
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
  property: SnapshotProperty,
  address: SnapshotAddress,
): string | undefined {
  const parts = [
    property.showAddressNumber === false
      ? address.street?.trim()
      : [address.street?.trim(), address.number?.trim()].filter(Boolean).join(' '),
    geoName(address.neighborhoodId),
    geoName(address.cityId),
  ].filter((part): part is string => Boolean(part && part.length > 0));
  const label = parts.join(', ');
  return label.length > 0 ? label : undefined;
}

/**
 * Where the home is, coarsely, plus the label the advert publishes.
 *
 * Returns nothing when the address was not populated or carries neither a label
 * nor coordinates — the contract refuses an empty location, and rightly so.
 */
function locationContext(property: SnapshotProperty): ModerationContextResource | null {
  const address = populatedAddress(property);
  if (!address) return null;

  const label = publishedAddressLabel(property, address);
  const point = address.coordinates?.coordinates;
  const hasPoint =
    Array.isArray(point) &&
    point.length === 2 &&
    Number.isFinite(point[0]) &&
    Number.isFinite(point[1]);

  if (label === undefined && !hasPoint) return null;

  return {
    role: 'context',
    type: 'location',
    data: {
      ...(label === undefined ? {} : { label }),
      ...(hasPoint
        ? { longitude: roundCoarse(point[0]), latitude: roundCoarse(point[1]) }
        : {}),
    },
  };
}

/** The flags ingest read out of the advert's own text. Facts, never findings. */
function listingFlagMetadata(property: SnapshotProperty): Record<string, boolean> {
  const flags = property.listingFlags;
  if (!flags || typeof flags !== 'object') return {};
  const firing: Record<string, boolean> = {};
  for (const [name, value] of Object.entries(flags)) {
    if (value === true) firing[`listingFlag_${name}`] = true;
  }
  return firing;
}

/**
 * The title Homiio renders for this listing.
 *
 * Generated rather than stored — Homiio has no `title` column — by the same
 * helper the app itself uses, so what a jury reads is what a reporter saw.
 */
function listingTitle(property: SnapshotProperty, address: SnapshotAddress | null): string {
  return generatePropertyTitle({
    type: property.type,
    address: { street: address?.street },
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    geo: address
      ? {
          city: geoName(address.cityId),
          neighborhood: geoName(address.neighborhoodId),
        }
      : null,
  });
}

/** Where Homiio's own users see the listing. Never fetched by a jury. */
function permalink(property: SnapshotProperty): string {
  return `${config.web.baseUrl}/properties/${property._id.toHexString()}`;
}

export function createPropertySubjectProvider(input: {
  reportedType: string;
}): ModerationSubjectProvider {
  return {
    reportedType: input.reportedType,
    subjectType: 'commerce.listing',

    async snapshot(reportedId: string): Promise<ModerationSubjectSnapshot | null> {
      if (!mongoose.isValidObjectId(reportedId)) return null;
      const property = await Property.findById(reportedId)
        .select(SNAPSHOT_PROJECTION)
        .populate({
          path: 'addressId',
          select: 'street number postal_code countryCode cityId neighborhoodId coordinates',
          populate: [
            { path: 'cityId', select: 'name' },
            { path: 'neighborhoodId', select: 'name' },
          ],
        })
        .lean<SnapshotProperty | null>();
      if (!property) return null;

      const address = populatedAddress(property);
      const price = listingPrice(property);
      const description = property.description?.trim();
      const photoCount = Array.isArray(property.images) ? property.images.length : 0;

      const content: ModerationResource = {
        type: 'listing',
        data: {
          title: listingTitle(property, address),
          ...(description ? { description: description.slice(0, MAX_DESCRIPTION_LENGTH) } : {}),
          ...(price === null ? {} : price),
        },
        ...(property.createdAt === undefined
          ? {}
          : { createdAt: new Date(property.createdAt) }),
      };

      const location = locationContext(property);

      return {
        subject: {
          externalId: property._id.toHexString(),
          type: 'commerce.listing',
          permalink: permalink(property),
          /**
           * An aggregated listing has no `oxyUserId` and gets NO author.
           *
           * The advert belongs to a portal, not to anyone with an Oxy identity,
           * and naming a principal Homiio cannot identify would attach a
           * reputation consequence to the wrong person — or to nobody, silently.
           * `author` is optional precisely so an application does not have to
           * invent one. Homiio can still restrict its own copy, which is the
           * only thing it could enforce here anyway.
           */
          ...(property.oxyUserId === undefined
            ? {}
            : { author: { oxyUserId: property.oxyUserId } }),
        },
        content,
        ...(location === null ? {} : { context: [location] }),
        metadata: {
          listingPhotos: photoCount,
          listingIsExternal: property.isExternal === true,
          ...(property.isExternal === true && property.source
            ? { listingSource: property.source }
            : {}),
          ...listingFlagMetadata(property),
        },
      };
    },
  };
}
