/**
 * Roommate Routes
 * Handles roommate matching functionality
 */

const express = require('express');
const roommateController = require('../controllers/roommateController');
const { asyncHandler } = require('../middlewares');

module.exports = function() {
  const router = express.Router();

  // Get all roommate profiles
  router.get('/', asyncHandler(roommateController.getRoommateProfiles));

  // Get current user's roommate preferences
  router.get('/preferences', asyncHandler(roommateController.getMyRoommatePreferences));

  // Update roommate preferences
  router.put('/preferences', asyncHandler(roommateController.updateRoommatePreferences));

  // Toggle roommate matching
  router.patch('/toggle', asyncHandler(roommateController.toggleRoommateMatching));

  // Get roommate requests
  router.get('/requests', asyncHandler(roommateController.getRoommateRequests));

  // Send roommate request
  router.post('/:profileId/request', asyncHandler(roommateController.sendRoommateRequest));

  // Accept roommate request
  router.post('/requests/:requestId/accept', asyncHandler(roommateController.acceptRoommateRequest));

  // Decline roommate request
  router.post('/requests/:requestId/decline', asyncHandler(roommateController.declineRoommateRequest));

  return router;
}; 