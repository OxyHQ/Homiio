# Frontend Image Upload Integration

This document describes how the image upload functionality has been integrated into the frontend React Native application.

## Components

### ImageUpload Component

Located at `packages/frontend/components/ImageUpload.tsx`

**Features:**
- Image selection from gallery
- Camera capture
- Multiple image upload support
- Image preview with thumbnails
- Primary image selection
- Image deletion
- Upload progress indication
- File size display
- Responsive design

**Props:**
```typescript
interface ImageUploadProps {
  images: UploadedImage[];
  onImagesChange: (images: UploadedImage[]) => void;
  maxImages?: number; // Default: 10
  folder?: string; // Default: 'properties'
  disabled?: boolean; // Default: false
}
```

**Usage:**
```tsx
import { ImageUpload } from '@/components/ImageUpload';

<ImageUpload
  images={formData.media.images}
  onImagesChange={(images) => updateFormField('media', 'images', images)}
  maxImages={10}
  folder="properties"
  disabled={isLoading}
/>
```

## Services

### ImageUploadService

Located at `packages/frontend/services/imageUploadService.ts`

**Features:**
- Single image upload
- Multiple image upload
- Image deletion
- Image info retrieval
- Error handling
- Authentication integration

**Methods:**
```typescript
// Upload a single image
uploadSingleImage(imageUri: string, folder?: string): Promise<UploadedImage>

// Upload multiple images
uploadMultipleImages(imageUris: string[], folder?: string): Promise<UploadedImage[]>

// Delete an image
deleteImage(imageKey: string): Promise<void>

// Delete multiple images
deleteMultipleImages(imageKeys: string[]): Promise<void>

// Get image info
getImageInfo(imageKey: string): Promise<{ key: string; url: string }>
```

## Store Integration

### CreatePropertyFormStore

Updated to handle the new image format:

```typescript
media: {
  images: Array<{
    imageId: string;
    urls: {
      small: string;
      medium: string;
      large: string;
      original: string;
    };
    keys: {
      original: string;
      variants: Record<string, string>;
    };
    metadata: {
      originalSize: number;
      originalFormat: string;
      uploadedAt: Date;
    };
    isPrimary?: boolean;
    caption?: string;
  }>;
  videos?: any[];
};
```

## Authentication

### Auth Utilities

Located at `packages/frontend/utils/auth.ts`

**Features:**
- Token storage and retrieval
- Refresh token management
- Authentication state checking

**Methods:**
```typescript
getAuthToken(): Promise<string | null>
setAuthToken(token: string): Promise<void>
removeAuthToken(): Promise<void>
isAuthenticated(): Promise<boolean>
```

## Integration Points

### Create Property Screen

The Media step in the create property flow now uses the ImageUpload component:

```tsx
case 'Media':
  return (
    <View style={styles.formSection}>
      <ThemedText type="subtitle" style={styles.sectionTitle}>
        Media
      </ThemedText>

      <ImageUpload
        images={formData.media.images}
        onImagesChange={(images) => updateFormField('media', 'images', images)}
        maxImages={10}
        folder="properties"
        disabled={isLoading}
      />
    </View>
  );
```

### Property Preview Widget

Updated to display uploaded images:

```tsx
imageSource={formData.media?.images && formData.media.images.length > 0 
  ? formData.media.images[0].urls.medium 
  : undefined}
```

### Property Submission

Images are processed before submission:

```tsx
images: formData.media.images?.map(img => img.urls.original) || [],
```

## Environment Configuration

Add the following environment variables:

```env
# API Configuration
EXPO_PUBLIC_API_URL=http://localhost:4000

# For production
EXPO_PUBLIC_API_URL=https://your-api-domain.com
```

## Dependencies

Required dependencies (already included):

```json
{
  "expo-image-picker": "~16.1.4",
  "@react-native-async-storage/async-storage": "1.25.0"
}
```

## Usage Flow

1. **User navigates to Media step** in property creation
2. **User taps "Choose Photos" or "Take Photo"**
3. **Image picker opens** (gallery or camera)
4. **User selects/captures images**
5. **Images are uploaded** to backend with progress indication
6. **Images are displayed** in horizontal scrollable grid
7. **User can set primary image** by tapping star icon
8. **User can delete images** by tapping trash icon
9. **Images are saved** in form state
10. **On property submission**, image URLs are sent to backend

## Error Handling

- **Permission denied**: Shows alert with permission request
- **Upload failed**: Shows error alert with retry option
- **Delete failed**: Shows error alert
- **Network errors**: Handled gracefully with user feedback
- **File size limits**: Enforced on frontend and backend
- **File type validation**: Only images allowed

## Performance Optimizations

- **Image compression**: Images are compressed before upload
- **Thumbnail generation**: Backend generates multiple sizes
- **Lazy loading**: Images load as needed
- **Caching**: Images are cached for better performance
- **Progress indication**: Users see upload progress

## Security

- **Authentication**: All requests require valid auth token
- **File validation**: Only image files allowed
- **Size limits**: Maximum file size enforced
- **Secure storage**: Tokens stored securely in AsyncStorage

## Testing

To test the image upload functionality:

1. **Start the backend server** with image upload endpoints
2. **Configure environment variables** for S3/DigitalOcean Spaces
3. **Run the frontend app** in development mode
4. **Navigate to property creation** and go to Media step
5. **Test image selection** from gallery
6. **Test camera capture**
7. **Test image deletion**
8. **Test primary image selection**
9. **Test property submission** with images

## Troubleshooting

### Common Issues

1. **Images not uploading**: Check API URL and authentication
2. **Permission errors**: Ensure camera/gallery permissions are granted
3. **Network errors**: Check internet connection and API availability
4. **Storage errors**: Ensure sufficient device storage
5. **Token errors**: Check authentication state and token validity

### Debug Steps

1. Check console logs for error messages
2. Verify API endpoints are accessible
3. Test authentication token validity
4. Check S3/DigitalOcean Spaces configuration
5. Verify image file formats and sizes
