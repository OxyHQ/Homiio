import { api } from '@/utils/api';
import { OxyServices } from '@oxyhq/services';

export interface SavedProperty {
  _id: string;
  title: string;
  description?: string;
  price: number;
  location: {
    address: string;
    city: string;
    state: string;
    zipCode: string;
  };
  images: string[];
  savedAt: string;
  notes?: string;
}

export interface SavePropertyRequest {
  propertyId: string;
  notes?: string;
}

export interface UpdateNotesRequest {
  notes: string;
}

class SavedPropertyService {
  /**
   * Get all saved properties for the current user
   */
  async getSavedProperties(oxyServices: OxyServices, activeSessionId: string): Promise<SavedProperty[]> {
    const response = await api.get('/api/profiles/me/saved-properties', {
      oxyServices,
      activeSessionId,
    });
    return response.data.data;
  }

  /**
   * Save a property
   */
  async saveProperty(data: SavePropertyRequest, oxyServices: OxyServices, activeSessionId: string): Promise<any> {
    const response = await api.post('/api/profiles/me/save-property', data, {
      oxyServices,
      activeSessionId,
    });
    return response.data.data;
  }

  /**
   * Unsave a property
   */
  async unsaveProperty(propertyId: string, oxyServices: OxyServices, activeSessionId: string): Promise<void> {
    await api.delete(`/api/profiles/me/saved-properties/${propertyId}`, {
      oxyServices,
      activeSessionId,
    });
  }

  /**
   * Update notes for a saved property
   */
  async updateNotes(propertyId: string, data: UpdateNotesRequest, oxyServices: OxyServices, activeSessionId: string): Promise<any> {
    const response = await api.put(`/api/profiles/me/saved-properties/${propertyId}/notes`, data, {
      oxyServices,
      activeSessionId,
    });
    return response.data.data;
  }
}

export const savedPropertyService = new SavedPropertyService();
export default savedPropertyService; 