import { api, type RequestOwner } from '@/utils/api';
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
  async getSavedProperties(owner: RequestOwner): Promise<SavedPropertiesResponse> {
    const response = await api.get('/api/profiles/me/saved-properties', {
      requireAuth: true,
      owner,
    });

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
    owner: RequestOwner,
    propertyId: string,
    notes?: string,
    folderId?: string | null,
  ): Promise<any> {
    const response = await api.post(
      '/api/profiles/me/save-property',
      {
        propertyId,
        notes,
        folderId,
      },
      { requireAuth: true, owner },
    );
    return response.data;
  }

  async unsaveProperty(owner: RequestOwner, propertyId: string): Promise<any> {
    const response = await api.delete(`/api/profiles/me/saved-properties/${propertyId}`, {
      requireAuth: true,
      owner,
    });
    return response.data;
  }

  async updateNotes(owner: RequestOwner, propertyId: string, notes: string): Promise<void> {
    await api.patch(
      `/api/profiles/me/saved-properties/${propertyId}/notes`,
      {
        notes,
      },
      { requireAuth: true, owner },
    );
  }

  async bulkUnsave(owner: RequestOwner, propertyIds: string[]): Promise<void> {
    // For bulk operations, we'll need to implement this in the API utility
    // For now, we'll use individual calls
    const promises = propertyIds.map((propertyId) => this.unsaveProperty(owner, propertyId));
    await Promise.all(promises);
  }
}

export default new SavedPropertyService();
