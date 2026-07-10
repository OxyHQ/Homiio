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

export interface NotificationListResponse {
  notifications: Notification[];
  unreadCount: number;
  total: number;
  page: number;
  totalPages: number;
}

class NotificationService {
  private baseUrl = '/api/notifications';

  async getNotifications(filters?: NotificationFilters): Promise<NotificationListResponse> {
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

  // Utility methods
  async getUnreadCount(): Promise<number> {
    const response = await this.getNotifications({ limit: 1 });
    return response.unreadCount;
  }
}

export const notificationService = new NotificationService();
