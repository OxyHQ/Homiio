# Address Search Hooks

This directory contains reusable hooks for address search functionality using OpenStreetMap Nominatim API.

## useAddressSearch

Basic hook for address search with manual control.

```tsx
import { useAddressSearch } from '@/hooks/useAddressSearch';

const { suggestions, loading, error, searchAddresses, clearSuggestions } = useAddressSearch({
  minQueryLength: 3,
  maxResults: 5,
  includeAddressDetails: true
});

// Search for addresses
await searchAddresses('123 Main St');

// Clear suggestions
clearSuggestions();
```

## useDebouncedAddressSearch

Hook with built-in debouncing for use with input fields.

```tsx
import { useDebouncedAddressSearch } from '@/hooks/useAddressSearch';

const { suggestions, loading, error, debouncedSearch } = useDebouncedAddressSearch({
  minQueryLength: 3,
  debounceDelay: 500,
  maxResults: 5,
  includeAddressDetails: true
});

// Use with TextInput
<TextInput onChangeText={debouncedSearch} />
```

## useReverseGeocode

Hook for reverse geocoding (coordinates to address).

```tsx
import { useReverseGeocode } from '@/hooks/useAddressSearch';

const { reverseGeocode, result, loading, error } = useReverseGeocode();

// Get address from coordinates
await reverseGeocode(40.7128, -74.0060);
```

## Configuration Options

### AddressSearchOptions

- `minQueryLength` (default: 3) - Minimum characters before searching
- `debounceDelay` (default: 500) - Debounce delay in milliseconds
- `maxResults` (default: 5) - Maximum number of suggestions
- `includeAddressDetails` (default: true) - Include parsed address components

### AddressSuggestion

```tsx
interface AddressSuggestion {
  id: string;           // OpenStreetMap place_id
  text: string;         // Full display name
  icon: string;         // Location icon
  lat?: number;         // Latitude
  lon?: number;         // Longitude
  address?: {           // Parsed address components
    street: string;
    city: string;
    state: string;
    country: string;
    postcode: string;
  };
}
```

## Usage Examples

### Main Search (index.tsx)

```tsx
const {
  suggestions: addressSuggestions,
  loading: isLoadingAddresses,
  debouncedSearch: fetchAddressSuggestions
} = useDebouncedAddressSearch({
  minQueryLength: 3,
  debounceDelay: 500,
  maxResults: 5,
  includeAddressDetails: true
});

<TextInput
  onChangeText={(text) => {
    setSearchQuery(text);
    fetchAddressSuggestions(text);
  }}
/>
```

### Create Property Form

The create property form uses the PropertyMap component which already implements address search using the same OpenStreetMap API.

### Custom Implementation

```tsx
const { suggestions, loading, searchAddresses } = useAddressSearch();

const handleSearch = async (query: string) => {
  await searchAddresses(query);
  // Custom logic with suggestions
  suggestions.forEach(suggestion => {
    console.log(suggestion.text, suggestion.address);
  });
};
```

## API Endpoints

- **Search**: `https://nominatim.openstreetmap.org/search`
- **Reverse Geocode**: `https://nominatim.openstreetmap.org/reverse`

## Benefits

- **Reusable**: Same hook across different components
- **Configurable**: Customizable options for different use cases
- **Type-safe**: Full TypeScript support
- **Error handling**: Built-in error states and handling
- **Performance**: Debounced search to reduce API calls
- **Global coverage**: OpenStreetMap provides worldwide address data
- **Free**: No API keys or rate limits for basic usage 