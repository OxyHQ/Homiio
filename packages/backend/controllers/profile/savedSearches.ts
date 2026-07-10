import {
  Profile,
  SavedSearch,
  successResponse,
  errorResponse,
} from './shared';

/**
 * Get saved searches for the current user's profile
 */
export async function getSavedSearches(req: any, res: any, next: any) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }
// Get saved searches
    const savedSearches = await SavedSearch.find({ oxyUserId })
      .sort({ createdAt: -1 })
      .lean();

    const response = successResponse(savedSearches, "Saved searches retrieved successfully");

    res.json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * Save a search for the current user's profile
 */
export async function saveSearch(req: any, res: any, next: any) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    const { name, query, filters, notificationsEnabled } = req.body;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (!name || !query) {
      return res.status(400).json(
        errorResponse("Search name and query are required", "SEARCH_DATA_REQUIRED")
      );
    }
// Check if search with same name already exists
    const existingSearch = await SavedSearch.findOne({
      oxyUserId,
      name: name.trim()
    });

    if (existingSearch) {
      return res.status(409).json(
        errorResponse("A search with this name already exists", "SEARCH_NAME_EXISTS")
      );
    }

    // Create new saved search
    const savedSearch = new SavedSearch({
      oxyUserId,
      name: name.trim(),
      query: query.trim(),
      filters: filters || {},
      notificationsEnabled: !!notificationsEnabled,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await savedSearch.save();

    res.status(201).json(
      successResponse(savedSearch, "Search saved successfully")
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Delete a saved search for the current user's profile
 */
export async function deleteSavedSearch(req: any, res: any, next: any) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    const { searchId } = req.params;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (!searchId) {
      return res.status(400).json(
        errorResponse("Search ID is required", "SEARCH_ID_REQUIRED")
      );
    }

    // Get the active profile for the current user
    const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

    if (!activeProfile) {
      return res.status(404).json(
        errorResponse("Saved search not found", "SAVED_SEARCH_NOT_FOUND")
      );
    }

    // Remove saved search
    const result = await SavedSearch.deleteOne({
      _id: searchId,
      oxyUserId
    });

    if (result.deletedCount === 0) {
      return res.status(404).json(
        errorResponse("Saved search not found", "SAVED_SEARCH_NOT_FOUND")
      );
    }

    res.json(
      successResponse(null, "Search deleted successfully")
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Update a saved search for the current user's profile
 */
export async function updateSavedSearch(req: any, res: any, next: any) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    const { searchId } = req.params;
    const { name, query, filters, notificationsEnabled } = req.body;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (!searchId) {
      return res.status(400).json(
        errorResponse("Search ID is required", "SEARCH_ID_REQUIRED")
      );
    }

    // Get the active profile for the current user
    const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

    if (!activeProfile) {
      return res.status(404).json(
        errorResponse("Saved search not found", "SAVED_SEARCH_NOT_FOUND")
      );
    }

    // Prepare update data
    const updateData: any = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name.trim();
    if (query !== undefined) updateData.query = query.trim();
    if (filters !== undefined) updateData.filters = filters;
    if (notificationsEnabled !== undefined) updateData.notificationsEnabled = !!notificationsEnabled;

    // Update saved search
    const savedSearch = await SavedSearch.findOneAndUpdate(
      { _id: searchId, oxyUserId },
      updateData,
      { new: true }
    );

    if (!savedSearch) {
      return res.status(404).json(
        errorResponse("Saved search not found", "SAVED_SEARCH_NOT_FOUND")
      );
    }

    res.json(
      successResponse(savedSearch, "Search updated successfully")
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Toggle notifications for a saved search
 */
export async function toggleSearchNotifications(req: any, res: any, next: any) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    const { searchId } = req.params;
    const { notificationsEnabled } = req.body;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (!searchId) {
      return res.status(400).json(
        errorResponse("Search ID is required", "SEARCH_ID_REQUIRED")
      );
    }

    // Get the active profile for the current user
    const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

    if (!activeProfile) {
      return res.status(404).json(
        errorResponse("Saved search not found", "SAVED_SEARCH_NOT_FOUND")
      );
    }

    // Update notifications setting
    const savedSearch = await SavedSearch.findOneAndUpdate(
      { _id: searchId, oxyUserId },
      {
        notificationsEnabled: !!notificationsEnabled,
        updatedAt: new Date()
      },
      { new: true }
    );

    if (!savedSearch) {
      return res.status(404).json(
        errorResponse("Saved search not found", "SAVED_SEARCH_NOT_FOUND")
      );
    }

    res.json(
      successResponse(savedSearch, "Search notifications updated successfully")
    );
  } catch (error) {
    next(error);
  }
}
