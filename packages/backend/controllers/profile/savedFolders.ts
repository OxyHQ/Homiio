import {
  Profile,
  Saved,
  SavedPropertyFolder,
  successResponse,
  errorResponse,
} from './shared';

/**
 * Get saved property folders for the current user's profile
 */
export async function getSavedPropertyFolders(req: any, res: any, next: any) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    // Get the active profile for the current user
    let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

    if (!activeProfile) {
      return res.status(404).json(
        errorResponse("Profile not found", "PROFILE_NOT_FOUND")
      );
    }

    // Get all folders for this profile
    const folders = await SavedPropertyFolder.find({ profileId: activeProfile._id })
      .sort({ isDefault: -1, createdAt: 1 })
      .lean();

    // Calculate property count using unified Saved collection
    const folderIds = folders.map((f: any) => f._id);
    let countsByFolder: Record<string, number> = {};
    if (folderIds.length > 0) {
      const counts = await Saved.aggregate([
        { $match: { profileId: activeProfile._id, targetType: 'property', folderId: { $in: folderIds } } },
        { $group: { _id: '$folderId', count: { $sum: 1 } } },
      ]);
      countsByFolder = counts.reduce((acc: any, row: any) => {
        acc[String(row._id)] = row.count;
        return acc;
      }, {} as Record<string, number>);
    }

    const foldersWithCount = folders.map((folder: any) => ({
      ...folder,
      propertyCount: countsByFolder[String(folder._id)] || 0,
    }));

    res.json(
      successResponse({ folders: foldersWithCount }, "Saved property folders retrieved successfully")
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Create a new saved property folder
 */
export async function createSavedPropertyFolder(req: any, res: any, next: any) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    const { name, description, color, icon } = req.body;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (!name || !name.trim()) {
      return res.status(400).json(
        errorResponse("Folder name is required", "FOLDER_NAME_REQUIRED")
      );
    }

    // Get the active profile for the current user
    let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

    if (!activeProfile) {
      return res.status(404).json(
        errorResponse("Profile not found", "PROFILE_NOT_FOUND")
      );
    }

    // Check if folder with same name already exists
    const existingFolder = await SavedPropertyFolder.findOne({
      profileId: activeProfile._id,
      name: { $regex: new RegExp(`^${name.trim()}$`, 'i') }
    });

    if (existingFolder) {
      return res.status(409).json(
        errorResponse("Folder with this name already exists", "FOLDER_NAME_EXISTS")
      );
    }

    // Create new folder
    const folder = new SavedPropertyFolder({
      profileId: activeProfile._id,
      name: name.trim(),
      description: description?.trim() || '',
      color: color || '#3B82F6',
      icon: icon || 'folder-outline',
      isDefault: false
    });

    await folder.save();

    res.status(201).json(
      successResponse(folder, "Folder created successfully")
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Update a saved property folder
 */
export async function updateSavedPropertyFolder(req: any, res: any, next: any) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    const { folderId } = req.params;
    const { name, description, color, icon } = req.body;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (!folderId) {
      return res.status(400).json(
        errorResponse("Folder ID is required", "FOLDER_ID_REQUIRED")
      );
    }

    // Get the active profile for the current user
    let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

    if (!activeProfile) {
      return res.status(404).json(
        errorResponse("Profile not found", "PROFILE_NOT_FOUND")
      );
    }

    // Find the folder
    const folder = await SavedPropertyFolder.findOne({
      _id: folderId,
      profileId: activeProfile._id
    });

    if (!folder) {
      return res.status(404).json(
        errorResponse("Folder not found", "FOLDER_NOT_FOUND")
      );
    }

    // Don't allow updating default folder
    if (folder.isDefault) {
      return res.status(400).json(
        errorResponse("Cannot update default folder", "CANNOT_UPDATE_DEFAULT_FOLDER")
      );
    }

    // Check if new name conflicts with existing folder
    if (name && name.trim() !== folder.name) {
      const existingFolder = await SavedPropertyFolder.findOne({
        profileId: activeProfile._id,
        name: { $regex: new RegExp(`^${name.trim()}$`, 'i') },
        _id: { $ne: folderId }
      });

      if (existingFolder) {
        return res.status(409).json(
          errorResponse("Folder with this name already exists", "FOLDER_NAME_EXISTS")
        );
      }
    }

    // Update folder
    const updateData: any = {};
    if (name) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim() || '';
    if (color) updateData.color = color;
    if (icon) updateData.icon = icon;

    const updatedFolder = await SavedPropertyFolder.findByIdAndUpdate(
      folderId,
      updateData,
      { new: true }
    );

    res.json(
      successResponse(updatedFolder, "Folder updated successfully")
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Delete a saved property folder
 */
export async function deleteSavedPropertyFolder(req: any, res: any, next: any) {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    const { folderId } = req.params;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (!folderId) {
      return res.status(400).json(
        errorResponse("Folder ID is required", "FOLDER_ID_REQUIRED")
      );
    }

    // Get the active profile for the current user
    let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);

    if (!activeProfile) {
      return res.status(404).json(
        errorResponse("Profile not found", "PROFILE_NOT_FOUND")
      );
    }

    // Find the folder
    const folder = await SavedPropertyFolder.findOne({
      _id: folderId,
      profileId: activeProfile._id
    });

    if (!folder) {
      return res.status(404).json(
        errorResponse("Folder not found", "FOLDER_NOT_FOUND")
      );
    }

    // Don't allow deleting default folder
    if (folder.isDefault) {
      return res.status(400).json(
        errorResponse("Cannot delete default folder", "CANNOT_DELETE_DEFAULT_FOLDER")
      );
    }

    // Move all properties in this folder to no folder (null) in unified Saved collection
    await Saved.updateMany(
      { profileId: activeProfile._id, targetType: 'property', folderId: folderId },
      { $set: { folderId: null } }
    );

    // Delete the folder
    await SavedPropertyFolder.findByIdAndDelete(folderId);

    res.json(
      successResponse(null, "Folder deleted successfully")
    );
  } catch (error) {
    next(error);
  }
}
