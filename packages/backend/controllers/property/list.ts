/**
 * The home/browse feed.
 *
 * Reads Postgres for the listings, their addresses and their photos. Three
 * collections it decorates the page with — `Saved`, `RecentlyViewed` and
 * `Reservation` — are still Mongo and stay that way: they are not part of the
 * catalogue, and ids are preserved verbatim across the copy, so a listing id
 * from Postgres matches the same id in Mongo with nothing to translate.
 *
 * ## Two things carried across VERBATIM that a reader will want to query
 *
 *  - **The saves count now matches on STRINGS, and that is a fix this port could
 *    not defer.** `Saved.targetId` is declared `String`; the pipeline compared it
 *    against `ObjectId`s and `aggregate` does not cast, so it has always matched
 *    nothing and `savesCount` has always been `0` —
 *    `db/MIGRATION-CONTRACT.md` names the identical defect in `stats.ts` and
 *    says a count that starts being non-zero after the cutover is correct
 *    behaviour arriving.
 *
 *    Leaving it alone was the plan until the integration suite showed what the
 *    cast actually does: `new ObjectId('019fd591-…')` THROWS, synchronously,
 *    outside the `.catch()` — so the first listing carrying a uuid v7 id turns
 *    this whole feed into a 500. Every listing created after the cutover carries
 *    one. Preserving a comparison that can never match, at the price of a
 *    guaranteed outage, is not preservation. The consequence is stated plainly:
 *    `savesCount` starts reporting real numbers, and the geo-ranked branch
 *    orders by it.
 *  - **An unknown `sortBy` now falls back to recency** instead of being passed
 *    through as a field name. Mongo accepted any string and sorted by a path
 *    that did not exist, which is a silent no-op; the SQL equivalent would be
 *    building a column name out of user input, which is not a thing to do. The
 *    five real sort fields are unchanged.
 */

import { Request, Response, NextFunction } from 'express';
import type { SQL } from 'drizzle-orm';
import { RecentlyViewed, Reservation, Saved } from '../../models';
import { paginationResponse } from '../../middlewares/errorHandler';
import { logger } from '../../middlewares/logging';
import {
  buildSort,
  priceColumnForOffering,
  DEFAULT_PRICE_COLUMN,
  type ParsedSearchParams,
  type SortField,
} from './searchQueryBuilder';
import { buildCommonPropertyFilters } from './commonFilters';
import { OfferingType } from '@homiio/shared-types';
import { ReservationStatus } from '@homiio/shared-types';
import { properties } from '../../db/schema';
import {
  allOf,
  countProperties,
  findProperties,
  propertyOrderBy,
} from '../../db/properties/propertyReads';
import {
  addressIs,
  booleanIs,
  calendarIsFree,
  hasOffering,
  idNotIn,
  inCity,
  inRange,
  inRegion,
  isAvailable,
  ownedBy,
  statusIs,
  statusIsNot,
} from '../../db/properties/propertyFilters';
import { serializeProperty } from '../../db/properties/propertySerializer';
import { resolveCityId, resolveRegionId } from '../../services/geoQueryService';

const OFFERING_VALUES: ReadonlySet<string> = new Set(Object.values(OfferingType));

const LIST_SORT_FIELDS: ReadonlySet<string> = new Set([
  'price',
  'salePrice',
  'createdAt',
  'relevance',
  'fairness',
]);

// Price-preference bucket boundaries (monthly-rent scale) used by the
// recommendation scorer to weight listings near a viewer's typical budget.
const PRICE_BUCKET_LOW_MAX = 1000;
const PRICE_BUCKET_MEDIUM_MAX = 2000;

/** Default radius (metres) for the "inside my area" half of the geo ranking. */
const DEFAULT_PREFERRED_RADIUS_METERS = 45000;

/**
 * A representative monthly-scale price for recommendation bucketing: the
 * long-term monthly amount when present, else the short-term nightly rate (so
 * vacation-only listings still bucket). Returns 0 when neither is set.
 */
function representativePrice(property: {
  longTermRent?: { monthlyAmount?: number };
  shortTermRent?: { nightlyRate?: number };
}): number {
  return property.longTermRent?.monthlyAmount || property.shortTermRent?.nightlyRate || 0;
}

/**
 * Ground-truth image presence for the per-page re-sorts below (geo ranking and
 * personalization). Read from the actual `images` array rather than the stored
 * `hasImages` flag so the in-memory ordering can never contradict the data even
 * if the denormalized flag is momentarily stale. The DB sort still uses the
 * indexed `has_images` column to decide page membership.
 */
function listingHasImages(property: { images?: unknown[] }): boolean {
  return Array.isArray(property.images) && property.images.length > 0;
}

/** Map a representative price to a coarse low/medium/high preference bucket. */
function priceBucket(price: number): 'low' | 'medium' | 'high' {
  if (price < PRICE_BUCKET_LOW_MAX) return 'low';
  if (price < PRICE_BUCKET_MEDIUM_MAX) return 'medium';
  return 'high';
}

/**
 * Stable city key for location-based personalization.
 *
 * Geo is relational, so this keys on the address's `cityId`. Under the join it
 * is always a bare id string — the "is the ref populated or not?" branch the
 * Mongo version needed has no counterpart, because a join has no unpopulated
 * state.
 */
function cityIdKey(property: { address?: { cityId?: unknown } }): string | null {
  const ref = property.address?.cityId;
  return ref ? String(ref) : null;
}

/** A `Date` from a query param, or null when absent or unparseable. */
function parseDateParam(value: unknown): Date | null {
  if (value === undefined || value === null) return null;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const getProperties = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      page = 1,
      limit = 10,
      minRent,
      maxRent,
      city,
      state,
      available,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      oxyUserId: ownerOxyUserId,
      addressId,
      lat,
      lng,
      radius,
      offering,
      minSalePrice,
      maxSalePrice,
      instantBook,
      minGuests,
      checkIn,
      checkOut,
    } = req.query;

    const pageNumber = Math.max(1, parseInt(String(page)) || 1);
    const limitNumber = Math.min(100, Math.max(1, parseInt(String(limit)) || 10));

    // The clauses this feed shares with the two proximity feeds — visibility,
    // type, the numeric ranges, the boolean flags, the enum filters,
    // `availableFrom` and `excludeIds`.
    const conditions: (SQL | undefined)[] = [...buildCommonPropertyFilters(req.query)];

    if (ownerOxyUserId) {
      // A query PARAMETER, not the session — which is why the moderation filter
      // in the common block applies here too. Scoping a feed to somebody else's
      // id must not reveal what a jury withheld.
      conditions.push(ownedBy(String(ownerOxyUserId)));
    }

    // Handle a direct addressId filter. No id-SHAPE guard: an id that matches no
    // address simply returns an empty page, which is what the old
    // `ObjectId.isValid` early return produced by hand.
    if (addressId) conditions.push(addressIs(String(addressId)));

    // City and state filter via RELATIONAL geo: the location name (or id) is
    // translated to a canonical City/Region id and the join's own address column
    // is compared against it. This replaces `resolveGeoFilterAddressIds`, which
    // loaded EVERY address id in the city into an uncapped `$in`.
    if (city) {
      const cityId = await resolveCityId(String(city));
      if (!cityId) return res.json(paginationResponse([], pageNumber, limitNumber, 0));
      conditions.push(inCity(cityId));
    }
    if (state) {
      const regionId = await resolveRegionId(String(state));
      if (!regionId) return res.json(paginationResponse([], pageNumber, limitNumber, 0));
      conditions.push(inRegion(regionId));
    }

    // ---- Status / availability ----
    // Carried across exactly, including the ordering quirk: an explicit
    // `available` sets `published`, and the draft default then REPLACES that
    // status whenever no `status` parameter was given.
    if (available !== undefined) {
      conditions.push(isAvailable(String(available) === 'true'), statusIs('published'));
    }
    if (status) {
      const statusValue = String(status).toLowerCase();
      if (statusValue === 'available') {
        conditions.push(isAvailable(true), statusIs('published'));
      } else {
        conditions.push(statusIs(statusValue));
      }
    } else if (!req.query.includeDrafts) {
      conditions.push(statusIsNot('draft'));
    }

    // ---- Offering ----
    // Resolved early because the price-range column below depends on it.
    let resolvedOffering: OfferingType | undefined;
    if (offering) {
      const offeringValue = String(offering).toLowerCase();
      if (OFFERING_VALUES.has(offeringValue)) {
        resolvedOffering = offeringValue as OfferingType;
        conditions.push(hasOffering(offeringValue));
      }
    }

    // ---- Price range (priceMin/priceMax aliased as minRent/maxRent) ----
    // Applies to the requested offering's price column. SALE uses
    // minSalePrice/maxSalePrice below, so a bare range is not applied to a sale
    // query.
    if ((minRent !== undefined || maxRent !== undefined) && resolvedOffering !== OfferingType.SALE) {
      conditions.push(inRange(
        priceColumnForOffering(resolvedOffering) ?? DEFAULT_PRICE_COLUMN,
        minRent === undefined ? undefined : parseFloat(String(minRent)),
        maxRent === undefined ? undefined : parseFloat(String(maxRent)),
      ));
    }

    // ---- Sale price range (ONLY for an explicit sale query) ----
    if ((minSalePrice !== undefined || maxSalePrice !== undefined) && resolvedOffering === OfferingType.SALE) {
      conditions.push(inRange(
        properties.salePrice,
        minSalePrice === undefined ? undefined : parseFloat(String(minSalePrice)),
        maxSalePrice === undefined ? undefined : parseFloat(String(maxSalePrice)),
      ));
    }

    if (instantBook !== undefined) {
      conditions.push(booleanIs(properties.shortTermRentInstantBook, String(instantBook) === 'true'));
    }

    if (minGuests !== undefined) {
      const guests = parseInt(String(minGuests), 10);
      if (!Number.isNaN(guests) && guests > 0) {
        conditions.push(inRange(properties.maxGuests, guests, undefined));
      }
    }

    // ---- Date-range availability ----
    // Excludes listings whose host calendar blocks the range, AND listings with
    // a confirmed Reservation overlapping it. The calendar half is a single
    // `NOT EXISTS` over the GiST-indexed range; the reservation half is still a
    // Mongo read, because `Reservation` is not part of this port.
    const checkInDate = parseDateParam(checkIn);
    const checkOutDate = parseDateParam(checkOut);
    const hasStay = checkInDate !== null && checkOutDate !== null && checkOutDate.getTime() > checkInDate.getTime();

    if (hasStay && checkInDate && checkOutDate) {
      conditions.push(calendarIsFree(checkInDate, checkOutDate));

      const conflictingReservations = await Reservation.find({
        status: ReservationStatus.CONFIRMED,
        checkIn: { $lt: checkOutDate },
        checkOut: { $gt: checkInDate },
      })
        .select('propertyId')
        .lean();
      const conflictingPropertyIds = conflictingReservations
        .map((reservation: { propertyId?: unknown }) => String(reservation.propertyId ?? ''))
        .filter(Boolean);
      if (conflictingPropertyIds.length > 0) {
        conditions.push(idNotIn(conflictingPropertyIds));
      }
    }

    const where = allOf(conditions);

    const sortByValue = String(sortBy);
    const sortParams: ParsedSearchParams = {
      page: pageNumber,
      limit: limitNumber,
      sortField: (LIST_SORT_FIELDS.has(sortByValue) ? sortByValue : 'createdAt') as SortField,
      sortDirection: sortOrder === 'asc' ? 'asc' : 'desc',
      offering: resolvedOffering,
    };
    // `has_images DESC` leads every branch so image-bearing listings always rank
    // first (product rule); `propertyOrderBy` prepends it once for every feed.
    const orderBy = propertyOrderBy(...buildSort(sortParams));
    const skip = (pageNumber - 1) * limitNumber;

    const hasCoords = lat !== undefined && lng !== undefined && lat !== null && lng !== null;
    const latitude = hasCoords ? parseFloat(String(lat)) : Number.NaN;
    const longitude = hasCoords ? parseFloat(String(lng)) : Number.NaN;
    const wantsDistance = hasCoords && Number.isFinite(latitude) && Number.isFinite(longitude);

    const [hydrated, total] = await Promise.all([
      findProperties({
        where,
        orderBy,
        limit: limitNumber,
        offset: skip,
        // Measured by PostGIS on the spheroid, not by a haversine in JavaScript
        // — the JS version this replaces read `address.coordinates.coordinates`
        // and returned Infinity whenever the pair was missing, which then sorted
        // the listing last for a reason nobody could see.
        distanceFrom: wantsDistance ? { longitude, latitude } : undefined,
      }),
      countProperties(where),
    ]);

    const serialized = hydrated.map(serializeProperty);

    const ids = serialized
      .map((property) => property.id)
      .filter((id): id is string => typeof id === 'string');
    let savesMap: Record<string, number> = {};
    if (ids.length > 0) {
      // STRING ids, matching what `Saved.targetId` is declared as — see the
      // module doc for why this stopped being deferrable.
      const savesAgg = await Saved.aggregate([
        { $match: { targetType: 'property', targetId: { $in: ids } } },
        { $group: { _id: '$targetId', count: { $sum: 1 } } }
      ]).catch(() => []);
      savesMap = Array.isArray(savesAgg) ? savesAgg.reduce((acc: Record<string, number>, doc: { _id?: unknown; count?: number }) => {
        acc[String(doc._id)] = doc.count || 0;
        return acc;
      }, {}) : {};
    }

    const preferredRadiusMeters = radius ? parseFloat(String(radius)) : DEFAULT_PREFERRED_RADIUS_METERS;
    let ordered: ListingForScoring[];

    if (wantsDistance) {
      const decorated = serialized.map((property, index) => {
        const distance = typeof property.distance === 'number' ? property.distance : Number.POSITIVE_INFINITY;
        const savesCount = savesMap[String(property.id)] || 0;
        return {
          index,
          distance,
          savesCount,
          hasImages: listingHasImages(property),
          inside: Number.isFinite(distance) && distance <= preferredRadiusMeters,
          prop: { ...property, isSaved: false },
        };
      });
      decorated.sort((a, b) => {
        // Image-bearing listings first (product rule), then the geo ranking.
        if (a.hasImages !== b.hasImages) return a.hasImages ? -1 : 1;
        if (a.inside !== b.inside) return a.inside ? -1 : 1;
        if (b.savesCount !== a.savesCount) return b.savesCount - a.savesCount;
        if (a.distance !== b.distance) return a.distance - b.distance;
        return a.index - b.index;
      });
      ordered = decorated.map((entry) => ({ ...entry.prop, savesCount: entry.savesCount, distance: entry.distance }));
    } else {
      ordered = serialized.map((property) => ({ ...property, savesCount: savesMap[String(property.id)] || 0, isSaved: false }));
    }

    if (req.user?.id || req.user?._id) {
      try {
        const oxyUserId = req.user.id || req.user._id;
        const [recentlyViewed, savedProperties] = await Promise.all([
          RecentlyViewed.find({ oxyUserId })
            .sort({ viewedAt: -1 })
            .limit(10)
            .select('propertyId')
            .lean(),
          Saved.find({ oxyUserId, targetType: 'property' })
            .select('targetId')
            .lean()
        ]);

        const savedIds = new Set(savedProperties.map((saved) => String((saved as { targetId?: unknown }).targetId)));

        // Build O(1) lookup map instead of O(n) .find() per view item
        const orderedMap = new Map<string, ListingForScoring>();
        for (const property of ordered) orderedMap.set(String(property.id), property);

        const preferenceWeights: {
          propertyTypes: Record<string, number>;
          priceRanges: Record<string, number>;
          locations: Record<string, number>;
          amenities: Record<string, number>;
        } = { propertyTypes: {}, priceRanges: {}, locations: {}, amenities: {} };
        const recentlyViewedIds = new Set<string>();
        for (const view of recentlyViewed) {
          const viewPropId = String((view as { propertyId?: unknown }).propertyId);
          recentlyViewedIds.add(viewPropId);
          const property = orderedMap.get(viewPropId);
          if (property) {
            preferenceWeights.propertyTypes[String(property.type)] = (preferenceWeights.propertyTypes[String(property.type)] || 0) + 1;
            const price = representativePrice(property);
            if (price > 0) {
              const priceRange = priceBucket(price);
              preferenceWeights.priceRanges[priceRange] = (preferenceWeights.priceRanges[priceRange] || 0) + 1;
            }
            const viewCityId = cityIdKey(property);
            if (viewCityId) {
              preferenceWeights.locations[viewCityId] = (preferenceWeights.locations[viewCityId] || 0) + 1;
            }
            for (const amenity of property.amenities ?? []) {
              preferenceWeights.amenities[amenity] = (preferenceWeights.amenities[amenity] || 0) + 1;
            }
          }
        }

        const personalized: ListingForScoring[] = ordered.map((property) => {
          const propertyId = String(property.id);
          const isSaved = savedIds.has(propertyId);
          let personalizedScore = (property.savesCount || 0) * 10;
          personalizedScore += (preferenceWeights.propertyTypes[String(property.type)] || 0) * 15;
          const price = representativePrice(property);
          if (price > 0) {
            const priceRange = priceBucket(price);
            personalizedScore += (preferenceWeights.priceRanges[priceRange] || 0) * 12;
          }
          const scoreCityId = cityIdKey(property);
          if (scoreCityId) personalizedScore += (preferenceWeights.locations[scoreCityId] || 0) * 20;
          for (const amenity of property.amenities ?? []) {
            personalizedScore += (preferenceWeights.amenities[amenity] || 0) * 5;
          }
          if (property.isVerified) personalizedScore += 25;
          if (property.isEcoFriendly) personalizedScore += 15;
          const priceEthics = property.priceEthics;
          if (priceEthics?.isFairPrice) personalizedScore += 30;
          if (
            priceEthics?.withinEthical === false ||
            priceEthics?.marketVerdict === 'above_average'
          ) {
            personalizedScore -= 20;
          }
          if (recentlyViewedIds.has(propertyId)) personalizedScore -= 30;
          if (isSaved) personalizedScore -= 20;
          return { ...property, personalizedScore, isSaved };
        });
        personalized.sort((a, b) => {
          // Image-bearing listings first (product rule), then personalization.
          const aHasImages = listingHasImages(a);
          const bHasImages = listingHasImages(b);
          if (aHasImages !== bHasImages) return aHasImages ? -1 : 1;
          return (Number(b.personalizedScore) || 0) - (Number(a.personalizedScore) || 0);
        });
        ordered = personalized;
      } catch (error) {
        // Personalization is a best-effort enhancement: if it fails we fall back
        // to the default ordering instead of failing the request, but we log it.
        logger.warn('Failed to personalize property ordering; using default order', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    res.json(paginationResponse(
      ordered,
      pageNumber,
      limitNumber,
      total,
      'Properties retrieved successfully'
    ));
  } catch (error) {
    next(error);
  }
};

/** The subset of a serialized listing the in-memory re-ranking reads. */
interface ListingForScoring extends Record<string, unknown> {
  id?: string;
  type?: string;
  amenities?: string[];
  images?: unknown[];
  isVerified?: boolean;
  isEcoFriendly?: boolean;
  savesCount?: number;
  address?: { cityId?: unknown };
  longTermRent?: { monthlyAmount?: number };
  shortTermRent?: { nightlyRate?: number };
  priceEthics?: { isFairPrice?: boolean; withinEthical?: boolean; marketVerdict?: string };
}
