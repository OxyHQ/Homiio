/**
 * User Controller
 * Handles user management operations
 */

const { horizonService } = require("../services");
const {
  successResponse,
  paginationResponse,
  AppError,
} = require("../middlewares/errorHandler");
const { logger } = require("../middlewares/logging");
const { PropertyModel, RecentlyViewedModel, SavedPropertyModel } = require("../models");

class UserController {
  /**
   * Get current user profile
   */
  async getCurrentUser(req, res, next) {
    try {
      const userId = req.userId;

      // In a real implementation, fetch from database
      // const user = await UserModel.findById(userId);

      const mockUser = {
        id: userId,
        email: req.user.email,
        username: req.user.username || "user",
        firstName: "John",
        lastName: "Doe",
        role: req.user.role || "user",
        profile: {
          phoneNumber: "+1234567890",
          dateOfBirth: "1990-01-01",
          address: {
            street: "123 Main St",
            city: "San Francisco",
            state: "CA",
            zipCode: "94102",
            country: "USA",
          },
          occupation: "Software Engineer",
          emergencyContact: {
            name: "Jane Doe",
            phoneNumber: "+1234567891",
            relationship: "Sister",
          },
        },
        preferences: {
          emailNotifications: true,
          pushNotifications: true,
          language: "en",
          timezone: "America/Los_Angeles",
        },
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: new Date().toISOString(),
        emailVerified: true,
        phoneVerified: false,
      };

      res.json(
        successResponse(mockUser, "User profile retrieved successfully"),
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update current user profile
   */
  async updateCurrentUser(req, res, next) {
    try {
      const userId = req.userId;
      const updateData = req.body;

      // In a real implementation, update in database
      // const updatedUser = await UserModel.findByIdAndUpdate(userId, updateData);

      const updatedUser = {
        id: userId,
        ...updateData,
        updatedAt: new Date().toISOString(),
      };

      logger.info("User profile updated", { userId });

      res.json(successResponse(updatedUser, "Profile updated successfully"));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete current user account
   */
  async deleteCurrentUser(req, res, next) {
    try {
      const userId = req.userId;

      // In a real implementation, soft delete user and cleanup
      // await UserModel.softDelete(userId);
      // await PropertyModel.transferOwnership(userId, 'system');

      logger.info("User account deleted", { userId });

      res.json(successResponse(null, "Account deleted successfully"));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get all users (admin only)
   */
  async getUsers(req, res, next) {
    try {
      const {
        page = 1,
        limit = 10,
        role,
        status,
        search,
        sortBy = "createdAt",
        sortOrder = "desc",
      } = req.query;

      // In a real implementation, query database with filters
      const mockUsers = [
        {
          id: "user_1",
          email: "admin@example.com",
          username: "admin",
          firstName: "Admin",
          lastName: "User",
          role: "admin",
          status: "active",
          createdAt: "2024-01-01T00:00:00Z",
        },
        {
          id: "user_2",
          email: "tenant@example.com",
          username: "tenant",
          firstName: "Tenant",
          lastName: "User",
          role: "tenant",
          status: "active",
          createdAt: "2024-01-02T00:00:00Z",
        },
      ];

      const total = mockUsers.length;

      res.json(
        paginationResponse(
          mockUsers,
          parseInt(page),
          parseInt(limit),
          total,
          "Users retrieved successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(req, res, next) {
    try {
      const { userId } = req.params;

      // In a real implementation, fetch from database
      // const user = await UserModel.findById(userId);

      const mockUser = {
        id: userId,
        email: "user@example.com",
        username: "user123",
        firstName: "John",
        lastName: "Doe",
        role: "tenant",
        status: "active",
        createdAt: "2024-01-01T00:00:00Z",
        updatedAt: new Date().toISOString(),
      };

      res.json(successResponse(mockUser, "User retrieved successfully"));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update user (admin only)
   */
  async updateUser(req, res, next) {
    try {
      const { userId } = req.params;
      const updateData = req.body;

      // In a real implementation, update in database
      // const updatedUser = await UserModel.findByIdAndUpdate(userId, updateData);

      const updatedUser = {
        id: userId,
        ...updateData,
        updatedAt: new Date().toISOString(),
      };

      logger.info("User updated by admin", { userId, adminId: req.userId });

      res.json(successResponse(updatedUser, "User updated successfully"));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete user (admin only)
   */
  async deleteUser(req, res, next) {
    try {
      const { userId } = req.params;

      // In a real implementation, soft delete and cleanup
      // await UserModel.softDelete(userId);

      logger.info("User deleted by admin", { userId, adminId: req.userId });

      res.json(successResponse(null, "User deleted successfully"));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user's properties
   */
  async getUserProperties(req, res, next) {
    try {
      const userId = req.userId;
      const { page = 1, limit = 10 } = req.query;

      // In a real implementation, fetch user's properties from database
      // const properties = await PropertyModel.findByOwnerId(userId);

      const mockProperties = [
        {
          id: "prop_1",
          title: "Downtown Apartment",
          address: { city: "San Francisco", state: "CA" },
          type: "apartment",
          status: "available",
          rent: { amount: 2500, currency: "USD" },
          roomCount: 3,
        },
      ];

      const total = mockProperties.length;

      res.json(
        paginationResponse(
          mockProperties,
          parseInt(page),
          parseInt(limit),
          total,
          "User properties retrieved successfully",
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user's recently viewed properties
   */
  async getRecentProperties(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id;
      console.log(`Getting recent properties for Oxy user ${oxyUserId}`);

      // Check if user is authenticated
      if (!req.userId || !oxyUserId) {
        console.log('No userId or oxyUserId provided - authentication required');
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
          code: 'AUTHENTICATION_REQUIRED'
        });
      }

      // Get the active profile for this Oxy user
      const Profile = require('../models').Profile;
      const activeProfile = await Profile.findPrimaryByOxyUserId(oxyUserId);
      
      if (!activeProfile) {
        console.log(`No active profile found for Oxy user ${oxyUserId}`);
        return res.json(
          successResponse(
            [],
            "No recently viewed properties found",
          ),
        );
      }

      const profileId = activeProfile._id;
      console.log(`Found active profile ${profileId} for Oxy user ${oxyUserId}`);

      // Get recently viewed properties for this profile
      const recentlyViewed = await RecentlyViewedModel.find({ profileId })
        .sort({ viewedAt: -1 })
        .limit(10)
        .populate('propertyId')
        .lean();

      if (!recentlyViewed || recentlyViewed.length === 0) {
        console.log(`No recent properties found for profileId ${profileId}`);
        return res.json(
          successResponse(
            [],
            "No recently viewed properties found",
          ),
        );
      }

      // Extract the properties from the populated documents
      const properties = recentlyViewed
        .map(item => item.propertyId)
        .filter(Boolean); // Remove any null properties

      console.log(`Found ${properties.length} recent properties for profileId ${profileId}`);

      res.json(
        successResponse(
          properties,
          "Recently viewed properties retrieved successfully",
        ),
      );
    } catch (error) {
      console.error("Error getting recent properties:", error);
      next(error);
    }
  }

  /**
   * Get user's saved properties
   */
  async getSavedProperties(req, res, next) {
    try {
      const userId = req.userId;
      const oxyUserId = req.user?.id || req.user?._id;
      
      console.log(`Getting saved properties for user ${userId} (Oxy ID: ${oxyUserId})`);

      // Check if user is authenticated
      if (!userId || !oxyUserId) {
        console.log('No userId or oxyUserId provided - authentication required');
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
          code: 'AUTHENTICATION_REQUIRED'
        });
      }

      // Get saved properties for this Oxy user
      const savedProperties = await SavedPropertyModel.find({ oxyUserId })
        .sort({ savedAt: -1 })
        .populate('propertyId')
        .lean();

      console.log('Raw saved properties from database:', savedProperties);

      if (!savedProperties || savedProperties.length === 0) {
        console.log(`No saved properties found for Oxy user ${oxyUserId}`);
        return res.json(
          successResponse(
            [],
            "No saved properties found",
          ),
        );
      }

      // Extract the properties with their saved metadata
      const properties = savedProperties
        .map(item => {
          const propertyData = item.propertyId;
          if (!propertyData) return null;
          
          const result = {
            ...propertyData.toObject ? propertyData.toObject() : propertyData,
            _id: propertyData._id || propertyData.id,
            id: propertyData._id || propertyData.id,
            savedAt: item.savedAt,
            notes: item.notes,
            savedPropertyId: item._id
          };
          
          console.log('Processed property:', result);
          return result;
        })
        .filter(item => item); // Remove any null properties

      console.log(`Found ${properties.length} saved properties for Oxy user ${oxyUserId}`);

      res.json(
        successResponse(
          properties,
          "Saved properties retrieved successfully",
        ),
      );
    } catch (error) {
      console.error("Error getting saved properties:", error);
      next(error);
    }
  }

  /**
   * Save a property for the user
   */
  async saveProperty(req, res, next) {
    try {
      const userId = req.userId;
      const oxyUserId = req.user?.id || req.user?._id;
      const { propertyId, notes } = req.body;
      
      console.log(`Saving property ${propertyId} for user ${userId} (Oxy ID: ${oxyUserId})`);

      // Check if user is authenticated
      if (!userId || !oxyUserId) {
        console.log('No userId or oxyUserId provided - authentication required');
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
          code: 'AUTHENTICATION_REQUIRED'
        });
      }

      // Check if property exists
      const property = await PropertyModel.findById(propertyId);
      if (!property) {
        return res.status(404).json({
          success: false,
          message: 'Property not found',
          code: 'PROPERTY_NOT_FOUND'
        });
      }

      // Check if already saved
      const existingSaved = await SavedPropertyModel.findOne({ oxyUserId, propertyId });
      if (existingSaved) {
        return res.status(409).json({
          success: false,
          message: 'Property already saved',
          code: 'PROPERTY_ALREADY_SAVED'
        });
      }

      // Save the property
      const savedProperty = new SavedPropertyModel({
        oxyUserId,
        propertyId,
        notes: notes || ''
      });

      await savedProperty.save();

      console.log(`Successfully saved property ${propertyId} for Oxy user ${oxyUserId}`);

      res.status(201).json(
        successResponse(
          savedProperty,
          "Property saved successfully",
        ),
      );
    } catch (error) {
      console.error("Error saving property:", error);
      next(error);
    }
  }

  /**
   * Unsave a property for the user
   */
  async unsaveProperty(req, res, next) {
    try {
      const userId = req.userId;
      const oxyUserId = req.user?.id || req.user?._id;
      const { propertyId } = req.params;
      
      console.log(`Unsaving property ${propertyId} for user ${userId} (Oxy ID: ${oxyUserId})`);

      // Check if user is authenticated
      if (!userId || !oxyUserId) {
        console.log('No userId or oxyUserId provided - authentication required');
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
          code: 'AUTHENTICATION_REQUIRED'
        });
      }

      // Find and delete the saved property
      const deletedSaved = await SavedPropertyModel.findOneAndDelete({ oxyUserId, propertyId });

      if (!deletedSaved) {
        return res.status(404).json({
          success: false,
          message: 'Saved property not found',
          code: 'SAVED_PROPERTY_NOT_FOUND'
        });
      }

      console.log(`Successfully unsaved property ${propertyId} for Oxy user ${oxyUserId}`);

      res.json(
        successResponse(
          { propertyId },
          "Property unsaved successfully",
        ),
      );
    } catch (error) {
      console.error("Error unsaving property:", error);
      next(error);
    }
  }

  /**
   * Update notes for a saved property
   */
  async updateSavedPropertyNotes(req, res, next) {
    try {
      const userId = req.userId;
      const oxyUserId = req.user?.id || req.user?._id;
      const { propertyId } = req.params;
      const { notes } = req.body;
      
      console.log(`Updating notes for property ${propertyId} for user ${userId} (Oxy ID: ${oxyUserId})`);

      // Check if user is authenticated
      if (!userId || !oxyUserId) {
        console.log('No userId or oxyUserId provided - authentication required');
        return res.status(401).json({
          success: false,
          message: 'Authentication required',
          code: 'AUTHENTICATION_REQUIRED'
        });
      }

      // Update the saved property notes
      const updatedSaved = await SavedPropertyModel.findOneAndUpdate(
        { oxyUserId, propertyId },
        { notes: notes || '' },
        { new: true }
      );

      if (!updatedSaved) {
        return res.status(404).json({
          success: false,
          message: 'Saved property not found',
          code: 'SAVED_PROPERTY_NOT_FOUND'
        });
      }

      console.log(`Successfully updated notes for property ${propertyId} for Oxy user ${oxyUserId}`);

      res.json(
        successResponse(
          updatedSaved,
          "Property notes updated successfully",
        ),
      );
    } catch (error) {
      console.error("Error updating property notes:", error);
      next(error);
    }
  }

  /**
   * Get user notifications
   */
  async getUserNotifications(req, res, next) {
    try {
      const userId = req.userId;

      // Get cross-app notifications from Horizon service
      try {
        const notifications =
          await horizonService.getCrossAppNotifications(userId);

        res.json(
          successResponse(
            notifications,
            "Notifications retrieved successfully",
          ),
        );
      } catch (horizonError) {
        // Fallback to mock notifications if Horizon service fails
        const mockNotifications = [
          {
            id: "notif_1",
            type: "payment_reminder",
            title: "Rent Payment Due",
            message: "Your rent payment is due in 3 days",
            app: "homio",
            priority: "high",
            read: false,
            createdAt: new Date().toISOString(),
          },
        ];

        res.json(
          successResponse(
            mockNotifications,
            "Notifications retrieved successfully",
          ),
        );
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark notification as read
   */
  async markNotificationAsRead(req, res, next) {
    try {
      const { notificationId } = req.params;
      const userId = req.userId;

      // In a real implementation, update notification status
      // await NotificationModel.markAsRead(notificationId, userId);

      logger.info("Notification marked as read", { notificationId, userId });

      res.json(successResponse(null, "Notification marked as read"));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new UserController();
