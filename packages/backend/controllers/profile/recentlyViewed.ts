import {
  Profile,
  RecentlyViewed,
  Property,
  successResponse,
  errorResponse,
} from './shared';

/**
 * Get recently viewed properties for the current user's profile
 */
export async function getRecentProperties(req: any, res: any, next: any) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    const { limit = 10 } = req.query;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    // Get the active profile for the current user
  let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

    if (!activeProfile) {
      return res.status(404).json(errorResponse("Active profile not found", "ACTIVE_PROFILE_NOT_FOUND"));
    }

    // Get recently viewed properties
    const recentViews = await RecentlyViewed.find({ profileId: activeProfile._id })
      .sort({ viewedAt: -1 })
      .limit(parseInt(limit))
      .populate({
        path: 'propertyId',
        populate: {
          path: 'addressId',
          model: 'Address'
        }
      })
      .lean();

    // Map and filter properties, ensuring no duplicates by property ID
    const propertiesMap = new Map();
    recentViews.forEach(view => {
      if (view.propertyId && view.propertyId._id) {
        const propertyId = view.propertyId._id.toString();
        // Only keep the most recent view for each property
        if (!propertiesMap.has(propertyId) || view.viewedAt > propertiesMap.get(propertyId).viewedAt) {
          propertiesMap.set(propertyId, {
            ...view.propertyId,
            viewedAt: view.viewedAt
          });
        }
      }
    });

    const properties = Array.from(propertiesMap.values());

    res.json(
      successResponse(properties, "Recent properties retrieved successfully")
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Track property view for the current user's profile
 */
export async function trackPropertyView(req: any, res: any, next: any) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    const { propertyId } = req.params;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (!propertyId) {
      return res.status(400).json(
        errorResponse("Property ID is required", "PROPERTY_ID_REQUIRED")
      );
    }

    // Get the active profile for the current user
    let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

    if (!activeProfile) {
      return res.status(404).json(errorResponse("Active profile not found", "ACTIVE_PROFILE_NOT_FOUND"));
    }

    // Check if view already exists
    const existingView = await RecentlyViewed.findOne({
      profileId: activeProfile._id,
      propertyId
    });

    if (existingView) {
      // Update existing view timestamp
      existingView.viewedAt = new Date();
      await existingView.save();
    } else {
      // Create new view record
      const propertyView = new RecentlyViewed({
        profileId: activeProfile._id,
        propertyId,
        viewedAt: new Date()
      });
      await propertyView.save();
    }

    res.json(
      successResponse(null, "Property view tracked successfully")
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Clear recently viewed properties for the current user's profile
 */
export async function clearRecentProperties(req: any, res: any, next: any) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    // Get the active profile for the current user
    const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

    if (!activeProfile) {
      return res.status(404).json(
        errorResponse("Profile not found", "PROFILE_NOT_FOUND")
      );
    }

    // Clear all recently viewed properties for this profile
    const result = await RecentlyViewed.deleteMany({
      profileId: activeProfile._id
    });

    res.json(
      successResponse({ deletedCount: result.deletedCount }, "Recently viewed properties cleared successfully")
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Debug endpoint to check recently viewed data
 */
export async function debugRecentProperties(req: any, res: any, next: any) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    // Get the active profile for the current user
    const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

    if (!activeProfile) {
      return res.json(
        successResponse({
          error: "No active profile found",
          oxyUserId,
          debugInfo: "User needs to create a profile first"
        }, "Debug info retrieved")
      );
    }

    // Get recently viewed records WITHOUT population
    const rawRecentViews = await RecentlyViewed.find({ profileId: activeProfile._id })
      .sort({ viewedAt: -1 })
      .lean();

    // Get recently viewed records WITH population
    const populatedRecentViews = await RecentlyViewed.find({ profileId: activeProfile._id })
      .sort({ viewedAt: -1 })
      .populate({
        path: 'propertyId',
        populate: {
          path: 'addressId',
          model: 'Address'
        }
      })
      .lean();

    // Check if properties exist
    const propertyChecks = await Promise.all(
      rawRecentViews.map(async (view) => {
        const exists = await Property.findById(view.propertyId);
        return {
          propertyId: view.propertyId,
          exists: !!exists,
          propertyTitle: exists?.type || 'No title',
          propertyStatus: exists?.status || 'unknown'
        };
      })
    );

    // Get total count
    const totalCount = await RecentlyViewed.countDocuments({ profileId: activeProfile._id });

    res.json(
      successResponse({
        oxyUserId,
        profileId: activeProfile._id,
        profileType: activeProfile.profileType,
        totalCount,
        rawRecentViews: rawRecentViews.map(view => ({
          propertyId: view.propertyId,
          viewedAt: view.viewedAt,
          createdAt: view.createdAt,
          updatedAt: view.updatedAt
        })),
        populatedRecentViews: populatedRecentViews.map(view => ({
          propertyId: view.propertyId ? (typeof view.propertyId === 'object' ? view.propertyId._id : view.propertyId) : null,
          hasPopulatedProperty: !!view.propertyId && typeof view.propertyId === 'object',
          viewedAt: view.viewedAt,
          populatedKeys: view.propertyId && typeof view.propertyId === 'object' ? Object.keys(view.propertyId) : []
        })),
        propertyChecks
      }, "Debug info retrieved successfully")
    );
  } catch (error) {
    next(error);
  }
}
