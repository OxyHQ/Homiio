import express from 'express';
const router = express.Router();
// `controllers/propertyController` called itself a "thin compatibility
// wrapper": an empty class with these handlers copied onto it at runtime and
// typed `unknown`, so every route below was registering an untyped value.
import * as propertyController from '../controllers/property';
import * as profileController from '../controllers/profile';
import viewingController from '../controllers/viewingController';
import { createListingReport } from '../controllers/reportController';
import * as validation from '../middlewares/validation';
import { asyncHandler } from '../middlewares/errorHandler';

// Property creation (requires authentication)
router.post("/", validation.validateProperty, asyncHandler(propertyController.createProperty));

// Property management (requires authentication)
router.post("/test-telegram", validation.validateProperty, asyncHandler(propertyController.createProperty));
router.put("/:propertyId", validation.validateProperty, asyncHandler(propertyController.updateProperty));
router.delete("/:propertyId", asyncHandler(propertyController.deleteProperty));

// Close a deal (rented/sold/exchanged) — owner only; fires the partner
// commission trigger (idempotent: at most one commission per property).
router.post("/:propertyId/mark-transacted", asyncHandler(propertyController.markPropertyTransacted));

// Property tracking (requires authentication)
router.post("/:propertyId/track-view", asyncHandler(profileController.trackPropertyView));

/**
 * Viewing requests ON a listing — the two handlers the app has always called.
 *
 * `viewingService` has posted to `/api/properties/:propertyId/viewings` since
 * the screen was written, and `viewingController` has had both handlers all
 * along; nothing mounted them. Only the integration suite's own express app
 * did, so every test passed while production answered 404 to every attempt to
 * arrange a viewing. `__tests__/integration/viewingRoutes.test.ts` now asserts
 * the MOUNT through the real router, which is the half no handler test can see.
 *
 * Authenticated, because this file is mounted behind
 * `createOxyAuthMiddleware` in `routes/index.ts` — the router is what decides
 * that (see `AGENTS.md`), and both handlers read the session.
 */
router.post("/:propertyId/viewings", asyncHandler(viewingController.createViewingRequest));
router.get("/:propertyId/viewings", asyncHandler(viewingController.listPropertyViewingRequests));

// Trust & safety: file a report against a listing (requires authentication)
router.post("/:propertyId/report", asyncHandler(createListingReport));

// User properties (requires authentication)
router.get("/me/list", asyncHandler(propertyController.getMyProperties));

// Owner properties (requires authentication)
router.get("/owner/:oxyUserId", asyncHandler(propertyController.getPropertiesByOwner));

export default function() {
  return router;
};