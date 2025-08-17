# Property Image Integration

This document shows how to integrate the image upload service with property creation and management.

## Property Image Schema

Add the following fields to your Property model to store image information:

```typescript
// In your Property model
interface PropertyImage {
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
  isPrimary?: boolean; // For main property image
  caption?: string;
}

interface Property {
  // ... existing fields
  images: PropertyImage[];
  primaryImageId?: string; // Reference to the primary image
}
```

## Enhanced Property Controller

Here's how to enhance your property controller to handle image uploads:

```typescript
import imageUploadService from '../services/imageUploadService';

class PropertyController {
  // ... existing methods

  async createPropertyWithImages(req: Request, res: Response, next: NextFunction) {
    try {
      // Handle property creation (existing logic)
      const property = await this.createProperty(req, res, next);
      
      // Handle image uploads if provided
      if (req.files && req.files.length > 0) {
        const uploadedImages = [];
        
        for (const file of req.files as Express.Multer.File[]) {
          try {
            const uploadedImage = await imageUploadService.uploadImage(file, 'properties');
            const imageUrls = imageUploadService.getAllImageUrls(uploadedImage);
            
            uploadedImages.push({
              imageId: uploadedImage.original.split('/').pop()?.split('-')[0],
              urls: imageUrls,
              keys: {
                original: uploadedImage.original,
                variants: uploadedImage.variants,
              },
              metadata: uploadedImage.metadata,
              isPrimary: uploadedImages.length === 0, // First image is primary
            });
          } catch (error) {
            console.error(`Failed to upload image ${file.originalname}:`, error);
          }
        }
        
        // Update property with image information
        if (uploadedImages.length > 0) {
          property.images = uploadedImages;
          property.primaryImageId = uploadedImages[0].imageId;
          await property.save();
        }
      }
      
      return property;
    } catch (error) {
      next(error);
    }
  }

  async updatePropertyImages(req: Request, res: Response, next: NextFunction) {
    try {
      const { propertyId } = req.params;
      const property = await Property.findById(propertyId);
      
      if (!property) {
        return res.status(404).json({
          success: false,
          message: 'Property not found',
        });
      }

      // Handle new image uploads
      if (req.files && req.files.length > 0) {
        const newImages = [];
        
        for (const file of req.files as Express.Multer.File[]) {
          try {
            const uploadedImage = await imageUploadService.uploadImage(file, 'properties');
            const imageUrls = imageUploadService.getAllImageUrls(uploadedImage);
            
            newImages.push({
              imageId: uploadedImage.original.split('/').pop()?.split('-')[0],
              urls: imageUrls,
              keys: {
                original: uploadedImage.original,
                variants: uploadedImage.variants,
              },
              metadata: uploadedImage.metadata,
            });
          } catch (error) {
            console.error(`Failed to upload image ${file.originalname}:`, error);
          }
        }
        
        // Add new images to existing ones
        property.images = [...(property.images || []), ...newImages];
        await property.save();
      }

      // Handle image deletion
      if (req.body.deleteImageIds && Array.isArray(req.body.deleteImageIds)) {
        const imagesToDelete = property.images.filter(img => 
          req.body.deleteImageIds.includes(img.imageId)
        );
        
        // Delete from S3
        for (const image of imagesToDelete) {
          try {
            const allKeys = [image.keys.original, ...Object.values(image.keys.variants)];
            await imageUploadService.deleteImageVariants(allKeys);
          } catch (error) {
            console.error(`Failed to delete image ${image.imageId}:`, error);
          }
        }
        
        // Remove from property
        property.images = property.images.filter(img => 
          !req.body.deleteImageIds.includes(img.imageId)
        );
        
        // Update primary image if needed
        if (req.body.deleteImageIds.includes(property.primaryImageId)) {
          property.primaryImageId = property.images[0]?.imageId;
        }
        
        await property.save();
      }

      // Handle primary image change
      if (req.body.primaryImageId) {
        property.primaryImageId = req.body.primaryImageId;
        await property.save();
      }

      res.json({
        success: true,
        message: 'Property images updated successfully',
        data: {
          images: property.images,
          primaryImageId: property.primaryImageId,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteProperty(req: Request, res: Response, next: NextFunction) {
    try {
      const { propertyId } = req.params;
      const property = await Property.findById(propertyId);
      
      if (!property) {
        return res.status(404).json({
          success: false,
          message: 'Property not found',
        });
      }

      // Delete all associated images from S3
      if (property.images && property.images.length > 0) {
        for (const image of property.images) {
          try {
            const allKeys = [image.keys.original, ...Object.values(image.keys.variants)];
            await imageUploadService.deleteImageVariants(allKeys);
          } catch (error) {
            console.error(`Failed to delete image ${image.imageId}:`, error);
          }
        }
      }

      // Delete property
      await Property.findByIdAndDelete(propertyId);

      res.json({
        success: true,
        message: 'Property and associated images deleted successfully',
      });
    } catch (error) {
      next(error);
    }
  }
}
```

## Property Routes with Image Upload

```typescript
import multer from 'multer';
import { Router } from 'express';
import propertyController from '../controllers/propertyController';
import handleUploadError from '../middlewares/uploadMiddleware';

const router = Router();

// Configure multer for property images
const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, and WebP are allowed.'));
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 10, // Max 10 images per property
  },
});

// Create property with images
router.post('/', upload.array('images', 10), handleUploadError, propertyController.createPropertyWithImages);

// Update property images
router.put('/:propertyId/images', upload.array('images', 10), handleUploadError, propertyController.updatePropertyImages);

// Delete property (includes image cleanup)
router.delete('/:propertyId', propertyController.deleteProperty);

export default router;
```

## Frontend Integration Example

```jsx
import React, { useState } from 'react';

const PropertyImageUpload = ({ propertyId, onImagesUpdated }) => {
  const [uploading, setUploading] = useState(false);
  const [images, setImages] = useState([]);

  const handleImageUpload = async (files) => {
    setUploading(true);
    
    const formData = new FormData();
    Array.from(files).forEach(file => {
      formData.append('images', file);
    });

    try {
      const response = await fetch(`/api/properties/${propertyId}/images`, {
        method: 'PUT',
        body: formData,
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const result = await response.json();
      if (result.success) {
        setImages(result.data.images);
        onImagesUpdated(result.data.images);
      }
    } catch (error) {
      console.error('Upload failed:', error);
    } finally {
      setUploading(false);
    }
  };

  const handleImageDelete = async (imageId) => {
    try {
      const response = await fetch(`/api/properties/${propertyId}/images`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          deleteImageIds: [imageId]
        })
      });

      const result = await response.json();
      if (result.success) {
        setImages(result.data.images);
        onImagesUpdated(result.data.images);
      }
    } catch (error) {
      console.error('Delete failed:', error);
    }
  };

  return (
    <div>
      <input
        type="file"
        multiple
        accept="image/*"
        onChange={(e) => handleImageUpload(e.target.files)}
        disabled={uploading}
      />
      
      {uploading && <p>Uploading images...</p>}
      
      <div className="image-gallery">
        {images.map((image, index) => (
          <div key={image.imageId} className="image-item">
            <img src={image.urls.small} alt={`Property ${index + 1}`} />
            <button onClick={() => handleImageDelete(image.imageId)}>
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
```

## Best Practices

1. **Image Organization**: Use folder structure like `properties/{propertyId}/` for better organization
2. **Cleanup**: Always delete images when properties are deleted
3. **Validation**: Validate image types and sizes on both frontend and backend
4. **Error Handling**: Handle upload failures gracefully
5. **Caching**: Use CDN for better image delivery performance
6. **Responsive Images**: Use different variants for different screen sizes
7. **Lazy Loading**: Implement lazy loading for better performance
