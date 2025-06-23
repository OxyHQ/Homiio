# PropertyCard Component

A modern, Airbnb-style property card component with Redux-powered favorites functionality.

## Features

- **Airbnb-inspired Design**: Clean, modern UI with rounded corners, subtle shadows, and proper spacing
- **Redux Integration**: Built-in favorites functionality using Redux state management
- **Multiple Variants**: Support for different display modes (default, compact, featured, saved)
- **Responsive**: Adapts to different screen sizes with proper scaling
- **Accessibility**: Full accessibility support with proper labels and roles
- **TypeScript**: Fully typed with comprehensive TypeScript interfaces
- **Monthly Rentals**: Designed for long-term rental properties (prices shown per month)

## Usage

### Basic Usage

```tsx
import { PropertyCard } from '@/components/PropertyCard';
import { Property } from '@/services/propertyService';

const property: Property = {
  _id: '1',
  address: {
    street: '123 Main St',
    city: 'San Francisco',
    state: 'CA',
    zipCode: '94102',
    country: 'USA',
  },
  type: 'apartment',
  bedrooms: 2,
  bathrooms: 1,
  squareFootage: 1200,
  rent: {
    amount: 3500,
    currency: '$',
    paymentFrequency: 'monthly',
    deposit: 3500,
    utilities: 'included',
  },
  images: ['https://example.com/image.jpg'],
  status: 'available',
  ownerId: 'owner1',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
};

function MyComponent() {
  return (
    <PropertyCard
      property={property}
      onPress={() => console.log('Property pressed')}
    />
  );
}
```

### With Custom Props

```tsx
<PropertyCard
  id="custom-id"
  title="Custom Property Title"
  location="Custom Location"
  price={2500}
  currency="$"
  type="house"
  imageSource={{ uri: 'https://example.com/image.jpg' }}
  bedrooms={3}
  bathrooms={2}
  size={1800}
  rating={4.8}
  reviewCount={25}
  variant="featured"
  onPress={() => console.log('Pressed')}
/>
```

## Props

### Core Data Props
- `property?: Property` - Property object from the service
- `id?: string` - Property ID
- `title?: string` - Property title
- `location?: string` - Property location
- `price?: number` - Property price (displayed as per month)
- `currency?: string` - Currency symbol (default: '$')
- `type?: PropertyType` - Property type
- `imageSource?: any` - Image source
- `bedrooms?: number` - Number of bedrooms
- `bathrooms?: number` - Number of bathrooms
- `size?: number` - Property size
- `sizeUnit?: string` - Size unit (default: 'm²')
- `rating?: number` - Property rating
- `reviewCount?: number` - Number of reviews

### Display Options
- `variant?: PropertyCardVariant` - Display variant (default, compact, featured, saved)
- `showFavoriteButton?: boolean` - Show favorite button (default: true)
- `showVerifiedBadge?: boolean` - Show verified badge (default: true)
- `showTypeIcon?: boolean` - Show property type icon (default: true)
- `showFeatures?: boolean` - Show property features (default: true)
- `showPrice?: boolean` - Show price (default: true)
- `showLocation?: boolean` - Show location (default: true)
- `showRating?: boolean` - Show rating (default: true)

### Actions
- `onPress?: () => void` - Called when card is pressed
- `onLongPress?: () => void` - Called when card is long pressed

### Styling
- `style?: ViewStyle` - Custom styles
- `imageHeight?: number` - Custom image height
- `titleLines?: number` - Number of title lines
- `locationLines?: number` - Number of location lines

### Custom Content
- `footerContent?: React.ReactNode` - Custom footer content
- `badgeContent?: React.ReactNode` - Custom badge content
- `overlayContent?: React.ReactNode` - Custom overlay content

## Variants

### Default
- Standard card layout
- Shows all features and information
- 160px image height
- Ideal for single column layouts

### Compact
- Smaller, condensed layout
- Hides features and rating
- 120px image height
- Ideal for grid layouts and lists

### Featured
- Larger, prominent layout
- Enhanced styling with larger text
- 200px image height
- Ideal for featured properties

### Saved
- Similar to default but optimized for saved properties view
- 160px image height
- Shows all features

## Sizes and Responsive Design

The PropertyCard is designed to be responsive and work well in different layouts:

- **Width**: 100% of container width, max 350px
- **Height**: Varies by variant (120px - 200px for images)
- **Grid Layout**: Works perfectly in 2-column grids
- **List Layout**: Optimized for single column lists
- **Mobile**: Responsive design that adapts to screen size

## Redux Favorites Integration

The PropertyCard automatically integrates with Redux for favorites management. **No external favorite handling is required** - the component manages favorites state internally.

### Automatic Features
- **Heart Icon**: Shows filled heart when property is favorited
- **Toggle Functionality**: Tap to add/remove from favorites
- **Redux State**: Automatically updates Redux store
- **Persistence**: Favorites persist across app sessions
- **Airbnb Styling**: Uses Airbnb's signature red color (#FF385C) when active

### Using the useFavorites Hook

```tsx
import { useFavorites } from '@/hooks/useFavorites';

function MyComponent() {
  const { 
    favoriteIds, 
    isFavorite, 
    toggleFavoriteProperty, 
    getFavoriteCount,
    addFavorite,
    removeFavorite,
    clearFavorites 
  } = useFavorites();
  
  return (
    <View>
      <Text>Total Favorites: {getFavoriteCount()}</Text>
      <Text>Is Property 1 Favorite: {isFavorite('property-1') ? 'Yes' : 'No'}</Text>
      
      <PropertyCard
        property={property}
        onPress={() => console.log('Property pressed')}
      />
      
      {/* Manual favorite management */}
      <TouchableOpacity onPress={() => addFavorite('property-1')}>
        <Text>Add to Favorites</Text>
      </TouchableOpacity>
    </View>
  );
}
```

## Redux Store Setup

The component requires the favorites reducer to be added to your Redux store:

```tsx
// store/store.ts
import favoritesReducer from './reducers/favoritesReducer';

const rootReducer = combineReducers({
  // ... other reducers
  favorites: favoritesReducer,
});
```

### Redux State Structure

```tsx
interface FavoritesState {
  favoriteIds: string[];
  isLoading: boolean;
  error: string | null;
}
```

### Available Actions

- `addToFavorites(propertyId: string)` - Add property to favorites
- `removeFromFavorites(propertyId: string)` - Remove property from favorites
- `toggleFavorite(propertyId: string)` - Toggle favorite status
- `setFavorites(propertyIds: string[])` - Set all favorites at once
- `clearFavorites()` - Clear all favorites

## Price Display

The PropertyCard is designed for **long-term rental properties** and displays prices as **per month**:

- **Format**: `$3,500/month`
- **Currency**: Supports any currency symbol
- **Localization**: Uses `toLocaleString()` for proper number formatting
- **Rental Focus**: Optimized for monthly rental properties, not short-term stays

## Styling

The component uses a modern Airbnb-inspired design with:

- Rounded corners (12px border radius)
- Subtle shadows and elevation
- Clean typography with proper hierarchy
- Responsive width (100% of container, max 350px)
- Proper spacing and padding
- Airbnb's signature red color for favorites

## Accessibility

- Proper accessibility labels for favorite button
- Screen reader support
- Touch target sizes meet accessibility guidelines
- High contrast colors for better visibility

## Integration with PropertyList

The PropertyCard works seamlessly with the PropertyList component for grid and list layouts:

```tsx
import { PropertyList } from '@/components/PropertyList';

<PropertyList
  properties={properties}
  onPropertyPress={handlePropertyPress}
  numColumns={2} // For grid layout
  variant="compact" // For smaller cards in grid
/>
```

## Testing

Use the `FavoritesTest` component to verify Redux functionality:

```tsx
import { FavoritesTest } from '@/components/FavoritesTest';

// Add this to any screen to test favorites functionality
<FavoritesTest />
```

## Example

See `PropertyCardExample.tsx` for a complete example of how to use the component with different variants and configurations. 