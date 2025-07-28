/**
 * Test Routes
 * Simple routes for testing and debugging Oxy authentication
 */

import express from "express";
import { asyncHandler } from "../middlewares";

export default function () {
  const router = express.Router();

  // Test route to get current user data
  router.get("/user", asyncHandler(async (req, res) => {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      const username = req.user?.username;
      const email = req.user?.email;
      
      console.log('Test route - User data:', {
        oxyUserId,
        username,
        email,
        fullUser: req.user
      });

      res.json({
        success: true,
        message: "User data retrieved successfully",
        data: {
          oxyUserId,
          username,
          email,
          fullUser: req.user,
          timestamp: new Date().toISOString(),
          headers: {
            authorization: req.headers.authorization ? 'Present' : 'Missing',
            'user-agent': req.headers['user-agent']
          }
        }
      });
    } catch (error) {
      console.error('Test route error:', error);
      res.status(500).json({
        success: false,
        message: "Error retrieving user data",
        error: error.message
      });
    }
  }));

  // Test route to check authentication status
  router.get("/auth-status", asyncHandler(async (req, res) => {
    try {
      const isAuthenticated = !!req.user;
      const oxyUserId = req.user?.id || req.user?._id;
      
      console.log('Test route - Auth status:', {
        isAuthenticated,
        oxyUserId,
        hasUser: !!req.user
      });

      res.json({
        success: true,
        message: "Authentication status retrieved",
        data: {
          isAuthenticated,
          oxyUserId,
          hasUser: !!req.user,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Test route error:', error);
      res.status(500).json({
        success: false,
        message: "Error checking authentication status",
        error: error.message
      });
    }
  }));

  // Test route to simulate profile creation (without actually creating)
  router.get("/profile-test", asyncHandler(async (req, res) => {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      
      if (!oxyUserId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
          data: {
            oxyUserId: null,
            canCreateProfile: false
          }
        });
      }

      console.log('Test route - Profile test for user:', oxyUserId);

      // Import Profile model to check if profile exists
      const { Profile } = require("../models");
      const existingProfile = await Profile.findOne({ oxyUserId });
      
      res.json({
        success: true,
        message: "Profile test completed",
        data: {
          oxyUserId,
          hasExistingProfile: !!existingProfile,
          profileType: existingProfile?.profileType || null,
          isActive: existingProfile?.isActive || false,
          canCreateProfile: !existingProfile,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Test route error:', error);
      res.status(500).json({
        success: false,
        message: "Error testing profile creation",
        error: error.message
      });
    }
  }));

  return router;
} 