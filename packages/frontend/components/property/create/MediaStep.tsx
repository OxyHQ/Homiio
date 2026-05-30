import React from 'react';
import { View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { ImageUpload } from '@/components/ImageUpload';
import { MAX_PROPERTY_IMAGES, PROPERTY_IMAGE_FOLDER } from './constants';
import type { PropertyStepProps } from './types';

interface MediaStepProps extends Pick<PropertyStepProps, 'formData' | 'updateFormField'> {
  isLoading: boolean;
}

/**
 * "Media" wizard step: property image upload.
 */
export function MediaStep({ formData, updateFormField, isLoading }: MediaStepProps) {
  return (
    <View>
      <ThemedText type="subtitle">Media</ThemedText>

      <ImageUpload
        images={formData.media.images}
        onImagesChange={(images) => updateFormField('media', 'images', images)}
        maxImages={MAX_PROPERTY_IMAGES}
        folder={PROPERTY_IMAGE_FOLDER}
        disabled={isLoading}
      />
    </View>
  );
}
