import { api } from '@/utils/api';
import type { Property } from '@homiio/shared-types';

/**
 * The signed-in person's recently-viewed history on the server.
 *
 * There is no write here: the server records a view when the detail screen
 * opens a listing (`propertyService.recordOpen`).
 */
export const recentlyViewedService = {
  /** The listings this person opened most recently, newest first. */
  async list(): Promise<Property[]> {
    const response = await api.get('/api/profiles/me/recent-properties');
    return response.data.data ?? [];
  },

  /** Forget this person's whole history. */
  async clear(): Promise<void> {
    await api.delete('/api/profiles/me/recent-properties');
  },
};
