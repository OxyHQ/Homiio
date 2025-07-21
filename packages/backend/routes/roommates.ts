/**
 * Roommate Routes
 * Handles roommate matching functionality
 */

import express from 'express';
import { asyncHandler } from '../middlewares';
const roommateController = require('../controllers/roommateController');

  const router = express.Router();

  // Get all roommate profiles
  router.get('/', asyncHandler(roommateController.getRoommateProfiles));

// Get current user's roommate status with Oxy data
router.get('/status', asyncHandler(roommateController.getCurrentUserRoommateStatus));

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

  // Get current user's roommate relationships
  router.get('/relationships', asyncHandler(roommateController.getMyRoommateRelationships));

  // End a roommate relationship
  router.delete('/relationships/:relationshipId', asyncHandler(roommateController.endRoommateRelationship));

export default () => router; 