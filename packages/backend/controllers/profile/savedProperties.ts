import {
  Profile,
  Saved,
  SavedPropertyFolder,
  Property,
  successResponse,
  errorResponse,
} from './shared';

/**
 * Get saved properties for the current user's profile
 */
export async function getSavedProperties(req: any, res: any, next: any) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }
// Use unified Saved collection
    const savedRows = await Saved.find({ oxyUserId, targetType: 'property' })
      .sort({ createdAt: -1 })
      .lean();

    const propertyIds = savedRows.map((row: any) => row.targetId);
    const properties = await Property.find({ _id: { $in: propertyIds } }).populate('addressId').lean();

    // Map propertyId to doc for quick lookup
    const propById: Record<string, any> = {};
    properties.forEach((p: any) => { propById[String(p._id)] = p; });

    const merged = savedRows
      .map((row: any) => {
        const prop = propById[String(row.targetId)];
        if (!prop) return null;
        return {
          ...prop,
          savedAt: row.createdAt || row.updatedAt,
          notes: row.notes || '',
          folderId: row.folderId || null,
        };
      })
      .filter(Boolean);

    const response = successResponse(merged, "Saved properties retrieved successfully");

    res.json(response);
  } catch (error) {
    next(error);
  }
}

/**
 * Save a property for the current user's profile
 */
export async function saveProperty(req: any, res: any, next: any) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    const { propertyId, notes, folderId } = req.body;

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
// Find or create default folder if no folderId provided
    let targetFolder;
    if (folderId) {
      // Verify the folder exists
      targetFolder = await SavedPropertyFolder.findOne({
        _id: folderId,
        oxyUserId
      });

      if (!targetFolder) {
        return res.status(404).json(
          errorResponse("Folder not found", "FOLDER_NOT_FOUND")
        );
      }
    } else {
      // Find or create default folder
      targetFolder = await SavedPropertyFolder.findOne({
        oxyUserId,
        isDefault: true
      });

      if (!targetFolder) {
        // Create default folder
        targetFolder = new SavedPropertyFolder({
          oxyUserId,
          name: "Favorites",
          description: "Default folder for saved properties",
          icon: "❤️",
          isDefault: true,
          properties: []
        });
        await targetFolder.save();
      }
    }

    // Check if property is already saved
    const existingSaved = await Saved.findOne({ oxyUserId, targetType: 'property', targetId: propertyId });

    // Upsert in unified Saved collection
    await Saved.updateOne(
      { oxyUserId, targetType: 'property', targetId: propertyId },
      { $set: { oxyUserId, targetType: 'property', targetId: propertyId, notes: notes || null, folderId: targetFolder?._id, createdAt: new Date() } },
      { upsert: true }
    );

    res.json(
      successResponse({ folderId: targetFolder?._id }, "Property saved successfully")
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Unsave a property for the current user's profile
 */
export async function unsaveProperty(req: any, res: any, next: any) {
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
const result = await Saved.deleteOne({ oxyUserId, targetType: 'property', targetId: propertyId });
    if (result.deletedCount === 0) {
      return res.status(404).json(errorResponse("Saved property not found", "SAVED_PROPERTY_NOT_FOUND"));
    }

    res.json(
      successResponse(null, "Property unsaved successfully")
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Update saved property notes for the current user's profile
 */
export async function updateSavedPropertyNotes(req: any, res: any, next: any) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    const { propertyId } = req.params;
    const { notes } = req.body;

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
// Update notes on the saved record
    const updated = await Saved.findOneAndUpdate(
      { oxyUserId, targetType: 'property', targetId: propertyId },
      { $set: { notes: notes || '' } },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json(errorResponse("Saved property not found", "SAVED_PROPERTY_NOT_FOUND"));
    }

    // Best-effort: if property exists inside a folder's properties array, mirror notes there too
    try {
      const folder = await SavedPropertyFolder.findOne({
        oxyUserId,
        'properties.propertyId': propertyId
      });
      if (folder) {
        const prop = folder.properties.find((p: any) => String(p.propertyId) === String(propertyId));
        if (prop) {
          prop.notes = notes || '';
          await folder.save();
        }
      }
    } catch (e) {
      // Non-fatal: failed to mirror notes to SavedPropertyFolder
    }
    res.json(successResponse(updated, "Property notes updated successfully"));
  } catch (error) {
    next(error);
  }
}

/**
 * Get properties for the current user's profile
 */
export async function getProfileProperties(req: any, res: any, next: any) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    const { page = 1, limit = 10 } = req.query;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [properties, total] = await Promise.all([
      Property.find({ oxyUserId, status: { $ne: 'archived' } })
        .populate('addressId')
        .skip(skip)
        .limit(parseInt(limit))
        .sort({ createdAt: -1 })
        .lean(),
      Property.countDocuments({ oxyUserId, status: { $ne: 'archived' } })
    ]);

    const totalPages = Math.ceil(total / parseInt(limit));

    res.json(
      successResponse({
        properties,
        total,
        page: parseInt(page),
        totalPages
      }, "Properties retrieved successfully")
    );
  } catch (error) {
    next(error);
  }
}
