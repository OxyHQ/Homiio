# Frontend Property Title System

This document describes the updated property title generation system on the frontend, which now matches the backend Telegram notification format.

## Overview

The frontend property title system provides:
- **Dynamic descriptive titles** for each property
- **Multi-language support** (Spanish and English) using i18next
- **Privacy protection** (property numbers automatically removed)
- **Consistent formatting** with backend Telegram notifications
- **Real-time localization** based on user's language preference

## Title Format

Property titles follow the format: `{PropertyType} {forRent} {Location}`

### Examples

**🇪🇸 Spanish Examples:**
- `Apartamento en alquiler en Calle Principal, Barcelona`
- `Casa en alquiler en Av. Diagonal, Barcelona, Cataluña`
- `Habitación en alquiler en Carrer Gran, Girona`

**🇺🇸 English Examples:**
- `Apartment for rent in Main Street, Madrid`
- `House for rent in Oak Avenue, Valencia, Valencia`
- `Room for rent in Pine Street, Seville`

## Implementation

### Core Files

1. **`utils/propertyTitleGenerator.ts`** - Main title generation logic
2. **`utils/propertyUtils.ts`** - Integration with Property components
3. **`locales/es.json`** - Spanish translations
4. **`locales/en.json`** - English translations

### Key Functions

#### `generatePropertyTitle(propertyData)`
Generates the main property title with privacy protection and localization.

```typescript
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';

const title = generatePropertyTitle({
  type: 'apartment',
  address: {
    street: 'Calle Principal, 123',
    city: 'Barcelona',
    state: 'Cataluña'
  }
});
// Result: "Apartamento en alquiler en Calle Principal, Barcelona, Cataluña"
```

#### `generateDetailedPropertyTitle(propertyData, includeDetails)`
Generates title with optional bedroom/bathroom details.

```typescript
const detailedTitle = generateDetailedPropertyTitle({
  type: 'apartment',
  address: { street: 'Main St', city: 'Madrid' },
  bedrooms: 2,
  bathrooms: 1
}, true);
// Result: "Apartment for rent in Main St, Madrid - 2 bedrooms, 1 bathroom"
```

### Privacy Protection

The system automatically removes property numbers for privacy:

```typescript
// Input: "Calle de Vicente Blasco Ibáñez, 6"
// Output: "Calle de Vicente Blasco Ibáñez"

// Input: "Main Street, 123-125"  
// Output: "Main Street"
```

### Localization

The system uses i18next for translations and automatically adapts to the user's language:

#### Spanish Translations (`locales/es.json`)
```json
{
  "properties": {
    "titles": {
      "forRent": "en alquiler en",
      "locationNotSpecified": "Ubicación no especificada",
      "types": {
        "apartment": "Apartamento",
        "house": "Casa",
        "room": "Habitación",
        "studio": "Estudio",
        "duplex": "Dúplex",
        "penthouse": "Ático"
      }
    }
  }
}
```

#### English Translations (`locales/en.json`)
```json
{
  "properties": {
    "titles": {
      "forRent": "for rent in",
      "locationNotSpecified": "Location not specified",
      "types": {
        "apartment": "Apartment",
        "house": "House",
        "room": "Room",
        "studio": "Studio",
        "duplex": "Duplex",
        "penthouse": "Penthouse"
      }
    }
  }
}
```

## Integration with Components

### PropertyCard Component

The `PropertyCard` component automatically uses the dynamic title generation:

```tsx
import { PropertyCard } from '@/components/PropertyCard';

// The component automatically generates titles using getPropertyTitle()
<PropertyCard property={property} />
```

### Usage in Property Utils

```typescript
import { getPropertyTitle } from '@/utils/propertyUtils';

const title = getPropertyTitle(property);
// Returns localized, privacy-protected title
```

## Features

### 1. Dynamic Title Generation
- Titles are generated based on property type and location
- No hardcoded strings or static titles
- Adapts to different property types automatically

### 2. Multi-language Support
- Automatic language detection from i18next
- Full Spanish and English support
- Easy to add new languages

### 3. Privacy Protection
- Property numbers automatically removed from addresses
- Maintains general location context
- Follows privacy best practices

### 4. Location Handling
- **Full address**: Street (without number) + City + State
- **City + State**: When street is not available
- **City only**: When state is not available
- **Fallback**: Localized "Location not specified" message

### 5. Consistency with Backend
- Same format as Telegram notifications
- Consistent privacy protection
- Unified translation keys

## Error Handling

The system includes robust error handling:

- **Missing translations**: Falls back to English
- **Invalid property types**: Uses "apartment" as default
- **Missing address**: Uses localized fallback text
- **Long titles**: Automatically truncated to 200 characters

## Testing

### Manual Testing

Test the title generation with different property configurations:

```typescript
// Test basic apartment
generatePropertyTitle({
  type: 'apartment',
  address: { street: 'Calle Mayor, 45', city: 'Madrid' }
});

// Test room with full address
generatePropertyTitle({
  type: 'room',
  address: { 
    street: 'Carrer de Provença, 123', 
    city: 'Barcelona', 
    state: 'Cataluña' 
  }
});

// Test missing address
generatePropertyTitle({
  type: 'house',
  address: {}
});
```

### Language Switching

Test with different languages:

```typescript
// Switch to Spanish
i18next.changeLanguage('es');
const spanishTitle = generatePropertyTitle(propertyData);

// Switch to English  
i18next.changeLanguage('en');
const englishTitle = generatePropertyTitle(propertyData);
```

## Best Practices

1. **Always use the utility functions** instead of creating titles manually
2. **Respect user language preferences** - titles automatically adapt
3. **Don't expose property numbers** - the system handles privacy automatically
4. **Use detailed titles sparingly** - only when bedroom/bathroom info adds value
5. **Test with different languages** during development

## Future Enhancements

- [ ] Support for more property types (loft, cottage, etc.)
- [ ] Additional languages (French, German, Italian)
- [ ] Custom title templates per region
- [ ] SEO-optimized title variations
- [ ] Integration with property search algorithms

## Consistency Benefits

This implementation ensures:
- ✅ **Frontend titles match Telegram notifications**
- ✅ **Privacy protection across all platforms**
- ✅ **Consistent multi-language support**
- ✅ **Unified translation management**
- ✅ **Professional, descriptive property titles**

The frontend now provides the same high-quality, privacy-protected, and localized property titles as the backend Telegram system! 