# OxyServices Authentication Guide

This document explains how to use OxyServices for authentication in the Homiio application, replacing the previous refresh token approach.

## Overview

OxyServices provides a robust authentication mechanism that eliminates the "No refresh token available" error. Instead of managing refresh tokens manually, OxyServices handles token management automatically.

## Why Use OxyServices?

- **Automatic Token Management**: No need to handle refresh tokens manually
- **Better Error Handling**: Clear authentication errors and automatic retries
- **Ecosystem Integration**: Seamless integration with the Oxy ecosystem
- **Security**: More secure token handling and storage

## Quick Start

### 1. Basic API Request with OxyServices

```typescript
import { oxyApiRequest } from '@/utils/oxyApi';
import { useOxy } from '@oxyhq/services';

function MyComponent() {
  const { oxyServices, activeSessionId } = useOxy();

  const fetchData = async () => {
    try {
      const data = await oxyApiRequest('/api/properties', {
        method: 'GET',
      }, oxyServices, activeSessionId);
      
      console.log('Properties:', data);
    } catch (error) {
      console.error('API request failed:', error);
    }
  };

  return (
    <button onClick={fetchData}>
      Fetch Properties
    </button>
  );
}
```

### 2. Creating a Property with OxyServices

```typescript
import { useOxyCreateProperty } from '@/hooks/useOxyPropertyQueries';
import { useOxy } from '@oxyhq/services';

function CreatePropertyForm() {
  const { oxyServices, activeSessionId } = useOxy();
  const createPropertyMutation = useOxyCreateProperty(oxyServices, activeSessionId);

  const handleSubmit = async (propertyData) => {
    try {
      await createPropertyMutation.mutateAsync(propertyData);
      // Property created successfully!
    } catch (error) {
      // Handle error (automatically shows toast)
      console.error('Failed to create property:', error);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields */}
    </form>
  );
}
```

## API Utilities

### Core Function: `oxyApiRequest`

The base function for making authenticated API requests:

```typescript
async function oxyApiRequest<T = any>(
  endpoint: string,
  options: RequestInit = {},
  oxyServices?: OxyServices,
  activeSessionId?: string
): Promise<T>
```

**Parameters:**
- `endpoint`: API endpoint (e.g., '/api/properties')
- `options`: Fetch options (method, body, headers, etc.)
- `oxyServices`: OxyServices instance from useOxy()
- `activeSessionId`: Active session ID from useOxy()

**Returns:** Promise with the API response data

### Convenience Functions

For common HTTP methods, use these helper functions:

```typescript
// GET request
const properties = await oxyApiGet('/api/properties', { page: 1 }, oxyServices, activeSessionId);

// POST request
const newProperty = await oxyApiPost('/api/properties', propertyData, oxyServices, activeSessionId);

// PUT request
const updatedProperty = await oxyApiPut('/api/properties/123', updateData, oxyServices, activeSessionId);

// DELETE request
await oxyApiDelete('/api/properties/123', oxyServices, activeSessionId);
```

## React Query Hooks

Use these hooks for managing server state with OxyServices authentication:

### Property Operations

```typescript
import { useOxyCreateProperty, useOxyUpdateProperty, useOxyDeleteProperty } from '@/hooks/useOxyPropertyQueries';
import { useOxy } from '@oxyhq/services';

function PropertyManager() {
  const { oxyServices, activeSessionId } = useOxy();
  
  // Create property
  const createProperty = useOxyCreateProperty(oxyServices, activeSessionId);
  
  // Update property
  const updateProperty = useOxyUpdateProperty(oxyServices, activeSessionId);
  
  // Delete property
  const deleteProperty = useOxyDeleteProperty(oxyServices, activeSessionId);

  const handleCreate = (data) => {
    createProperty.mutate(data);
  };

  const handleUpdate = (id, data) => {
    updateProperty.mutate({ id, data });
  };

  const handleDelete = (id) => {
    deleteProperty.mutate(id);
  };

  return (
    <div>
      {/* UI components */}
    </div>
  );
}
```

## Error Handling

OxyServices provides better error handling with specific error types:

```typescript
import { ApiError } from '@/utils/oxyApi';

try {
  const result = await oxyApiRequest('/api/properties', options, oxyServices, activeSessionId);
} catch (error) {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      // Authentication error
      console.log('Please sign in');
    } else if (error.status === 403) {
      // Permission error
      console.log('Access denied');
    } else {
      console.log('API error:', error.message);
    }
  } else {
    console.log('Network error:', error.message);
  }
}
```

## Authentication Checks

Always check authentication before making requests:

```typescript
function MyComponent() {
  const { oxyServices, activeSessionId } = useOxy();

  const isAuthenticated = oxyServices && activeSessionId;

  if (!isAuthenticated) {
    return <div>Please sign in to continue</div>;
  }

  // Proceed with authenticated operations
  return <div>Authenticated content</div>;
}
```

## Migration from Refresh Tokens

If you're migrating from the old refresh token approach:

### Before (Refresh Tokens)
```typescript
// ❌ Old approach - causes "No refresh token available" error
import api from '@/utils/api';

const response = await api.post('/api/properties', data);
```

### After (OxyServices)
```typescript
// ✅ New approach - uses OxyServices
import { oxyApiPost } from '@/utils/oxyApi';
import { useOxy } from '@oxyhq/services';

const { oxyServices, activeSessionId } = useOxy();
const response = await oxyApiPost('/api/properties', data, oxyServices, activeSessionId);
```

## Best Practices

1. **Always use OxyServices for authenticated requests**
2. **Check authentication state before making requests**
3. **Use the provided hooks for React Query integration**
4. **Handle errors appropriately with proper user feedback**
5. **Use convenience functions (oxyApiGet, oxyApiPost, etc.) for simpler code**

## Troubleshooting

### "Authentication required" Error
- Ensure the user is signed in with OxyServices
- Check that `oxyServices` and `activeSessionId` are available
- Verify the OxyProvider is properly configured in your app root

### "No refresh token available" Error
- This indicates you're still using the old API utility
- Switch to the new OxyServices-based functions
- Update your imports to use `@/utils/oxyApi` instead of `@/utils/api`

### Network Errors
- Check your API endpoint configuration
- Verify the backend is running and accessible
- Ensure CORS is properly configured for your domain

## Example Implementation

Here's a complete example of a component that creates properties using OxyServices:

```typescript
import React, { useState } from 'react';
import { useOxy } from '@oxyhq/services';
import { useOxyCreateProperty } from '@/hooks/useOxyPropertyQueries';
import { CreatePropertyData } from '@/services/propertyService';

export default function CreatePropertyExample() {
  const { oxyServices, activeSessionId } = useOxy();
  const createPropertyMutation = useOxyCreateProperty(oxyServices, activeSessionId);
  
  const [formData, setFormData] = useState<CreatePropertyData>({
    title: '',
    address: {
      street: '',
      city: '',
      state: '',
      zipCode: '',
      country: 'US',
    },
    type: 'apartment',
    rent: {
      amount: 0,
      currency: 'USD',
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!oxyServices || !activeSessionId) {
      alert('Please sign in to continue');
      return;
    }

    try {
      await createPropertyMutation.mutateAsync(formData);
      // Success handled by the hook (shows toast)
      setFormData({ /* reset form */ });
    } catch (error) {
      // Error handled by the hook (shows toast)
      console.error('Failed to create property:', error);
    }
  };

  const isAuthenticated = oxyServices && activeSessionId;

  if (!isAuthenticated) {
    return (
      <div>
        <h2>Authentication Required</h2>
        <p>Please sign in with OxyServices to create properties.</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2>Create Property</h2>
      
      <input
        type="text"
        placeholder="Property Title"
        value={formData.title}
        onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
        required
      />
      
      <input
        type="text"
        placeholder="Street Address"
        value={formData.address.street}
        onChange={(e) => setFormData(prev => ({ 
          ...prev, 
          address: { ...prev.address, street: e.target.value }
        }))}
        required
      />
      
      {/* More form fields... */}
      
      <button 
        type="submit" 
        disabled={createPropertyMutation.isPending}
      >
        {createPropertyMutation.isPending ? 'Creating...' : 'Create Property'}
      </button>
    </form>
  );
}
```

## Support

For additional help with OxyServices authentication:

1. Check the [OxyServices documentation](https://docs.oxy.so)
2. Review the implementation in `/packages/frontend/utils/oxyApi.ts`
3. Look at working examples in `/packages/frontend/hooks/useOxyPropertyQueries.ts`
4. Test with the property creation form in `/packages/frontend/app/properties/create.tsx`