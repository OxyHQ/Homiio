# Notifications System

This document describes the comprehensive notification system implemented in the Homiio React Native Expo app using Expo Notifications.

## Overview

The notification system provides:
- **Local notifications** for immediate user feedback
- **Scheduled notifications** for reminders and timed alerts
- **Server notifications** via WebSocket for real-time updates
- **Badge management** for app icon unread counts
- **Permission management** with user-friendly prompts
- **Notification preferences** for granular control
- **Notification categories** for different types of alerts

## Architecture

### Core Components

1. **NotificationContext** (`context/NotificationContext.tsx`)
   - Central state management for all notification-related data
   - Handles permission requests, badge management, and socket connections
   - Provides unified API for notification operations

2. **Notification Utilities** (`utils/notifications.ts`)
   - Low-level notification functions using Expo Notifications
   - Platform-specific handling for iOS and Android
   - Utility functions for common notification types

3. **Notification Service** (`services/notificationService.ts`)
   - Server-side notification management
   - API integration for fetching and managing notifications
   - Real-time notification handling

4. **Notification Socket** (`utils/notificationsSocket.ts`)
   - WebSocket connection for real-time notifications
   - Automatic reconnection and error handling
   - Token refresh management

### Screens

1. **Notifications Screen** (`app/notifications.tsx`)
   - Main notifications list with filtering and search
   - Support for both server and local notifications
   - Mark as read, delete, and management functions

2. **Notification Settings** (`app/settings/notifications.tsx`)
   - User preferences for notification categories
   - Permission management
   - Test notification functionality

### Components

1. **NotificationBadge** (`components/NotificationBadge.tsx`)
   - Reusable badge component for navigation
   - Configurable size and appearance
   - Automatic unread count display

2. **NotificationItem** (`components/NotificationItem.tsx`)
   - Individual notification display component
   - Type-specific icons and styling
   - Read/unread state management

## Setup

### 1. App Configuration

The notification system is already configured in `app.config.js`:

```javascript
plugins: [
  [
    'expo-notifications',
    {
      color: '#ffffff',
    },
  ],
  // ... other plugins
]
```

### 2. Provider Setup

The `NotificationProvider` is included in the app layout:

```tsx
// app/_layout.tsx
import { NotificationProvider } from '@/context/NotificationContext';

export default function RootLayout() {
  return (
    <NotificationProvider>
      {/* Your app components */}
    </NotificationProvider>
  );
}
```

### 3. Permission Request

Permissions are automatically requested on app startup, but you can also request them manually:

```tsx
import { useNotifications } from '@/context/NotificationContext';

function MyComponent() {
  const { requestPermissions, hasPermission } = useNotifications();
  
  const handleRequestPermissions = async () => {
    const granted = await requestPermissions();
    if (granted) {
      console.log('Notifications enabled');
    }
  };
}
```

## Usage

### Basic Notification Management

```tsx
import { useNotifications } from '@/context/NotificationContext';

function MyComponent() {
  const {
    notifications,
    unreadCount,
    markAsRead,
    deleteNotification,
    createLocalNotification,
  } = useNotifications();

  // Create a simple notification
  const showNotification = async () => {
    await createLocalNotification(
      'Hello!',
      'This is a test notification',
      { screen: 'home' }
    );
  };

  // Mark notification as read
  const handleNotificationPress = async (notification) => {
    if (!notification.read) {
      await markAsRead(notification.id);
    }
    // Navigate to relevant screen
  };
}
```

### Using the Notification Manager Hook

For common notification patterns, use the `useNotificationManager` hook:

```tsx
import { useNotificationManager } from '@/hooks/useNotificationManager';

function PropertyComponent({ property }) {
  const {
    notifyNewProperty,
    notifyPriceChange,
    notifyViewingReminder,
  } = useNotificationManager();

  // Notify about new property
  const handleNewProperty = async () => {
    await notifyNewProperty(
      property.id,
      property.title,
      property.price,
      property.location
    );
  };

  // Notify about price change
  const handlePriceChange = async (oldPrice, newPrice) => {
    await notifyPriceChange(
      property.id,
      property.title,
      oldPrice,
      newPrice
    );
  };

  // Schedule viewing reminder
  const scheduleViewing = async (date, time) => {
    await notifyViewingReminder(
      property.id,
      property.title,
      date,
      time
    );
  };
}
```

### Notification Badge Component

```tsx
import { NotificationBadge } from '@/components/NotificationBadge';

function NavigationBar() {
  return (
    <View style={styles.navBar}>
      <NotificationBadge 
        size="medium"
        showCount={true}
        iconName="notifications-outline"
      />
    </View>
  );
}
```

## Notification Types

### 1. Property Notifications

```tsx
// New property available
await notifyNewProperty(propertyId, title, price, location);

// Price change alert
await notifyPriceChange(propertyId, title, oldPrice, newPrice);

// Viewing reminder
await notifyViewingReminder(propertyId, title, date, time);
```

### 2. Message Notifications

```tsx
// New message received
await notifyNewMessage(messageId, senderName, preview, senderId);
```

### 3. Contract Notifications

```tsx
// Contract status update
await notifyContractUpdate(
  contractId,
  title,
  'signed', // or 'expired', 'pending', 'approved', 'rejected'
  additionalInfo
);
```

### 4. Payment Notifications

```tsx
// Payment received
await notifyPaymentReceived(paymentId, amount, propertyTitle);

// Payment due reminder
await notifyPaymentDue(paymentId, amount, dueDate, propertyTitle);
```

### 5. System Notifications

```tsx
// System update
await notifySystemUpdate(title, message, 'high');

// App update available
await notifyAppUpdate(version, ['New Feature 1', 'New Feature 2']);
```

### 6. Scheduled Notifications

```tsx
// Daily digest
await scheduleDailyDigest(title, message, { customData: 'value' });

// Weekly digest
await scheduleWeeklyDigest(title, message, { customData: 'value' });
```

## Notification Preferences

Users can customize their notification preferences:

```tsx
import { useNotifications } from '@/context/NotificationContext';

function SettingsComponent() {
  const { preferences, updatePreferences } = useNotifications();

  const togglePropertyNotifications = async (enabled) => {
    await updatePreferences({ property: enabled });
  };

  return (
    <Switch
      value={preferences.property}
      onValueChange={togglePropertyNotifications}
    />
  );
}
```

## Platform-Specific Features

### iOS

- **Notification Categories**: Custom action buttons for different notification types
- **Rich Notifications**: Support for images and custom UI
- **Silent Notifications**: Background processing without user interaction

### Android

- **Notification Channels**: Granular control over notification behavior
- **Notification Groups**: Group related notifications together
- **Priority Levels**: Different importance levels for notifications

## Testing

### Test Notifications

Use the test functions in the settings screen:

```tsx
// Test property notification
await testPropertyNotification();

// Test message notification
await testMessageNotification();

// Test reminder notification
await testReminderNotification();

// Test repeating notification
await testRepeatingNotification();
```

### Development Mode

In development mode, a demo notification is automatically scheduled when permissions are granted:

```tsx
// This happens automatically in _layout.tsx
if (hasPermission && __DEV__) {
  await scheduleDemoNotification();
}
```

## Error Handling

The notification system includes comprehensive error handling:

```tsx
try {
  await createLocalNotification(title, body, data);
} catch (error) {
  console.error('Notification error:', error);
  // Handle error appropriately
  toast.error('Failed to send notification');
}
```

## Best Practices

### 1. Permission Management

- Always check permissions before sending notifications
- Provide clear explanations for why notifications are needed
- Handle permission denial gracefully

### 2. Notification Content

- Keep titles short and descriptive (under 40 characters)
- Use clear, actionable body text
- Include relevant data for navigation

### 3. Timing and Frequency

- Don't overwhelm users with too many notifications
- Use appropriate priority levels
- Consider user timezone for scheduled notifications

### 4. User Experience

- Provide clear navigation paths from notifications
- Allow users to manage notification preferences
- Respect user preferences for different notification types

## Troubleshooting

### Common Issues

1. **Notifications not showing**
   - Check if permissions are granted
   - Verify notification settings in device settings
   - Ensure app is not in foreground (for some notification types)

2. **Badge count not updating**
   - Check if badge permissions are enabled
   - Verify badge count logic in notification handlers
   - Clear and reset badge count if needed

3. **Scheduled notifications not firing**
   - Check if device allows background app refresh
   - Verify notification scheduling logic
   - Test with shorter intervals first

### Debug Mode

Enable debug logging by setting the environment variable:

```bash
EXPO_DEBUG=true
```

This will log detailed information about notification operations.

## API Reference

### NotificationContext

```tsx
interface NotificationContextType {
  // State
  hasPermission: boolean;
  badgeCount: number;
  notifications: Notification[];
  unreadCount: number;
  preferences: NotificationPreferences;
  
  // Actions
  requestPermissions(): Promise<boolean>;
  createLocalNotification(title, body, data, options): Promise<string>;
  markAsRead(notificationId): Promise<void>;
  updatePreferences(preferences): Promise<void>;
  // ... more methods
}
```

### Notification Utilities

```tsx
// Create immediate notification
createNotification(title, body, data, options): Promise<string>;

// Schedule notification
scheduleNotification(content, trigger, repeats): Promise<string>;

// Cancel notification
cancelNotification(notificationId): Promise<void>;

// Badge management
setBadgeCount(count): Promise<void>;
clearBadge(): Promise<void>;
```

## Future Enhancements

- **Rich Notifications**: Support for images, videos, and custom UI
- **Action Buttons**: Custom actions for different notification types
- **Notification History**: Persistent storage of notification history
- **Advanced Scheduling**: More complex scheduling patterns
- **Analytics**: Track notification engagement and effectiveness
- **A/B Testing**: Test different notification strategies
- **Smart Notifications**: AI-powered notification timing and content

## Contributing

When adding new notification features:

1. Follow the existing patterns and architecture
2. Add appropriate TypeScript types
3. Include error handling
4. Add tests for new functionality
5. Update documentation
6. Consider platform-specific behavior
7. Test on both iOS and Android devices
