import { Request, Response } from 'express';
import imageUploadService, { UploadedImage } from '../services/imageUploadService';

// Minimal shape for an uploaded file to avoid relying on Express.Multer types
type UploadedFile = {
  fieldname?: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
};

export class ImageController {
  async uploadImage(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({
          success: false,
          message: 'No image file provided',
        });
        return;
      }

      // Validate file type
      const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
      if (!allowedMimeTypes.includes(req.file.mimetype)) {
        res.status(400).json({
          success: false,
          message: 'Invalid file type. Only JPEG, PNG, WebP, and GIF are allowed.',
        });
        return;
      }

      // Validate file size (10MB limit)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (req.file.size > maxSize) {
        res.status(400).json({
          success: false,
          message: 'File size too large. Maximum size is 10MB.',
        });
        return;
      }

      const folder = req.body.folder || 'general';
      const uploadedImage: UploadedImage = await imageUploadService.uploadImage(req.file, folder);
      
      // Get all image URLs
      const imageUrls = imageUploadService.getAllImageUrls(uploadedImage);

      res.status(200).json({
        success: true,
        message: 'Image uploaded successfully',
        data: {
          imageId: uploadedImage.original.split('/').pop()?.split('-')[0],
          urls: imageUrls,
          metadata: uploadedImage.metadata,
          keys: {
            original: uploadedImage.original,
            variants: uploadedImage.variants,
          },
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to upload image',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  async uploadMultipleImages(req: Request, res: Response): Promise<void> {
    try {
      if (!req.files || (Array.isArray(req.files) && req.files.length === 0)) {
        res.status(400).json({
          success: false,
          message: 'No image files provided',
        });
        return;
      }

      // Normalize req.files which can be an array or a field map depending on multer usage
      const files: UploadedFile[] = Array.isArray(req.files)
        ? (req.files as unknown as UploadedFile[])
        : Object.values(req.files as Record<string, UploadedFile[]>)
            .flat()
            .filter(Boolean) as UploadedFile[];
      const folder = req.body.folder || 'general';
      const uploadedImages: any[] = [];

      // Validate each file
      for (const file of files) {
        const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'];
        if (!allowedMimeTypes.includes(file.mimetype)) {
          res.status(400).json({
            success: false,
            message: `Invalid file type for ${file.originalname}. Only JPEG, PNG, WebP, and GIF are allowed.`,
          });
          return;
        }

        const maxSize = 10 * 1024 * 1024; // 10MB
        if (file.size > maxSize) {
          res.status(400).json({
            success: false,
            message: `File size too large for ${file.originalname}. Maximum size is 10MB.`,
          });
          return;
        }
      }

      // Upload each image
      for (const file of files) {
        try {
          const uploadedImage = await imageUploadService.uploadImage(file, folder);
          const imageUrls = imageUploadService.getAllImageUrls(uploadedImage);
          
          uploadedImages.push({
            originalName: file.originalname,
            imageId: uploadedImage.original.split('/').pop()?.split('-')[0],
            urls: imageUrls,
            metadata: uploadedImage.metadata,
            keys: {
              original: uploadedImage.original,
              variants: uploadedImage.variants,
            },
          });
        } catch (error) {
          // Continue with other files even if one fails
        }
      }

      res.status(200).json({
        success: true,
        message: `Successfully uploaded ${uploadedImages.length} images`,
        data: {
          uploadedCount: uploadedImages.length,
          images: uploadedImages,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to upload images',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  async deleteImage(req: Request, res: Response): Promise<void> {
    try {
      const { imageKey } = req.params;

      if (!imageKey) {
        res.status(400).json({
          success: false,
          message: 'Image key is required',
        });
        return;
      }

      await imageUploadService.deleteImage(imageKey);

      res.status(200).json({
        success: true,
        message: 'Image deleted successfully',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to delete image',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  async deleteImageVariants(req: Request, res: Response): Promise<void> {
    try {
      const { imageKeys } = req.body;

      if (!imageKeys || !Array.isArray(imageKeys) || imageKeys.length === 0) {
        res.status(400).json({
          success: false,
          message: 'Image keys array is required',
        });
        return;
      }

      await imageUploadService.deleteImageVariants(imageKeys);

      res.status(200).json({
        success: true,
        message: 'Image variants deleted successfully',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to delete image variants',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  async getImageInfo(req: Request, res: Response): Promise<void> {
    try {
      const { imageKey } = req.params;

      if (!imageKey) {
        res.status(400).json({
          success: false,
          message: 'Image key is required',
        });
        return;
      }

      const imageUrl = imageUploadService.getImageUrl(imageKey);

      res.status(200).json({
        success: true,
        data: {
          key: imageKey,
          url: imageUrl,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Failed to get image info',
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

export default new ImageController();
