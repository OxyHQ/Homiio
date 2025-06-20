import api, { getCacheKey, setCacheEntry, getCacheEntry, getOxyServices } from '@/utils/api';
import type { Property } from './propertyService';

export interface User {
  id: string;
  email: string;
  username: string;
  firstName?: string;
  lastName?: string;
  role: string;
  profile?: {
    phoneNumber?: string;
    dateOfBirth?: string;
    address?: {
      street?: string;
      city?: string;
      state?: string;
      zipCode?: string;
      country?: string;
    };
    occupation?: string;
    emergencyContact?: {
      name?: string;
      phoneNumber?: string;
      relationship?: string;
    };
  };
  preferences?: {
    emailNotifications?: boolean;
    pushNotifications?: boolean;
    language?: string;
    timezone?: string;
  };
  createdAt: string;
  updatedAt: string;
  emailVerified?: boolean;
  phoneVerified?: boolean;
}

export interface UpdateUserData {
  username?: string;
  firstName?: string;
  lastName?: string;
  profile?: User['profile'];
  preferences?: User['preferences'];
}

export interface UserFilters {
  role?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
}

class UserService {
  private baseUrl = '/api/users';

  async getCurrentUser(): Promise<User> {
    const cacheKey = getCacheKey(`${this.baseUrl}/me`);
    const cached = getCacheEntry<User>(cacheKey);
    
    if (cached) {
      return cached;
    }

    const response = await api.get(`${this.baseUrl}/me`);
    setCacheEntry(cacheKey, response.data.data);
    return response.data.data;
  }

  async updateCurrentUser(data: UpdateUserData): Promise<User> {
    const response = await api.put(`${this.baseUrl}/me`, data);
    
    // Clear user cache
    this.clearUserCache();
    
    return response.data.data;
  }

  async deleteCurrentUser(): Promise<void> {
    await api.delete(`${this.baseUrl}/me`);
    
    // Clear all caches
    this.clearUserCache();
  }

  async getUsers(filters?: UserFilters): Promise<{
    users: User[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const cacheKey = getCacheKey(this.baseUrl, filters);
    const cached = getCacheEntry<any>(cacheKey);
    
    if (cached) {
      return cached;
    }

    const response = await api.get(this.baseUrl, { params: filters });
    setCacheEntry(cacheKey, response.data);
    return response.data;
  }

  async getUserById(userId: string): Promise<User> {
    const cacheKey = getCacheKey(`${this.baseUrl}/${userId}`);
    const cached = getCacheEntry<User>(cacheKey);
    
    if (cached) {
      return cached;
    }

    const response = await api.get(`${this.baseUrl}/${userId}`);
    setCacheEntry(cacheKey, response.data.data);
    return response.data.data;
  }

  async updateUser(userId: string, data: UpdateUserData): Promise<User> {
    const response = await api.put(`${this.baseUrl}/${userId}`, data);
    
    // Clear related caches
    this.clearUserCache(userId);
    this.clearUsersCache();
    
    return response.data.data;
  }

  async deleteUser(userId: string): Promise<void> {
    await api.delete(`${this.baseUrl}/${userId}`);
    
    // Clear related caches
    this.clearUserCache(userId);
    this.clearUsersCache();
  }

  async getUserProperties(): Promise<{
    properties: any[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const cacheKey = getCacheKey(`${this.baseUrl}/me/properties`);
    const cached = getCacheEntry<any>(cacheKey);
    
    if (cached) {
      return cached;
    }

    const response = await api.get(`${this.baseUrl}/me/properties`);
    setCacheEntry(cacheKey, response.data, 300000); // 5 minute cache
    return response.data;
  }

  async getRecentlyViewedProperties(): Promise<Property[]> {
    const cacheKey = getCacheKey(`${this.baseUrl}/me/recent-properties`);
    const cached = getCacheEntry<Property[]>(cacheKey);

    if (cached) {
      console.log('Returning cached recent properties:', cached.length);
      return cached;
    }

    try {
      console.log('Fetching recent properties from API...');
      
      // Check if OxyServices is available
      const { oxyServices, activeSessionId } = getOxyServices();
      
      if (oxyServices && activeSessionId) {
        console.log('Using OxyServices authentication for recent properties');
        const tokenData = await oxyServices.getTokenBySession(activeSessionId);
        
        if (tokenData) {
          // Make authenticated request using the token
          const response = await fetch(`${api.defaults.baseURL}${this.baseUrl}/me/recent-properties`, {
            headers: {
              'Authorization': `Bearer ${tokenData.accessToken}`,
              'Content-Type': 'application/json',
            },
          });
          
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }
          
          const data = await response.json();
          const properties = data.data || data.properties || [];
          console.log('Recent properties API response (OxyServices):', properties.length);
          setCacheEntry(cacheKey, properties, 300000); // 5 minute cache
          return properties;
        }
      }
      
      // Fallback to the old method
      console.log('Using fallback authentication for recent properties');
      const response = await api.get(`${this.baseUrl}/me/recent-properties`, {
        timeout: 15000, // Increase timeout to 15 seconds
      });
      console.log('Recent properties API response (fallback):', response.data);
      const properties = response.data.data || response.data.properties || [];
      console.log('Parsed recent properties count:', properties.length);
      setCacheEntry(cacheKey, properties, 300000); // 5 minute cache
      return properties;
    } catch (error) {
      console.error('Error fetching recent properties:', error);
      // Return empty array on error instead of throwing
      return [];
    }
  }

  async getUserNotifications(): Promise<any[]> {
    const response = await api.get(`${this.baseUrl}/me/notifications`);
    return response.data.data;
  }

  async markNotificationAsRead(notificationId: string): Promise<void> {
    await api.patch(`${this.baseUrl}/me/notifications/${notificationId}/read`);
  }

  private clearUserCache(userId?: string) {
    const { clearCache } = require('@/utils/api');
    if (userId) {
      clearCache(`${this.baseUrl}/${userId}`);
    }
    clearCache(`${this.baseUrl}/me`);
  }

  private clearUsersCache() {
    const { clearCache } = require('@/utils/api');
    clearCache(this.baseUrl);
  }
}

export const userService = new UserService();