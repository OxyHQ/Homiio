/**
 * Area price-insights controller.
 *
 * Powers the property-detail "price range in this area" section. Given a target
 * property it computes how that listing's price compares to SIMILAR homes
 * nearby, returning min/max/avg/median, a verdict, a price distribution and a
 * set of comparable listings.
 */

import type { Request, Response, NextFunction } from 'express';
import { Types, type Model } from 'mongoose';
import type {
  PropertyAreaInsights,
  AreaInsightsBasis,
} from '@homiio/shared-types';
import type { IProperty } from '../../models/Property';

import * as models from '../../models';
const Property: Model<IProperty> = models.Property;
import { AppError, successResponse } from '../../middlewares/errorHandler';
import {
  RADIUS_KM,
  MIN_RADIUS_SAMPLE,
  buildBaseComparableFilter,
  buildComparison,
  buildDistribution,
  buildNeighborhoodContrast,
  buildPricePerSqm,
  buildTargetContext,
  fetchComparables,
  resolveCityAddressIds,
  resolveRadiusAddressIds,
  aggregatePriceStats,
  PRICE_UNIT_MONTH,
} from '../../services/areaPriceComparison';

type AreaInsightsResponse = Omit<PropertyAreaInsights, 'comparables'> & {
  comparables: Record<string, unknown>[];
};

function buildEmptyInsights(property: IProperty): AreaInsightsResponse {
  return {
    basis: 'city',
    radiusKm: RADIUS_KM,
    areaLabel: '',
    currency:
      property.longTermRent?.currency ??
      property.shortTermRent?.currency ??
      property.sale?.currency ??
      'EUR',
    priceUnit: PRICE_UNIT_MONTH,
    sampleSize: 0,
    comparison: buildComparison(null, 0),
    pricePerSqm: null,
    distribution: buildDistribution(null, 0),
    neighborhoodVsCity: null,
    comparables: [],
  };
}

export async function getAreaInsights(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { propertyId } = req.params;
    if (!Types.ObjectId.isValid(propertyId)) {
      return next(new AppError('Invalid property ID', 400, 'INVALID_ID'));
    }

    const property = await Property.findById(propertyId)
      .populate({
        path: 'addressId',
        populate: [
          { path: 'cityId', select: 'name' },
          { path: 'neighborhoodId', select: 'name' },
        ],
      })
      .lean<IProperty | null>();
    if (!property) {
      return next(new AppError('Property not found', 404, 'NOT_FOUND'));
    }

    const targetResult = buildTargetContext(property);
    if ('reason' in targetResult) {
      if (targetResult.reason === 'no_coordinates') {
        return next(new AppError('Property is missing address coordinates', 422, 'MISSING_COORDINATES'));
      }
      res.json(successResponse(buildEmptyInsights(property), 'Area insights retrieved successfully'));
      return;
    }
    const target = targetResult.context;

    const baseFilter = buildBaseComparableFilter(target);

    const radiusAddressIds = await resolveRadiusAddressIds(target, RADIUS_KM);
    const radiusStats = await aggregatePriceStats(baseFilter, radiusAddressIds, target.priceField);
    const radiusCount = radiusStats?.count ?? 0;

    const useRadius = radiusCount >= MIN_RADIUS_SAMPLE;
    let basis: AreaInsightsBasis;
    let scopeAddressIds: Types.ObjectId[];
    let stats;

    if (useRadius) {
      basis = 'radius';
      scopeAddressIds = radiusAddressIds;
      stats = radiusStats;
    } else {
      basis = 'city';
      scopeAddressIds = await resolveCityAddressIds(target);
      stats = await aggregatePriceStats(baseFilter, scopeAddressIds, target.priceField);
    }

    const areaLabel =
      basis === 'radius' ? target.neighborhood ?? target.city : target.city;
    const sampleSize = stats?.count ?? 0;

    const [comparables, neighborhoodVsCity] = await Promise.all([
      fetchComparables(baseFilter, scopeAddressIds),
      buildNeighborhoodContrast(target, baseFilter, basis === 'city' ? scopeAddressIds : null),
    ]);

    const response: AreaInsightsResponse = {
      basis,
      radiusKm: RADIUS_KM,
      areaLabel,
      currency: target.currency,
      priceUnit: target.priceUnit,
      sampleSize,
      comparison: buildComparison(stats, target.price),
      pricePerSqm: buildPricePerSqm(target.squareFootage, target.price, stats?.avgPricePerSqm ?? null),
      distribution: buildDistribution(stats, target.price),
      neighborhoodVsCity,
      comparables,
    };

    res.json(successResponse(response, 'Area insights retrieved successfully'));
  } catch (error) {
    next(error);
  }
}
