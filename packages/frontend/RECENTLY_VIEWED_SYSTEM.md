# Recently Viewed System Implementation

This document describes the implementation of the Recently Viewed feature using Redux and backend persistence across the Homiio app.

## Overview

The Recently Viewed system allows users to track properties they've viewed, with full synchronization between the frontend Redux store and the backend database. The system includes:

- Automatic view tracking when properties are visited
- Redux state management for immediate UI updates
- Backend persistence for cross-device synchronization
- Real-time UI updates with loading states
- Error handling and graceful degradation

## Architecture

### Backend Components

1. **RecentlyViewedModel** (`models/schemas/RecentlyViewedSchema.js`)
   - MongoDB schema for storing property views
   - Links profile ID to property ID with timestamp
   - Unique compound index to prevent duplicates
   - Automatic timestamp updates

2. **Property Controller** (`controllers/propertyController.js`)
   - Automatic view tracking in `getPropertyById` method
   - Non-blocking tracking that doesn't affect property fetching
   - Creates profile if none exists

3. **Profile Controller** (`controllers/profileController.js`)
   - `getRecentProperties` endpoint retrieves user's recently viewed properties
   - Populates full property data
   - Sorts by most recent first
   - Filters out deleted properties

4. **API Routes** (`routes/profiles.js`)
   - `GET /api/profiles/me/recent-properties` - Get recently viewed properties

### Frontend Components

1. **Redux Store** (`store/reducers/recentlyViewedReducer.ts`)
   - Manages recently viewed state
   - Async thunk for fetching from backend
   - Local state management for instant updates
   - Error handling and loading states

2. **useRecentlyViewed Hook** (`hooks/useRecentlyViewed.ts`)
   - Main interface for recently viewed functionality
   - Auto-loads data when authenticated
   - Provides CRUD operations
   - Debug logging for troubleshooting

3. **Recently Viewed Screen** (`app/properties/recently-viewed.tsx`)
   - Full-featured screen for browsing recently viewed properties
   - Search and filtering capabilities
   - Grid/list view toggle
   - Clear history functionality

4. **Recently Viewed Widget** (`components/widgets/RecentlyViewedWidget.tsx`)
   - Compact horizontal scrolling widget for dashboard
   - Quick navigation to full screen
   - Authentication-aware display

5. **Property Detail Integration** (`app/properties/[id].tsx`)
   - Automatic Redux state update for instant UI feedback
   - Backend sync for cross-device consistency
   - No manual API calls needed

## How It Works

### Automatic View Tracking

1. **User visits property detail page**
   - Property data is fetched via `getPropertyById` API
   - Backend automatically tracks the view in `RecentlyViewedModel`
   - Uses user's active profile ID
   - Updates existing record timestamp or creates new one

2. **Frontend immediate update**
   - Property detail page adds property to Redux state instantly
   - Provides immediate UI feedback in widgets/screens
   - Triggers backend sync for consistency

3. **Cross-device synchronization**
   - Recently viewed data persists in backend database
   - Available across all user devices
   - Auto-loads when user opens app

### Data Flow

```
User visits property → Backend tracks view → Frontend updates Redux → UI updates instantly
                                         ↓
                     Backend persists to database ← Frontend syncs for consistency
```

## Usage

### Basic Usage with Hook

```tsx
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';

function MyComponent() {
  const { 
    properties, 
    isLoading, 
    error,
    refetch,
    clear 
  } = useRecentlyViewed();

  if (isLoading) return <Loading />;
  if (error) return <Error message={error} />;

  return (
    <div>
      {properties.map(property => (
        <PropertyCard key={property._id || property.id} property={property} />
      ))}
    </div>
  );
}
```

### Manual Operations

```tsx
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';

function AdvancedComponent() {
  const {
    properties,
    addProperty,
    removeProperty,
    clear,
    refetch
  } = useRecentlyViewed();

  const handleAddProperty = (property) => {
    // Add property to local state (also syncs with backend)
    addProperty(property);
  };

  const handleRemoveProperty = (propertyId) => {
    // Remove from local state
    removeProperty(propertyId);
  };

  const handleClearAll = () => {
    // Clear all recently viewed properties
    clear();
  };

  const handleRefresh = () => {
    // Refresh from backend
    refetch();
  };
}
```

## API Endpoints

### Backend Endpoints

- `GET /api/properties/:id` - Get property (automatically tracks view)
- `GET /api/profiles/me/recent-properties` - Get recently viewed properties

### Frontend API Integration

```javascript
// Get recently viewed properties
const response = await userApi.getRecentProperties(oxyServices, activeSessionId);
```

## Features

### 1. Automatic Tracking
- Views are tracked automatically when properties are visited
- No manual API calls required from frontend
- Non-blocking implementation doesn't affect performance

### 2. Redux Integration
- Immediate UI updates through Redux state
- Consistent state management across components
- Loading and error states

### 3. Cross-Device Sync
- Backend persistence enables cross-device access
- User sees recently viewed properties on all devices
- Automatic profile creation for new users

### 4. Privacy & Performance
- Only authenticated users can track views
- Views are tied to user profiles, not devices
- Efficient database indexing for fast queries

### 5. Error Handling
- Graceful degradation when backend is unavailable
- Non-blocking tracking doesn't affect core functionality
- Comprehensive error logging

## Integration Points

### Property Detail Screen
The property detail screen automatically integrates with the recently viewed system:
- Updates Redux state immediately for instant UI feedback
- Backend tracking happens automatically via property API
- No additional code required

### Dashboard Widgets
The `RecentlyViewedWidget` provides quick access:
- Horizontal scrolling list of recent properties
- Click to navigate to property details
- Authentication-aware display

### Recently Viewed Screen
Full-featured screen accessible via `/properties/recently-viewed`:
- Search and filter capabilities
- Grid/list view toggle
- Clear history functionality
- Empty and error state handling

## Database Schema

```javascript
{
  profileId: ObjectId, // Reference to user's profile
  propertyId: ObjectId, // Reference to property
  viewedAt: Date, // When property was viewed
  createdAt: Date, // When record was created
  updatedAt: Date // When record was last updated
}
```

### Indexes
- Compound unique index on `profileId + propertyId`
- Performance index on `profileId + viewedAt` (descending)

## Best Practices

1. **Always use the `useRecentlyViewed` hook** instead of directly accessing Redux
2. **Handle loading and error states** appropriately in UI components
3. **Don't manually track views** - let the system handle it automatically
4. **Use defensive coding** for property IDs (`property._id || property.id`)
5. **Test with authentication** as the system requires user login

## Troubleshooting

### Common Issues

1. **No properties showing**
   - Check if user is authenticated
   - Verify active profile exists
   - Check console for API errors

2. **Properties not persisting**
   - Verify backend database connection
   - Check profile creation logs
   - Ensure proper authentication

3. **Slow loading**
   - Check database indexes
   - Monitor API response times
   - Consider pagination for large datasets

### Debug Logging

The system includes comprehensive debug logging:
- Redux actions and state changes
- Backend tracking operations
- API call success/failure
- Profile creation and lookup

Enable debug logging by checking browser console and server logs.

## Future Enhancements

- [ ] Pagination for large recently viewed lists
- [ ] Recently viewed analytics and insights
- [ ] Time-based auto-cleanup of old views
- [ ] Recently viewed categories/filters
- [ ] Share recently viewed lists
- [ ] Export recently viewed data 