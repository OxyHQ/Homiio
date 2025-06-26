# Favorites System Implementation

This document describes the implementation of the save property (favorites) feature using Redux across the Homiio app.

## Overview

The favorites system allows users to save properties to their favorites list, with full synchronization between the frontend Redux store and the backend API. The system includes:

- Redux state management for favorites
- API integration for persistence
- Real-time UI updates
- Loading states and error handling
- Notes functionality for saved properties

## Architecture

### Redux Store Structure

```typescript
interface FavoritesState {
  favoriteIds: string[];        // Array of property IDs
  isLoading: boolean;           // Loading state for initial fetch
  isSaving: boolean;            // Loading state for save/unsave operations
  error: string | null;         // Error message if any
  lastSynced: number | null;    // Timestamp of last sync
}
```

### Key Components

1. **FavoritesReducer** (`store/reducers/favoritesReducer.ts`)
   - Manages Redux state for favorites
   - Handles local state updates
   - Provides loading and error states

2. **useFavorites Hook** (`hooks/useFavorites.ts`)
   - Main interface for favorites functionality
   - Integrates Redux with API calls
   - Provides loading states and error handling
   - Auto-loads favorites on mount

3. **FavoriteButton Component** (`components/FavoriteButton.tsx`)
   - Reusable button component for toggling favorites
   - Supports heart and bookmark variants
   - Shows loading states
   - Integrates with Redux automatically

4. **SavedPropertyService** (`services/savedPropertyService.ts`)
   - API service for saved properties
   - Handles CRUD operations
   - TypeScript interfaces for type safety

## Usage

### Basic Usage in Components

```tsx
import { useFavorites } from '@/hooks/useFavorites';
import FavoriteButton from '@/components/FavoriteButton';

function MyComponent() {
  const { 
    favoriteIds, 
    isFavorite, 
    toggleFavoriteProperty,
    isLoading,
    error 
  } = useFavorites();

  return (
    <FavoriteButton
      propertyId="property-123"
      variant="heart"
      size={24}
    />
  );
}
```

### Advanced Usage

```tsx
import { useFavorites } from '@/hooks/useFavorites';

function AdvancedComponent() {
  const {
    favoriteIds,
    isLoading,
    isSaving,
    error,
    lastSynced,
    saveProperty,
    unsaveProperty,
    toggleFavoriteProperty,
    updateNotes,
    loadSavedProperties,
    clearAllFavorites,
    getFavoriteCount,
  } = useFavorites();

  // Save property with notes
  const handleSaveWithNotes = async () => {
    try {
      await saveProperty('property-123', 'Love this place!');
    } catch (error) {
      console.error('Failed to save property:', error);
    }
  };

  // Update notes
  const handleUpdateNotes = async () => {
    try {
      await updateNotes('property-123', 'Updated notes');
    } catch (error) {
      console.error('Failed to update notes:', error);
    }
  };
}
```

## API Endpoints

The backend provides the following endpoints for favorites:

- `GET /api/profiles/me/saved-properties` - Get all saved properties
- `POST /api/profiles/me/save-property` - Save a property
- `DELETE /api/profiles/me/saved-properties/:propertyId` - Unsave a property
- `PUT /api/profiles/me/saved-properties/:propertyId/notes` - Update notes

## Features

### 1. Real-time Synchronization
- Favorites are automatically synced with the backend
- Local state is updated immediately for better UX
- Failed operations revert local state

### 2. Loading States
- Separate loading states for initial fetch and save operations
- Visual feedback during API calls
- Prevents multiple simultaneous operations

### 3. Error Handling
- Comprehensive error handling with user feedback
- Automatic retry mechanisms
- Graceful degradation

### 4. Notes System
- Users can add personal notes to saved properties
- Notes are persisted in the backend
- Rich text editing interface

### 5. Offline Support
- Local state persists during offline periods
- Syncs when connection is restored
- Optimistic updates for better UX

## Integration Points

### PropertyCard Component
The `PropertyCard` component automatically includes a `FavoriteButton` when `showFavoriteButton={true}` (default).

### Saved Properties Screen
The `/saved` screen displays all saved properties with notes functionality.

### Widgets
The `FavoritesWidget` provides a quick overview of favorite count and navigation.

## Testing

Use the `FavoritesTest` component to test the favorites functionality:

```tsx
import FavoritesTest from '@/components/FavoritesTest';

// Add to any screen for testing
<FavoritesTest />
```

## Best Practices

1. **Always use the `useFavorites` hook** instead of directly accessing Redux
2. **Handle loading states** to provide good UX
3. **Implement error boundaries** for graceful error handling
4. **Use the `FavoriteButton` component** for consistent UI
5. **Test with the `FavoritesTest` component** during development

## Future Enhancements

- [ ] Offline-first architecture with local storage
- [ ] Batch operations for multiple properties
- [ ] Favorite categories/tags
- [ ] Share favorites with others
- [ ] Favorite analytics and insights
- [ ] Export favorites functionality 