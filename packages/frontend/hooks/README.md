# Redux Hooks for Property and Room Management

This directory contains Redux hooks that replace the previous React Query implementation for better state management and consistency across the application.

## Property Hooks

### `useProperties()`
Hook for managing a list of properties with filtering and pagination.

```typescript
const { 
  properties, 
  loading, 
  error, 
  pagination, 
  loadProperties, 
  setFilters, 
  clearFilters 
} = useProperties();

// Load properties with filters
loadProperties({ type: 'apartment', minRent: 1000 });

// Set filters
setFilters({ bedrooms: 2, maxRent: 2000 });
```

### `useProperty(id: string)`
Hook for managing a single property.

```typescript
const { 
  property, 
  loading, 
  error, 
  loadProperty, 
  clearCurrentProperty 
} = useProperty(propertyId);

// Load property data
loadProperty();
```

### `usePropertyStats(id: string)`
Hook for managing property statistics.

```typescript
const { 
  stats, 
  loading, 
  error, 
  loadStats 
} = usePropertyStats(propertyId);

// Load property stats
loadStats();
```

### `usePropertyEnergyStats(id: string, period: 'day' | 'week' | 'month')`
Hook for managing property energy statistics.

```typescript
const { 
  stats, 
  loading, 
  error, 
  loadEnergyStats 
} = usePropertyEnergyStats(propertyId, 'day');

// Load energy stats
loadEnergyStats();
```

### `useSearchProperties()`
Hook for searching properties.

```typescript
const { 
  searchResults, 
  loading, 
  error, 
  search, 
  clearSearchResults 
} = useSearchProperties();

// Search properties
search('downtown apartment', { type: 'apartment' });
```

### `useCreateProperty()`
Hook for creating new properties.

```typescript
const { 
  create, 
  loading, 
  error 
} = useCreateProperty();

// Create property
const newProperty = await create({
  address: { street: '123 Main St', city: 'New York', state: 'NY', zipCode: '10001' },
  type: 'apartment',
  rent: { amount: 1500, currency: 'USD' }
});
```

### `useUpdateProperty()`
Hook for updating properties.

```typescript
const { 
  update, 
  loading, 
  error 
} = useUpdateProperty();

// Update property
await update(propertyId, { rent: { amount: 1600 } });
```

### `useDeleteProperty()`
Hook for deleting properties.

```typescript
const { 
  remove, 
  loading, 
  error 
} = useDeleteProperty();

// Delete property
await remove(propertyId);
```

## Room Hooks

### `useRooms(propertyId: string)`
Hook for managing rooms within a property.

```typescript
const { 
  rooms, 
  loading, 
  error, 
  pagination, 
  loadRooms, 
  setFilters, 
  clearFilters 
} = useRooms(propertyId);

// Load rooms with filters
loadRooms({ type: 'bedroom', available: true });
```

### `useRoom(propertyId: string, roomId: string)`
Hook for managing a single room.

```typescript
const { 
  room, 
  loading, 
  error, 
  loadRoom, 
  clearCurrentRoom 
} = useRoom(propertyId, roomId);

// Load room data
loadRoom();
```

### `useRoomStats(propertyId: string, roomId: string)`
Hook for managing room statistics.

```typescript
const { 
  stats, 
  loading, 
  error, 
  loadStats 
} = useRoomStats(propertyId, roomId);

// Load room stats
loadStats();
```

### `useRoomEnergyStats(propertyId: string, roomId: string, period: 'day' | 'week' | 'month')`
Hook for managing room energy statistics.

```typescript
const { 
  stats, 
  loading, 
  error, 
  loadEnergyStats 
} = useRoomEnergyStats(propertyId, roomId, 'day');

// Load energy stats
loadEnergyStats();
```

### `useSearchRooms(propertyId: string)`
Hook for searching rooms within a property.

```typescript
const { 
  searchResults, 
  loading, 
  error, 
  search, 
  clearSearchResults 
} = useSearchRooms(propertyId);

// Search rooms
search('master bedroom', { type: 'bedroom' });
```

### `useCreateRoom()`
Hook for creating new rooms.

```typescript
const { 
  create, 
  loading, 
  error 
} = useCreateRoom();

// Create room
const newRoom = await create(propertyId, {
  name: 'Master Bedroom',
  type: 'bedroom',
  rent: { amount: 800, currency: 'USD' }
});
```

### `useUpdateRoom()`
Hook for updating rooms.

```typescript
const { 
  update, 
  loading, 
  error 
} = useUpdateRoom();

// Update room
await update(propertyId, roomId, { rent: { amount: 850 } });
```

### `useDeleteRoom()`
Hook for deleting rooms.

```typescript
const { 
  remove, 
  loading, 
  error 
} = useDeleteRoom();

// Delete room
await remove(propertyId, roomId);
```

### `useAssignTenant()`
Hook for assigning tenants to rooms.

```typescript
const { 
  assign, 
  loading, 
  error 
} = useAssignTenant();

// Assign tenant
await assign(propertyId, roomId, tenantId);
```

### `useUnassignTenant()`
Hook for unassigning tenants from rooms.

```typescript
const { 
  unassign, 
  loading, 
  error 
} = useUnassignTenant();

// Unassign tenant
await unassign(propertyId, roomId);
```

## Key Features

- **Centralized State Management**: All property and room data is managed in Redux store
- **Loading States**: Individual loading states for different operations
- **Error Handling**: Comprehensive error handling with toast notifications
- **Optimistic Updates**: Immediate UI updates with background sync
- **Type Safety**: Full TypeScript support with proper typing
- **Oxy Integration**: Automatic integration with Oxy authentication services
- **Defensive ID Handling**: Handles both `_id` and `id` fields for MongoDB compatibility

## Migration from React Query

The old React Query hooks have been replaced with Redux hooks that provide:

1. **Better Performance**: Redux state is cached and shared across components
2. **Consistent State**: Single source of truth for all property and room data
3. **Better Error Handling**: Centralized error management with toast notifications
4. **Type Safety**: Improved TypeScript support with proper action types
5. **Optimistic Updates**: Immediate UI feedback with background data sync

## Usage Example

```typescript
import { useProperties, useCreateProperty } from '@/hooks';

function PropertyList() {
  const { properties, loading, loadProperties } = useProperties();
  const { create, loading: creating } = useCreateProperty();

  useEffect(() => {
    loadProperties();
  }, []);

  const handleCreateProperty = async () => {
    try {
      await create({
        address: { street: '123 Main St', city: 'New York', state: 'NY', zipCode: '10001' },
        type: 'apartment',
        rent: { amount: 1500, currency: 'USD' }
      });
    } catch (error) {
      // Error is automatically handled with toast notification
    }
  };

  return (
    <div>
      {loading ? <LoadingSpinner /> : (
        properties.map(property => <PropertyCard key={property._id || property.id} property={property} />)
      )}
      <button onClick={handleCreateProperty} disabled={creating}>
        {creating ? 'Creating...' : 'Create Property'}
      </button>
    </div>
  );
}
``` 