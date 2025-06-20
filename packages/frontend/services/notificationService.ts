import api, { getCacheKey, setCacheEntry, getCacheEntry } from '@/utils/api';

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  app: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  read: boolean;
  createdAt: string;
  data?: any;
}

export interface NotificationFilters {
  unreadOnly?: boolean;
  type?: string;
  priority?: string;
  page?: number;
  limit?: number;
}

export interface NotificationSettings {
  userId: string;
  emailNotifications: {
    enabled: boolean;
    types: {
      payment_reminders: boolean;
      maintenance_requests: boolean;
      energy_alerts: boolean;
      system_updates: boolean;
      marketing: boolean;
    };
  };
  pushNotifications: {
    enabled: boolean;
    types: {
      payment_reminders: boolean;
      maintenance_requests: boolean;
      energy_alerts: boolean;
      system_updates: boolean;
      marketing: boolean;
    };
  };
  smsNotifications: {
    enabled: boolean;
    types: {
      payment_reminders: boolean;
      maintenance_requests: boolean;
      energy_alerts: boolean;
      system_updates: boolean;
      marketing: boolean;
    };
  };
  quietHours: {
    enabled: boolean;
    startTime: string;
    endTime: string;
    timezone: string;
  };
  frequency: {
    digest: 'daily' | 'weekly' | 'never';
    realTime: boolean;
  };
}

class NotificationService {
  private baseUrl = '/api/notifications';

  async getNotifications(filters?: NotificationFilters): Promise<{
    notifications: Notification[];
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
    setCacheEntry(cacheKey, response.data, 60000); // 1 minute cache for notifications
    return response.data;
  }

  async getNotification(notificationId: string): Promise<Notification> {
    const cacheKey = getCacheKey(`${this.baseUrl}/${notificationId}`);
    const cached = getCacheEntry<Notification>(cacheKey);
    
    if (cached) {
      return cached;
    }

    const response = await api.get(`${this.baseUrl}/${notificationId}`);
    setCacheEntry(cacheKey, response.data.data);
    return response.data.data;
  }

  async markAsRead(notificationId: string): Promise<void> {
    await api.patch(`${this.baseUrl}/${notificationId}/read`);
    
    // Clear notifications cache to refresh read status
    this.clearNotificationsCache();
  }

  async deleteNotification(notificationId: string): Promise<void> {
    await api.delete(`${this.baseUrl}/${notificationId}`);
    
    // Clear related caches
    this.clearNotificationCache(notificationId);
    this.clearNotificationsCache();
  }

  async markAllAsRead(): Promise<void> {
    await api.patch(`${this.baseUrl}/read-all`);
    
    // Clear notifications cache
    this.clearNotificationsCache();
  }

  async clearAllNotifications(): Promise<void> {
    await api.delete(`${this.baseUrl}/clear-all`);
    
    // Clear notifications cache
    this.clearNotificationsCache();
  }

  async getNotificationSettings(): Promise<NotificationSettings> {
    const cacheKey = getCacheKey(`${this.baseUrl}/preferences/settings`);
    const cached = getCacheEntry<NotificationSettings>(cacheKey);
    
    if (cached) {
      return cached;
    }

    const response = await api.get(`${this.baseUrl}/preferences/settings`);
    setCacheEntry(cacheKey, response.data.data, 300000); // 5 minute cache
    return response.data.data;
  }

  async updateNotificationSettings(settings: Partial<NotificationSettings>): Promise<NotificationSettings> {
    const response = await api.put(`${this.baseUrl}/preferences/settings`, settings);
    
    // Clear settings cache
    this.clearNotificationSettingsCache();
    
    return response.data.data;
  }

  // Utility methods
  async getUnreadCount(): Promise<number> {
    try {
      const response = await this.getNotifications({ unreadOnly: true, limit: 1 });
      return response.total;
    } catch (error) {
      console.error('Failed to get unread count:', error);
      return 0;
    }
  }

  async getNotificationsByType(type: string, limit = 10): Promise<Notification[]> {
    try {
      const response = await this.getNotifications({ type, limit });
      return response.notifications;
    } catch (error) {
      console.error(`Failed to get notifications by type ${type}:`, error);
      return [];
    }
  }

  async getHighPriorityNotifications(limit = 5): Promise<Notification[]> {
    try {
      const response = await this.getNotifications({ priority: 'high', limit });
      return response.notifications;
    } catch (error) {
      console.error('Failed to get high priority notifications:', error);
      return [];
    }
  }

  // Cache management
  private clearNotificationCache(notificationId: string) {
    const { clearCache } = require('@/utils/api');
    clearCache(`${this.baseUrl}/${notificationId}`);
  }

  private clearNotificationsCache() {
    const { clearCache } = require('@/utils/api');
    clearCache(this.baseUrl);
  }

  private clearNotificationSettingsCache() {
    const { clearCache } = require('@/utils/api');
    clearCache(`${this.baseUrl}/preferences/settings`);
  }
}

export const notificationService = new NotificationService();