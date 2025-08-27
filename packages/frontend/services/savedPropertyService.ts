import { api } from '@/utils/api';
import type { SavedProperty as SharedSavedProperty } from '@homiio/shared-types';

export type SavedProperty = SharedSavedProperty & {
  savedAt?: string;
  folderId?: string;
};

export interface SavedPropertiesResponse {
  properties: SavedProperty[];
  total: number;
  page: number;
  totalPages: number;
}

class SavedPropertyService {
  async getSavedProperties(): Promise<SavedPropertiesResponse> {
    const response = await api.get('/api/profiles/me/saved-properties');
    
    // The API returns { success: true, data: [...], message: "..." }
    // where response.data contains the wrapper and response.data.data contains the actual properties array
    const properties = Array.isArray(response.data.data) ? response.data.data : [];
    
    return {
      properties,
      total: properties.length,
      page: 1,
      totalPages: 1,
    };
  }

  async saveProperty(
    propertyId: string,
    notes?: string,
    folderId?: string | null,
  ): Promise<any> {
    const response = await api.post('/api/profiles/me/save-property', {
      propertyId,
      notes,
      folderId,
    });
    return response.data;
  }

  async unsaveProperty(propertyId: string): Promise<any> {
    const response = await api.delete(`/api/profiles/me/saved-properties/${propertyId}`);
    return response.data;
  }

  async updateNotes(propertyId: string, notes: string): Promise<void> {
    await api.patch(`/api/profiles/me/saved-properties/${propertyId}/notes`, {
      notes,
    });
  }

  async bulkUnsave(propertyIds: string[]): Promise<void> {
    // For bulk operations, we'll need to implement this in the API utility
    // For now, we'll use individual calls
    const promises = propertyIds.map((propertyId) =>
      this.unsaveProperty(propertyId),
    );
    await Promise.all(promises);
  }
}

export default new SavedPropertyService();
