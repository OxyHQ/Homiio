import api from '@/utils/api';

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
      system_updates: boolean;
      marketing: boolean;
    };
  };
  pushNotifications: {
    enabled: boolean;
    types: {
      payment_reminders: boolean;
      maintenance_requests: boolean;
      system_updates: boolean;
      marketing: boolean;
    };
  };
  smsNotifications: {
    enabled: boolean;
    types: {
      payment_reminders: boolean;
      maintenance_requests: boolean;
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
    const response = await api.get(this.baseUrl, { params: filters });
    return response.data;
  }

  async getNotification(notificationId: string): Promise<Notification> {
    const response = await api.get(`${this.baseUrl}/${notificationId}`);
    return response.data.data;
  }

  async markAsRead(notificationId: string): Promise<void> {
    await api.patch(`${this.baseUrl}/${notificationId}/read`);
  }

  async deleteNotification(notificationId: string): Promise<void> {
    await api.delete(`${this.baseUrl}/${notificationId}`);
  }

  async markAllAsRead(): Promise<void> {
    await api.patch(`${this.baseUrl}/read-all`);
  }

  async clearAllNotifications(): Promise<void> {
    await api.delete(`${this.baseUrl}/clear-all`);
  }

  async getNotificationSettings(): Promise<NotificationSettings> {
    const response = await api.get(`${this.baseUrl}/preferences/settings`);
    return response.data.data;
  }

  async updateNotificationSettings(
    settings: Partial<NotificationSettings>,
  ): Promise<NotificationSettings> {
    const response = await api.put(`${this.baseUrl}/preferences/settings`, settings);
    return response.data.data;
  }

  // Utility methods
  async getUnreadCount(): Promise<number> {
    try {
      const response = await this.getNotifications({ unreadOnly: true, limit: 1 });
      return response.total;
    } catch (error) {
      return 0;
    }
  }

  async getNotificationsByType(type: string, limit = 10): Promise<Notification[]> {
    try {
      const response = await this.getNotifications({ type, limit });
      return response.notifications;
    } catch (error) {
      return [];
    }
  }

  async getHighPriorityNotifications(limit = 5): Promise<Notification[]> {
    try {
      const response = await this.getNotifications({ priority: 'high', limit });
      return response.notifications;
    } catch (error) {
      return [];
    }
  }
}

export const notificationService = new NotificationService();
