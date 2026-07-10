/**
 * Neighborhood Routes (public reads)
 *
 * Neighborhood metrics over the DB-owned relational geo layer. All reads are
 * public (no auth) — mounted under the public router in `routes/public.ts`,
 * alongside `cities` and `area-insights`. Static routes are declared before the
 * dynamic `/by-property/:propertyId` so they are never shadowed.
 */

import express from 'express';
import { asyncHandler } from '../middlewares';
import {
  getNeighborhoodByLocation,
  getNeighborhoodByName,
  getNeighborhoodByProperty,
  searchNeighborhoods,
  getPopularNeighborhoods,
} from '../controllers/neighborhoodController';

export default function () {
  const router = express.Router();

  router.get('/by-location', asyncHandler(getNeighborhoodByLocation));
  router.get('/by-name', asyncHandler(getNeighborhoodByName));
  router.get('/search', asyncHandler(searchNeighborhoods));
  router.get('/popular', asyncHandler(getPopularNeighborhoods));
  router.get('/by-property/:propertyId', asyncHandler(getNeighborhoodByProperty));

  return router;
}
