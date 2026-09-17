import React from 'react';
import { View } from 'react-native';
import { ImageUpload } from '@/components/ImageUpload';
import { MAX_PROPERTY_IMAGES, PROPERTY_IMAGE_FOLDER } from './constants';
import { createPropertyStyles as styles } from './styles';
import type { PropertyStepProps } from './types';

interface MediaStepProps extends Pick<PropertyStepProps, 'formData' | 'updateFormField'> {
  isLoading: boolean;
}

/**
 * "Media" wizard step: property image upload.
 */
export function MediaStep({ formData, updateFormField, isLoading }: MediaStepProps) {
  return (
    <View style={styles.step}>
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
