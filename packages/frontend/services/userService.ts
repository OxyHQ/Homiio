import api from '@/utils/api';
import type { Property } from './propertyService';

export interface User {
  id: string;
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
    const response = await api.get(`${this.baseUrl}/me`);
    return response.data.data;
  }

  async updateCurrentUser(data: UpdateUserData): Promise<User> {
    const response = await api.put(`${this.baseUrl}/me`, data);
    return response.data.data;
  }

  async deleteCurrentUser(): Promise<void> {
    await api.delete(`${this.baseUrl}/me`);
  }

  async getUsers(filters?: UserFilters): Promise<{
    users: User[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const response = await api.get(this.baseUrl, { params: filters });
    return response.data;
  }

  async getUserById(userId: string): Promise<User> {
    const response = await api.get(`${this.baseUrl}/${userId}`);
    return response.data.data;
  }

  async updateUser(userId: string, data: UpdateUserData): Promise<User> {
    const response = await api.put(`${this.baseUrl}/${userId}`, data);
    return response.data.data;
  }

  async deleteUser(userId: string): Promise<void> {
    await api.delete(`${this.baseUrl}/${userId}`);
  }

  async getUserProperties(): Promise<{
    properties: any[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const response = await api.get(`${this.baseUrl}/me/properties`);
    return response.data;
  }

  async getRecentlyViewedProperties(): Promise<Property[]> {
    try {
      console.log('Fetching recent properties from API...');
      const response = await api.get(`${this.baseUrl}/me/recent-properties`);
      console.log('Recent properties API response:', response.data);
      const properties = response.data.data || response.data.properties || [];
      console.log('Parsed recent properties count:', properties.length);
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

}

export const userService = new UserService();