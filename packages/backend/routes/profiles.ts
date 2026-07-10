/**
 * Profile Routes
 * API routes for the RE sidecar profile (one per oxyUserId).
 */

import express from 'express';
const profileController = require('../controllers/profileController');
const exchangeReviewController = require('../controllers/exchangeReviewController');
import { asyncHandler } from '../middlewares';
import performanceMonitor from '../middlewares/performance';

export default function () {
  const router = express.Router();

  router.use(performanceMonitor);

  router.get('/', asyncHandler(profileController.getOrCreateProfile));
  router.get('/me', asyncHandler(profileController.getOrCreateProfile));
  router.put('/me', asyncHandler(profileController.updateMyProfile));
  router.get('/me/recent-properties', asyncHandler(profileController.getRecentProperties));
  router.get('/me/recent-properties/debug', asyncHandler(profileController.debugRecentProperties));
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

    const { Billing } = require('../models');
    const billing = await Billing.findOne({ oxyUserId }).lean();

    const entitlements = billing || {
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
    const { Billing } = require('../models');

    let billing = await Billing.findOne({ oxyUserId });
    if (!billing) {
      billing = new Billing({
        oxyUserId,
        plusActive: false,
        fileCredits: 0,
        processedSessions: [],
      });
      await billing.save();
    }

    const hasPlus = !!billing.plusActive;
    if (hasPlus) return res.json({ success: true, remaining: 'unlimited', consumed: false });

    if ((billing.fileCredits || 0) <= 0) {
      return res.status(402).json({ success: false, error: { message: 'No file credits', code: 'NO_CREDITS' }});
    }

    const result = await billing.consumeFileCredit();
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
  router.get('/oxy/:oxyUserId', asyncHandler(profileController.getProfileByOxyUserId));
  router.get('/oxy/:oxyUserId/exchange-reviews', asyncHandler(exchangeReviewController.getProfileExchangeReviews));

  return router;
}
