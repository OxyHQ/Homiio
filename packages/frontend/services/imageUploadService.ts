import { OxyServices } from '@oxyhq/services';

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
    images: Array<{
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
    }>;
  };
}

class ImageUploadService {
  private baseURL: string;

  constructor() {
    this.baseURL = (process.env.NODE_ENV === 'production' ? 'https://api.homiio.com' : 'http://192.168.86.44:4000');
  }

  private async makeRequest(
    endpoint: string,
    options: RequestInit = {},
    oxyServices?: OxyServices,
    activeSessionId?: string
  ): Promise<Response> {
    const headers: Record<string, string> = {
      ...((options.headers as Record<string, string>) || {}),
    };

    // Handle authentication if OxyServices is provided
    if (oxyServices && activeSessionId) {
      try {
        const tokenData = await oxyServices.getTokenBySession(activeSessionId);
        if (tokenData) {
          headers['Authorization'] = `Bearer ${tokenData.accessToken}`;
        }
      } catch (error) {
        console.error('Failed to get authentication token:', error);
        throw new Error('Authentication failed');
      }
    }

    // Don't set Content-Type for FormData - let the browser set it automatically
    const requestOptions: RequestInit = {
      ...options,
      headers: options.body instanceof FormData ? headers : {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    // Debug logging
    if (options.body instanceof FormData) {
      console.log('Sending FormData request to:', `${this.baseURL}${endpoint}`);
      console.log('Headers:', headers);
    }

    return fetch(`${this.baseURL}${endpoint}`, requestOptions);
  }

  async uploadSingleImage(
    imageUri: string,
    folder: string = 'properties',
    oxyServices?: OxyServices,
    activeSessionId?: string
  ): Promise<UploadedImage> {
    const formData = new FormData();
    formData.append('image', {
      uri: imageUri,
      type: 'image/jpeg',
      name: `image-${Date.now()}.jpg`,
    } as any);
    formData.append('folder', folder);

    const response = await this.makeRequest('/api/images/upload', {
      method: 'POST',
      body: formData,
    }, oxyServices, activeSessionId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Upload failed: ${response.statusText}`);
    }

    const result: UploadResponse = await response.json();
    
    if (!result.success) {
      throw new Error(result.message || 'Upload failed');
    }

    return {
      imageId: result.data.imageId,
      urls: result.data.urls as { small: string; medium: string; large: string; original: string },
      keys: result.data.keys,
      metadata: result.data.metadata,
    };
  }

  async uploadMultipleImages(
    imageUris: string[],
    folder: string = 'properties',
    oxyServices?: OxyServices,
    activeSessionId?: string
  ): Promise<UploadedImage[]> {
    const formData = new FormData();
    
    console.log('Uploading images:', imageUris.length, 'files');
    
    // Process each image URI
    for (let index = 0; index < imageUris.length; index++) {
      const uri = imageUris[index];
      
      try {
        // Fetch the image data
        const response = await fetch(uri);
        const blob = await response.blob();
        
        // Create a proper file object
        const file = new File([blob], `image-${Date.now()}-${index}.jpg`, {
          type: 'image/jpeg',
        });
        
        console.log(`Adding file ${index}:`, file.name, file.size, file.type);
        formData.append('images', file);
      } catch (error) {
        console.error(`Error processing image ${index}:`, error);
        throw new Error(`Failed to process image ${index}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    formData.append('folder', folder);
    
    console.log('FormData created with', imageUris.length, 'images and folder:', folder);

    const response = await this.makeRequest('/api/images/upload-multiple', {
      method: 'POST',
      body: formData,
    }, oxyServices, activeSessionId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Upload failed: ${response.statusText}`);
    }

    const result: MultipleUploadResponse = await response.json();
    
    if (!result.success) {
      throw new Error(result.message || 'Upload failed');
    }

    return result.data.images.map(image => ({
      imageId: image.imageId,
      urls: image.urls as { small: string; medium: string; large: string; original: string },
      keys: image.keys,
      metadata: image.metadata,
    }));
  }

  async deleteImage(
    imageKey: string,
    oxyServices?: OxyServices,
    activeSessionId?: string
  ): Promise<void> {
    const response = await this.makeRequest(`/api/images/${imageKey}`, {
      method: 'DELETE',
    }, oxyServices, activeSessionId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Delete failed: ${response.statusText}`);
    }
  }

  async deleteMultipleImages(
    imageKeys: string[],
    oxyServices?: OxyServices,
    activeSessionId?: string
  ): Promise<void> {
    const response = await this.makeRequest('/api/images/variants', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ imageKeys }),
    }, oxyServices, activeSessionId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Delete failed: ${response.statusText}`);
    }
  }

  async getImageInfo(
    imageKey: string,
    oxyServices?: OxyServices,
    activeSessionId?: string
  ): Promise<{ key: string; url: string }> {
    const response = await this.makeRequest(`/api/images/info/${imageKey}`, {}, oxyServices, activeSessionId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to get image info: ${response.statusText}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.message || 'Failed to get image info');
    }

    return result.data;
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
