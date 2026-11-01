import { api, type RequestOwner } from '@/utils/api';

export interface SavedPropertyFolder {
  id: string;
  profileId: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  isDefault: boolean;
  propertyCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SavedPropertyFoldersResponse {
  folders: SavedPropertyFolder[];
}

class SavedPropertyFolderService {
  async getSavedPropertyFolders(owner: RequestOwner): Promise<SavedPropertyFoldersResponse> {
    const response = await api.get('/api/profiles/me/saved-property-folders', {
      requireAuth: true,
      owner,
    });

    // The API returns { success: true, data: { folders: [...] }, message: "..." }
    // where response.data contains the wrapper and response.data.data contains { folders: [...] }
    return {
      folders: response.data.data?.folders || [],
    };
  }

  async createSavedPropertyFolder(
    owner: RequestOwner,
    folderData: {
      name: string;
      description?: string;
      color?: string;
      icon?: string;
    },
  ): Promise<SavedPropertyFolder> {
    const response = await api.post('/api/profiles/me/saved-property-folders', folderData, {
      requireAuth: true,
      owner,
    });
    return response.data.data;
  }

  async updateSavedPropertyFolder(
    owner: RequestOwner,
    folderId: string,
    folderData: { name?: string; description?: string; color?: string; icon?: string },
  ): Promise<SavedPropertyFolder> {
    const response = await api.put(
      `/api/profiles/me/saved-property-folders/${folderId}`,
      folderData,
      { requireAuth: true, owner },
    );
    return response.data.data;
  }

  async deleteSavedPropertyFolder(owner: RequestOwner, folderId: string): Promise<void> {
    await api.delete(`/api/profiles/me/saved-property-folders/${folderId}`, {
      requireAuth: true,
      owner,
    });
  }
}

export default new SavedPropertyFolderService();
