# Enterprise Saved Properties System

A comprehensive, production-ready system for managing saved properties in the Homiio application. Built with enterprise-grade patterns including type safety, optimistic updates, proper error handling, and scalable architecture.

## 🏗️ Architecture Overview

### Core Components

```
📁 Enterprise Saved Properties System
├── 🔧 Types System          - Comprehensive type definitions
├── 🌐 API Service Layer     - RESTful API with error handling
├── 🔄 State Management      - Reducer pattern with optimistic updates
├── 📡 Context Provider      - React Query integration
├── 🎨 UI Components         - Enterprise SaveButton components
├── 🪝 Utility Hooks         - Specialized hooks for common patterns
└── 📖 Documentation        - Complete guides and examples
```

### Technology Stack

- **Type Safety**: Full TypeScript with comprehensive type definitions
- **State Management**: React useReducer with immutable updates
- **Data Fetching**: React Query for caching and synchronization
- **Optimistic Updates**: Immediate UI feedback with rollback capability
- **Error Handling**: Centralized error handling with user-friendly messages
- **Performance**: Memoization, efficient re-renders, and smart caching

## 🚀 Quick Start

### 1. Basic Setup

```tsx
import { SavedPropertiesProvider } from '@/features/savedProperties';

function App() {
  return (
    <SavedPropertiesProvider>
      <YourAppContent />
    </SavedPropertiesProvider>
  );
}
```

### 2. Using the Save Button

```tsx
import { SaveButton } from '@/features/savedProperties';

function PropertyCard({ propertyId }: { propertyId: string }) {
  return (
    <SaveButton
      propertyId={propertyId}
      size="medium"
      variant="filled"
      showCount={true}
      onSaveComplete={(saved) => console.log(\`Property \${saved ? 'saved' : 'unsaved'}\`)}
    />
  );
}
```

### 3. Using the Context Hook

```tsx
import { useSavedProperties } from '@/features/savedProperties';

function SavedPropertiesList() {
  const {
    properties,
    folders,
    isLoading,
    saveProperty,
    createFolder
  } = useSavedProperties();

  if (isLoading) return <LoadingSpinner />;

  return (
    <div>
      <h2>Saved Properties ({properties.length})</h2>
      {properties.map(property => (
        <PropertyItem key={property.id} property={property} />
      ))}
    </div>
  );
}
```

## 📋 API Reference

### Core Hooks

#### `useSavedProperties()`
The main hook for accessing saved properties functionality.

```tsx
const {
  // State
  properties: SavedProperty[],
  folders: SavedPropertyFolder[],
  propertiesCount: number,
  isInitialized: boolean,
  isLoading: boolean,
  error: SavedPropertiesError | null,

  // Property Operations
  saveProperty: (operation: SavePropertyOperation) => Promise<void>,
  unsaveProperty: (operation: UnsavePropertyOperation) => Promise<void>,
  isPropertySaved: (propertyId: string) => boolean,
  isPropertySaving: (propertyId: string) => boolean,

  // Folder Operations
  createFolder: (data: CreateFolderData) => Promise<SavedPropertyFolder>,
  updateFolder: (folderId: string, data: UpdateFolderData) => Promise<SavedPropertyFolder>,
  deleteFolder: (folderId: string) => Promise<void>,
  getFolder: (folderId: string) => SavedPropertyFolder | undefined,
  getDefaultFolder: () => SavedPropertyFolder | undefined,

  // Utilities
  refresh: () => Promise<void>,
  clearError: () => void,
} = useSavedProperties();
```

#### `usePropertySaver()`
Simplified hook for basic save/unsave operations.

```tsx
const {
  toggleProperty: (propertyId: string, options?) => Promise<void>,
  isPropertySaved: (propertyId: string) => boolean,
  isPropertySaving: (propertyId: string) => boolean,
} = usePropertySaver();
```

#### `useFolderOperations()`
Hook for folder management operations.

```tsx
const {
  folders: SavedPropertyFolder[],
  createFolder: (name: string, options?) => Promise<SavedPropertyFolder>,
  updateFolder: (folderId: string, data: UpdateFolderData) => Promise<SavedPropertyFolder>,
  deleteFolder: (folderId: string) => Promise<void>,
  getFolder: (folderId: string) => SavedPropertyFolder | undefined,
  getDefaultFolder: () => SavedPropertyFolder | undefined,
  getFolderWithProperties: (folderId: string) => { folder, properties, count },
} = useFolderOperations();
```

### UI Components

#### `SaveButton`
The main save button component with full customization options.

```tsx
<SaveButton
  propertyId={string}              // Required: Property ID to save/unsave
  folderId={string | null}         // Optional: Folder to save to
  notes={string}                   // Optional: Notes for the saved property
  size={'small' | 'medium' | 'large'}  // Optional: Button size (default: 'medium')
  variant={'filled' | 'outlined' | 'minimal'}  // Optional: Button style (default: 'filled')
  showCount={boolean}              // Optional: Show saved count (default: true)
  onSaveComplete={(saved) => void} // Optional: Success callback
  onError={(error) => void}        // Optional: Error callback
  disabled={boolean}               // Optional: Disable button (default: false)
  className={string}               // Optional: Additional CSS classes
  testID={string}                  // Optional: Test identifier
/>
```

#### Component Variants

```tsx
// Compact button for lists
<CompactSaveButton propertyId="123" />

// Card button with count
<CardSaveButton propertyId="123" />

// Large button for details pages
<DetailsSaveButton propertyId="123" />
```

## 🔧 Configuration

### Provider Configuration

```tsx
<SavedPropertiesProvider
  autoRefresh={true}                    // Enable auto-refresh (default: true)
  refreshInterval={5 * 60 * 1000}       // Refresh interval in ms (default: 5min)
>
  <App />
</SavedPropertiesProvider>
```

### Global Configuration

```tsx
import { SAVED_PROPERTIES_CONFIG } from '@/features/savedProperties';

// Access configuration constants
const {
  CACHE_STALE_TIME,           // 2 minutes
  CACHE_GC_TIME,              // 10 minutes
  AUTO_REFRESH_INTERVAL,      // 5 minutes
  DEFAULT_BUTTON_SIZE,        // 'medium'
  DEFAULT_BUTTON_VARIANT,     // 'filled'
  DEFAULT_FOLDER_COLOR,       // '#3B82F6'
} = SAVED_PROPERTIES_CONFIG;
```

## 🎯 Advanced Usage

### Optimistic Updates

The system automatically handles optimistic updates for immediate UI feedback:

```tsx
// When user clicks save, the UI updates immediately
// If the API call fails, the change is automatically reverted
<SaveButton
  propertyId="123"
  onSaveComplete={(saved) => {
    // This callback fires after successful API call
    analytics.track('property_saved', { propertyId: '123', saved });
  }}
  onError={(error) => {
    // This callback fires if the API call fails
    // The UI has already been reverted automatically
    analytics.track('property_save_failed', { error: error.message });
  }}
/>
```

### Bulk Operations

```tsx
import { useBulkOperations } from '@/features/savedProperties';

function BulkActions({ selectedPropertyIds }: { selectedPropertyIds: string[] }) {
  const { moveToFolder, bulkUnsave } = useBulkOperations();

  const handleMoveToFolder = async (folderId: string) => {
    const result = await moveToFolder(selectedPropertyIds, folderId, {
      onProgress: (completed, total) => {
        console.log(\`Progress: \${completed}/\${total}\`);
      },
      onError: (error, propertyId) => {
        console.error(\`Failed to move \${propertyId}:\`, error);
      },
    });

    console.log(\`Moved \${result.successful} properties, \${result.failed} failed\`);
  };

  return (
    <div>
      <button onClick={() => handleMoveToFolder('folder-123')}>
        Move to Favorites
      </button>
      <button onClick={() => bulkUnsave(selectedPropertyIds)}>
        Remove All
      </button>
    </div>
  );
}
```

### Custom Filtering and Sorting

```tsx
import { usePropertyFilters } from '@/features/savedProperties';

function FilteredPropertiesList() {
  const {
    getPropertiesByFolder,
    searchProperties,
    sortProperties,
    stats
  } = usePropertyFilters();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  // Get filtered properties
  const filteredProperties = useMemo(() => {
    let properties = getPropertiesByFolder(selectedFolder);
    
    if (searchQuery) {
      properties = searchProperties(searchQuery);
    }
    
    return sortProperties(properties, 'dateAdded', 'desc');
  }, [selectedFolder, searchQuery, getPropertiesByFolder, searchProperties, sortProperties]);

  return (
    <div>
      <div>Total: {stats.total}, With notes: {stats.withNotes}</div>
      <input
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder="Search properties..."
      />
      {filteredProperties.map(property => (
        <PropertyItem key={property.id} property={property} />
      ))}
    </div>
  );
}
```

### Analytics Integration

```tsx
import { useSavedPropertiesAnalytics } from '@/features/savedProperties';

function AnalyticsDashboard() {
  const analytics = useSavedPropertiesAnalytics();

  return (
    <div>
      <h3>Saved Properties Analytics</h3>
      <div>Total Properties: {analytics.total}</div>
      <div>Added This Week: {analytics.recentlyAdded}</div>
      <div>Added This Month: {analytics.addedThisMonth}</div>
      <div>With Notes: {analytics.withNotes}</div>
      <div>Uncategorized: {analytics.uncategorized.count} ({analytics.uncategorized.percentage.toFixed(1)}%)</div>
      
      <h4>Folder Usage</h4>
      {analytics.folderUsage.map(({ folder, count, percentage }) => (
        <div key={folder.id}>
          {folder.name}: {count} properties ({percentage.toFixed(1)}%)
        </div>
      ))}
    </div>
  );
}
```

## 🧪 Development Tools

### Debug Mode

```tsx
import { savedPropertiesDevTools } from '@/features/savedProperties';

function DebugPanel() {
  const savedPropertiesContext = useSavedProperties();

  if (__DEV__ && savedPropertiesDevTools) {
    return (
      <div>
        <button onClick={() => savedPropertiesDevTools.logState(savedPropertiesContext)}>
          Log State
        </button>
        <button onClick={() => savedPropertiesDevTools.testSaveOperation('test-property', savedPropertiesContext)}>
          Test Save Operation
        </button>
      </div>
    );
  }

  return null;
}
```

### Testing

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SaveButton, SavedPropertiesProvider } from '@/features/savedProperties';

function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <SavedPropertiesProvider>
      {children}
    </SavedPropertiesProvider>
  );
}

test('SaveButton toggles save state', async () => {
  render(
    <SaveButton propertyId="test-property" />,
    { wrapper: TestWrapper }
  );

  const button = screen.getByRole('button');
  
  // Initial state should be unsaved
  expect(button).toHaveAccessibilityLabel('Save property');
  
  // Click to save
  fireEvent.press(button);
  
  // Should show loading state
  expect(button).toHaveAccessibilityLabel('Saving property...');
  
  // Wait for save to complete
  await waitFor(() => {
    expect(button).toHaveAccessibilityLabel('Remove from saved properties');
  });
});
```

## 🚀 Performance Optimization

### Caching Strategy

The system implements intelligent caching:

- **Properties**: 2-minute stale time, 10-minute garbage collection
- **Folders**: 5-minute stale time, 15-minute garbage collection
- **Optimistic Updates**: Immediate UI feedback with automatic rollback
- **Background Refetch**: Automatic refresh every 5 minutes

### Memory Management

- Efficient re-renders using React.memo and useMemo
- Proper cleanup of event listeners and subscriptions
- Garbage collection of unused cache data
- Minimal state updates using immutable patterns

### Bundle Size

The system is designed for optimal bundle size:

- Tree-shakeable exports
- Lazy loading of non-critical components
- Minimal dependencies
- Efficient TypeScript compilation

## 🔒 Error Handling

### Comprehensive Error Recovery

```tsx
import { SavedPropertiesProvider } from '@/features/savedProperties';

function App() {
  return (
    <SavedPropertiesProvider>
      <ErrorBoundary fallback={<ErrorFallback />}>
        <YourApp />
      </ErrorBoundary>
    </SavedPropertiesProvider>
  );
}

function ErrorFallback() {
  const { clearError, refresh } = useSavedProperties();
  
  return (
    <div>
      <h2>Something went wrong</h2>
      <button onClick={() => { clearError(); refresh(); }}>
        Try Again
      </button>
    </div>
  );
}
```

### Error Types

The system provides specific error types for different scenarios:

- **Network Errors**: Connection issues, timeouts
- **Validation Errors**: Invalid data, missing required fields
- **Authorization Errors**: Authentication failures
- **Server Errors**: Backend API errors
- **Client Errors**: Component usage errors

## 📈 Migration Guide

### From Legacy SavedPropertiesContext

```tsx
// Old way
import { SavedPropertiesContext } from '@/context/SavedPropertiesContext';

// New way
import { useSavedProperties } from '@/features/savedProperties';

// Old context usage
const { savedProperties, saveProperty } = useContext(SavedPropertiesContext);

// New hook usage  
const { properties, saveProperty } = useSavedProperties();
```

### Breaking Changes

1. **Property Structure**: `savedProperties` → `properties`
2. **Loading States**: Individual property loading instead of global
3. **Error Handling**: Centralized error management
4. **Optimistic Updates**: Automatic rollback on failure

## 🤝 Contributing

### Code Style

- Use TypeScript for all new code
- Follow the established patterns in existing components
- Add comprehensive JSDoc documentation
- Include unit tests for new functionality

### Adding New Features

1. **Types**: Add types to `types/savedProperties.ts`
2. **API**: Extend `services/savedPropertiesApi.ts`
3. **State**: Update `hooks/useSavedPropertiesState.ts`
4. **Components**: Create in `components/` directory
5. **Documentation**: Update this README

### Testing Requirements

- Unit tests for all utilities and hooks
- Integration tests for complex workflows
- E2E tests for critical user paths
- Performance tests for large datasets

## 📝 License

This system is part of the Homiio application and follows the same licensing terms.

---

*Built with ❤️ for the Homiio team. For questions or support, please reach out to the development team.*
