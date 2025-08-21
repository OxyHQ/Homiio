/**
 * Profile Routes
 * API routes for profile management
 */

import express from "express";
const profileController = require("../controllers/profileController");
import { asyncHandler } from "../middlewares";
import performanceMonitor from "../middlewares/performance";

export default function () {
  const router = express.Router();

  // Performance monitoring for all profile routes
  router.use(performanceMonitor);

  // Profile routes
  router.get("/", asyncHandler(profileController.getOrCreateActiveProfile));
  router.post("/", asyncHandler(profileController.createProfile));
  router.get("/me", asyncHandler(profileController.getOrCreateActiveProfile));
  router.get("/me/all", asyncHandler(profileController.getUserProfiles));
  router.get("/me/recent-properties", asyncHandler(profileController.getRecentProperties));
  router.get("/me/recent-properties/debug", asyncHandler(profileController.debugRecentProperties));
  router.delete("/me/recent-properties", asyncHandler(profileController.clearRecentProperties));
  router.get("/me/saved-properties", asyncHandler(profileController.getSavedProperties));
  router.get("/me/saved-profiles", asyncHandler(profileController.getSavedProfiles));
  router.post("/me/save-property", asyncHandler(profileController.saveProperty));
  router.delete("/me/saved-properties/:propertyId", asyncHandler(profileController.unsaveProperty));
  router.patch("/me/saved-properties/:propertyId/notes", asyncHandler(profileController.updateSavedPropertyNotes));
  
  // Billing/Entitlements
  router.get('/me/entitlements', asyncHandler(async (req, res) => {
    // Prevent caching so clients always get fresh entitlements
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    const oxyUserId = req.user?.id || req.user?._id;
    if (!oxyUserId) return res.status(401).json({ success: false, error: { message: 'Authentication required' }});
    
    // Find billing record for this user
    const { Billing } = require('../models');
    const billing = await Billing.findOne({ oxyUserId }).lean();
    
    // Return default entitlements if no billing record exists
    const entitlements = billing || { 
      plusActive: false, 
      fileCredits: 0,
      founderSupporter: false,
      processedSessions: []
    };
    
    return res.json({ success: true, entitlements });
  }));
  
  router.post('/me/entitlements/consume-file-credit', asyncHandler(async (req, res) => {
    const oxyUserId = req.user?.id || req.user?._id;
    if (!oxyUserId) return res.status(401).json({ success: false, error: { message: 'Authentication required' }});
    const { Billing } = require('../models');
    
    // Find or create billing record for this user
    let billing = await Billing.findOne({ oxyUserId });
    if (!billing) {
      billing = new Billing({
        oxyUserId,
        plusActive: false,
        fileCredits: 0,
        processedSessions: []
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
      consumed: result.consumed 
    });
  }));
  
  // Saved property folders
  router.get("/me/saved-property-folders", asyncHandler(profileController.getSavedPropertyFolders));
  router.post("/me/saved-property-folders", asyncHandler(profileController.createSavedPropertyFolder));
  router.put("/me/saved-property-folders/:folderId", asyncHandler(profileController.updateSavedPropertyFolder));
  router.delete("/me/saved-property-folders/:folderId", asyncHandler(profileController.deleteSavedPropertyFolder));
  router.get("/me/saved-searches", asyncHandler(profileController.getSavedSearches));
  router.post("/me/saved-searches", asyncHandler(profileController.saveSearch));
  router.delete("/me/saved-searches/:searchId", asyncHandler(profileController.deleteSavedSearch));
  router.put("/me/saved-searches/:searchId", asyncHandler(profileController.updateSavedSearch));
  router.put("/me/saved-searches/:searchId/notifications", asyncHandler(profileController.toggleSearchNotifications));
  // Save/unsave other profiles (follow)
  router.post("/me/save-profile", asyncHandler(profileController.saveProfile));
  router.delete("/me/saved-profiles/:profileId", asyncHandler(profileController.unsaveProfile));
  router.get("/me/saved-profiles/:profileId", asyncHandler(profileController.isProfileSaved));
  router.get("/me/properties", asyncHandler(profileController.getProfileProperties));
  router.get("/me/:profileType", asyncHandler(profileController.getProfileByType));
  router.get("/:profileId", asyncHandler(profileController.getProfileById));
  router.put("/:profileId", asyncHandler(profileController.updateProfile));
  router.delete("/:profileId", asyncHandler(profileController.deleteProfile));
  router.post("/:profileId/activate", asyncHandler(profileController.activateProfile));

  return router;
}; 