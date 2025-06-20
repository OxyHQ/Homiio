# Property Title Generator

This utility automatically generates property titles based on property data, following the format requested in the examples. **Titles are generated dynamically when displaying properties and are not stored in the database.**

## Usage

```typescript
import { generatePropertyTitle, getPropertyTitle } from '@/utils/propertyTitleGenerator';
import { getPropertyDisplayTitle } from '@/utils/propertyUtils';

// Generate a title for a property
const title = generatePropertyTitle({
  type: 'room',
  address: {
    street: 'Calle de Provença, 478',
    city: 'Barcelona',
    state: 'Catalonia'
  }
});
// Result: "Room for rent in Calle de Provença, 478, Barcelona"

// Get title for a property object
const propertyTitle = getPropertyTitle(property);
// Result: "Studio flat for rent in Calle de Garigliano, 34, Barcelona"

// Get display title for UI components
const displayTitle = getPropertyDisplayTitle(property);
```

## Examples

Based on the provided examples:

1. **Room for rent in calle de Provença, 478**
   ```typescript
   generatePropertyTitle({
     type: 'room',
     address: { street: 'Calle de Provença, 478', city: 'Barcelona' }
   })
   ```

2. **Duplex for rent in calle d'Aragó**
   ```typescript
   generatePropertyTitle({
     type: 'duplex',
     address: { street: "Calle d'Aragó", city: 'Barcelona' }
   })
   ```

3. **Studio flat for rent in calle de Garigliano, 34**
   ```typescript
   generatePropertyTitle({
     type: 'studio',
     address: { street: 'Calle de Garigliano, 34', city: 'Barcelona' }
   })
   ```

## Features

- **Dynamic title generation** based on property type and address
- **Smart formatting** that extracts street numbers and formats addresses properly
- **Fallback handling** when address information is incomplete
- **Length validation** to ensure titles don't exceed 200 characters
- **Type safety** with TypeScript interfaces
- **No database storage** - titles are generated on-the-fly when displaying properties

## Property Types Supported

- `room` → "Room for rent"
- `studio` → "Studio flat for rent"
- `apartment` → "Apartment for rent" (or "Studio for rent" if 1 bedroom)
- `house` → "House for rent" (or "Cottage for rent" if 1 bedroom)
- `duplex` → "Duplex for rent"
- `penthouse` → "Penthouse for rent"

## Implementation Status

Dynamic title generation has been implemented across the entire application:

### ✅ Completed
- **Property Detail Page** (`/properties/[id].tsx`) - Generates titles dynamically
- **Recently Viewed Widget** - Generates titles for recently viewed properties
- **Property Type Pages** (`/properties/type/[id].tsx`) - Generates titles for mock data
- **City Properties Pages** (`/properties/city/[id].tsx`) - Generates titles for mock data
- **Book Viewing Page** (`/properties/[id]/book-viewing.tsx`) - Generates titles for viewing appointments
- **Search Results Page** (`/search/[query].tsx`) - Generates titles for search results
- **Backend API** - No longer stores titles in database
- **Property Creation** - No longer requires title input

### 🔧 Components Using Dynamic Titles
- `PropertyCard` - Receives generated titles as props
- `PropertyList` - Displays properties with generated titles
- `RecentlyViewedWidget` - Shows recently viewed properties with generated titles
- All property display pages and components

### 📝 Database Changes
- Removed `title` field from Property schema
- Updated Property model to exclude title from JSON output
- Updated Property controller to not handle title storage
- Updated Property service interfaces to not include title field

## Benefits

1. **Consistency** - All property titles follow the same format
2. **Flexibility** - Titles automatically adapt to property data changes
3. **Storage Efficiency** - No redundant title storage in database
4. **Maintainability** - Single source of truth for title generation logic
5. **Localization Ready** - Easy to adapt for different languages 