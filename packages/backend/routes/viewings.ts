import express from "express";
import { asyncHandler } from "../middlewares";

export default function () {
  const router = express.Router();

  const viewingController = require("../controllers/viewingController");

  // Current user's viewing requests
  router.get(
    "/me",
    asyncHandler(viewingController.listMyViewingRequests)
  );

  // Manage a specific viewing request
  router.post(
    "/:viewingId/approve",
    asyncHandler(viewingController.approveViewingRequest)
  );
  router.post(
    "/:viewingId/decline",
    asyncHandler(viewingController.declineViewingRequest)
  );
  router.post(
    "/:viewingId/cancel",
    asyncHandler(viewingController.cancelViewingRequest)
  );

  // Update a viewing request
  router.put(
    "/:viewingId",
    asyncHandler(viewingController.updateViewingRequest)
  );

  return router;
}


