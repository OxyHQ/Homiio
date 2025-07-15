import { api } from '@/utils/api';
import { OxyServices } from '@oxyhq/services';
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
  async getSavedProperties(oxyServices: OxyServices, activeSessionId: string): Promise<SavedPropertiesResponse> {
    const response = await api.getSavedProperties(oxyServices, activeSessionId);
    
    return {
      properties: response.data?.properties || response.data || [],
      total: response.data?.pagination?.total || 0,
      page: response.data?.pagination?.page || 1,
      totalPages: response.data?.pagination?.totalPages || 1,
    };
  }

  async saveProperty(
    propertyId: string, 
    notes: string | undefined, 
    oxyServices: OxyServices, 
    activeSessionId: string
  ): Promise<void> {
    await api.saveProperty(propertyId, notes, oxyServices, activeSessionId);
  }

  async unsaveProperty(
    propertyId: string, 
    oxyServices: OxyServices, 
    activeSessionId: string
  ): Promise<void> {
    await api.unsaveProperty(propertyId, oxyServices, activeSessionId);
  }

  async updateNotes(
    propertyId: string, 
    notes: string, 
    oxyServices: OxyServices, 
    activeSessionId: string
  ): Promise<void> {
    await api.updateSavedPropertyNotes(propertyId, notes, oxyServices, activeSessionId);
  }

  async bulkUnsave(
    propertyIds: string[], 
    oxyServices: OxyServices, 
    activeSessionId: string
  ): Promise<void> {
    // For bulk operations, we'll need to implement this in the API utility
    // For now, we'll use individual calls
    const promises = propertyIds.map(propertyId => 
      this.unsaveProperty(propertyId, oxyServices, activeSessionId)
    );
    await Promise.all(promises);
  }
}

export default new SavedPropertyService(); 