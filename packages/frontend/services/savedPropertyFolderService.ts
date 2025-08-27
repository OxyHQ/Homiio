import { api } from '@/utils/api';

export interface SavedPropertyFolder {
  _id: string;
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
  async getSavedPropertyFolders(): Promise<SavedPropertyFoldersResponse> {
    const response = await api.get('/api/profiles/me/saved-property-folders');

    // The API returns { success: true, data: { folders: [...] }, message: "..." }
    // where response.data contains the wrapper and response.data.data contains { folders: [...] }
    return {
      folders: response.data.data?.folders || [],
    };
  }

  async createSavedPropertyFolder(
    folderData: { name: string; description?: string; color?: string; icon?: string },
  ): Promise<SavedPropertyFolder> {
    const response = await api.post('/api/profiles/me/saved-property-folders', folderData);
    return response.data.data;
  }

  async updateSavedPropertyFolder(
    folderId: string,
    folderData: { name?: string; description?: string; color?: string; icon?: string },
  ): Promise<SavedPropertyFolder> {
    const response = await api.put(`/api/profiles/me/saved-property-folders/${folderId}`, folderData);
    return response.data.data;
  }

  async deleteSavedPropertyFolder(folderId: string): Promise<void> {
    await api.delete(`/api/profiles/me/saved-property-folders/${folderId}`);
  }
}

export default new SavedPropertyFolderService();
