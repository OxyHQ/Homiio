# Geospatial Search API Documentation

## Overview

The Property Search API has been extended to support location-based searches using GeoJSON Point coordinates and MongoDB's geospatial query operators. This enables powerful location-based property discovery with distance-based filtering and sorting.

## API Endpoints

### 1. Enhanced Search Properties

**Endpoint:** `GET /api/properties/search`

**Description:** Enhanced search endpoint that supports both text-based and location-based queries.

**Query Parameters:**
- `query` (optional): Text search query
- `type` (optional): Property type filter
- `minRent` (optional): Minimum rent amount
- `maxRent` (optional): Maximum rent amount
- `city` (optional): City name filter
- `bedrooms` (optional): Number of bedrooms
- `bathrooms` (optional): Number of bathrooms
- `amenities` (optional): Comma-separated list of amenities
- `available` (optional): Availability filter (true/false)
- `lat` (optional): Latitude coordinate
- `lng` (optional): Longitude coordinate
- `radius` (optional): Search radius in meters
- `page` (optional): Page number (default: 1)
- `limit` (optional): Results per page (default: 10)

**Location Search Example:**
```bash
GET /api/properties/search?lat=40.730610&lng=-73.935242&radius=5000&type=apartment&minRent=1000&maxRent=3000
```

**Response:**
```json
{
  "success": true,
  "message": "Search completed successfully",
  "data": [
    {
      "_id": "property_id",
      "address": {
        "street": "123 Main St",
        "city": "New York",
        "state": "NY",
        "zipCode": "10001"
      },
      "location": {
        "type": "Point",
        "coordinates": [-73.935242, 40.730610]
      },
      "type": "apartment",
      "rent": {
        "amount": 2500,
        "currency": "USD"
      },
      "bedrooms": 2,
      "bathrooms": 1
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 25,
    "totalPages": 3
  }
}
```

### 2. Find Nearby Properties

**Endpoint:** `GET /api/properties/nearby`

**Description:** Find properties within a specified distance from a point, sorted by distance (closest first).

**Required Parameters:**
- `longitude`: Longitude coordinate
- `latitude`: Latitude coordinate

**Optional Parameters:**
- `maxDistance` (default: 10000): Maximum distance in meters
- `type`: Property type filter
- `minRent`: Minimum rent amount
- `maxRent`: Maximum rent amount
- `bedrooms`: Number of bedrooms
- `bathrooms`: Number of bathrooms
- `amenities`: Comma-separated list of amenities
- `available`: Availability filter (true/false)
- `page` (default: 1): Page number
- `limit` (default: 10): Results per page

**Example:**
```bash
GET /api/properties/nearby?longitude=-73.9855&latitude=40.7580&maxDistance=5000&type=apartment&minRent=1500
```

**Response:**
```json
{
  "success": true,
  "message": "Nearby properties found successfully",
  "data": [
    {
      "_id": "property_id",
      "address": {
        "street": "456 Broadway",
        "city": "New York",
        "state": "NY",
        "zipCode": "10013"
      },
      "location": {
        "type": "Point",
        "coordinates": [-73.9855, 40.7580]
      },
      "type": "apartment",
      "rent": {
        "amount": 2800,
        "currency": "USD"
      },
      "bedrooms": 1,
      "bathrooms": 1
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 15,
    "totalPages": 2
  }
}
```

### 3. Find Properties in Radius

**Endpoint:** `GET /api/properties/radius`

**Description:** Find properties within a circular radius from a point.

**Required Parameters:**
- `longitude`: Longitude coordinate
- `latitude`: Latitude coordinate
- `radius`: Radius in meters

**Optional Parameters:**
- `type`: Property type filter
- `minRent`: Minimum rent amount
- `maxRent`: Maximum rent amount
- `bedrooms`: Number of bedrooms
- `bathrooms`: Number of bathrooms
- `amenities`: Comma-separated list of amenities
- `available`: Availability filter (true/false)
- `page` (default: 1): Page number
- `limit` (default: 10): Results per page

**Example:**
```bash
GET /api/properties/radius?longitude=-73.9855&latitude=40.7580&radius=3000&type=house&maxRent=4000
```

**Response:**
```json
{
  "success": true,
  "message": "Properties in radius found successfully",
  "data": [
    {
      "_id": "property_id",
      "address": {
        "street": "789 Park Ave",
        "city": "New York",
        "state": "NY",
        "zipCode": "10021"
      },
      "location": {
        "type": "Point",
        "coordinates": [-73.9700, 40.7500]
      },
      "type": "house",
      "rent": {
        "amount": 3500,
        "currency": "USD"
      },
      "bedrooms": 3,
      "bathrooms": 2
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 8,
    "totalPages": 1
  }
}
```

## Geospatial Query Types

### 1. $near Operator (Used in /search and /nearby)

The `$near` operator finds documents near a specified point and returns results sorted by distance.

```javascript
{
  location: {
    $near: {
      $geometry: {
        type: 'Point',
        coordinates: [longitude, latitude]
      },
      $maxDistance: radiusInMeters
    }
  }
}
```

**Benefits:**
- Results sorted by distance (closest first)
- Efficient with 2dsphere index
- Supports maxDistance limit

### 2. $geoWithin with $centerSphere (Used in /radius)

The `$geoWithin` operator with `$centerSphere` finds documents within a circular area.

```javascript
{
  location: {
    $geoWithin: {
      $centerSphere: [[longitude, latitude], radiusInRadians]
    }
  }
}
```

**Benefits:**
- Exact circular boundary
- No distance sorting (can be combined with other sorts)
- Efficient for radius-based searches

## Coordinate Validation

All endpoints validate coordinates to ensure they are within valid ranges:

- **Latitude**: Must be between -90 and 90 degrees
- **Longitude**: Must be between -180 and 180 degrees

**Error Response for Invalid Coordinates:**
```json
{
  "success": false,
  "message": "Invalid coordinates provided",
  "error": "INVALID_COORDINATES"
}
```

## Distance Calculations

### Distance Units
- All distances are specified in **meters**
- The API uses the Haversine formula for accurate distance calculations
- Earth's radius is assumed to be 6,371,000 meters

### Common Distance Values
- **1 km** = 1000 meters
- **5 km** = 5000 meters
- **10 km** = 10000 meters
- **1 mile** ≈ 1609 meters

## Performance Considerations

### Index Usage
- The 2dsphere index on the `location` field is automatically used
- Geospatial queries are highly efficient with proper indexing
- Compound queries with location and other filters are optimized

### Query Optimization
- Use appropriate radius values (avoid very large radii)
- Combine location filters with other filters for better performance
- Consider pagination for large result sets

### Best Practices
1. **Use reasonable radius values**: 1-10km for most searches
2. **Combine with other filters**: Add property type, rent range, etc.
3. **Implement pagination**: Use page and limit parameters
4. **Cache results**: Consider caching for frequently searched areas

## Frontend Integration

### Using the Enhanced Search

```typescript
// Search with location
const searchWithLocation = async () => {
  const response = await propertyService.getProperties({
    lat: 40.730610,
    lng: -73.935242,
    radius: 5000,
    type: 'apartment',
    minRent: 1000,
    maxRent: 3000
  });
  return response;
};
```

### Using Nearby Search

```typescript
// Find nearby properties
const findNearby = async () => {
  const response = await propertyService.findNearbyProperties(
    -73.9855,  // longitude
    40.7580,   // latitude
    5000,      // maxDistance in meters
    {
      type: 'apartment',
      minRent: 1500,
      maxRent: 3000
    }
  );
  return response;
};
```

### Using Radius Search

```typescript
// Find properties in radius
const findInRadius = async () => {
  const response = await propertyService.findPropertiesInRadius(
    -73.9855,  // longitude
    40.7580,   // latitude
    3000,      // radius in meters
    {
      type: 'house',
      maxRent: 4000
    }
  );
  return response;
};
```

## Error Handling

### Common Error Responses

**Missing Coordinates:**
```json
{
  "success": false,
  "message": "Longitude and latitude are required",
  "error": "MISSING_COORDINATES"
}
```

**Missing Parameters:**
```json
{
  "success": false,
  "message": "Longitude, latitude, and radius are required",
  "error": "MISSING_PARAMETERS"
}
```

**Invalid Coordinates:**
```json
{
  "success": false,
  "message": "Invalid coordinates provided",
  "error": "INVALID_COORDINATES"
}
```

## Use Cases

### 1. User Location-Based Search
```bash
# Find apartments within 2km of user's location
GET /api/properties/search?lat=40.730610&lng=-73.935242&radius=2000&type=apartment
```

### 2. Neighborhood Exploration
```bash
# Find all properties within 5km of a landmark
GET /api/properties/nearby?longitude=-73.9855&latitude=40.7580&maxDistance=5000
```

### 3. Commute-Based Search
```bash
# Find properties within 3km of a train station
GET /api/properties/radius?longitude=-73.9700&latitude=40.7500&radius=3000&minRent=1500&maxRent=3000
```

### 4. Campus Housing Search
```bash
# Find student housing near university
GET /api/properties/search?lat=40.730610&lng=-73.935242&radius=1000&type=room&maxRent=1500
```

## Testing

### Test Coordinates (New York City)
- **Times Square**: 40.7580, -73.9855
- **Central Park**: 40.7829, -73.9654
- **Brooklyn Bridge**: 40.7061, -73.9969
- **Statue of Liberty**: 40.6892, -74.0445

### Example Test Queries
```bash
# Test nearby search
curl "http://localhost:3001/api/properties/nearby?longitude=-73.9855&latitude=40.7580&maxDistance=2000"

# Test radius search
curl "http://localhost:3001/api/properties/radius?longitude=-73.9855&latitude=40.7580&radius=1500"

# Test enhanced search with location
curl "http://localhost:3001/api/properties/search?lat=40.7580&lng=-73.9855&radius=1000&type=apartment"
```

## Future Enhancements

### Planned Features
1. **Polygon Search**: Search within custom polygon boundaries
2. **Route-Based Search**: Find properties along a route
3. **Distance Sorting**: Sort by distance in all queries
4. **Geofencing**: Real-time notifications for new properties in area
5. **Heat Maps**: Property density visualization
6. **Travel Time**: Integration with transportation APIs

### Advanced Queries
1. **Multi-Point Search**: Search near multiple locations
2. **Exclusion Zones**: Exclude certain areas from search
3. **Custom Shapes**: Search within custom geometric shapes
4. **Elevation-Based**: Consider elevation in distance calculations 