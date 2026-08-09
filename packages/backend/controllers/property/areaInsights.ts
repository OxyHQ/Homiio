/**
 * Area price-insights controller.
 *
 * Powers the property-detail "price range in this area" section. Given a target
 * listing it reports how that listing's price compares to SIMILAR homes nearby:
 * min/max/avg/median, a verdict, a price distribution and a set of comparables.
 *
 * Public (no auth) — mirrors the auth posture of the nearby/radius/stats routes
 * in `routes/public.ts`.
 *
 * Like-for-like is preserved: a target is compared only against listings
 * carrying the SAME offering (monthly vs monthly, nightly vs nightly, sale vs
 * sale), so a €/month listing is never mixed with a €/night one. That rule lives
 * in `buildBaseComparableFilter`.
 *
 * ## This file was a 770-line COPY of `services/areaPriceComparison`
 *
 * The two carried ~493 near-identical lines — the same thresholds, scope
 * resolution, aggregates and distribution builder, maintained twice. The
 * service is the single authority (`priceEthicsService` already computes its
 * market verdict through it), so this is now the HTTP wrapper it should always
 * have been, and the comparison logic has one place left to be wrong in.
 *
 * ## The scopes are SQL predicates, not id lists
 *
 * The copy resolved each scope by loading every matching ADDRESS id into an
 * uncapped array and `$in`-ing it against the listings, because Mongo could not
 * join. `radiusScope` / `cityScope` / `neighborhoodScope` are predicates over
 * the address join `propertyReads` already makes, so those intermediate arrays —
 * and the over-fetch-then-re-sort that reproduced their distance ordering — are
 * gone rather than ported.
 */

import type { Request, Response, NextFunction } from 'express';
import type { AreaInsightsBasis, PropertyAreaInsights } from '@homiio/shared-types';

import { AppError, successResponse } from '../../middlewares/errorHandler';
import { findPropertyById } from '../../db/properties/propertyReads';
import { serializeProperty } from '../../db/properties/propertySerializer';
import {
  aggregatePriceStats,
  buildBaseComparableFilter,
  buildComparison,
  buildDistribution,
  buildNeighborhoodContrast,
  buildPricePerSqm,
  buildTargetContext,
  cityScope,
  fetchComparables,
  MIN_RADIUS_SAMPLE,
  PRICE_UNIT_MONTH,
  RADIUS_KM,
  radiusScope,
  type ComparableProperty,
} from '../../services/areaPriceComparison';

/**
 * Outgoing response shape. Field-for-field the shared `PropertyAreaInsights`
 * contract, except `comparables`: the shared type exposes full `Property[]`,
 * while this endpoint returns serialized listings
 * (`Record<string, unknown>[]`). The boundary is narrowed here rather than
 * loosening the shared type.
 */
type AreaInsightsResponse = Omit<PropertyAreaInsights, 'comparables'> & {
  comparables: Record<string, unknown>[];
};

/**
 * The "not enough data" response.
 *
 * Returned when the listing carries no positive price at all: there is no basis
 * to compare against, so a graceful `sampleSize: 0` beats a comparison against
 * zero. The frontend hides the section on that.
 */
function buildEmptyInsights(property: ComparableProperty): AreaInsightsResponse {
  return {
    basis: 'city',
    radiusKm: RADIUS_KM,
    areaLabel: '',
    currency:
      (property.longTermRent?.currency as string | undefined) ??
      (property.shortTermRent?.currency as string | undefined) ??
      (property.sale?.currency as string | undefined) ??
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

/**
 * GET /api/properties/:propertyId/area-insights
 *
 * Never 500s on sparse data — it falls back from a 2 km radius to the whole
 * city, and finally to a target-only "not enough data" response.
 */
export async function getAreaInsights(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { propertyId } = req.params;
    // No id-SHAPE guard. `Types.ObjectId.isValid` answers `false` for every
    // listing minted after the cutover, so this endpoint 400'd on exactly the
    // listings most likely to be looked at. A `text` primary key takes any
    // string and a nonsense id matches no row — see `db/ids.ts`.
    const hydrated = await findPropertyById(propertyId);
    if (!hydrated) {
      return next(new AppError('Property not found', 404, 'NOT_FOUND'));
    }
    const property = serializeProperty(hydrated) as ComparableProperty;

    const targetResult = buildTargetContext(property);
    if ('reason' in targetResult) {
      if (targetResult.reason === 'no_coordinates') {
        return next(
          new AppError('Property is missing address coordinates', 422, 'MISSING_COORDINATES'),
        );
      }
      res.json(
        successResponse(buildEmptyInsights(property), 'Area insights retrieved successfully'),
      );
      return;
    }
    const target = targetResult.context;
    const baseFilter = buildBaseComparableFilter(target);

    // Inherently sequential: the radius stats decide whether the radius scope is
    // dense enough, which decides the scope everything below operates on.
    const radius = radiusScope(target, RADIUS_KM);
    const radiusStats = await aggregatePriceStats(baseFilter, radius, target.priceField);
    const useRadius = (radiusStats?.count ?? 0) >= MIN_RADIUS_SAMPLE;

    const basis: AreaInsightsBasis = useRadius ? 'radius' : 'city';
    const scope = useRadius ? radius : cityScope(target);
    const stats = useRadius
      ? radiusStats
      : await aggregatePriceStats(baseFilter, scope, target.priceField);

    const areaLabel = basis === 'radius' ? (target.neighborhood ?? target.city) : target.city;

    // Independent once the scope is fixed, so they overlap on the wire.
    const [comparables, neighborhoodVsCity] = await Promise.all([
      fetchComparables(baseFilter, scope, {
        longitude: target.longitude,
        latitude: target.latitude,
      }),
      buildNeighborhoodContrast(target, baseFilter),
    ]);

    const response: AreaInsightsResponse = {
      basis,
      radiusKm: RADIUS_KM,
      areaLabel,
      currency: target.currency,
      priceUnit: target.priceUnit,
      sampleSize: stats?.count ?? 0,
      comparison: buildComparison(stats, target.price),
      pricePerSqm: buildPricePerSqm(
        target.squareFootage,
        target.price,
        stats?.avgPricePerSqm ?? null,
      ),
      distribution: buildDistribution(stats, target.price),
      neighborhoodVsCity,
      comparables,
    };

    res.json(successResponse(response, 'Area insights retrieved successfully'));
  } catch (error) {
    next(error);
  }
}
