# Address Refactoring Migration Guide

## Overview

This document describes the refactoring of address handling in the Homiio application from embedded documents to a separate collection with references. This change improves data integrity, reduces duplication, and enables easier address updates.

## What Changed

### Before (Embedded Addresses)
```javascript
// Property document structure
{
  _id: ObjectId,
  title: "Property Title",
  address: {
    street: "123 Main St",
    city: "New York",
    state: "NY",
    zipCode: "10001",
    country: "USA",
    coordinates: {
      type: "Point",
      coordinates: [-74.006, 40.7128]
    }
  },
  // ... other property fields
}
```

### After (Address References)
```javascript
// Address document
{
  _id: ObjectId("address_id_123"),
  street: "123 Main St",
  city: "New York",
  state: "NY",
  zipCode: "10001",
  country: "USA",
  coordinates: {
    type: "Point",
    coordinates: [-74.006, 40.7128]
  },
  createdAt: Date,
  updatedAt: Date
}

// Property document structure
{
  _id: ObjectId,
  title: "Property Title",
  addressId: ObjectId("address_id_123"), // Reference to address
  // ... other property fields
}
```

## Benefits

1. **Data Normalization**: Eliminates duplicate address data
2. **Easier Updates**: Change address once, affects all properties
3. **Shared Addresses**: Multiple properties can reference the same address
4. **Better Performance**: Reduced document size for properties
5. **Future Features**: Enables address validation, deduplication, and analytics

## Migration Process

### 1. Run Migration Script

```bash
# Check current migration status
node scripts/migrate-addresses.js status

# Run the migration
node scripts/migrate-addresses.js migrate
```

### 2. Migration Steps

The migration script:
1. Creates the new Address collection
2. Extracts unique addresses from existing properties
3. Creates Address documents with proper deduplication
4. Updates properties to reference addresses by ID
5. Removes embedded address data from properties

## Code Changes

### 1. Schema Changes

- **New**: `AddressSchema.ts` - Standalone address model
- **Updated**: `PropertySchema.ts` - Uses `addressId` reference instead of embedded `address`

### 2. Controller Updates

All controllers that previously accessed `property.address.*` fields have been updated:

- **Property Controllers**: Updated to populate address data
- **Search/Filter Logic**: Now uses Address collection lookups
- **Geospatial Queries**: Work with Address coordinates
- **Analytics**: Uses aggregation pipelines with Address lookups

### 3. API Changes

**Property Retrieval**: Address data is now populated automatically
```javascript
// Before
property.address.city

// After (same access pattern)
property.addressId.city // or property.address.city (populated)
```

**Property Creation**: Can use either address data or addressId
```javascript
// Option 1: Provide address data (will be deduplicated)
POST /api/properties
{
  "title": "My Property",
  "address": {
    "street": "123 Main St",
    "city": "New York",
    // ... other address fields
  }
}

// Option 2: Reference existing address
POST /api/properties
{
  "title": "My Property", 
  "addressId": "address_id_123"
}
```

## Developer Guidelines

### 1. Querying Properties with Addresses

```javascript
// Always populate address when needed
const properties = await Property.find(query).populate('addressId');

// For lean queries
const properties = await Property.find(query).populate('addressId').lean();
```

### 2. Creating Properties

```javascript
// Use Address.findOrCreate for automatic deduplication
const { Address } = require('../models');
const address = await Address.findOrCreate(addressData);
const property = new Property({
  ...propertyData,
  addressId: address._id
});
```

### 3. Address-based Filtering

```javascript
// For city/state filtering, use Address lookup
const { Address } = require('../models');
const addressQuery = { city: new RegExp(city, 'i') };
const matchingAddresses = await Address.find(addressQuery).select('_id');
const addressIds = matchingAddresses.map(addr => addr._id);

const properties = await Property.find({
  addressId: { $in: addressIds }
}).populate('addressId');
```

### 4. Geospatial Queries

```javascript
// Use Property static methods for geospatial queries
const nearbyProperties = await Property.findNearby(lng, lat, maxDistance);
const propertiesInRadius = await Property.findWithinRadius(lng, lat, radius);
```

## Rollback Plan

If issues arise, the migration can be reversed:

1. **Backup**: The original PropertySchema is saved as `PropertySchema.ts.bak`
2. **Data Restoration**: Re-embed address data from Address collection back into properties
3. **Schema Revert**: Restore the original embedded address schema

## Testing

### 1. Property Creation
- Test creating properties with new address data
- Test creating properties with existing addressId
- Verify address deduplication works

### 2. Property Queries
- Test property listings with city/state filters
- Test geospatial queries (nearby, radius)
- Verify address data is properly populated

### 3. Address Updates
- Test updating an address and verify all properties reflect the change
- Test address coordinate updates for geospatial queries

## Monitoring

Monitor the following after migration:

1. **Query Performance**: Address lookup queries should be efficient
2. **Data Integrity**: Verify all properties have valid addressId references
3. **Deduplication**: Check that duplicate addresses are properly merged
4. **API Responses**: Ensure address data is properly populated in responses

## Support

For issues related to this migration:
1. Check migration script logs
2. Verify database indexes are properly created
3. Ensure all controllers populate address data
4. Check for any remaining embedded address references in queries