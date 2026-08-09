/**
 * Analytics Controller
 * Per-profile analytics computed from real platform data
 * (RecentlyViewed, Saved, ViewingRequest, Property) plus public app-wide stats.
 */

import type { Request, Response, NextFunction } from 'express';

import { AppError, successResponse } from '../middlewares/errorHandler';
import { logger } from '../middlewares/logging';
import { getDb } from '../db/postgres';
import {
  countAppWideCatalogue,
  countAppWideSaves,
  countListingsByPriceBucket,
  findTopCitiesByListings,
  summarizeCatalogueRent,
  countSavesOfProperties,
  countViewsOfProperties,
  listOwnedPropertyIds,
} from '../db/analytics/ownerAnalytics';
import { findProfileByOxyUserId } from '../db/profiles/profileRepository';
import { countViewingsByStatusForOwner } from '../db/bookings/viewingReads';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}


const PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
const DAY_MS = 24 * 60 * 60 * 1000;

/** How many cities the "most listed" table shows. */
const TOP_CITIES_LIMIT = 6;

/**
 * The monthly-rent bands the public stats endpoint reports, verbatim from the
 * Mongo `$bucket` boundaries this replaces.
 */
const PRICE_BUCKET_BOUNDARIES = [0, 500, 1000, 1500, 2000, 3000, 5000, 10000] as const;

/**
 * Label each band and drop the empty ones.
 *
 * `width_bucket` numbers bands from 1, and returns `boundaries.length` for
 * anything at or above the last boundary — which is the `default: '10000+'`
 * overflow the Mongo version declared. A band nobody's listing falls in is
 * ABSENT from the map, and stays absent from the response, exactly as `$bucket`
 * omitted it.
 */
function priceBucketLabels(
  counts: ReadonlyMap<number, number>,
): { bucket: string; count: number }[] {
  const labels: { bucket: string; count: number }[] = [];
  for (const [bucket, count] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
    if (bucket >= PRICE_BUCKET_BOUNDARIES.length) {
      labels.push({ bucket: `${PRICE_BUCKET_BOUNDARIES[PRICE_BUCKET_BOUNDARIES.length - 1]}+`, count });
      continue;
    }
    const low = PRICE_BUCKET_BOUNDARIES[bucket - 1];
    labels.push({ bucket: `${low}-${low + 499}`, count });
  }
  return labels;
}

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


      // A GATE, not a lookup: nothing below reads this row — every figure is
      // keyed by `oxyUserId` — so its only job is "does this person have a
      // Homiio profile at all". It is the last Mongo read in this file's own
      // handler and it was SOUND, unlike the three defects the rest of this
      // endpoint carried: `Profile.findByOxyUserId` is a plain
      // `findOne({ oxyUserId })` on a declared, indexed path. It moves anyway,
      // because profiles are WRITTEN to Postgres now — leaving it on Mongo
      // would answer zeros forever for anyone whose profile was created after
      // that port landed.
      const db = getDb();
      const activeProfile = await findProfileByOxyUserId(db, oxyUserId);
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

      // The owner key is `oxy_user_id`. The Mongo original filtered on
      // `profileId`, which `PropertySchema` does not declare — so it matched no
      // document, `propertyIds` was always empty, and the two guarded
      // aggregates below never ran. Every number this endpoint reported has
      // been 0 since it was written; see `db/analytics/ownerAnalytics.ts`.
      const propertyIds = await listOwnedPropertyIds(db, oxyUserId);

      const [views, savesTotal, viewingBuckets] = await Promise.all([
        countViewsOfProperties(db, propertyIds, since),
        countSavesOfProperties(db, propertyIds, since),
        countViewingsByStatusForOwner(db, oxyUserId, since),
      ]);

      const saves = { total: savesTotal };

      const viewingByStatus: Record<string, number> = {};
      let viewingReceived = 0;
      for (const bucket of viewingBuckets) {
        viewingByStatus[bucket.status] = bucket.count;
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

      // `Property` and `City` stay on Mongo here: the catalogue aggregates
      // below are the property batch's to move, and these two counts join
      // nothing to the saved figures, so a mixed read produces two independent
      // correct numbers rather than an inconsistency.
      //
      // The saved pair moves, because `saved_items` is on Postgres — and
      // `uniqueSavers` was another `distinct('profileId')` against a schema
      // whose column is `oxyUserId`, so it has always been 0.
      const [catalogue, appSaves, pricing, topCities, priceBuckets] = await Promise.all([
        countAppWideCatalogue(getDb()),
        countAppWideSaves(getDb()),
        summarizeCatalogueRent(getDb()),
        findTopCitiesByListings(getDb(), TOP_CITIES_LIMIT),
        countListingsByPriceBucket(getDb(), PRICE_BUCKET_BOUNDARIES),
      ]);

      return res.json(
        successResponse(
          {
            totals: {
              properties: catalogue.properties,
              cities: catalogue.cities,
              saves: appSaves.total,
              uniqueSavers: appSaves.uniqueSavers,
            },
            pricing: {
              averageRent: Math.round(pricing.averageRent),
              minRent: pricing.minRent,
              maxRent: pricing.maxRent,
            },
            topCities: topCities.map((city) => ({
              cityId: city.cityId,
              city: city.city,
              state: city.state,
              properties: city.properties,
              averageRent: Math.round(city.averageRent),
            })),
            priceBuckets: priceBucketLabels(priceBuckets),
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

export default new AnalyticsController();
