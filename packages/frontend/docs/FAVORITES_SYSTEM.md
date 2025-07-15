# Favorites System - Production Ready

## Overview

The Favorites System is a robust, scalable solution for managing user favorites across the Homiio application. Built with Zustand for state management, it provides optimistic updates, error handling, retry mechanisms, and performance monitoring.

## Architecture

### Core Components

1. **Zustand Store** (`favoritesStore.ts`)
   - Centralized state management
   - Type-safe operations
   - Immutable state updates

2. **Custom Hook** (`useFavorites.ts`)
   - Business logic encapsulation
   - API integration
   - Error handling and retry logic

3. **UI Components**
   - `FavoriteButton.tsx` - Reusable favorite toggle button
   - `SaveButton.tsx` - Property save button with heart icon
   - `PropertyCard.tsx` - Property card with favorite integration

4. **Utilities**
   - `favoritesErrorHandler.ts` - Error categorization and user messages
   - `favoritesRetry.ts` - Exponential backoff retry mechanism
   - `favoritesPerformance.ts` - Performance monitoring and metrics

## Features

### ✅ Production Ready Features

- **Optimistic Updates**: UI updates immediately, API calls happen in background
- **Error Handling**: Comprehensive error categorization and user-friendly messages
- **Retry Mechanism**: Exponential backoff for failed requests
- **Performance Monitoring**: Track operation metrics and identify bottlenecks
- **Accessibility**: Screen reader support and proper ARIA attributes
- **Type Safety**: Full TypeScript support with strict typing
- **Memory Management**: Proper cleanup and memoization
- **Duplicate Prevention**: Prevents multiple simultaneous requests
- **Offline Resilience**: Graceful handling of network issues

### 🔧 Technical Features

- **Zustand State Management**: Lightweight, performant state management
- **React.memo**: Prevents unnecessary re-renders
- **useCallback/useMemo**: Optimized performance
- **Error Boundaries**: Graceful error handling
- **Loading States**: Visual feedback during operations
- **Toast Notifications**: User feedback for actions

## Usage

### Basic Usage

```tsx
import { useFavorites } from '@/hooks/useFavorites';

function MyComponent() {
  const { 
    isFavorite, 
    toggleFavorite, 
    isPropertySaving,
    error 
  } = useFavorites();

  const handleFavoriteToggle = async (propertyId: string, propertyData: Property) => {
    await toggleFavorite(propertyId, propertyData);
  };

  return (
    <FavoriteButton
      propertyId="property-123"
      onPress={() => handleFavoriteToggle("property-123", propertyData)}
      onError={(error) => console.error('Favorite error:', error)}
    />
  );
}
```

### Advanced Usage

```tsx
import { useFavorites } from '@/hooks/useFavorites';
import { FavoritesPerformance } from '@/utils/favoritesPerformance';

function AdvancedComponent() {
  const {
    favoriteIds,
    isLoading,
    isSaving,
    error,
    toggleFavorite,
    isFavorite,
    isPropertySaving,
    addToFavorites,
    removeFromFavorites,
    clearError,
  } = useFavorites();

  // Log performance metrics
  React.useEffect(() => {
    const interval = setInterval(() => {
      FavoritesPerformance.logSummary();
    }, 60000); // Log every minute

    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      <p>Total Favorites: {favoriteIds.length}</p>
      <p>Loading: {isLoading ? 'Yes' : 'No'}</p>
      <p>Saving: {isSaving ? 'Yes' : 'No'}</p>
      {error && <p>Error: {error}</p>}
      
      <FavoriteButton
        propertyId="property-123"
        onError={clearError}
        accessibilityLabel="Toggle favorite for this property"
        testID="favorite-button"
      />
    </div>
  );
}
```

## Error Handling

### Error Types

The system categorizes errors into different types:

- **Network Errors**: Connection issues, retryable
- **Authentication Errors**: User not signed in, not retryable
- **Permission Errors**: User lacks permissions, not retryable
- **Validation Errors**: Invalid data, not retryable
- **Server Errors**: Backend issues, retryable
- **Unknown Errors**: Unexpected issues, retryable

### Error Handling Example

```tsx
import { FavoritesErrorHandler } from '@/utils/favoritesErrorHandler';

function ErrorHandlingExample() {
  const handleError = (error: any) => {
    const favoritesError = FavoritesErrorHandler.createError(error, 'MyComponent');
    
    if (FavoritesErrorHandler.shouldShowUserMessage(favoritesError)) {
      // Show toast notification
      toast.error(favoritesError.userMessage);
    }
    
    if (FavoritesErrorHandler.isRetryableError(favoritesError)) {
      // Implement retry logic
      console.log('Retryable error, will retry in', 
        FavoritesErrorHandler.getRetryDelay(favoritesError), 'ms');
    }
  };

  return (
    <FavoriteButton
      propertyId="property-123"
      onError={handleError}
    />
  );
}
```

## Performance Monitoring

### Metrics Tracked

- Operation duration
- Success/failure rates
- Slow operation detection
- Error frequency

### Performance Configuration

```tsx
import { FavoritesPerformance } from '@/utils/favoritesPerformance';

// Configure performance monitoring
FavoritesPerformance.configure({
  enabled: true,
  logThreshold: 1000, // Log operations slower than 1 second
  sampleRate: 0.1, // Track 10% of operations
});

// Get performance summary
const summary = FavoritesPerformance.getMetricsSummary();
console.log('Performance Summary:', summary);
```

## Testing

### Unit Tests

```tsx
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { useFavorites } from '@/hooks/useFavorites';

// Mock the hook
jest.mock('@/hooks/useFavorites');

test('FavoriteButton toggles correctly', async () => {
  const mockToggleFavorite = jest.fn();
  (useFavorites as jest.Mock).mockReturnValue({
    isFavorite: jest.fn().mockReturnValue(false),
    toggleFavorite: mockToggleFavorite,
    isPropertySaving: jest.fn().mockReturnValue(false),
  });

  const { getByTestId } = render(
    <FavoriteButton propertyId="test-123" testID="favorite-button" />
  );

  fireEvent.press(getByTestId('favorite-button'));
  
  await waitFor(() => {
    expect(mockToggleFavorite).toHaveBeenCalledWith('test-123');
  });
});
```

### Integration Tests

```tsx
test('Favorites flow works end-to-end', async () => {
  // Test the complete flow from UI interaction to API call
  // This would test the integration between components, hooks, and API
});
```

## Best Practices

### ✅ Do's

- Always pass property data to `toggleFavorite` for optimistic updates
- Handle errors gracefully with user-friendly messages
- Use the `onError` prop for error handling in components
- Implement proper loading states
- Test error scenarios and edge cases
- Monitor performance metrics in production

### ❌ Don'ts

- Don't call `toggleFavorite` without property data
- Don't ignore error handling
- Don't make multiple simultaneous requests for the same property
- Don't forget to clear errors when appropriate
- Don't skip accessibility attributes

## Configuration

### Environment Variables

```env
# Enable performance monitoring in production
REACT_APP_ENABLE_FAVORITES_PERFORMANCE_MONITORING=true

# Configure retry settings
REACT_APP_FAVORITES_MAX_RETRY_ATTEMPTS=3
REACT_APP_FAVORITES_RETRY_DELAY=1000
```

### Store Configuration

```tsx
// Configure the favorites store
import { useFavoritesStore } from '@/store/favoritesStore';

// Clear all favorites (useful for logout)
useFavoritesStore.getState().clearFavorites();

// Get current state
const currentState = useFavoritesStore.getState();
```

## Troubleshooting

### Common Issues

1. **Icon not toggling**: Check if property data is passed to `toggleFavorite`
2. **Multiple requests**: Ensure `isPropertySaving` check is implemented
3. **Stale state**: Verify Zustand store is properly configured
4. **Performance issues**: Check performance metrics and optimize slow operations

### Debug Mode

Enable debug logging:

```tsx
// In development
if (__DEV__) {
  FavoritesPerformance.configure({
    enabled: true,
    logThreshold: 500,
    sampleRate: 1.0, // Track all operations
  });
}
```

## Migration Guide

### From Redux to Zustand

The system has been migrated from Redux to Zustand. Key changes:

1. **State Management**: Replaced Redux reducers with Zustand store
2. **Selectors**: Updated to use Zustand selectors
3. **Actions**: Replaced Redux actions with Zustand actions
4. **Performance**: Improved performance with Zustand's lightweight approach

### Breaking Changes

- `useFavorites` hook signature changed
- Store actions renamed for clarity
- Error handling improved with categorization

## Contributing

When contributing to the favorites system:

1. Follow the existing patterns and conventions
2. Add proper TypeScript types
3. Include error handling for new features
4. Add performance monitoring for new operations
5. Update documentation
6. Add tests for new functionality

## License

This favorites system is part of the Homiio application and follows the same licensing terms. 