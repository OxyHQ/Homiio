import { Request, Response, NextFunction } from 'express';
import type { SortOrder } from 'mongoose';
import { Property, Reservation } from '../../models';
import { paginationResponse } from '../../middlewares/errorHandler';
import { logger } from '../../middlewares/logging';
import {
  priceFieldForOffering,
  DEFAULT_PRICE_FIELD,
  FIELD_SHORT_TERM_INSTANT_BOOK,
  PRICE_FIELD_SALE,
  FIELD_PRICE_ETHICS_IS_FAIR_PRICE,
  buildSort,
  SORT_ASC,
  SORT_DESC,
  type SortField,
} from './searchQueryBuilder';
import { OfferingType } from '@homiio/shared-types';
const {
  AvailabilityWindowStatus,
  ReservationStatus
} = require('@homiio/shared-types');
import { serializePropertyAddresses, ADDRESS_GEO_POPULATE } from '../../services/propertyAddressSerializer';
import { serializePropertyImages } from '../../services/imageSerializer';

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

/** Map a representative price to a coarse low/medium/high preference bucket. */
function priceBucket(price: number): 'low' | 'medium' | 'high' {
  if (price < PRICE_BUCKET_LOW_MAX) return 'low';
  if (price < PRICE_BUCKET_MEDIUM_MAX) return 'medium';
  return 'high';
}

/**
 * Stable city key for location-based personalization. Geo is relational, so we
 * key on the Address `cityId` (the post-find transform renames the populated
 * `addressId` to `address`; the ref is a bare id under a shallow populate, or a
 * `{ _id }` doc under a deep one). Returns null when no city ref is present.
 */
function cityIdKey(property: { address?: { cityId?: unknown }; addressId?: { cityId?: unknown } }): string | null {
  const ref = property.address?.cityId ?? property.addressId?.cityId;
  if (!ref) return null;
  if (typeof ref === 'object' && '_id' in (ref as Record<string, unknown>)) {
    const id = (ref as { _id?: unknown })._id;
    return id ? String(id) : null;
  }
  return String(ref);
}

export const getProperties = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      page = 1,
      limit = 10,
      type,
      minRent,
      maxRent,
      city,
      state,
      bedrooms,
      bathrooms,
      minBedrooms,
      maxBedrooms,
      minBathrooms,
      maxBathrooms,
      minSquareFootage,
      maxSquareFootage,
      minYearBuilt,
      maxYearBuilt,
      amenities,
      available,
      status,
      hasPhotos,
      verified,
      eco,
      housingType,
      layoutType,
      furnishedStatus,
      petFriendly,
      utilitiesIncluded,
      parkingType,
      petPolicy,
      leaseTerm,
      proximityToTransport,
      proximityToSchools,
      proximityToShopping,
      availableFromBefore,
      availableFromAfter,
      excludeIds,
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
      fairPrice,
    } = req.query as any;

    const pageNumber = Math.max(1, parseInt(String(page)) || 1);
    const limitNumber = Math.min(100, Math.max(1, parseInt(String(limit)) || 10));

    const filters: any = {};
    // Public feed: never surface soft-deleted (archived) listings.
    filters.deletedAt = null;
    if (ownerOxyUserId) filters.oxyUserId = String(ownerOxyUserId);
    if (type) filters.type = type;
    
    // Handle direct addressId filter
    if (addressId) {
      const mongoose = require('mongoose');
      if (mongoose.Types.ObjectId.isValid(String(addressId))) {
        filters.addressId = new mongoose.Types.ObjectId(String(addressId));
      } else {
        return res.json(paginationResponse([], pageNumber, limitNumber, 0));
      }
    }
    
    // Handle city and state filters via RELATIONAL geo resolution. The location
    // name (or id) is translated to a canonical City/Region id and the matching
    // Address ids — there is no free-text city/state matching on the Address.
    if (city || state) {
      const { resolveGeoFilterAddressIds } = require('../../services/geoQueryService');
      const addressIds = await resolveGeoFilterAddressIds({
        city: city ? String(city) : undefined,
        state: state ? String(state) : undefined,
      });
      if (addressIds === null || addressIds.length === 0) {
        // Unknown city/region, or no addresses there — return empty result.
        return res.json(paginationResponse([], pageNumber, limitNumber, 0));
      }
      filters.addressId = { $in: addressIds };
    }

    if (minBedrooms || maxBedrooms) {
      const br: any = {};
      if (minBedrooms) br.$gte = parseInt(String(minBedrooms));
      if (maxBedrooms) br.$lte = parseInt(String(maxBedrooms));
      filters.bedrooms = br;
    } else if (bedrooms) {
      filters.bedrooms = parseInt(String(bedrooms));
    }
    if (minBathrooms || maxBathrooms) {
      const ba: any = {};
      if (minBathrooms) ba.$gte = parseInt(String(minBathrooms));
      if (maxBathrooms) ba.$lte = parseInt(String(maxBathrooms));
      filters.bathrooms = ba;
    } else if (bathrooms) {
      filters.bathrooms = parseInt(String(bathrooms));
    }
    if (minSquareFootage || maxSquareFootage) {
      const sf: any = {};
      if (minSquareFootage) sf.$gte = parseInt(String(minSquareFootage));
      if (maxSquareFootage) sf.$lte = parseInt(String(maxSquareFootage));
      filters.squareFootage = sf;
    }
    if (minYearBuilt || maxYearBuilt) {
      const yb: any = {};
      if (minYearBuilt) yb.$gte = parseInt(String(minYearBuilt));
      if (maxYearBuilt) yb.$lte = parseInt(String(maxYearBuilt));
      filters.yearBuilt = yb;
    }
    if (available !== undefined) {
      filters['availability.isAvailable'] = available === 'true';
      filters.status = 'published'; // Use published instead of active for available properties
    }
    
    // Handle status parameter (preferred approach)
    if (status) {
      const statusValue = String(status).toLowerCase();
      if (statusValue === 'available') {
        filters['availability.isAvailable'] = true;
        filters.status = 'published'; // Published and available for rent
      } else if (statusValue === 'rented') {
        filters.status = 'rented';
      } else if (statusValue === 'reserved') {
        filters.status = 'reserved';
      } else if (statusValue === 'sold') {
        filters.status = 'sold';
      } else if (statusValue === 'inactive') {
        filters.status = 'inactive';
      } else if (statusValue === 'draft') {
        filters.status = 'draft';
      } else if (statusValue === 'published') {
        filters.status = 'published';
      } else {
        // Direct status mapping for other values
        filters.status = statusValue;
      }
    }
    if (amenities) {
      const amenityList = String(amenities).split(',');
      filters.amenities = { $in: amenityList };
    }
    if (hasPhotos === 'true') filters['images.url'] = { $exists: true, $nin: [null, ''] };
    if (verified === 'true') filters.isVerified = true;
    if (eco === 'true') filters.isEcoFriendly = true;
    if (fairPrice === 'true') filters[FIELD_PRICE_ETHICS_IS_FAIR_PRICE] = true;
    if (housingType) filters.housingType = String(housingType);
    if (layoutType) filters.layoutType = String(layoutType);
    if (furnishedStatus) filters.furnishedStatus = String(furnishedStatus);
    if (petPolicy) filters.petPolicy = String(petPolicy);
    if (leaseTerm) filters.leaseTerm = String(leaseTerm);
    if (parkingType) filters.parkingType = String(parkingType);
    if (petFriendly !== undefined) filters.petFriendly = String(petFriendly) === 'true';
    if (utilitiesIncluded !== undefined) filters.utilitiesIncluded = String(utilitiesIncluded) === 'true';
    if (proximityToTransport !== undefined) filters.proximityToTransport = String(proximityToTransport) === 'true';
    if (proximityToSchools !== undefined) filters.proximityToSchools = String(proximityToSchools) === 'true';
    if (proximityToShopping !== undefined) filters.proximityToShopping = String(proximityToShopping) === 'true';
    if (availableFromBefore || availableFromAfter) {
      const af: any = {};
      if (availableFromAfter) {
        const d = new Date(String(availableFromAfter));
        if (!isNaN(d.getTime())) af.$gte = d;
      }
      if (availableFromBefore) {
        const d = new Date(String(availableFromBefore));
        if (!isNaN(d.getTime())) af.$lte = d;
      }
      if (Object.keys(af).length) filters.availableFrom = af;
    }
    // ---- Offering (long_term_rent / short_term_rent / sale / exchange) ----
    // Resolved early because the price-range field below depends on it.
    // `offerings` is an array, so equality matches membership.
    let resolvedOffering: OfferingType | undefined;
    if (offering) {
      const offeringValue = String(offering).toLowerCase();
      if (OFFERING_VALUES.has(offeringValue)) {
        resolvedOffering = offeringValue as OfferingType;
        filters.offerings = offeringValue;
      }
    }

    // ---- Price range (priceMin/priceMax aliased as minRent/maxRent) ----
    // Applies to the requested offering's price field (long_term→monthlyAmount,
    // short_term→nightlyRate; defaults to long-term). SALE uses minSalePrice /
    // maxSalePrice below, so a bare range is not applied to a sale query.
    if ((minRent !== undefined || maxRent !== undefined) && resolvedOffering !== OfferingType.SALE) {
      const priceField = priceFieldForOffering(resolvedOffering) ?? DEFAULT_PRICE_FIELD;
      const priceRange: { $gte?: number; $lte?: number } = {};
      if (minRent !== undefined) priceRange.$gte = parseFloat(String(minRent));
      if (maxRent !== undefined) priceRange.$lte = parseFloat(String(maxRent));
      filters[priceField] = priceRange;
    }

    // ---- Sale price range (ONLY for an explicit sale query) ----
    if ((minSalePrice !== undefined || maxSalePrice !== undefined) && resolvedOffering === OfferingType.SALE) {
      const saleRange: { $gte?: number; $lte?: number } = {};
      if (minSalePrice !== undefined) saleRange.$gte = parseFloat(String(minSalePrice));
      if (maxSalePrice !== undefined) saleRange.$lte = parseFloat(String(maxSalePrice));
      filters[PRICE_FIELD_SALE] = saleRange;
    }

    if (excludeIds) {
      try {
        const mongoose = require('mongoose');
        const list = String(excludeIds)
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
          .filter((id: string) => mongoose.Types.ObjectId.isValid(id))
          .map((id: string) => new mongoose.Types.ObjectId(id));
        if (list.length) filters._id = { $nin: list };
      } catch (error) {
        // Best-effort exclude filter: a malformed excludeIds param must not fail
        // the listing, but we record it rather than swallowing it silently.
        logger.warn('Failed to parse excludeIds filter; ignoring it', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Exclude draft properties by default unless explicitly requested.
    // When a `status` param is provided it has already been mapped to the
    // canonical PropertyStatus enum above (e.g. `available` -> `published`),
    // so we must NOT overwrite that mapping with the raw query value here.
    if (!req.query.includeDrafts && !req.query.status) {
      filters.status = { $ne: 'draft' };
    }

    // (Offering membership is applied above, alongside the price-range field it
    // selects, so the home/list feed and the search endpoint scope identically.)

    if (instantBook !== undefined) {
      filters[FIELD_SHORT_TERM_INSTANT_BOOK] = String(instantBook) === 'true';
    }

    if (minGuests !== undefined) {
      const n = parseInt(String(minGuests), 10);
      if (!Number.isNaN(n) && n > 0) {
        filters.maxGuests = { ...(filters.maxGuests || {}), $gte: n };
      }
    }

    // Date-range availability filter — exclude properties whose
    // availabilityWindows have a blocked/booked overlap OR which have a
    // confirmed Reservation overlapping the requested range.
    let checkInDate: Date | null = null;
    let checkOutDate: Date | null = null;
    if (checkIn && checkOut) {
      const parsedCheckIn = new Date(String(checkIn));
      const parsedCheckOut = new Date(String(checkOut));
      if (
        !Number.isNaN(parsedCheckIn.getTime()) &&
        !Number.isNaN(parsedCheckOut.getTime()) &&
        parsedCheckOut.getTime() > parsedCheckIn.getTime()
      ) {
        checkInDate = parsedCheckIn;
        checkOutDate = parsedCheckOut;
      }
    }

    if (checkInDate && checkOutDate) {
      // Block by host calendar windows (non-AVAILABLE windows that overlap).
      // A window overlaps if window.start < checkOut AND window.end > checkIn.
      filters.$nor = [
        {
          availabilityWindows: {
            $elemMatch: {
              status: { $ne: AvailabilityWindowStatus.AVAILABLE },
              start: { $lt: checkOutDate },
              end: { $gt: checkInDate }
            }
          }
        }
      ];

      // Exclude properties with confirmed reservations overlapping the range.
      const conflictingReservations = await Reservation.find({
        status: ReservationStatus.CONFIRMED,
        checkIn: { $lt: checkOutDate },
        checkOut: { $gt: checkInDate }
      })
        .select('propertyId')
        .lean();
      const conflictingPropertyIds = conflictingReservations.map((r: any) => r.propertyId);
      if (conflictingPropertyIds.length > 0) {
        const existingNin = (filters._id && filters._id.$nin) || [];
        filters._id = {
          ...(filters._id || {}),
          $nin: [...existingNin, ...conflictingPropertyIds]
        };
      }
    }

    const sortByValue = String(sortBy);
    const sortOptions: Record<string, SortOrder | { $meta: 'textScore' }> = LIST_SORT_FIELDS.has(sortByValue)
      ? buildSort(
          {
            page: pageNumber,
            limit: limitNumber,
            sortField: sortByValue as SortField,
            sortDirection: sortOrder === SORT_ASC ? SORT_ASC : SORT_DESC,
            offering: resolvedOffering,
          },
          false,
        )
      : { [sortByValue]: (sortOrder === 'desc' ? -1 : 1) as SortOrder };
    const skip = (pageNumber - 1) * limitNumber;

    const [properties, total] = await Promise.all([
      Property.find(filters)
        .populate(ADDRESS_GEO_POPULATE)
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      Property.countDocuments(filters)
    ]);

    // Resolve each address's city/region/country NAMES from the deep-populated
    // geo refs (relational geo), then flatten the refs back to ids. Done once,
    // in-place, before the personalization/ordering spreads (which preserve the
    // `address` reference), so cards render a location label with no N+1.
    serializePropertyAddresses(properties);
    serializePropertyImages(properties);

    const mongoose = require('mongoose');
    const { Saved } = require('../../models');
    const ids = properties.map(p => p._id).filter(Boolean).map((id: any) => new mongoose.Types.ObjectId(id));
    let savesMap: Record<string, number> = {};
    if (ids.length > 0) {
      const savesAgg = await Saved.aggregate([
        { $match: { targetType: 'property', targetId: { $in: ids } } },
        { $group: { _id: '$targetId', count: { $sum: 1 } } }
      ]).catch(() => []);
      savesMap = Array.isArray(savesAgg) ? savesAgg.reduce((acc: Record<string, number>, doc: any) => {
        acc[String(doc._id)] = doc.count || 0;
        return acc;
      }, {}) : {};
    }

    const hasCoords = lat !== undefined && lng !== undefined && lat !== null && lng !== null;
    const preferredRadiusMeters = radius ? parseFloat(String(radius)) : 45000;
    let ordered: any[] = properties;

    if (hasCoords) {
      const latitude = parseFloat(String(lat));
      const longitude = parseFloat(String(lng));
      try {
        const R = 6371000;
        const toRadians = (deg: number) => deg * Math.PI / 180;
        const computeDistance = (prop: any): number => {
          const coords = prop?.address?.coordinates?.coordinates;
          if (!Array.isArray(coords) || coords.length !== 2) return Number.POSITIVE_INFINITY;
          const [propLng, propLat] = coords;
          const dLat = toRadians(latitude - propLat);
          const dLng = toRadians(longitude - propLng);
          const a = Math.sin(dLat/2) ** 2 + Math.cos(toRadians(propLat)) * Math.cos(toRadians(latitude)) * Math.sin(dLng/2) ** 2;
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          return R * c;
        };
        const decorated = properties.map((p: any, index: number) => {
          const distance = computeDistance(p);
          const savesCount = savesMap[String(p._id)] || 0;
          return {
            index,
            distance,
            savesCount,
            inside: Number.isFinite(distance) && distance <= preferredRadiusMeters,
            prop: { ...p, isSaved: false }
          };
        });
        decorated.sort((a, b) => {
          if (a.inside !== b.inside) return a.inside ? -1 : 1;
          if (b.savesCount !== a.savesCount) return b.savesCount - a.savesCount;
          if (a.distance !== b.distance) return a.distance - b.distance;
          return a.index - b.index;
        });
        ordered = decorated.map(d => ({ ...d.prop, savesCount: d.savesCount, distance: d.distance }));
      } catch {
        ordered = properties.map((p: any) => ({ ...p, savesCount: savesMap[String(p._id)] || 0, isSaved: false }));
      }
    } else {
      ordered = properties.map((p: any) => ({ ...p, savesCount: savesMap[String(p._id)] || 0, isSaved: false }));
    }

    if (req.user?.id || req.user?._id) {
      try {
        const oxyUserId = req.user.id || req.user._id;
        const { RecentlyViewed, Saved } = require('../../models');
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

          const savedIds = new Set(savedProperties.map((s: any) => s.targetId.toString()));

          // Build O(1) lookup map instead of O(n) .find() per view item
          const orderedMap = new Map<string, any>();
          for (const p of ordered) {
            orderedMap.set(p._id.toString(), p);
          }

          const preferenceWeights = { propertyTypes: {} as any, priceRanges: {} as any, locations: {} as any, amenities: {} as any };
          const recentlyViewedIds = new Set<string>();
          for (const view of recentlyViewed) {
            const viewPropId = view.propertyId.toString();
            recentlyViewedIds.add(viewPropId);
            const property = orderedMap.get(viewPropId); // O(1) instead of O(n)
            if (property) {
              preferenceWeights.propertyTypes[property.type] = (preferenceWeights.propertyTypes[property.type] || 0) + 1;
              const price = representativePrice(property);
              if (price > 0) {
                const priceRange = priceBucket(price);
                preferenceWeights.priceRanges[priceRange] = (preferenceWeights.priceRanges[priceRange] || 0) + 1;
              }
              const viewCityId = cityIdKey(property);
              if (viewCityId) {
                preferenceWeights.locations[viewCityId] = (preferenceWeights.locations[viewCityId] || 0) + 1;
              }
              if (property.amenities) {
                for (const amenity of property.amenities) {
                  preferenceWeights.amenities[amenity] = (preferenceWeights.amenities[amenity] || 0) + 1;
                }
              }
            }
          }

          const personalized = ordered.map(property => {
            const propertyId = property._id.toString();
            const isSaved = savedIds.has(propertyId);
            let personalizedScore = (property.savesCount || 0) * 10;
            personalizedScore += (preferenceWeights.propertyTypes[property.type] || 0) * 15;
            const price = representativePrice(property);
            if (price > 0) {
              const priceRange = priceBucket(price);
              personalizedScore += (preferenceWeights.priceRanges[priceRange] || 0) * 12;
            }
            const scoreCityId = cityIdKey(property);
            if (scoreCityId) personalizedScore += (preferenceWeights.locations[scoreCityId] || 0) * 20;
            if (property.amenities) {
              for (const amenity of property.amenities) {
                personalizedScore += (preferenceWeights.amenities[amenity] || 0) * 5;
              }
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
            if (recentlyViewedIds.has(propertyId)) personalizedScore -= 30; // O(1) instead of O(n) .some()
            if (isSaved) personalizedScore -= 20;
            return { ...property, personalizedScore, isSaved };
          });
          personalized.sort((a, b) => (b.personalizedScore || 0) - (a.personalizedScore || 0));
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