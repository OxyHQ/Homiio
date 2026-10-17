import { api } from '@/utils/api';

export interface UploadedImage {
  /**
   * The photo's identity WITHIN THE PICKER — the grid's React key and what a
   * reorder or a remove looks it up by. It comes from the upload response,
   * where it is the Oxy file id, so it is unique per photo but is NOT an
   * `images` row id and must never be published as one.
   */
  imageId: string;
  /**
   * The Oxy file the upload stored the photo as, in the uploader's own Oxy
   * account (ADR 0043). Publishing sends it; the server checks it is yours.
   */
  fileId?: string;
  /**
   * The canonical `images` row this photo is, when it has one: set only for
   * photos the edit screen loaded back from the server. A freshly uploaded
   * photo has no row yet (see `utils/propertyPhotos`) and publishes its
   * {@link keys} instead.
   */
  storedImageId?: string;
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
    /** Source pixel dimensions, when the upload pipeline could read them. */
    width?: number;
    height?: number;
  };
  isPrimary?: boolean;
  caption?: string;
}

interface MultipleUploadResponse {
  success: boolean;
  message: string;
  data: {
    uploadedCount: number;
    images: {
      originalName: string;
      imageId: string;
      fileId?: string;
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
  async uploadSingleImage(imageUri: string, folder: string = 'properties'): Promise<UploadedImage> {
    const formData = new FormData();
    formData.append('image', {
      uri: imageUri,
      type: 'image/jpeg',
      name: 'image.jpg',
    });
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
      });
    });
    formData.append('folder', folder);

    const response = await api.post('/api/images/upload-multiple', formData);

    if (!response.data.success) {
      throw new Error(response.data.message || 'Upload failed');
    }

    return response.data;
  }

  /*
   * There is no delete: an uploaded photo is a file in the uploader's own Oxy
   * account. Removing it from the picker removes it from the listing; the file
   * stays theirs, shown as "not in use" in their Oxy file manager.
   */

  // Helper method to get the best image URL for a given size
  getImageUrl(
    image: UploadedImage,
    size: 'small' | 'medium' | 'large' | 'original' = 'medium',
  ): string {
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
    return parseFloat((bytes / k ** i).toFixed(2)) + ' ' + sizes[i];
  }
}

export const imageUploadService = new ImageUploadService();
