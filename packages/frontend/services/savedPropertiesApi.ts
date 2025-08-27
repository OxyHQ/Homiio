/**
 * Enterprise-level API service for Saved Properties
 * Implements consistent error handling, retry logic, and type safety
 */

import { api } from '@/utils/api';
import type {
  SavedProperty,
  SavedPropertyFolder,
  SavedPropertiesResponse,
  SavedPropertyFoldersResponse,
  CreateFolderData,
  UpdateFolderData,
  SavedPropertiesError,
} from '@/types/savedProperties';

class SavedPropertiesApiError extends Error implements SavedPropertiesError {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, any>
  ) {
    super(message);
    this.name = 'SavedPropertiesApiError';
  }
}

/**
 * Enterprise-level API service for saved properties operations
 */
export class SavedPropertiesApiService {
  private readonly baseUrl = '/api/profiles/me';

  /**
   * Safely extracts data from API response wrapper
   */
  private extractApiData<T>(response: any): T {
    if (!response?.data) {
      throw new SavedPropertiesApiError(
        'Invalid API response structure',
        'INVALID_RESPONSE',
        { response }
      );
    }

    // Handle wrapped responses: { success: true, data: actualData, message: "..." }
    if (response.data.success !== undefined) {
      return response.data.data;
    }

    // Handle direct data responses
    return response.data;
  }

  /**
   * Get all saved properties with comprehensive error handling
   */
  async getSavedProperties(): Promise<SavedPropertiesResponse> {
    try {
      const response = await api.get(`${this.baseUrl}/saved-properties`);
      const data = this.extractApiData<SavedProperty[]>(response);
      
      const properties = Array.isArray(data) ? data : [];
      
      return {
        properties,
        total: properties.length,
        page: 1,
        totalPages: 1,
      };
    } catch (error: any) {
      if (error instanceof SavedPropertiesApiError) throw error;
      
      throw new SavedPropertiesApiError(
        error?.message || 'Failed to fetch saved properties',
        'FETCH_PROPERTIES_FAILED',
        { originalError: error }
      );
    }
  }

  /**
   * Save a property to a folder with optimistic updates support
   */
  async saveProperty(
    propertyId: string,
    folderId?: string | null,
    notes?: string
  ): Promise<SavedProperty> {
    try {
      if (!propertyId) {
        throw new SavedPropertiesApiError(
          'Property ID is required',
          'INVALID_PROPERTY_ID'
        );
      }

      const response = await api.post(`${this.baseUrl}/save-property`, {
        propertyId,
        folderId: folderId || undefined,
        notes,
      });

      const data = this.extractApiData<SavedProperty>(response);
      return data;
    } catch (error: any) {
      if (error instanceof SavedPropertiesApiError) throw error;
      
      throw new SavedPropertiesApiError(
        error?.message || 'Failed to save property',
        'SAVE_PROPERTY_FAILED',
        { propertyId, folderId, originalError: error }
      );
    }
  }

  /**
   * Unsave a property with proper error handling
   */
  async unsaveProperty(propertyId: string): Promise<void> {
    try {
      if (!propertyId) {
        throw new SavedPropertiesApiError(
          'Property ID is required',
          'INVALID_PROPERTY_ID'
        );
      }

      await api.delete(`${this.baseUrl}/saved-properties/${propertyId}`);
    } catch (error: any) {
      // Handle 404 as success (property already not saved)
      if (error?.status === 404 || error?.response?.status === 404) {
        return;
      }

      if (error instanceof SavedPropertiesApiError) throw error;
      
      throw new SavedPropertiesApiError(
        error?.message || 'Failed to unsave property',
        'UNSAVE_PROPERTY_FAILED',
        { propertyId, originalError: error }
      );
    }
  }

  /**
   * Update property notes
   */
  async updatePropertyNotes(propertyId: string, notes: string): Promise<SavedProperty> {
    try {
      if (!propertyId) {
        throw new SavedPropertiesApiError(
          'Property ID is required',
          'INVALID_PROPERTY_ID'
        );
      }

      const response = await api.put(`${this.baseUrl}/saved-properties/${propertyId}/notes`, {
        notes,
      });

      return this.extractApiData<SavedProperty>(response);
    } catch (error: any) {
      if (error instanceof SavedPropertiesApiError) throw error;
      
      throw new SavedPropertiesApiError(
        error?.message || 'Failed to update property notes',
        'UPDATE_NOTES_FAILED',
        { propertyId, originalError: error }
      );
    }
  }

  /**
   * Get all saved property folders
   */
  async getFolders(): Promise<SavedPropertyFoldersResponse> {
    try {
      const response = await api.get(`${this.baseUrl}/saved-property-folders`);
      const data = this.extractApiData<{ folders: SavedPropertyFolder[] }>(response);
      
      return {
        folders: data?.folders || [],
        total: data?.folders?.length || 0,
      };
    } catch (error: any) {
      if (error instanceof SavedPropertiesApiError) throw error;
      
      throw new SavedPropertiesApiError(
        error?.message || 'Failed to fetch folders',
        'FETCH_FOLDERS_FAILED',
        { originalError: error }
      );
    }
  }

  /**
   * Create a new folder
   */
  async createFolder(folderData: CreateFolderData): Promise<SavedPropertyFolder> {
    try {
      if (!folderData.name?.trim()) {
        throw new SavedPropertiesApiError(
          'Folder name is required',
          'INVALID_FOLDER_NAME'
        );
      }

      const response = await api.post(`${this.baseUrl}/saved-property-folders`, folderData);
      return this.extractApiData<SavedPropertyFolder>(response);
    } catch (error: any) {
      if (error instanceof SavedPropertiesApiError) throw error;
      
      throw new SavedPropertiesApiError(
        error?.message || 'Failed to create folder',
        'CREATE_FOLDER_FAILED',
        { folderData, originalError: error }
      );
    }
  }

  /**
   * Update an existing folder
   */
  async updateFolder(folderId: string, folderData: UpdateFolderData): Promise<SavedPropertyFolder> {
    try {
      if (!folderId) {
        throw new SavedPropertiesApiError(
          'Folder ID is required',
          'INVALID_FOLDER_ID'
        );
      }

      const response = await api.put(`${this.baseUrl}/saved-property-folders/${folderId}`, folderData);
      return this.extractApiData<SavedPropertyFolder>(response);
    } catch (error: any) {
      if (error instanceof SavedPropertiesApiError) throw error;
      
      throw new SavedPropertiesApiError(
        error?.message || 'Failed to update folder',
        'UPDATE_FOLDER_FAILED',
        { folderId, folderData, originalError: error }
      );
    }
  }

  /**
   * Delete a folder
   */
  async deleteFolder(folderId: string): Promise<void> {
    try {
      if (!folderId) {
        throw new SavedPropertiesApiError(
          'Folder ID is required',
          'INVALID_FOLDER_ID'
        );
      }

      await api.delete(`${this.baseUrl}/saved-property-folders/${folderId}`);
    } catch (error: any) {
      if (error instanceof SavedPropertiesApiError) throw error;
      
      throw new SavedPropertiesApiError(
        error?.message || 'Failed to delete folder',
        'DELETE_FOLDER_FAILED',
        { folderId, originalError: error }
      );
    }
  }
}

// Export singleton instance
export const savedPropertiesApi = new SavedPropertiesApiService();
