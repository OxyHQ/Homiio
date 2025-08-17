import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { v4 as uuidv4 } from 'uuid';
import config from '../config';

export interface ImageVariant {
  name: string;
  width: number;
  height: number;
  quality: number;
  format: 'jpeg' | 'webp';
}

export interface UploadedImage {
  original: string;
  variants: Record<string, string>;
  metadata: {
    originalSize: number;
    originalFormat: string;
    uploadedAt: Date;
  };
}

export class ImageUploadService {
  private s3Client: S3Client;
  private readonly variants: ImageVariant[] = [
    { name: 'small', width: 300, height: 300, quality: 80, format: 'webp' },
    { name: 'medium', width: 600, height: 600, quality: 85, format: 'webp' },
    { name: 'large', width: 1200, height: 1200, quality: 90, format: 'webp' },
    { name: 'original', width: 0, height: 0, quality: 95, format: 'jpeg' }
  ];

  constructor() {
    console.log('S3 Configuration:', {
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      accessKeyId: config.s3.accessKeyId ? '***SET***' : '***NOT SET***',
      secretAccessKey: config.s3.secretAccessKey ? '***SET***' : '***NOT SET***',
      bucketName: config.s3.bucketName
    });
    
    this.s3Client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
      },
      forcePathStyle: true, // Use path-style URLs for DigitalOcean Spaces
    });
  }

  async uploadImage(file: any, folder: string = 'general'): Promise<UploadedImage> {
    try {
      const imageId = uuidv4();
      const originalFormat = this.getImageFormat(file.mimetype);
      const uploadedVariants: Record<string, string> = {};
      let originalSize = 0;

      // Process and upload each variant
      for (const variant of this.variants) {
        const processedBuffer = await this.processImage(file.buffer, variant);
        const fileName = this.generateFileName(imageId, variant.name, variant.format);
        const key = `${folder}/${fileName}`;
        
        await this.uploadToS3(processedBuffer, key, file.mimetype);
        uploadedVariants[variant.name] = key;
        
        if (variant.name === 'original') {
          originalSize = processedBuffer.length;
        }
      }

      return {
        original: uploadedVariants.original,
        variants: uploadedVariants,
        metadata: {
          originalSize,
          originalFormat,
          uploadedAt: new Date(),
        },
      };
    } catch (error) {
      console.error('Error uploading image:', error);
      throw new Error('Failed to upload image');
    }
  }

  async deleteImage(imageKey: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: config.s3.bucketName,
        Key: imageKey,
      });
      
      await this.s3Client.send(command);
    } catch (error) {
      console.error('Error deleting image:', error);
      throw new Error('Failed to delete image');
    }
  }

  async deleteImageVariants(imageKeys: string[]): Promise<void> {
    try {
      const deletePromises = imageKeys.map(key => this.deleteImage(key));
      await Promise.all(deletePromises);
    } catch (error) {
      console.error('Error deleting image variants:', error);
      throw new Error('Failed to delete image variants');
    }
  }

  private async processImage(buffer: Buffer, variant: ImageVariant): Promise<Buffer> {
    let sharpInstance = sharp(buffer);

    // Resize if dimensions are specified
    if (variant.width > 0 && variant.height > 0) {
      sharpInstance = sharpInstance.resize(variant.width, variant.height, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    // Apply format and quality
    if (variant.format === 'webp') {
      return await sharpInstance
        .webp({ quality: variant.quality })
        .toBuffer();
    } else {
      return await sharpInstance
        .jpeg({ quality: variant.quality })
        .toBuffer();
    }
  }

  private async uploadToS3(buffer: Buffer, key: string, contentType: string): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: config.s3.bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ACL: 'public-read',
      CacheControl: 'public, max-age=31536000', // 1 year cache
    });

    await this.s3Client.send(command);
  }

  private generateFileName(imageId: string, variant: string, format: string): string {
    return `${imageId}-${variant}.${format}`;
  }

  private getImageFormat(mimeType: string): string {
    const formatMap: Record<string, string> = {
      'image/jpeg': 'jpeg',
      'image/jpg': 'jpeg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
    };
    
    return formatMap[mimeType] || 'jpeg';
  }

  getImageUrl(key: string): string {
    return `${config.s3.endpoint}/${config.s3.bucketName}/${key}`;
  }

  getAllImageUrls(uploadedImage: UploadedImage): Record<string, string> {
    const urls: Record<string, string> = {};
    
    urls.original = this.getImageUrl(uploadedImage.original);
    
    for (const [variant, key] of Object.entries(uploadedImage.variants)) {
      urls[variant] = this.getImageUrl(key);
    }
    
    return urls;
  }
}

export default new ImageUploadService();
