# Homiio API Documentation

## Overview
Complete REST API documentation for the Homiio backend with all implemented routes and endpoints.

## Base URL
- Development: `http://localhost:4000/api`
- Production: `https://your-domain.com/api`

## Authentication
The API uses JWT (JSON Web Tokens) for authentication. Include the token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## Routes Overview

### Authentication Routes (`/api/auth`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| POST | `/login` | User login | No |
| POST | `/register` | User registration | No |
| POST | `/refresh` | Refresh access token | No |
| GET | `/validate` | Validate access token | Yes |
| POST | `/logout` | User logout | Yes |
| POST | `/forgot-password` | Request password reset | No |
| POST | `/reset-password` | Reset password | No |

### User Management Routes (`/api/users`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/me` | Get current user profile | Yes |
| PUT | `/me` | Update current user profile | Yes |
| DELETE | `/me` | Delete current user account | Yes |
| GET | `/` | Get all users (admin only) | Yes (Admin) |
| GET | `/:userId` | Get user by ID | Yes |
| PUT | `/:userId` | Update user (admin only) | Yes (Admin) |
| DELETE | `/:userId` | Delete user (admin only) | Yes (Admin) |
| GET | `/me/properties` | Get user's properties | Yes |
| GET | `/me/notifications` | Get user's notifications | Yes |
| PATCH | `/me/notifications/:notificationId/read` | Mark notification as read | Yes |

### Property Management Routes (`/api/properties`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/` | List properties | No |
| GET | `/search` | Search properties | No |
| GET | `/:propertyId` | Get property by ID | No |
| POST | `/` | Create property | Yes |
| PUT | `/:propertyId` | Update property | Yes (Owner) |
| DELETE | `/:propertyId` | Delete property | Yes (Owner) |
| GET | `/my/properties` | Get user's properties | Yes |
| GET | `/:propertyId/energy` | Get property energy data | Yes |
| POST | `/:propertyId/energy/configure` | Configure energy monitoring | Yes (Owner) |
| GET | `/:propertyId/stats` | Get property statistics | Yes (Owner) |

### Room Management Routes (`/api/properties/:propertyId/rooms`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/search` | Search rooms | No |
| POST | `/` | Create room | Yes (Owner) |
| GET | `/` | Get property rooms | Yes |
| GET | `/statistics` | Get room statistics | Yes (Owner) |
| GET | `/:roomId` | Get room by ID | Yes |
| PUT | `/:roomId` | Update room | Yes (Owner) |
| DELETE | `/:roomId` | Delete room | Yes (Owner) |
| GET | `/:roomId/stats` | Get room statistics | Yes (Owner) |
| PATCH | `/:roomId/availability` | Update room availability | Yes (Owner) |
| POST | `/:roomId/assign` | Assign tenant to room | Yes (Owner) |
| POST | `/:roomId/unassign` | Unassign tenant from room | Yes (Owner) |
| GET | `/:roomId/energy` | Get room energy data | Yes |

### Device Management Routes (`/api/devices`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/` | Get user's devices | Yes |
| POST | `/` | Create device | Yes |
| GET | `/:deviceId` | Get device by ID | Yes (Owner) |
| PUT | `/:deviceId` | Update device | Yes (Owner) |
| DELETE | `/:deviceId` | Delete device | Yes (Owner) |
| GET | `/:deviceId/data` | Get device data | Yes (Owner) |
| POST | `/:deviceId/data` | Submit device data | Yes (API Key) |
| GET | `/:deviceId/config` | Get device configuration | Yes (Owner) |
| PUT | `/:deviceId/config` | Update device configuration | Yes (Owner) |
| GET | `/:deviceId/status` | Get device status | Yes (Owner) |
| POST | `/:deviceId/ping` | Device ping/heartbeat | Yes (API Key) |

### Lease Management Routes (`/api/leases`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/` | Get user's leases | Yes |
| POST | `/` | Create lease | Yes |
| GET | `/:leaseId` | Get lease by ID | Yes (Participant) |
| PUT | `/:leaseId` | Update lease | Yes (Participant) |
| DELETE | `/:leaseId` | Delete lease | Yes (Participant) |
| POST | `/:leaseId/sign` | Sign lease | Yes (Participant) |
| POST | `/:leaseId/terminate` | Terminate lease | Yes (Participant) |
| POST | `/:leaseId/renew` | Renew lease | Yes (Participant) |
| GET | `/:leaseId/payments` | Get lease payments | Yes (Participant) |
| POST | `/:leaseId/payments` | Create payment | Yes (Participant) |
| GET | `/:leaseId/documents` | Get lease documents | Yes (Participant) |
| POST | `/:leaseId/documents` | Upload lease document | Yes (Participant) |

### Notification Management Routes (`/api/notifications`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/` | Get user notifications | Yes |
| GET | `/:notificationId` | Get notification by ID | Yes |
| PATCH | `/:notificationId/read` | Mark notification as read | Yes |
| DELETE | `/:notificationId` | Delete notification | Yes |
| PATCH | `/read-all` | Mark all notifications as read | Yes |
| DELETE | `/clear-all` | Clear all notifications | Yes |
| GET | `/preferences/settings` | Get notification settings | Yes |
| PUT | `/preferences/settings` | Update notification settings | Yes |

### Analytics Routes (`/api/analytics`)
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/` | Get user analytics | Yes |

### Health Check Routes
| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | `/health` | API health check | No |
| GET | `/api/health` | Detailed API health | No |

## Frontend Services

The following TypeScript services are available in the frontend:

### AuthService (`authService.ts`)
- `login(credentials)` - User authentication
- `register(userData)` - User registration
- `refreshToken(token)` - Token refresh
- `validateToken()` - Token validation
- `logout()` - User logout
- `forgotPassword(email)` - Password reset request
- `resetPassword(token, password)` - Password reset

### UserService (`userService.ts`)
- `getCurrentUser()` - Get current user profile
- `updateCurrentUser(data)` - Update profile
- `deleteCurrentUser()` - Delete account
- `getUsers(filters)` - Get all users (admin)
- `getUserById(id)` - Get user by ID
- `updateUser(id, data)` - Update user (admin)
- `deleteUser(id)` - Delete user (admin)
- `getUserProperties()` - Get user's properties
- `getUserNotifications()` - Get notifications
- `markNotificationAsRead(id)` - Mark notification read

### PropertyService (`propertyService.ts`)
- `getProperties(filters)` - List properties
- `getProperty(id)` - Get property details
- `createProperty(data)` - Create property
- `updateProperty(id, data)` - Update property
- `deleteProperty(id)` - Delete property
- `searchProperties(query, filters)` - Search properties
- `getPropertyStats(id)` - Get property statistics
- `getPropertyEnergyStats(id, period)` - Get energy stats

### RoomService (`roomService.ts`)
- `getRooms(propertyId, filters)` - Get property rooms
- `getRoom(propertyId, roomId)` - Get room details
- `createRoom(propertyId, data)` - Create room
- `updateRoom(propertyId, roomId, data)` - Update room
- `deleteRoom(propertyId, roomId)` - Delete room
- `searchRooms(propertyId, query, filters)` - Search rooms
- `getRoomStats(propertyId, roomId)` - Get room statistics
- `getRoomEnergyStats(propertyId, roomId, period)` - Get energy stats
- `assignTenant(propertyId, roomId, tenantId)` - Assign tenant
- `unassignTenant(propertyId, roomId)` - Unassign tenant

### DeviceService (`deviceService.ts`)
- `getDevices(filters)` - List devices
- `getDevice(id)` - Get device details
- `createDevice(data)` - Create device
- `updateDevice(id, data)` - Update device
- `deleteDevice(id)` - Delete device
- `getDeviceData(id, options)` - Get device data
- `submitDeviceData(id, data)` - Submit device data
- `getDeviceConfig(id)` - Get device configuration
- `updateDeviceConfig(id, config)` - Update configuration
- `getDeviceStatus(id)` - Get device status
- `pingDevice(id, status, metrics)` - Send device ping

### LeaseService (`leaseService.ts`)
- `getLeases(filters)` - List leases
- `getLease(id)` - Get lease details
- `createLease(data)` - Create lease
- `updateLease(id, data)` - Update lease
- `deleteLease(id)` - Delete lease
- `signLease(id, signature, acceptTerms)` - Sign lease
- `terminateLease(id, reason, date, notice)` - Terminate lease
- `renewLease(id, data)` - Renew lease
- `getLeasePayments(id, filters)` - Get lease payments
- `createPayment(id, data)` - Create payment
- `getLeaseDocuments(id)` - Get lease documents
- `uploadLeaseDocument(id, file, type, desc)` - Upload document

### NotificationService (`notificationService.ts`)
- `getNotifications(filters)` - List notifications
- `getNotification(id)` - Get notification details
- `markAsRead(id)` - Mark notification as read
- `deleteNotification(id)` - Delete notification
- `markAllAsRead()` - Mark all as read
- `clearAllNotifications()` - Clear all notifications
- `getNotificationSettings()` - Get settings
- `updateNotificationSettings(settings)` - Update settings
- `getUnreadCount()` - Get unread count
- `getNotificationsByType(type, limit)` - Get by type
- `getHighPriorityNotifications(limit)` - Get high priority

## Error Handling

All endpoints return standardized error responses:

```json
{
  "success": false,
  "error": {
    "message": "Error description",
    "code": "ERROR_CODE",
    "statusCode": 400
  }
}
```

## Success Response Format

All successful responses follow this format:

```json
{
  "success": true,
  "message": "Operation successful",
  "data": { ... },
  "meta": {
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

## Pagination

List endpoints support pagination with the following query parameters:
- `page` - Page number (default: 1)
- `limit` - Items per page (default: 10, max: 100)
- `sortBy` - Sort field
- `sortOrder` - Sort direction (asc/desc)

Paginated responses include:

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 50,
    "totalPages": 5,
    "hasNext": true,
    "hasPrev": false,
    "nextPage": 2,
    "prevPage": null
  }
}
```

## Integration Status

✅ **Complete Backend Infrastructure**
- Authentication system with JWT tokens
- User management with role-based access
- Property and room management
- IoT device monitoring and control
- Lease management with digital signatures
- Notification system with preferences
- Analytics with fallback data

✅ **Complete Frontend Services**
- Type-safe TypeScript services
- Automated caching and cache invalidation
- Error handling and retry logic
- Consistent API integration patterns

✅ **End-to-End Integration**
- All major workflows tested and working
- Authentication flow fully functional
- Data flows correctly between frontend and backend
- Proper error handling throughout the stack