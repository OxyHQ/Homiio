# Image Upload Service

This service provides image upload functionality using AWS SDK for S3, optimized for DigitalOcean Spaces. It includes automatic image optimization, multiple variants, and quality reduction to minimize file sizes.

## Features

- **Multiple Image Variants**: Automatically generates small, medium, large, and original variants
- **Quality Optimization**: Reduces file sizes while maintaining visual quality
- **Format Conversion**: Converts images to WebP for better compression (except original)
- **S3 Integration**: Uses AWS SDK for S3 compatible with DigitalOcean Spaces
- **Error Handling**: Comprehensive error handling and validation
- **Batch Upload**: Support for uploading multiple images at once

## Configuration

Add the following environment variables to your `.env` file:

```env
# DigitalOcean Spaces Configuration
S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
S3_REGION=nyc3
S3_ACCESS_KEY_ID=your_access_key_id
S3_SECRET_ACCESS_KEY=your_secret_access_key
S3_BUCKET_NAME=homiio-images
```

## API Endpoints

### Upload Single Image
```
POST /api/images/upload
Content-Type: multipart/form-data

Body:
- image: File (required)
- folder: String (optional, default: 'general')
```

**Response:**
```json
{
  "success": true,
  "message": "Image uploaded successfully",
  "data": {
    "imageId": "uuid",
    "urls": {
      "small": "https://nyc3.digitaloceanspaces.com/bucket/small-url",
      "medium": "https://nyc3.digitaloceanspaces.com/bucket/medium-url",
      "large": "https://nyc3.digitaloceanspaces.com/bucket/large-url",
      "original": "https://nyc3.digitaloceanspaces.com/bucket/original-url"
    },
    "metadata": {
      "originalSize": 1024000,
      "originalFormat": "jpeg",
      "uploadedAt": "2024-01-01T00:00:00.000Z"
    },
    "keys": {
      "original": "general/uuid-original.jpeg",
      "variants": {
        "small": "general/uuid-small.webp",
        "medium": "general/uuid-medium.webp",
        "large": "general/uuid-large.webp"
      }
    }
  }
}
```

### Upload Multiple Images
```
POST /api/images/upload-multiple
Content-Type: multipart/form-data

Body:
- images: File[] (required, max 10 files)
- folder: String (optional, default: 'general')
```

**Response:**
```json
{
  "success": true,
  "message": "Successfully uploaded 3 images",
  "data": {
    "uploadedCount": 3,
    "images": [
      {
        "originalName": "image1.jpg",
        "imageId": "uuid1",
        "urls": { ... },
        "metadata": { ... },
        "keys": { ... }
      }
    ]
  }
}
```

### Delete Single Image
```
DELETE /api/images/:imageKey
```

### Delete Multiple Image Variants
```
DELETE /api/images/variants
Content-Type: application/json

Body:
{
  "imageKeys": ["key1", "key2", "key3"]
}
```

### Get Image Info
```
GET /api/images/info/:imageKey
```

## Image Variants

The service automatically generates the following variants:

| Variant | Dimensions | Quality | Format | Use Case |
|---------|------------|---------|--------|----------|
| small | 300x300 | 80% | WebP | Thumbnails, previews |
| medium | 600x600 | 85% | WebP | Gallery views |
| large | 1200x1200 | 90% | WebP | Detailed views |
| original | Original | 95% | JPEG | Full resolution |

## File Validation

- **Supported Formats**: JPEG, JPG, PNG, WebP, GIF
- **Maximum File Size**: 10MB per file
- **Maximum Files**: 10 files per batch upload

## Error Handling

The service includes comprehensive error handling for:

- Invalid file types
- File size limits
- Upload failures
- S3 connection issues
- Image processing errors

## Usage Examples

### Frontend Integration (JavaScript)

```javascript
// Single image upload
const formData = new FormData();
formData.append('image', file);
formData.append('folder', 'properties');

const response = await fetch('/api/images/upload', {
  method: 'POST',
  body: formData,
  headers: {
    'Authorization': `Bearer ${token}`
  }
});

const result = await response.json();
console.log(result.data.urls.small); // Small variant URL
```

### Frontend Integration (React)

```jsx
import { useState } from 'react';

const ImageUpload = () => {
  const [uploading, setUploading] = useState(false);
  const [uploadedImages, setUploadedImages] = useState([]);

  const handleUpload = async (files) => {
    setUploading(true);
    
    const formData = new FormData();
    Array.from(files).forEach(file => {
      formData.append('images', file);
    });
    formData.append('folder', 'properties');

    try {
      const response = await fetch('/api/images/upload-multiple', {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const result = await response.json();
      if (result.success) {
        setUploadedImages(result.data.images);
      }
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <input
        type="file"
        multiple
        accept="image/*"
        onChange={(e) => handleUpload(e.target.files)}
        disabled={uploading}
      />
      {uploading && <p>Uploading...</p>}
      {uploadedImages.map((image, index) => (
        <img key={index} src={image.urls.small} alt="Uploaded" />
      ))}
    </div>
  );
};
```

## Security Considerations

- All endpoints require authentication
- File type validation prevents malicious uploads
- File size limits prevent abuse
- Images are stored with public-read ACL for CDN access
- Cache headers are set for optimal performance

## Performance Optimization

- Images are processed in memory for faster uploads
- WebP format provides better compression
- Multiple variants allow responsive image loading
- Cache headers improve loading performance
- Parallel processing for multiple image uploads
