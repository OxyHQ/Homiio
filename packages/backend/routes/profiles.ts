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
import {
  consumeFileCredit,
  ensureBilling,
  readEntitlements,
} from '../db/billing/billingRepository';

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
  router.post('/me/recent-properties/:propertyId', asyncHandler(profileController.trackPropertyView));
  router.delete('/me/recent-properties', asyncHandler(profileController.clearRecentProperties));
  router.get('/me/saved-properties', asyncHandler(profileController.getSavedProperties));
  router.post('/me/save-property', asyncHandler(profileController.saveProperty));
  router.delete('/me/saved-properties/:propertyId', asyncHandler(profileController.unsaveProperty));
  router.patch('/me/saved-properties/:propertyId/notes', asyncHandler(profileController.updateSavedPropertyNotes));

  router.get('/me/entitlements', asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    const oxyUserId = (req as { user?: { id?: string; _id?: string } }).user?.id
      || (req as { user?: { id?: string; _id?: string } }).user?._id;
    if (!oxyUserId) return res.status(401).json({ success: false, error: { message: 'Authentication required' }});

    // A person who has never paid has no row, and that is not an error — the
    // zeroed shape below is what the client reads. Deliberately NOT created on
    // read: an entitlements GET that mints a billing row would put a write on
    // every page load.
    const entitlements = (await readEntitlements(oxyUserId)) ?? {
      plusActive: false,
      fileCredits: 0,
      founderSupporter: false,
      processedSessions: [],
    };

    return res.json({ success: true, entitlements });
  }));

  router.post('/me/entitlements/consume-file-credit', asyncHandler(async (req, res) => {
    const oxyUserId = (req as { user?: { id?: string; _id?: string } }).user?.id
      || (req as { user?: { id?: string; _id?: string } }).user?._id;
    if (!oxyUserId) return res.status(401).json({ success: false, error: { message: 'Authentication required' }});

    // Created on first spend rather than on read: this endpoint is a write
    // either way, so it is the honest place for the row to appear.
    await ensureBilling(oxyUserId);

    // ONE guarded statement decides all three outcomes. The Mongo version read
    // the record, checked `fileCredits > 0`, and then decremented — so two
    // concurrent requests could each see 1 and each spend it. `consumeFileCredit`
    // carries the predicate into the UPDATE, so the guard and the write cannot
    // interleave, and "no row updated" IS the out-of-credits answer.
    const result = await consumeFileCredit(oxyUserId);
    if (!result.consumed && result.remaining !== 'unlimited') {
      return res.status(402).json({ success: false, error: { message: 'No file credits', code: 'NO_CREDITS' }});
    }

    return res.json({
      success: true,
      remaining: result.remaining,
      consumed: result.consumed,
    });
  }));

  router.get('/me/saved-property-folders', asyncHandler(profileController.getSavedPropertyFolders));
  router.post('/me/saved-property-folders', asyncHandler(profileController.createSavedPropertyFolder));
  router.put('/me/saved-property-folders/:folderId', asyncHandler(profileController.updateSavedPropertyFolder));
  router.delete('/me/saved-property-folders/:folderId', asyncHandler(profileController.deleteSavedPropertyFolder));
  router.get('/me/saved-searches', asyncHandler(profileController.getSavedSearches));
  router.post('/me/saved-searches', asyncHandler(profileController.saveSearch));
  router.delete('/me/saved-searches/:searchId', asyncHandler(profileController.deleteSavedSearch));
  router.put('/me/saved-searches/:searchId', asyncHandler(profileController.updateSavedSearch));
  router.put('/me/saved-searches/:searchId/notifications', asyncHandler(profileController.toggleSearchNotifications));
  // The alert history — declared BEFORE nothing, but kept next to the watches it
  // belongs to. `/me/alerts/:alertId` is the "why did I get this?" read.
  router.get('/me/alerts', asyncHandler(profileController.getHousingAlerts));
  router.get('/me/alerts/:alertId', asyncHandler(profileController.getHousingAlert));
  router.get('/oxy/:oxyUserId', asyncHandler(profileController.getProfileByOxyUserId));
  router.get('/oxy/:oxyUserId/exchange-reviews', asyncHandler(exchangeReviewController.getProfileExchangeReviews));

  return router;
}
