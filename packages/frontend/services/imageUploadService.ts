import { api } from '@/utils/api';

export interface UploadedImage {
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
}

export interface UploadResponse {
  success: boolean;
  message: string;
  data: {
    imageId: string;
    urls: Record<string, string>;
    metadata: {
      originalSize: number;
      originalFormat: string;
      uploadedAt: Date;
    };
    keys: {
      original: string;
      variants: Record<string, string>;
    };
  };
}

export interface MultipleUploadResponse {
  success: boolean;
  message: string;
  data: {
    uploadedCount: number;
    images: {
      originalName: string;
      imageId: string;
      urls: Record<string, string>;
      metadata: {
        originalSize: number;
        originalFormat: string;
        uploadedAt: Date;
      };
      keys: {
        original: string;
        variants: Record<string, string>;
      };
    }[];
  };
}

class ImageUploadService {
  async uploadSingleImage(
    imageUri: string,
    folder: string = 'properties',
  ): Promise<UploadedImage> {
    const formData = new FormData();
    formData.append('image', {
      uri: imageUri,
      type: 'image/jpeg',
      name: 'image.jpg',
    } as any);
    formData.append('folder', folder);

    const response = await api.post('/api/images/upload', formData);
    
    if (!response.data.success) {
      throw new Error(response.data.message || 'Upload failed');
    }

    return response.data.data;
  }

  async uploadMultipleImages(
    imageUris: string[],
    folder: string = 'properties',
  ): Promise<MultipleUploadResponse> {
    const formData = new FormData();
    
    imageUris.forEach((uri, index) => {
      formData.append('images', {
        uri,
        type: 'image/jpeg',
        name: `image${index}.jpg`,
      } as any);
    });
    formData.append('folder', folder);

    const response = await api.post('/api/images/upload-multiple', formData);
    
    if (!response.data.success) {
      throw new Error(response.data.message || 'Upload failed');
    }

    return response.data;
  }

  async deleteImage(imageKey: string): Promise<{ success: boolean; message: string }> {
    const response = await api.delete(`/api/images/${imageKey}`);
    
    if (!response.data.success) {
      throw new Error(response.data.message || 'Delete failed');
    }

    return response.data;
  }

  async deleteMultipleImages(imageKeys: string[]): Promise<{ success: boolean; message: string; results: any[] }> {
    const response = await api.post('/api/images/variants', {
      method: 'DELETE',
      keys: imageKeys,
    });
    
    if (!response.data.success) {
      throw new Error(response.data.message || 'Delete failed');
    }

    return response.data;
  }

  async getImageInfo(imageKey: string): Promise<UploadedImage> {
    const response = await api.get(`/api/images/info/${imageKey}`);
    
    if (!response.data.success) {
      throw new Error(response.data.message || 'Failed to get image info');
    }

    return response.data.data;
  }

  // Helper method to get the best image URL for a given size
  getImageUrl(image: UploadedImage, size: 'small' | 'medium' | 'large' | 'original' = 'medium'): string {
    return image.urls[size] || image.urls.original;
  }

  // Helper method to get all image URLs
  getAllImageUrls(image: UploadedImage): Record<string, string> {
    return image.urls;
  }

  // Helper method to format file size
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}

export const imageUploadService = new ImageUploadService();
export default imageUploadService;
