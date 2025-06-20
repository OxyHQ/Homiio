# PropertyMap Component

A cross-platform map component that works on web, iOS, and Android using OpenStreetMap and Leaflet.

## Features

- **Cross-platform**: Works on web, iOS, and Android
- **Search functionality**: Search for addresses using OpenStreetMap's Nominatim service
- **Interactive selection**: Click on the map to select a location
- **Reverse geocoding**: Automatically gets address from coordinates
- **Real-time updates**: Updates form fields when location is selected

## Usage

```tsx
import { PropertyMap } from '@/components/PropertyMap';

// Basic usage
<PropertyMap
  latitude={40.7128}
  longitude={-74.0060}
  address="New York, NY"
  onLocationSelect={(lat, lng, address) => {
    console.log('Selected location:', { lat, lng, address });
  }}
  height={300}
  interactive={true}
/>
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `latitude` | `number` | `40.7128` | Initial latitude coordinate |
| `longitude` | `number` | `-74.0060` | Initial longitude coordinate |
| `address` | `string` | `''` | Display address for the location |
| `onLocationSelect` | `(lat: number, lng: number, address: string) => void` | `undefined` | Callback when location is selected |
| `height` | `number` | `300` | Height of the map component |
| `interactive` | `boolean` | `true` | Whether the map is interactive |

## Integration with Create Property Form

The map component is integrated into the create property form and:

1. **Searches addresses**: Users can search for any address
2. **Selects locations**: Users can click on the map to select a location
3. **Auto-fills form**: Automatically fills street, city, state, and ZIP code fields
4. **Stores coordinates**: Saves latitude and longitude for the property

## Technical Details

- Uses **OpenStreetMap** tiles (free and open-source)
- Uses **Nominatim** for geocoding and reverse geocoding
- Uses **Leaflet** for map functionality
- Wrapped in **WebView** for cross-platform compatibility
- Includes error handling and loading states

## Backend Integration

The selected location coordinates are sent to the backend and stored in the property's address coordinates:

```javascript
address: {
  street: "123 Main St",
  city: "New York",
  state: "NY",
  zipCode: "10001",
  coordinates: {
    lat: 40.7128,
    lng: -74.0060
  }
}
```

## Error Handling

The component includes:
- Loading states with spinner
- Error messages if map fails to load
- Fallback timeout for loading
- Graceful degradation if geocoding fails 