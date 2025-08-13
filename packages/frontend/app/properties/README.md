# Properties Screens

This directory contains all property-related screens in the Homiio app.

## Screens

### `/properties/my` - My Properties Screen

- **Purpose**: Displays properties owned by the current user
- **Features**:
  - List of user's owned properties with PropertyCard components
  - Edit and delete actions for each property
  - Empty state with call-to-action to create first property
  - Error state with retry functionality
  - Pull-to-refresh functionality
  - Add button in header to create new property
- **Navigation**:
  - Property detail: `/properties/[id]`
  - Edit property: `/properties/create?id=[id]` (Unified with create screen)
  - Create property: `/properties/create`
- **API**: Uses `useUserProperties` hook to fetch data from `/api/users/me/properties`

### `/properties/[id]` - Property Detail Screen

- **Purpose**: Displays detailed information about a specific property
- **Features**:
  - Property images, details, and amenities
  - Contact landlord functionality
  - Save/unsave property
  - Share property
  - Book viewing functionality
  - Property map integration

### `/properties/create` - Create Property Screen

- **Purpose**: Form to create a new property listing
- **Features**:
  - Multi-step form for property details
  - Image upload functionality
  - Location selection with map integration
  - Amenities selection
  - Preview before publishing

### `/properties/search` - Property Search Screen

- **Purpose**: Search and filter properties
- **Features**:
  - Search by location, property type, etc.
  - Advanced filters (price, bedrooms, amenities)
  - Map view integration
  - Saved searches functionality

### `/properties/map` - Property Map Screen

- **Purpose**: View properties on a map
- **Features**:
  - Interactive map with property markers
  - Property clustering
  - Filter properties on map
  - Navigation to property details

## Components Used

- `PropertyCard`: Reusable card component for displaying property information
- `Header`: Navigation header with title and action buttons
- `Button`: Standard button component
- `LoadingTopSpinner`: Loading indicator
- `PropertyMap`: Map component for property locations

## Hooks Used

- `useUserProperties`: Fetch user's owned properties
- `useProperty`: Fetch individual property details
- `useSaveProperty`/`useUnsaveProperty`: Property save functionality
- `useOxy`: Authentication and user context

## Translation Keys

The screens use the following translation keys:

```json
{
  "properties": {
    "my": {
      "title": "My Properties",
      "edit": "Edit",
      "delete": "Delete",
      "deleteTitle": "Delete Property",
      "deleteMessage": "Are you sure you want to delete \"{{title}}\"? This action cannot be undone.",
      "deleteSuccess": "Property deleted successfully",
      "emptyTitle": "No Properties Yet",
      "emptyDescription": "You haven't created any properties yet. Start by adding your first property listing.",
      "createFirst": "Create Your First Property",
      "errorTitle": "Error Loading Properties",
      "errorDescription": "There was an error loading your properties. Please try again."
    }
  }
}
```

## API Endpoints

- `GET /api/users/me/properties` - Get user's owned properties
- `GET /api/properties/:id` - Get property details
- `POST /api/properties` - Create new property
- `PUT /api/properties/:id` - Update property
- `DELETE /api/properties/:id` - Delete property

## Future Enhancements

- Property editing functionality
- Property analytics and insights
- Bulk property management
- Property scheduling and availability management
- Integration with property management tools
