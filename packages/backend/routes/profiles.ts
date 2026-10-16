/**
 * Profile Routes
 * API routes for the RE sidecar profile (one per oxyUserId).
 */

import express from 'express';
// The real owner. `controllers/profileController` was an empty class with these
// handlers copied onto it at runtime and typed `unknown`, so every call below
// was untyped; it is gone.
import * as profileController from '../controllers/profile';
import exchangeReviewController from '../controllers/exchangeReviewController';
import { asyncHandler } from '../middlewares';
import performanceMonitor from '../middlewares/performance';
import { consumeFileCredit, readAccountEntitlements } from '../domain/entitlements';
import { AppError } from '../middlewares/errorHandler';

export default function () {
  const router = express.Router();

  router.use(performanceMonitor);

  router.get('/', asyncHandler(profileController.getOrCreateProfile));
  router.get('/me', asyncHandler(profileController.getOrCreateProfile));
  router.put('/me', asyncHandler(profileController.updateMyProfile));
  router.get('/me/recent-properties', asyncHandler(profileController.getRecentProperties));
  // The recently-viewed WRITE. It used to live only at
  // `POST /api/properties/:propertyId/track-view`, which no client called, while
  // `services/recentlyViewedService` posted here — to a route no router served.
  // Both spellings are now mounted on the same handler; the upsert is idempotent
  // per (owner, listing), so which one a client uses cannot matter.
  router.post(
    '/me/recent-properties/:propertyId',
    asyncHandler(profileController.trackPropertyView),
  );
  router.delete('/me/recent-properties', asyncHandler(profileController.clearRecentProperties));
  router.get('/me/saved-properties', asyncHandler(profileController.getSavedProperties));
  router.post('/me/save-property', asyncHandler(profileController.saveProperty));
  router.delete('/me/saved-properties/:propertyId', asyncHandler(profileController.unsaveProperty));
  router.patch(
    '/me/saved-properties/:propertyId/notes',
    asyncHandler(profileController.updateSavedPropertyNotes),
  );

  /** The session's Oxy user id, or undefined: these two answer their own 401. */
  const sessionUserId = (req: unknown): string | undefined =>
    (req as { user?: { id?: string; _id?: string } }).user?.id ||
    (req as { user?: { id?: string; _id?: string } }).user?._id;

  router.get(
    '/me/entitlements',
    asyncHandler(async (req, res) => {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.set('Pragma', 'no-cache');
      res.set('Expires', '0');
      const oxyUserId = sessionUserId(req);
      if (!oxyUserId)
        return res
          .status(401)
          .json({ success: false, error: { message: 'Authentication required' } });
      return res.json({ success: true, entitlements: await readAccountEntitlements(oxyUserId) });
    }),
  );

  router.post(
    '/me/entitlements/consume-file-credit',
    asyncHandler(async (req, res) => {
      const oxyUserId = sessionUserId(req);
      if (!oxyUserId)
        return res
          .status(401)
          .json({ success: false, error: { message: 'Authentication required' } });
      try {
        const result = await consumeFileCredit(oxyUserId);
        return res.json({ success: true, remaining: result.remaining, consumed: result.consumed });
      } catch (error) {
        if (error instanceof AppError && error.code === 'NO_CREDITS') {
          return res
            .status(402)
            .json({ success: false, error: { message: error.message, code: error.code } });
        }
        throw error;
      }
    }),
  );

  router.get('/me/saved-property-folders', asyncHandler(profileController.getSavedPropertyFolders));
  router.post(
    '/me/saved-property-folders',
    asyncHandler(profileController.createSavedPropertyFolder),
  );
  router.put(
    '/me/saved-property-folders/:folderId',
    asyncHandler(profileController.updateSavedPropertyFolder),
  );
  router.delete(
    '/me/saved-property-folders/:folderId',
    asyncHandler(profileController.deleteSavedPropertyFolder),
  );
  router.get('/me/saved-searches', asyncHandler(profileController.getSavedSearches));
  router.post('/me/saved-searches', asyncHandler(profileController.saveSearch));
  router.delete('/me/saved-searches/:searchId', asyncHandler(profileController.deleteSavedSearch));
  router.put('/me/saved-searches/:searchId', asyncHandler(profileController.updateSavedSearch));
  router.put(
    '/me/saved-searches/:searchId/notifications',
    asyncHandler(profileController.toggleSearchNotifications),
  );
  // The alert history — declared BEFORE nothing, but kept next to the watches it
  // belongs to. `/me/alerts/:alertId` is the "why did I get this?" read.
  router.get('/me/alerts', asyncHandler(profileController.getHousingAlerts));
  router.get('/me/alerts/:alertId', asyncHandler(profileController.getHousingAlert));
  router.get('/oxy/:oxyUserId', asyncHandler(profileController.getProfileByOxyUserId));
  router.get(
    '/oxy/:oxyUserId/exchange-reviews',
    asyncHandler(exchangeReviewController.getProfileExchangeReviews),
  );

  return router;
}
