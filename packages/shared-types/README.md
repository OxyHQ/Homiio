# @homiio/shared-types

Shared TypeScript types for the Homiio frontend and backend applications.

## Overview

This package contains TypeScript interfaces and types that are shared between the frontend and backend applications to ensure type consistency across the entire Homiio platform.

## Installation

```bash
npm install @homiio/shared-types
```

## Usage

### Importing Types

```typescript
import { Property, Profile, City, PropertyType, PropertyStatus } from '@homiio/shared-types';
```

### Available Types

#### Common Types
- `PropertyType` - Enum for property types (apartment, house, room, etc.)
- `PropertyStatus` - Enum for property status (available, occupied, etc.)
- `ProfileType` - Enum for profile types (personal, agency, business, cooperative)
- `ApiResponse<T>` - Generic API response interface
- `Pagination` - Pagination interface
- `Coordinates` - Geographic coordinates interface
- `GeoJSONPoint` - GeoJSON Point format interface

#### Property Types
- `Property` - Main property interface
- `CreatePropertyData` - Data for creating a new property
- `PropertyFilters` - Property search filters
- `PropertyRent` - Property rent information
- `SavedProperty` - Property with saved information
- `MapProperty` - Property for map display

#### Profile Types
- `Profile` - Main profile interface
- `PersonalProfile` - Personal profile data
- `AgencyProfile` - Agency profile data
- `BusinessProfile` - Business profile data
- `CooperativeProfile` - Cooperative profile data
- `CreateProfileData` - Data for creating a new profile
- `UpdateProfileData` - Data for updating a profile

#### Address Types
- `Address` - Basic address interface
- `AddressDetail` - Detailed address with neighborhood info
- `AddressSuggestion` - Address suggestion for search

#### City Types
- `City` - City information interface
- `CityFilters` - City search filters
- `NeighborhoodData` - Neighborhood information
- `CitiesResponse` - API response for cities

#### Lease Types
- `Lease` - Main lease interface
- `LeaseStatus` - Enum for lease status
- `LeaseRent` - Lease rent information
- `LeaseTerms` - Lease terms and conditions
- `CreateLeaseData` - Data for creating a new lease

## Development

### Building

```bash
npm run build
```

### Development Mode

```bash
npm run dev
```

### Cleaning

```bash
npm run clean
```

## Structure

```
src/
├── common.ts      # Common enums and utility types
├── address.ts     # Address-related types
├── property.ts    # Property-related types
├── profile.ts     # Profile-related types
├── city.ts        # City-related types
├── lease.ts       # Lease-related types
└── index.ts       # Main export file
```

## Contributing

When adding new types:

1. Create or update the appropriate type file
2. Export the new types from the main `index.ts` file
3. Update this README with the new types
4. Build the package to ensure everything compiles correctly

## Versioning

This package follows semantic versioning. When making breaking changes to types, increment the major version number. 