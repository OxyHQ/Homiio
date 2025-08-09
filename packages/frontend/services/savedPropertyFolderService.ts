import { OxyServices } from '@oxyhq/services';

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
  async getSavedPropertyFolders(oxyServices: OxyServices, activeSessionId: string): Promise<SavedPropertyFoldersResponse> {
    const { userApi } = await import('@/utils/api');
    const response = await userApi.getSavedPropertyFolders(oxyServices, activeSessionId);
    
    return {
      folders: response.data?.folders || response.data || [],
    };
  }

  async createSavedPropertyFolder(
    folderData: { name: string; description?: string; color?: string; icon?: string },
    oxyServices: OxyServices,
    activeSessionId: string
  ): Promise<SavedPropertyFolder> {
    const { userApi } = await import('@/utils/api');
    const response = await userApi.createSavedPropertyFolder(folderData, oxyServices, activeSessionId);
    return response.data;
  }

  async updateSavedPropertyFolder(
    folderId: string,
    folderData: { name?: string; description?: string; color?: string; icon?: string },
    oxyServices: OxyServices,
    activeSessionId: string
  ): Promise<SavedPropertyFolder> {
    const { userApi } = await import('@/utils/api');
    const response = await userApi.updateSavedPropertyFolder(folderId, folderData, oxyServices, activeSessionId);
    return response.data;
  }

  async deleteSavedPropertyFolder(
    folderId: string,
    oxyServices: OxyServices,
    activeSessionId: string
  ): Promise<void> {
    const { userApi } = await import('@/utils/api');
    await userApi.deleteSavedPropertyFolder(folderId, oxyServices, activeSessionId);
  }


}

export default new SavedPropertyFolderService(); 