/**
 * Roommate Routes
 * Handles roommate matching functionality
 */

const express = require('express');
const roommateController = require('../controllers/roommateController');

module.exports = function(authenticateToken) {
  const router = express.Router();

  // Get all roommate profiles
  router.get('/', authenticateToken, roommateController.getRoommateProfiles);

  // Get current user's roommate preferences
  router.get('/preferences', authenticateToken, roommateController.getMyRoommatePreferences);

  // Update roommate preferences
  router.put('/preferences', authenticateToken, roommateController.updateRoommatePreferences);

  // Toggle roommate matching
  router.patch('/toggle', authenticateToken, roommateController.toggleRoommateMatching);

  // Get roommate requests
  router.get('/requests', authenticateToken, roommateController.getRoommateRequests);

  // Send roommate request
  router.post('/:profileId/request', authenticateToken, roommateController.sendRoommateRequest);

  // Accept roommate request
  router.post('/requests/:requestId/accept', authenticateToken, roommateController.acceptRoommateRequest);

  // Decline roommate request
  router.post('/requests/:requestId/decline', authenticateToken, roommateController.declineRoommateRequest);

  return router;
}; 