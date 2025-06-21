# Properties Map Screen

A comprehensive map view for displaying and interacting with properties in the Homiio application.

## Features

### 🗺️ Interactive Map View
- **Multi-property display**: Shows all properties with coordinates on an interactive map
- **Custom markers**: Different colored markers for different property types (A=Apartment, H=House, R=Room, S=Studio)
- **Property selection**: Click on markers to select and view property details
- **Auto-centering**: Map automatically centers on the average location of all properties
- **Zoom controls**: Interactive zoom and pan functionality

### 🔍 Search & Filtering
- **Text search**: Search properties by address, title, or description
- **Property type filters**: Filter by apartment, house, room, or studio
- **Real-time filtering**: Filters apply immediately to both map and list views
- **Clear filters**: Easy reset of all applied filters

### 📱 Dual View Modes
- **Map View**: Interactive map with property markers and overlays
- **List View**: Traditional list view with property cards
- **Seamless switching**: Toggle between views with a single tap

### 🏠 Property Details
- **Property cards**: Detailed property information with images, pricing, and amenities
- **Quick actions**: Select property for detailed view or navigate to full property page
- **Property overlay**: Selected property details appear as an overlay on the map
- **Properties list**: Horizontal scrollable list of nearby properties

### 📊 Data Integration
- **Real-time data**: Uses React Query for efficient data fetching and caching
- **Pagination**: Load more properties as needed
- **Error handling**: Graceful error states with retry functionality
- **Loading states**: Smooth loading indicators and skeleton screens

## Technical Implementation

### Components Used
- **PropertiesMap**: Custom map component supporting multiple properties
- **PropertyCard**: Reusable property display component
- **React Query**: For data fetching and caching
- **OpenStreetMap**: Free map tiles and geocoding services

### Key Features
- **Cross-platform**: Works on web, iOS, and Android
- **Responsive design**: Adapts to different screen sizes
- **Performance optimized**: Efficient rendering and data management
- **Accessibility**: Screen reader friendly with proper labels

## Usage

### Navigation
```typescript
// Navigate to the map screen
router.push('/properties/map');
```

### API Integration
The screen uses the existing property queries:
- `useProperties()` - Fetch all properties with filters
- Property data includes coordinates for map display
- Automatic transformation of property data for map markers

### Customization
- Map center and zoom levels can be customized
- Property marker colors and icons can be modified
- Filter options can be extended
- Overlay positioning and styling can be adjusted

## Future Enhancements

- **Advanced filters**: Price range, amenities, availability
- **Saved searches**: Save and reuse search criteria
- **Property clustering**: Group nearby properties for better performance
- **Directions**: Navigation to selected properties
- **Favorites**: Mark and filter favorite properties
- **Analytics**: Track user interactions and popular areas 