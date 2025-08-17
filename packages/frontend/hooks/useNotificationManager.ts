import { useCallback } from 'react';
import { useNotifications } from '@/context/NotificationContext';
import {
  createPropertyNotification,
  createMessageNotification,
  createReminderNotification,
  createRepeatingNotification,
  NotificationData,
} from '@/utils/notifications';

export function useNotificationManager() {
  const {
    createLocalNotification,
    scheduleLocalNotification,
    cancelLocalNotification,
    cancelAllLocalNotifications,
    updateBadgeCount,
    clearBadgeCount,
    hasPermission,
    requestPermissions,
  } = useNotifications();

  // Property-related notifications
  const notifyNewProperty = useCallback(async (
    propertyId: string,
    propertyTitle: string,
    price?: string,
    location?: string
  ) => {
    try {
      const title = 'New Property Available';
      const body = `${propertyTitle}${price ? ` - ${price}` : ''}${location ? ` in ${location}` : ''}`;
      
      await createPropertyNotification(propertyId, title, body, {
        propertyId,
        propertyTitle,
        price,
        location,
      });
    } catch (error) {
      console.error('Error creating property notification:', error);
    }
  }, []);

  const notifyPriceChange = useCallback(async (
    propertyId: string,
    propertyTitle: string,
    oldPrice: string,
    newPrice: string
  ) => {
    try {
      const title = 'Price Change Alert';
      const body = `${propertyTitle} price changed from ${oldPrice} to ${newPrice}`;
      
      await createPropertyNotification(propertyId, title, body, {
        propertyId,
        propertyTitle,
        oldPrice,
        newPrice,
        type: 'price_change',
      });
    } catch (error) {
      console.error('Error creating price change notification:', error);
    }
  }, []);

  const notifyViewingReminder = useCallback(async (
    propertyId: string,
    propertyTitle: string,
    viewingDate: Date,
    viewingTime: string
  ) => {
    try {
      const title = 'Property Viewing Reminder';
      const body = `Your viewing for ${propertyTitle} is scheduled for ${viewingTime}`;
      
      await createReminderNotification(title, body, viewingDate, {
        propertyId,
        propertyTitle,
        viewingTime,
        type: 'viewing_reminder',
      });
    } catch (error) {
      console.error('Error creating viewing reminder notification:', error);
    }
  }, []);

  // Message-related notifications
  const notifyNewMessage = useCallback(async (
    messageId: string,
    senderName: string,
    messagePreview: string,
    senderId?: string
  ) => {
    try {
      await createMessageNotification(messageId, senderName, messagePreview, {
        senderId,
        messagePreview,
        type: 'new_message',
      });
    } catch (error) {
      console.error('Error creating message notification:', error);
    }
  }, []);

  // Contract-related notifications
  const notifyContractUpdate = useCallback(async (
    contractId: string,
    contractTitle: string,
    updateType: 'signed' | 'expired' | 'pending' | 'approved' | 'rejected',
    additionalInfo?: string
  ) => {
    try {
      let title = 'Contract Update';
      let body = `${contractTitle} - `;
      
      switch (updateType) {
        case 'signed':
          body += 'Contract has been signed';
          break;
        case 'expired':
          body += 'Contract has expired';
          break;
        case 'pending':
          body += 'Contract is pending your signature';
          break;
        case 'approved':
          body += 'Contract has been approved';
          break;
        case 'rejected':
          body += 'Contract has been rejected';
          break;
      }
      
      if (additionalInfo) {
        body += ` - ${additionalInfo}`;
      }
      
      await createLocalNotification(title, body, {
        contractId,
        contractTitle,
        updateType,
        additionalInfo,
        type: 'contract_update',
      });
    } catch (error) {
      console.error('Error creating contract notification:', error);
    }
  }, [createLocalNotification]);

  // Payment-related notifications
  const notifyPaymentReceived = useCallback(async (
    paymentId: string,
    amount: string,
    propertyTitle?: string
  ) => {
    try {
      const title = 'Payment Received';
      const body = `Payment of ${amount} received${propertyTitle ? ` for ${propertyTitle}` : ''}`;
      
      await createLocalNotification(title, body, {
        paymentId,
        amount,
        propertyTitle,
        type: 'payment_received',
      });
    } catch (error) {
      console.error('Error creating payment notification:', error);
    }
  }, [createLocalNotification]);

  const notifyPaymentDue = useCallback(async (
    paymentId: string,
    amount: string,
    dueDate: Date,
    propertyTitle?: string
  ) => {
    try {
      const title = 'Payment Due';
      const body = `Payment of ${amount} is due${propertyTitle ? ` for ${propertyTitle}` : ''}`;
      
      await createReminderNotification(title, body, dueDate, {
        paymentId,
        amount,
        propertyTitle,
        type: 'payment_due',
      });
    } catch (error) {
      console.error('Error creating payment due notification:', error);
    }
  }, []);

  // System notifications
  const notifySystemUpdate = useCallback(async (
    title: string,
    message: string,
    priority: 'low' | 'normal' | 'high' = 'normal'
  ) => {
    try {
      await createLocalNotification(title, message, {
        type: 'system_update',
        priority,
      }, { priority });
    } catch (error) {
      console.error('Error creating system notification:', error);
    }
  }, [createLocalNotification]);

  const notifyAppUpdate = useCallback(async (
    version: string,
    features?: string[]
  ) => {
    try {
      const title = 'App Update Available';
      let body = `Version ${version} is now available`;
      
      if (features && features.length > 0) {
        body += ` with new features: ${features.join(', ')}`;
      }
      
      await createLocalNotification(title, body, {
        version,
        features,
        type: 'app_update',
      }, { priority: 'high' });
    } catch (error) {
      console.error('Error creating app update notification:', error);
    }
  }, [createLocalNotification]);

  // Marketing notifications
  const notifyPromotion = useCallback(async (
    title: string,
    message: string,
    promotionId?: string
  ) => {
    try {
      await createLocalNotification(title, message, {
        promotionId,
        type: 'promotion',
      });
    } catch (error) {
      console.error('Error creating promotion notification:', error);
    }
  }, [createLocalNotification]);

  // Repeating notifications
  const scheduleDailyDigest = useCallback(async (
    title: string,
    message: string,
    data?: NotificationData
  ) => {
    try {
      await createRepeatingNotification(title, message, 'day', {
        type: 'daily_digest',
        ...data,
      });
    } catch (error) {
      console.error('Error scheduling daily digest:', error);
    }
  }, []);

  const scheduleWeeklyDigest = useCallback(async (
    title: string,
    message: string,
    data?: NotificationData
  ) => {
    try {
      await createRepeatingNotification(title, message, 'week', {
        type: 'weekly_digest',
        ...data,
      });
    } catch (error) {
      console.error('Error scheduling weekly digest:', error);
    }
  }, []);

  // Utility functions
  const clearAllNotifications = useCallback(async () => {
    try {
      await cancelAllLocalNotifications();
      await clearBadgeCount();
    } catch (error) {
      console.error('Error clearing all notifications:', error);
    }
  }, [cancelAllLocalNotifications, clearBadgeCount]);

  const setNotificationBadge = useCallback(async (count: number) => {
    try {
      await updateBadgeCount(count);
    } catch (error) {
      console.error('Error setting notification badge:', error);
    }
  }, [updateBadgeCount]);

  return {
    // Permission management
    hasPermission,
    requestPermissions,
    
    // Property notifications
    notifyNewProperty,
    notifyPriceChange,
    notifyViewingReminder,
    
    // Message notifications
    notifyNewMessage,
    
    // Contract notifications
    notifyContractUpdate,
    
    // Payment notifications
    notifyPaymentReceived,
    notifyPaymentDue,
    
    // System notifications
    notifySystemUpdate,
    notifyAppUpdate,
    
    // Marketing notifications
    notifyPromotion,
    
    // Repeating notifications
    scheduleDailyDigest,
    scheduleWeeklyDigest,
    
    // Utility functions
    clearAllNotifications,
    setNotificationBadge,
    createLocalNotification,
    scheduleLocalNotification,
    cancelLocalNotification,
  };
}
