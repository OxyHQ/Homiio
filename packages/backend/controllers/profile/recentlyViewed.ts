/**
 * Recently-viewed listings, on Postgres.
 *
 * Ported from the Mongo `RecentlyViewed` collection to
 * `db/saved/recentlyViewedRepository.ts`. The collection held 0 documents in
 * production — and, unlike the rest of this domain, that is not because nobody
 * used the feature. See the repository header: the client posted to a route no
 * router served, so every view was a swallowed 404.
 *
 * ## Three things the port changed, all deliberate
 *
 * **The `Profile.findByOxyUserId` guard on `clearRecentProperties` is GONE.** It
 * was not an authorisation check — the delete is already scoped by `oxyUserId`,
 * which is resolved from the session and never from the client — so its only
 * effect was to answer 404 to somebody who owned rows but happened to have no
 * profile document yet. The same guard was dropped from `savedSearches` for the
 * same reason, and the ownership predicate that does the real work is untouched.
 *
 * **The de-duplicating `Map` is gone.** The handler read every view, then folded
 * them into a `Map` keyed by property id, keeping the newest of each. A second
 * row for one `(owner, listing)` pair is unrepresentable under
 * `recently_viewed_owner_property_key`, so the fold could only ever be a no-op —
 * and it was applied AFTER `limit`, which meant a duplicate would have silently
 * shortened the page rather than being corrected.
 *
 * **`debugRecentProperties` is DELETED**, with its route. Every fact it reported
 * was either a `populate()` artefact with no Postgres counterpart
 * (`hasPopulatedProperty`, `populatedKeys`) or already answered by
 * `GET /me/recent-properties`; its `propertyChecks` — "does this property still
 * exist?" — is a question `ON DELETE CASCADE` now answers "yes" by construction.
 * It had no consumer anywhere in the repo.
 */

import type { NextFunction, Request, Response } from 'express';
import { inArray } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { properties } from '../../db/schema';
import { findProperties } from '../../db/properties/propertyReads';
import { serializeProperty } from '../../db/properties/propertySerializer';
import {
  clearRecentlyViewed,
  listRecentlyViewed,
  trackPropertyView as trackPropertyViewRow,
  ViewedPropertyNotFoundError,
} from '../../db/saved/recentlyViewedRepository';
import { getQueryInteger } from '../queryParams';
import { errorResponse, successResponse } from './shared';

/** What `GET /me/recent-properties` returns when the caller names no limit. */
const DEFAULT_RECENT_LIMIT = 10;

/**
 * The most rows one request may ask for.
 *
 * Mongo's `parseInt(limit)` was unbounded, so `?limit=1000000` hydrated a
 * million listings — and hydration here is a catalogue read with four joins and
 * three batched child queries, not a `find()`. The cap is the response's bound;
 * the TABLE's bound is the 90-day retention sweep (see the repository header).
 */
const MAX_RECENT_LIMIT = 100;

/** Resolve the owner from the session, in the shape the auth layer sets. */
function ownerOf(req: Request): string | undefined {
  return req.user?.id || req.user?._id || undefined;
}

/**
 * Get recently viewed properties for the current user's profile
 */
export async function getRecentProperties(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    // `getQueryInteger` already floors at 1 by falling back on a non-positive
    // value, so only the ceiling has to be applied here.
    const limit = Math.min(
      getQueryInteger(req.query.limit, DEFAULT_RECENT_LIMIT),
      MAX_RECENT_LIMIT,
    );

    const views = await listRecentlyViewed(getDb(), oxyUserId, limit);
    if (views.length === 0) {
      return res.json(successResponse([], "Recent properties retrieved successfully"));
    }

    const hydrated = await findProperties({
      where: inArray(properties.id, views.map((view) => view.propertyId)),
    });
    const byId = new Map(hydrated.map((entry) => [entry.property.id, entry]));

    // Ordered by `views`, not by the catalogue read: most recently opened first.
    const recent = views.flatMap((view) => {
      const listing = byId.get(view.propertyId);
      // Only reachable if a listing is deleted BETWEEN the two statements above;
      // the foreign key rules out every other case.
      if (!listing) return [];
      return [{ ...serializeProperty(listing), viewedAt: view.viewedAt }];
    });

    res.json(successResponse(recent, "Recent properties retrieved successfully"));
  } catch (error) {
    next(error);
  }
}

/**
 * Track property view for the current user's profile
 */
export async function trackPropertyView(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);
    const { propertyId } = req.params;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (!propertyId) {
      return res.status(400).json(
        errorResponse("Property ID is required", "PROPERTY_ID_REQUIRED")
      );
    }

    try {
      await trackPropertyViewRow(getDb(), oxyUserId, propertyId);
    } catch (error) {
      if (error instanceof ViewedPropertyNotFoundError) {
        return res.status(404).json(
          errorResponse("Property not found", "PROPERTY_NOT_FOUND")
        );
      }
      throw error;
    }

    res.json(successResponse(null, "Property view tracked successfully"));
  } catch (error) {
    next(error);
  }
}

/**
 * Clear recently viewed properties for the current user's profile
 */
export async function clearRecentProperties(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    const deletedCount = await clearRecentlyViewed(getDb(), oxyUserId);

    res.json(successResponse({ deletedCount }, "Recently viewed properties cleared successfully"));
  } catch (error) {
    next(error);
  }
}
