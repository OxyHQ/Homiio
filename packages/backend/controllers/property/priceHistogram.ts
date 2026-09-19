/**
 * `GET /api/properties/search/price-histogram` — the price distribution of a
 * search's scope, for the bars under its price slider.
 *
 * ## A sibling endpoint, not an `include=` on search
 *
 * It takes EXACTLY the search endpoint's params and resolves them through the
 * same `resolveSearchScope`, so the two describe one set of homes. It is not
 * folded into the search response because the two answers key differently: the
 * histogram deliberately ignores the price bounds, so it must not refetch every
 * time a thumb is released, while the result page must. The filters dialog's
 * count is the search endpoint keyed by the draft INCLUDING its price, and the
 * results screen reuses that exact cache entry on apply — an extra `include`
 * param on the dialog's request would split that key and fetch the page twice.
 * As a sibling, a slider drag costs one search request and zero histogram
 * requests.
 *
 * ## The price bounds are ignored ON PURPOSE
 *
 * `priceMin`/`priceMax`, their `minRent`/`maxRent` aliases and
 * `minSalePrice`/`maxSalePrice` are stripped before the scope is resolved.
 * The histogram answers "where do prices sit in this area, for these homes", and
 * narrowing it to the selected range would erase the bars outside the thumbs
 * the moment they move.
 *
 * ## Extra params (ADR 0002 §14.2)
 *
 *  - `histogramMin`, `histogramMax` — the span the buckets split. A slider sends
 *    its own track so each bar sits over the prices it counts. Default: the
 *    lowest price in scope and its 98th percentile.
 *  - `histogramBuckets` — how many buckets, clamped to 8..40, default 24.
 *  - `currency` — ISO 4217; default the scope's most common. See
 *    `db/properties/priceHistogram.ts` for why one currency only.
 *
 * `exchange` has no monetary price, so it answers `priceHistogram: null`. An
 * unresolved place answers the search's own `location.status: 'unresolved'`
 * and `priceHistogram: null` — never the distribution of the whole catalogue
 * (ADR 0002 §4.3).
 */

import type { NextFunction, Request, Response } from 'express';
import { OfferingType, parseListingCurrency } from '@homiio/shared-types';

import { priceHistogramForScope } from '../../db/properties/priceHistogram';
import { logger } from '../../middlewares/logging';
import { resolveSearchScope, sendGeoParamError } from './search';
import {
  currencyColumnForOffering,
  DEFAULT_PRICE_COLUMN,
  parseFloatParam,
  parseIntParam,
  priceColumnForOffering,
} from './searchQueryBuilder';
import { describeErrorForLog } from '../../middlewares/errorHandler';

export const DEFAULT_HISTOGRAM_BUCKETS = 24;
export const MIN_HISTOGRAM_BUCKETS = 8;
export const MAX_HISTOGRAM_BUCKETS = 40;

/** Every price-bound param the search accepts — none of them narrows a histogram. */
const PRICE_BOUND_PARAMS = ['priceMin', 'priceMax', 'minRent', 'maxRent', 'minSalePrice', 'maxSalePrice'] as const;

type RawQuery = Record<string, string | string[] | undefined>;

function badRequest(res: Response, message: string): void {
  res.status(400).json({ success: false, message, error: 'INVALID_HISTOGRAM' });
}

export async function getSearchPriceHistogram(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const raw = req.query as RawQuery;

    const histogramMin = parseFloatParam(raw.histogramMin);
    const histogramMax = parseFloatParam(raw.histogramMax);
    if ((histogramMin !== undefined && histogramMin < 0) || (histogramMax !== undefined && histogramMax < 0)) {
      badRequest(res, 'histogramMin and histogramMax must not be negative');
      return;
    }
    if (histogramMin !== undefined && histogramMax !== undefined && histogramMax <= histogramMin) {
      badRequest(res, 'histogramMax must be greater than histogramMin');
      return;
    }
    const requestedBuckets = parseIntParam(raw.histogramBuckets) ?? DEFAULT_HISTOGRAM_BUCKETS;
    const bucketCount = Math.min(MAX_HISTOGRAM_BUCKETS, Math.max(MIN_HISTOGRAM_BUCKETS, requestedBuckets));
    // Checked against the vocabulary the COLUMN holds, not against a shape.
    // The old `^[A-Z]{3}$` accepted any three letters — so `currency=XYZ` was
    // answered with a silent `null` histogram that reads as "nothing here" —
    // and rejected `FAIR`, which is a real four-character code on the exchange
    // listings. `parseListingCurrency` is the same reader the price filter uses.
    const currencyRaw = typeof raw.currency === 'string' ? raw.currency.trim() : undefined;
    const currency = parseListingCurrency(currencyRaw);
    if (currencyRaw !== undefined && currencyRaw !== '' && currency === undefined) {
      badRequest(res, 'currency must be a currency Homiio lists prices in');
      return;
    }

    const scopeQuery: RawQuery = { ...raw };
    for (const param of PRICE_BOUND_PARAMS) delete scopeQuery[param];

    let scope: Awaited<ReturnType<typeof resolveSearchScope>>;
    try {
      scope = await resolveSearchScope(scopeQuery);
    } catch (error) {
      if (sendGeoParamError(res, error)) return;
      throw error;
    }

    const envelope = {
      success: true,
      location: scope.location,
      ...(scope.params.queryId === undefined ? {} : { queryId: scope.params.queryId }),
    };

    const { offering } = scope.params;
    if (scope.status === 'unresolved' || offering === OfferingType.EXCHANGE) {
      res.json({ ...envelope, priceHistogram: null });
      return;
    }

    const priceHistogram = await priceHistogramForScope({
      where: scope.where,
      priceColumn: priceColumnForOffering(offering) ?? DEFAULT_PRICE_COLUMN,
      currencyColumn: currencyColumnForOffering(offering),
      bucketCount,
      currency,
      min: histogramMin,
      max: histogramMax,
    });

    res.json({
      ...envelope,
      priceHistogram: priceHistogram && {
        offering: offering ?? OfferingType.LONG_TERM_RENT,
        ...priceHistogram,
      },
    });
  } catch (error) {
    // Parameter NAMES only, never values — the same rule as the search endpoint
    // (a `lat`/`lng` here can be a device fix; ADR 0002 §8.2).
    logger.error('Property search price histogram failed', {
      error: describeErrorForLog(error),
      queryParams: Object.keys(req.query).sort(),
    });
    next(error);
  }
}
