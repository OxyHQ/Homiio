import api from '@/utils/api';
import type { Property } from './propertyService';

export interface SavedProperty extends Property {
  notes?: string;
  savedAt?: string;
}

export interface SavedPropertiesResponse {
  properties: SavedProperty[];
  total: number;
  page: number;
  totalPages: number;
}

class SavedPropertyService {
  private baseUrl = '/api/profiles/me/saved-properties';

  async getSavedProperties(oxyServices: any, activeSessionId: string): Promise<SavedPropertiesResponse> {
    const response = await api.get(this.baseUrl, {
      headers: {
        'Authorization': `Bearer ${activeSessionId}`,
        'Content-Type': 'application/json',
      },
    });
    
    return {
      properties: response.data.data || response.data || [],
      total: response.data.pagination?.total || 0,
      page: response.data.pagination?.page || 1,
      totalPages: response.data.pagination?.totalPages || 1,
    };
  }

  async saveProperty(
    propertyId: string, 
    notes?: string, 
    oxyServices: any, 
    activeSessionId: string
  ): Promise<void> {
    await api.post('/api/profiles/me/save-property', {
      propertyId,
      notes,
    }, {
      headers: {
        'Authorization': `Bearer ${activeSessionId}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async unsaveProperty(
    propertyId: string, 
    oxyServices: any, 
    activeSessionId: string
  ): Promise<void> {
    await api.delete(`/api/profiles/me/saved-properties/${propertyId}`, {
      headers: {
        'Authorization': `Bearer ${activeSessionId}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async updateNotes(
    propertyId: string, 
    notes: string, 
    oxyServices: any, 
    activeSessionId: string
  ): Promise<void> {
    await api.patch(`/api/profiles/me/saved-properties/${propertyId}/notes`, {
      notes,
    }, {
      headers: {
        'Authorization': `Bearer ${activeSessionId}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async bulkUnsave(
    propertyIds: string[], 
    oxyServices: any, 
    activeSessionId: string
  ): Promise<void> {
    await api.delete('/api/profiles/me/saved-properties/bulk', {
      data: { propertyIds },
      headers: {
        'Authorization': `Bearer ${activeSessionId}`,
        'Content-Type': 'application/json',
      },
    });
  }
}

export default new SavedPropertyService(); 