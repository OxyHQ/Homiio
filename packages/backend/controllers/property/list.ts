import { Request, Response, NextFunction } from 'express';
const { Property } = require('../../models');
import { successResponse, paginationResponse } from '../../middlewares/errorHandler';

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
      priceUnit,
      proximityToTransport,
      proximityToSchools,
      proximityToShopping,
      availableFromBefore,
      availableFromAfter,
      excludeIds,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      profileId,
      lat,
      lng,
      radius
    } = req.query as any;

    const pageNumber = parseInt(String(page));
    const limitNumber = parseInt(String(limit));

    const filters: any = {};
    if (profileId) filters.profileId = profileId;
    if (type) filters.type = type;
    
    // Handle city and state filters with Address lookup
    let addressIds: string[] = [];
    if (city || state) {
      const { Address } = require('../../models');
      const addressQuery: any = {};
      if (city) addressQuery.city = new RegExp(city, 'i');
      if (state) addressQuery.state = new RegExp(String(state), 'i');
      
      const matchingAddresses = await Address.find(addressQuery).select('_id');
      addressIds = matchingAddresses.map((addr: any) => addr._id);
      
      if (addressIds.length === 0) {
        // No matching addresses found, return empty result
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
      filters.status = 'active';
    }
    if (amenities) {
      const amenityList = String(amenities).split(',');
      filters.amenities = { $in: amenityList };
    }
    if (hasPhotos === 'true') filters['images.url'] = { $exists: true, $nin: [null, ''] };
    if (verified === 'true') filters.isVerified = true;
    if (eco === 'true') filters.isEcoFriendly = true;
    if (housingType) filters.housingType = String(housingType);
    if (layoutType) filters.layoutType = String(layoutType);
    if (furnishedStatus) filters.furnishedStatus = String(furnishedStatus);
    if (petPolicy) filters.petPolicy = String(petPolicy);
    if (leaseTerm) filters.leaseTerm = String(leaseTerm);
    if (priceUnit) filters.priceUnit = String(priceUnit);
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
    if (minRent !== undefined || maxRent !== undefined) {
      filters['rent.amount'] = {};
      if (minRent !== undefined) filters['rent.amount'].$gte = parseFloat(String(minRent));
      if (maxRent !== undefined) filters['rent.amount'].$lte = parseFloat(String(maxRent));
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
      } catch { }
    }

    const sortOptions: any = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
    const skip = (pageNumber - 1) * limitNumber;

    const [properties, total] = await Promise.all([
      Property.find(filters)
        .populate('addressId')
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNumber)
        .lean(),
      Property.countDocuments(filters)
    ]);

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
            return { index, distance, savesCount, inside: Number.isFinite(distance) && distance <= preferredRadiusMeters, prop: p };
        });
        decorated.sort((a, b) => {
          if (a.inside !== b.inside) return a.inside ? -1 : 1;
          if (b.savesCount !== a.savesCount) return b.savesCount - a.savesCount;
          if (a.distance !== b.distance) return a.distance - b.distance;
          return a.index - b.index;
        });
        ordered = decorated.map(d => ({ ...d.prop, savesCount: d.savesCount, distance: d.distance }));
      } catch {
        ordered = properties.map((p: any) => ({ ...p, savesCount: savesMap[String(p._id)] || 0 }));
      }
    } else {
      ordered = properties.map((p: any) => ({ ...p, savesCount: savesMap[String(p._id)] || 0 }));
    }

    if ((req as any).user?.id || (req as any).user?._id) {
      try {
        const oxyUserId = (req as any).user.id || (req as any).user._id;
        const { Profile, RecentlyViewed, Saved } = require('../../models');
        const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
        if (activeProfile) {
          const recentlyViewed = await RecentlyViewed.find({ profileId: activeProfile._id })
            .sort({ viewedAt: -1 })
            .limit(10)
            .lean();
          const savedProperties = await Saved.find({ profileId: activeProfile._id, targetType: 'property' }).lean();
          const preferenceWeights = { propertyTypes: {}, priceRanges: {}, locations: {}, amenities: {} } as any;
          recentlyViewed.forEach((view: any) => {
            const property = ordered.find(p => p._id.toString() === view.propertyId.toString());
            if (property) {
              preferenceWeights.propertyTypes[property.type] = (preferenceWeights.propertyTypes[property.type] || 0) + 1;
              const rent = property.rent?.amount || 0;
              if (rent > 0) {
                const priceRange = rent < 1000 ? 'low' : rent < 2000 ? 'medium' : 'high';
                preferenceWeights.priceRanges[priceRange] = (preferenceWeights.priceRanges[priceRange] || 0) + 1;
              }
              if (property.address?.city) {
                preferenceWeights.locations[property.address.city] = (preferenceWeights.locations[property.address.city] || 0) + 1;
              }
              if (property.amenities) {
                property.amenities.forEach((amenity: string) => {
                  preferenceWeights.amenities[amenity] = (preferenceWeights.amenities[amenity] || 0) + 1;
                });
              }
            }
          });
          const personalized = ordered.map(property => {
            let personalizedScore = (property.savesCount || 0) * 10;
            personalizedScore += (preferenceWeights.propertyTypes[property.type] || 0) * 15;
            const rent = property.rent?.amount || 0;
            if (rent > 0) {
              const priceRange = rent < 1000 ? 'low' : rent < 2000 ? 'medium' : 'high';
              personalizedScore += (preferenceWeights.priceRanges[priceRange] || 0) * 12;
            }
            if (property.addressId?.city) personalizedScore += (preferenceWeights.locations[property.addressId.city] || 0) * 20;
            if (property.amenities) {
              property.amenities.forEach((amenity: string) => {
                personalizedScore += (preferenceWeights.amenities[amenity] || 0) * 5;
              });
            }
            if (property.isVerified) personalizedScore += 25;
            if (property.isEcoFriendly) personalizedScore += 15;
            const isRecentlyViewed = recentlyViewed.some((view: any) => view.propertyId.toString() === property._id.toString());
            if (isRecentlyViewed) personalizedScore -= 30;
            const isSaved = savedProperties.some((saved: any) => saved.targetId.toString() === property._id.toString());
            if (isSaved) personalizedScore -= 20;
            return { ...property, personalizedScore };
          });
          personalized.sort((a, b) => (b.personalizedScore || 0) - (a.personalizedScore || 0));
          ordered = personalized;
        }
      } catch { }
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