/**
 * Public Routes (No Authentication Required)
 * These routes can be accessed without authentication
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import neighborhoodRoutes from './neighborhoods';
import cityController from '../controllers/cityController';
import imageController from '../controllers/imageController';
import geocodingController from '../controllers/geocodingController';
import * as geoController from '../controllers/geoController';
import { getHomeSections } from '../controllers/home/homeSectionsController';
import { rateLimitKeyFor } from '../middlewares/rateLimitKey';
import observabilityController from '../controllers/observabilityController';
import * as propertyController from '../controllers/property';
import telegramController from '../controllers/telegramController';
import analyticsController from '../controllers/analyticsController';
import * as reviewController from '../controllers/reviewController';
import { asyncHandler } from '../middlewares';
import { serializeWireIds } from '../middlewares/wireIds';
import performanceMonitor from '../middlewares/performance';
import { findConversationByShareToken } from '../db/conversations/conversationRepository';
import { toSharedConversationDTO } from '../db/conversations/conversationSerializer';
import { getDb } from '../db/postgres';
import * as profileController from '../controllers/profile';
import * as evictionController from '../controllers/eviction';

const PROPERTY_ADJUSTMENTS = {
  studio: 0.8,
  room: 0.6,
  apartment: 1.0,
  house: 1.2,
};

/**
 * The geo budget, per caller per 15 minutes.
 *
 * Sized for a person typing rather than for a screen's fan-out: at a 300 ms
 * debounce an engaged searcher issues single-digit requests per minute, and 300
 * leaves generous room for several sessions while stopping a script from
 * spending Homiio's whole provider allowance. It is deliberately far below the
 * global anonymous budget, because a geo call leaves Homiio's network and is
 * counted against Homiio by the provider — the cost is not ours to absorb.
 *
 * The backend does not rely on the client's debounce for any of this. A
 * debounce is absent from a script, a replay, or an app binary shipped last
 * year; the limiter and the input validation are the actual boundary.
 */
const GEO_RATE_LIMIT_MAX = 300;
const GEO_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

const geoLimiter = rateLimit({
  windowMs: GEO_RATE_LIMIT_WINDOW_MS,
  max: GEO_RATE_LIMIT_MAX,
  // Its own namespace, so the geo budget and the global API budget cannot
  // consume one another.
  keyGenerator: (req) => rateLimitKeyFor(req, 'geo'),
  standardHeaders: true,
  legacyHeaders: false,
});

function getPropertyAdjustmentFactor(propertyType: unknown): number {
  switch (propertyType) {
    case 'studio':
      return PROPERTY_ADJUSTMENTS.studio;
    case 'room':
      return PROPERTY_ADJUSTMENTS.room;
    case 'apartment':
      return PROPERTY_ADJUSTMENTS.apartment;
    case 'house':
      return PROPERTY_ADJUSTMENTS.house;
    default:
      return 1.0;
  }
}

export default function () {
  const router = express.Router();

  // FIRST, so every body below leaves as `id` and never `_id`. See wireIds.ts.
  router.use(serializeWireIds);

  // Performance monitoring for all routes
  router.use(performanceMonitor);

  // Public property routes
  router.get('/properties', asyncHandler(propertyController.getProperties));
  router.get('/properties/search', asyncHandler(propertyController.searchProperties));
  router.get('/properties/by-ids', asyncHandler(propertyController.getPropertiesByIds));
  router.get('/properties/nearby', asyncHandler(propertyController.findNearbyProperties));
  router.get('/properties/radius', asyncHandler(propertyController.findPropertiesInRadius));
  router.get('/properties/:propertyId', asyncHandler(propertyController.getPropertyById));
  router.get('/properties/:propertyId/stats', asyncHandler(propertyController.getPropertyStats));
  router.get('/properties/:propertyId/area-insights', asyncHandler(propertyController.getAreaInsights));
  router.get('/properties/:propertyId/nearby-services', asyncHandler(propertyController.getPropertyNearbyServices));

  // ── Geo gateway (#351, ADR 0002 §14.1) ──────────────────────────────────
  //
  // The only thing in Homiio that asks a geocoder a question on behalf of a
  // person. Public on purpose: somebody typing a city name has not signed in
  // yet, and requiring auth would push every screen back to a device-side
  // geocoder, which is exactly what this replaces.
  //
  // Its own rate limiter, tighter than the global one, because these calls
  // leave Homiio's network and are counted against Homiio by the provider —
  // unlike the rest of `/api`, where the cost of an extra request is a database
  // read. The key is the same privacy-preserving one the global limiter uses
  // (`middlewares/rateLimitKey.ts`): a user id when there is one, otherwise a
  // salted HMAC of the normalized IP, so no user IP is held at rest.
  router.use('/geo', geoLimiter);
  // The Home surface, in ONE request (#353). Public: Home works logged out, and
  // every section it serves is public listing data. The saved and
  // recently-viewed bands stay CLIENT side precisely so this endpoint needs no
  // session — a surface that 401s on cold start is a surface that shows nothing.
  router.get('/home/sections', asyncHandler(getHomeSections));

  router.get('/geo/search', asyncHandler(geoController.search));
  router.get('/geo/resolve', asyncHandler(geoController.resolve));
  router.get('/geo/reverse', asyncHandler(geoController.reverse));

  // The ADDRESS-FORM endpoints, kept and NOT superseded by `/api/geo/*`.
  //
  // These return `GeocodedAddress` — street, house number, postal code — which
  // `GeoPlace` deliberately cannot carry, because a country has no street. The
  // map's pin-drop feeds the review, property-creation and eviction forms, and
  // the review form cannot advance without a street, so pointing them at
  // `/api/geo/reverse` would silently empty three forms. They now run on the
  // same provider layer, cache and OSM-policy queue as the gateway; nothing
  // here talks to a provider directly.
  //
  // They are rate-limited alongside `/geo` rather than separately: the budget
  // that matters is calls leaving Homiio, and these leave by the same door.
  router.use('/geocoding', geoLimiter);
  router.get('/geocoding/reverse', asyncHandler(geocodingController.reverseGeocode));
  router.get('/geocoding/forward', asyncHandler(geocodingController.forwardGeocode));

  // Privacy-safe product observability ingest (#350). Unauthenticated on
  // purpose — the first-open, permission and geocoder-fallback events this
  // exists to see all happen before anybody signs in. See the controller
  // header; it always answers 202 and reads nothing from `req.user`.
  router.post('/observability/events', asyncHandler(observabilityController.ingestEvents));

  // Public review READ routes (community notes). These are community-visible
  // building/unit reviews surfaced on the property-detail screen — the
  // controllers read only `req.params`/`req.query` and never touch `req.user`,
  // so they belong here next to `area-insights` rather than behind `oxy.auth()`.
  // Review WRITES (POST/PUT/DELETE) stay on the authenticated `/reviews` router.
  router.get('/reviews/address/:addressId', asyncHandler(reviewController.getReviewsByAddress));
  router.get('/reviews/address/:addressId/stats', asyncHandler(reviewController.getAddressReviewStats));

  // Public review-explore aggregations (cities → neighborhoods → buildings).
  // Coverage-only stats; no per-review reads here. Declared as distinct literal
  // segments so they don't collide with `/reviews/address/...` above.
  router.get('/reviews/explore', asyncHandler(reviewController.getExploreCities));
  router.get('/reviews/explore/city/:cityId', asyncHandler(reviewController.getExploreCity));
  router.get('/reviews/explore/neighborhood/:neighborhoodId', asyncHandler(reviewController.getExploreNeighborhood));

  // Public agency profile reads. `/agencies/search` is declared BEFORE the
  // `/agencies/:slug` catch so "search" is never captured as a slug.
  router.get('/agencies/search', asyncHandler(reviewController.searchAgencies));
  router.get('/agencies/:slug', asyncHandler(reviewController.getAgencyBySlug));
  router.get('/agencies/:slug/reviews', asyncHandler(reviewController.getAgencyReviews));
  router.get('/agencies/:slug/properties', asyncHandler(reviewController.getAgencyProperties));

  // Public self-hosted image store: serve a processed image's bytes by its
  // bucket-relative key (used when object storage is not configured). Images are
  // public assets — render-time photos must load without a token — so this lives
  // on the public router. Mounted before `/cities` etc.; the wildcard captures
  // the full key, e.g. GET /api/images/file/city/<uuid>-medium.webp.
  router.get('/images/file/*', asyncHandler(imageController.serveLocalImage.bind(imageController)));

  // Public city routes
  router.get('/cities', asyncHandler(cityController.getCities));
  router.get('/cities/popular', asyncHandler(cityController.getPopularCities));
  router.get('/cities/search', asyncHandler(cityController.searchCities));
  router.get('/cities/lookup', asyncHandler(cityController.lookupCity));
  router.get('/cities/:id', asyncHandler(cityController.getCityById));
  router.get('/cities/:id/properties', asyncHandler(cityController.getPropertiesByCity));

  // Public neighborhood routes (metrics derived from Homiio listings)
  router.use('/neighborhoods', neighborhoodRoutes());

  // Public eviction solidarity board reads (no auth; optionalAuth still runs
  // before public routes so a signed-in viewer's `isAttending` is resolved).
  // Writes + caller-scoped lists live on the authenticated `/evictions` router,
  // and so does `GET /evictions/:id/location/exact` — the only endpoint that
  // returns an exact coordinate, which would return one to anybody from here.
  //
  // `/evictions/resources` is declared BEFORE `/evictions/:id` so `resources` is
  // not swallowed by the id matcher.
  router.get('/evictions', asyncHandler(evictionController.listEvictions));
  router.get('/evictions/resources', asyncHandler(evictionController.listResources));
  router.get('/evictions/:id/comments', asyncHandler(evictionController.listComments));
  router.get('/evictions/:id', asyncHandler(evictionController.getEvictionById));

  // Public analytics/stats (no auth)
  router.get('/analytics/stats', asyncHandler(analyticsController.getAppStats));

  // Ethical pricing calculation endpoint (public - no authentication required)
  router.post('/properties/calculate-ethical-pricing', asyncHandler(async (req, res) => {
    const { localMedianIncome, areaAverageRent, propertyType } = req.body;

    // Validate required fields
    if (!localMedianIncome || !areaAverageRent) {
      return res.status(400).json({
        success: false,
        message: 'Local median income and area average rent are required'
      });
    }

    if (localMedianIncome <= 0 || areaAverageRent <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Income and rent values must be positive numbers'
      });
    }

    // Calculate monthly income
    const monthlyMedianIncome = localMedianIncome / 12;
    
    // Adjust percentages based on income level - lower incomes need higher housing percentages
    let standardRentPercentage, affordableRentPercentage, communityRentPercentage;
    
    if (monthlyMedianIncome < 2000) {
      // Lower income: higher percentage needed for housing
      standardRentPercentage = 0.65; // 65% for very low income
      affordableRentPercentage = 0.55; // 55% for affordable
      communityRentPercentage = 0.45; // 45% for community
    } else if (monthlyMedianIncome < 4000) {
      // Moderate income
      standardRentPercentage = 0.5; // 50%
      affordableRentPercentage = 0.4; // 40%
      communityRentPercentage = 0.35; // 35%
    } else if (monthlyMedianIncome < 8000) {
      // Higher income
      standardRentPercentage = 0.4; // 40%
      affordableRentPercentage = 0.35; // 35%
      communityRentPercentage = 0.3; // 30%
    } else {
      // High income: can afford lower percentages
      standardRentPercentage = 0.35; // 35%
      affordableRentPercentage = 0.3; // 30%
      communityRentPercentage = 0.25; // 25%
    }

    // Calculate ethical pricing suggestions
    const suggestions = {
      standardRent: Math.round(monthlyMedianIncome * standardRentPercentage),
      affordableRent: Math.round(monthlyMedianIncome * affordableRentPercentage),
      marketRate: areaAverageRent,
      reducedDeposit: Math.round(monthlyMedianIncome * standardRentPercentage),
      communityRent: Math.round(monthlyMedianIncome * communityRentPercentage),
      slidingScaleBase: Math.round(monthlyMedianIncome * (communityRentPercentage - 0.1)),
      slidingScaleMax: Math.round(monthlyMedianIncome * (standardRentPercentage + 0.1)),
      marketAdjustedRent: Math.round(Math.min(areaAverageRent * 0.9, monthlyMedianIncome * 0.7)),
      incomeBasedRent: Math.round(monthlyMedianIncome * 0.7),
    };

    // Validate suggestions against market rate
    const isMarketRateReasonable = areaAverageRent >= suggestions.affordableRent * 0.7 && 
                                  areaAverageRent <= suggestions.standardRent * 2.0;

    // Provide market context
    const rentToIncomeRatio = (areaAverageRent / monthlyMedianIncome) * 100;
    let marketContext = '';
    
    if (rentToIncomeRatio < 25) {
      marketContext = 'Very affordable market';
    } else if (rentToIncomeRatio < 35) {
      marketContext = 'Affordable market';
    } else if (rentToIncomeRatio < 45) {
      marketContext = 'Moderate market';
    } else if (rentToIncomeRatio < 55) {
      marketContext = 'Expensive market';
    } else {
      marketContext = 'Very expensive market';
    }

    // Generate warnings if needed
    const warnings = [];
    if (!isMarketRateReasonable) {
      if (areaAverageRent < suggestions.affordableRent * 0.7) {
        warnings.push('Market rate seems unusually low compared to local income');
      } else {
        warnings.push('Market rate seems unusually high compared to local income');
      }
    }

    const adjustmentFactor = getPropertyAdjustmentFactor(propertyType);
    const adjustedSuggestions = {
      standardRent: Math.round(suggestions.standardRent * adjustmentFactor),
      affordableRent: Math.round(suggestions.affordableRent * adjustmentFactor),
      marketRate: suggestions.marketRate,
      reducedDeposit: suggestions.reducedDeposit,
      communityRent: Math.round(suggestions.communityRent * adjustmentFactor),
      slidingScaleBase: Math.round(suggestions.slidingScaleBase * adjustmentFactor),
      slidingScaleMax: Math.round(suggestions.slidingScaleMax * adjustmentFactor),
      marketAdjustedRent: Math.round(suggestions.marketAdjustedRent * adjustmentFactor),
      incomeBasedRent: Math.round(suggestions.incomeBasedRent * adjustmentFactor),
    };

    res.json({
      success: true,
      data: {
        suggestions: adjustedSuggestions,
        marketContext,
        warnings,
        calculations: {
          monthlyMedianIncome,
          rentToIncomeRatio: Math.round(rentToIncomeRatio * 100) / 100,
          standardRentPercentage: Math.round(standardRentPercentage * 100),
          affordableRentPercentage: Math.round(affordableRentPercentage * 100),
          communityRentPercentage: Math.round(communityRentPercentage * 100),
        }
      }
    });
  }));

  // Public Telegram routes (for testing and bot management)
  router.get('/telegram/status', asyncHandler(telegramController.getBotStatus));
  router.get('/telegram/groups/:city', asyncHandler(telegramController.getGroupMapping));
  router.get('/telegram/webhook', asyncHandler(telegramController.getWebhookInfo));
  router.post('/telegram/test', asyncHandler(telegramController.sendTestMessage));

  // Public profile route (read-only). The handlers come from the top-level
  // `profileController` namespace import; the local `require` this replaced was
  // still pointing at a module that has been deleted, and no typechecker could
  // see that because `require()` is opaque to one.
  router.get('/public/profiles/by-user/:oxyUserId', asyncHandler(profileController.getPublicProfileByOxyUserId));
  router.get('/public/profiles/oxy/:oxyUserId', asyncHandler(profileController.getProfileByOxyUserId));

  // Public shared conversation endpoint (no authentication required).
  //
  // The freshness check is in the QUERY (`findConversationByShareToken` requires
  // `is_shared`, a non-null token and a deadline in the future), so an expired
  // link is 404 whether or not the share-link sweep has run since. That is what
  // keeps the sweep pure housekeeping rather than a correctness dependency —
  // and it is why Mongo's TTL index, which deleted the whole conversation 24
  // hours after anybody shared it, was never needed for this route to be right.
  //
  // The `try/catch` that used to swallow every failure into a 500 is gone:
  // `asyncHandler` forwards to `errorHandler`, which is the one place that
  // decides what a caller sees.
  router.get('/ai/shared/:token', asyncHandler(async (req, res) => {
    const hydrated = await findConversationByShareToken(getDb(), String(req.params.token || ''));
    if (!hydrated) {
      return res.status(404).json({ error: 'Shared conversation not found or expired' });
    }
    res.json({ success: true, conversation: toSharedConversationDTO(hydrated) });
  }));

  return router;
}; 
