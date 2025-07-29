# Recently Viewed Database Persistence

This document explains how the recently viewed functionality works with database persistence using Zustand.

## Overview

The recently viewed functionality now persists data to the database while maintaining a responsive local state for immediate UI feedback. This provides the best of both worlds: instant UI updates and persistent storage.

## Architecture

### Store Structure (`recentlyViewedStore.ts`)

The Zustand store manages:
- **Local State**: Items stored in memory for instant access (allows multiple entries per property)
- **Loading States**: `isLoading`, `isInitialized`, `error`
- **Database Operations**: `loadFromDatabase`, `syncToDatabase`, `clearFromDatabase`
- **Entry Management**: Each property view creates a new entry, keeps latest 20 entries

### Database Schema

The backend uses a `RecentlyViewed` collection with:
- `profileId`: Reference to user's profile
- `propertyId`: Reference to viewed property
- `viewedAt`: Timestamp of when property was viewed
- Compound index on `(profileId, propertyId)` for uniqueness (backend handles deduplication if needed)

## Data Flow

### 1. Initial Load
When a user authenticates:
1. `ProfileProvider` automatically calls `loadFromDatabase()`
2. Data is fetched from `/api/profiles/me/recent-properties`
3. Transformed to store format and cached locally
4. UI shows loading state during fetch

### 2. Adding Properties
When a property is viewed:
1. **Immediate**: Property added to local Zustand state for instant UI feedback (allows multiple entries)
2. **Background**: Backend API called to track view in database
3. **Sync**: Local state stays in sync with database

### 3. Clearing Data
When user clears recently viewed:
1. **Immediate**: Local state cleared for instant UI feedback
2. **Background**: Database cleared via `/api/profiles/me/recent-properties` (DELETE)
3. **Error Handling**: If database clear fails, local state is reverted

## API Endpoints

### GET `/api/profiles/me/recent-properties`
- Returns recently viewed properties for authenticated user
- Automatically creates profile if none exists
- Returns properties with `viewedAt` timestamps

### DELETE `/api/profiles/me/recent-properties`
- Clears all recently viewed properties for user
- Returns success/error response

### POST `/api/properties/:propertyId/track-view`
- Tracks individual property view (called automatically)
- Updates or creates recently viewed record

## Usage Examples

### Basic Usage
```typescript
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';

function MyComponent() {
  const { properties, isLoading, error, addProperty, clear } = useRecentlyViewed();
  
  // Data is automatically loaded on authentication
  // Properties are automatically added when viewed
  // Clear function handles both local and database clearing
}
```

### Manual Database Operations
```typescript
import { useRecentlyViewedStore } from '@/store/recentlyViewedStore';

// Force reload from database
await useRecentlyViewedStore.getState().loadFromDatabase(oxyServices, activeSessionId);

// Clear from database
await useRecentlyViewedStore.getState().clearFromDatabase(oxyServices, activeSessionId);
```

## Error Handling

- **Network Errors**: Displayed to user with retry options
- **Authentication Errors**: Gracefully handled (user can still use local state)
- **Database Errors**: Logged but don't break local functionality
- **Sync Failures**: Local state remains functional, errors logged

## Performance Considerations

- **Caching**: Data loaded once and cached locally
- **Lazy Loading**: Database only queried when needed
- **Optimistic Updates**: UI updates immediately, database syncs in background
- **Multiple Entries**: Each property view creates a new entry (no deduplication)
- **Limit Management**: Keeps only the 20 most recent entries to prevent memory bloat

## Testing

Use the `RecentlyViewedTest` component to test:
- Adding test properties
- Database synchronization
- Error scenarios
- Direct API calls

## Future Enhancements

- Individual property removal from database
- Bulk sync operations
- Offline support with sync queue
- Analytics integration
- Cross-device synchronization 