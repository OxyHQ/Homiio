/**
 * Analytics Controller
 * Per-profile analytics computed from real platform data
 * (RecentlyViewed, Saved, ViewingRequest, Property) plus public app-wide stats.
 */

import type { Request, Response, NextFunction } from 'express';

import { AppError, successResponse } from '../middlewares/errorHandler';
import { logger } from '../middlewares/logging';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

interface TopCityRow {
  _id: unknown;
  city?: { name?: string };
  region?: { name?: string };
  properties: number;
  averageRent: number;
}

interface PriceBucketRow {
  _id: string | number;
  count: number;
}

const PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
const DAY_MS = 24 * 60 * 60 * 1000;

class AnalyticsController {
  /**
   * Get analytics for the authenticated profile.
   *
   * Aggregates real data over the requested period:
   * - views: RecentlyViewed entries for the profile's properties
   * - saves: Saved entries targeting the profile's properties
   * - viewingRequests: ViewingRequest documents received as owner, by status
   *
   * Metrics with no backing data are returned as 0 — nothing is fabricated.
   */
  async getAnalytics(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const periodParam = String(req.query.period || '30d');
      const periodDays = PERIOD_DAYS[periodParam] || PERIOD_DAYS['30d'];
      const period = PERIOD_DAYS[periodParam] ? periodParam : '30d';
      const since = new Date(Date.now() - periodDays * DAY_MS);

      const { Profile, Property, RecentlyViewed, Saved, ViewingRequest } = require('../models');

      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) {
        return res.json(
          successResponse(
            {
              period,
              totalInteractions: 0,
              properties: { listed: 0 },
              views: { total: 0, uniqueViewers: 0 },
              saves: { total: 0 },
              viewingRequests: { received: 0, pending: 0, approved: 0, declined: 0, cancelled: 0 },
              insights: [],
            },
            'Analytics retrieved successfully',
          ),
        );
      }

      const propertyIds = await Property.distinct('_id', {
        profileId: activeProfile._id,
        status: { $ne: 'archived' },
      });

      const [viewsAgg, savesAgg, viewingAgg] = await Promise.all([
        propertyIds.length
          ? RecentlyViewed.aggregate([
              { $match: { propertyId: { $in: propertyIds }, viewedAt: { $gte: since } } },
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  uniqueViewers: { $addToSet: '$profileId' },
                },
              },
              { $project: { _id: 0, total: 1, uniqueViewers: { $size: '$uniqueViewers' } } },
            ])
          : Promise.resolve([]),
        propertyIds.length
          ? Saved.aggregate([
              {
                $match: {
                  targetType: 'property',
                  targetId: { $in: propertyIds },
                  createdAt: { $gte: since },
                },
              },
              { $group: { _id: null, total: { $sum: 1 } } },
            ])
          : Promise.resolve([]),
        ViewingRequest.aggregate([
          { $match: { ownerProfileId: activeProfile._id, createdAt: { $gte: since } } },
          { $group: { _id: '$status', count: { $sum: 1 } } },
        ]),
      ]);

      const views = {
        total: viewsAgg[0]?.total || 0,
        uniqueViewers: viewsAgg[0]?.uniqueViewers || 0,
      };
      const saves = { total: savesAgg[0]?.total || 0 };

      const viewingByStatus: Record<string, number> = {};
      let viewingReceived = 0;
      for (const bucket of viewingAgg) {
        viewingByStatus[bucket._id] = bucket.count;
        viewingReceived += bucket.count;
      }
      const viewingRequests = {
        received: viewingReceived,
        pending: viewingByStatus.pending || 0,
        approved: viewingByStatus.approved || 0,
        declined: viewingByStatus.declined || 0,
        cancelled: viewingByStatus.cancelled || 0,
      };

      const insights: string[] = [];
      if (views.total > 0) {
        insights.push(
          `Your properties received ${views.total} view${views.total === 1 ? '' : 's'} from ${views.uniqueViewers} unique viewer${views.uniqueViewers === 1 ? '' : 's'} in the last ${periodDays} days`,
        );
      }
      if (saves.total > 0) {
        insights.push(
          `${saves.total} ${saves.total === 1 ? 'person' : 'people'} saved your properties in the last ${periodDays} days`,
        );
      }
      if (viewingRequests.pending > 0) {
        insights.push(
          `You have ${viewingRequests.pending} pending viewing request${viewingRequests.pending === 1 ? '' : 's'}`,
        );
      }

      const data = {
        period,
        totalInteractions: views.total + saves.total + viewingRequests.received,
        properties: { listed: propertyIds.length },
        views,
        saves,
        viewingRequests,
        insights,
      };

      res.json(successResponse(data, 'Analytics retrieved successfully'));
    } catch (error) {
      logger.error('Failed to retrieve analytics', { error: errorMessage(error) });
      next(error);
    }
  }

  /**
   * Get app-wide statistics (public)
   * - Totals: properties, cities, saves, unique savers
   * - Pricing: average/min/max rent
   * - Top cities by property count with average rent
   * - Price buckets distribution
   */
  async getAppStats(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const { Property, City, Saved } = require('../models');

      const [totalProperties, totalCities, totalSaves, uniqueSavers] = await Promise.all([
        Property.countDocuments({}),
        City.countDocuments({}),
        Saved.countDocuments({ targetType: 'property' }),
        Saved.distinct('profileId', { targetType: 'property' }).then((arr: unknown[]) => arr.length),
      ]);

      // Pricing aggregates
      const pricingAgg = await Property.aggregate([
        { $match: { 'longTermRent.monthlyAmount': { $gt: 0 } } },
        {
          $group: {
            _id: null,
            averageRent: { $avg: '$longTermRent.monthlyAmount' },
            minRent: { $min: '$longTermRent.monthlyAmount' },
            maxRent: { $max: '$longTermRent.monthlyAmount' },
          },
        },
      ]);

      const pricing = pricingAgg[0] || { averageRent: 0, minRent: 0, maxRent: 0 };

      // Top cities by property count with avg rent. Geo is relational, so this
      // joins Property → Address → City (and Region for the label) and groups by
      // the canonical cityId rather than a free-text city string.
      const topCities = await Property.aggregate([
        { $match: { addressId: { $exists: true, $ne: null } } },
        { $lookup: { from: 'addresses', localField: 'addressId', foreignField: '_id', as: 'address' } },
        { $unwind: '$address' },
        { $match: { 'address.cityId': { $exists: true, $ne: null } } },
        {
          $group: {
            _id: '$address.cityId',
            regionId: { $first: '$address.regionId' },
            properties: { $sum: 1 },
            averageRent: { $avg: '$longTermRent.monthlyAmount' },
          },
        },
        { $sort: { properties: -1 } },
        { $limit: 6 },
        { $lookup: { from: 'cities', localField: '_id', foreignField: '_id', as: 'city' } },
        { $unwind: { path: '$city', preserveNullAndEmptyArrays: true } },
        { $lookup: { from: 'regions', localField: 'regionId', foreignField: '_id', as: 'region' } },
        { $unwind: { path: '$region', preserveNullAndEmptyArrays: true } },
      ]);

      // Price buckets (preset boundaries)
      const priceBuckets = await Property.aggregate([
        { $match: { 'longTermRent.monthlyAmount': { $gte: 0 } } },
        {
          $bucket: {
            groupBy: '$longTermRent.monthlyAmount',
            boundaries: [0, 500, 1000, 1500, 2000, 3000, 5000, 10000],
            default: '10000+',
            output: { count: { $sum: 1 } },
          },
        },
      ]);

      return res.json(
        successResponse(
          {
            totals: {
              properties: totalProperties,
              cities: totalCities,
              saves: totalSaves,
              uniqueSavers: uniqueSavers,
            },
            pricing: {
              averageRent: Math.round(pricing.averageRent || 0),
              minRent: pricing.minRent || 0,
              maxRent: pricing.maxRent || 0,
            },
            topCities: (topCities as TopCityRow[]).map((c) => ({
              cityId: c._id,
              city: c.city?.name ?? null,
              state: c.region?.name ?? null,
              properties: c.properties,
              averageRent: Math.round(c.averageRent || 0),
            })),
            priceBuckets: (priceBuckets as PriceBucketRow[]).map((b) => ({
              bucket: typeof b._id === 'string' ? b._id : `${b._id}-${Number(b._id) + 499}`,
              count: b.count,
            })),
          },
          'App stats retrieved successfully',
        ),
      );
    } catch (error) {
      logger.error('Failed to retrieve app stats', { error: errorMessage(error) });
      return next(error);
    }
  }
}

module.exports = new AnalyticsController();
