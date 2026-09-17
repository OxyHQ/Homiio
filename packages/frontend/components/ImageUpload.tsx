import React, { useState } from 'react';
import { View, StyleSheet, Image, ScrollView, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import {
  RiAddLine,
  RiCameraLine,
  RiDeleteBinLine,
  RiImageAddLine,
  RiStarLine,
} from '@oxy.so/bloom/icons';
import { Loading } from '@oxy.so/bloom/loading';
import { confirm } from '@oxy.so/bloom/surfaces';
import { toast } from '@oxy.so/bloom/toast';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import { imageUploadService, UploadedImage } from '@/services/imageUploadService';

interface ImageUploadProps {
  images: UploadedImage[];
  onImagesChange: (images: UploadedImage[]) => void;
  maxImages?: number;
  folder?: string;
  disabled?: boolean;
}

const TILE_SIZE = 120;

/**
 * Multi-image picker + uploader (property media step, review photos).
 *
 * Bloom `FileUpload` is a single-file drop zone, so the gallery grid stays
 * local; its controls are Bloom (`Button`, `Chip`, `Loading`), decisions go
 * through `confirm()` and failures through `toast` — RN `Alert` with buttons is
 * a no-op on web.
 */
export function ImageUpload({
  images = [],
  onImagesChange,
  maxImages = 10,
  folder = 'properties',
  disabled = false,
}: ImageUploadProps) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);
  const atLimit = images.length >= maxImages;

  const requestPermissions = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        toast.error(t('imageUpload.permissionTitle'), {
          description: t('imageUpload.permissionMessage'),
        });
        return false;
      }
    }
    return true;
  };

  const guardLimit = () => {
    if (!atLimit) return true;
    toast.warning(t('imageUpload.maxImagesTitle'), {
      description: t('imageUpload.maxImagesMessage', { max: maxImages }),
    });
    return false;
  };

  const uploadImages = async (selectedImages: ImagePicker.ImagePickerAsset[]) => {
    setUploading(true);

    try {
      const response = await imageUploadService.uploadMultipleImages(
        selectedImages.map((img) => img.uri),
        folder,
      );

      const processedImages: UploadedImage[] = response.data.images.map((image, index) => ({
        imageId: image.imageId,
        urls: {
          small: image.urls.small ?? image.urls.original ?? '',
          medium: image.urls.medium ?? image.urls.original ?? '',
          large: image.urls.large ?? image.urls.original ?? '',
          original: image.urls.original ?? '',
        },
        keys: image.keys,
        metadata: image.metadata,
        isPrimary: images.length === 0 && index === 0,
      }));

      onImagesChange([...images, ...processedImages]);
    } catch (error) {
      console.error('Error uploading images:', error);
      toast.error(t('imageUpload.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const pickImages = async () => {
    if (disabled || uploading) return;

    const hasPermission = await requestPermissions();
    if (!hasPermission || !guardLimit()) return;

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.8,
        aspect: [4, 3],
        allowsEditing: false,
      });

      if (!result.canceled && result.assets) {
        const selectedImages = result.assets.slice(0, maxImages - images.length);
        await uploadImages(selectedImages);
      }
    } catch (error) {
      console.error('Error picking images:', error);
      toast.error(t('imageUpload.selectFailed'));
    }
  };

  const takePhoto = async () => {
    if (disabled || uploading) return;

    const hasPermission = await requestPermissions();
    if (!hasPermission || !guardLimit()) return;

    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        aspect: [4, 3],
        allowsEditing: false,
      });

      if (!result.canceled && result.assets) {
        await uploadImages(result.assets);
      }
    } catch (error) {
      console.error('Error taking photo:', error);
      toast.error(t('imageUpload.photoFailed'));
    }
  };

  const deleteImage = async (imageId: string) => {
    const ok = await confirm({
      title: t('imageUpload.deleteTitle'),
      description: t('imageUpload.deleteMessage'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;

    try {
      const imageToDelete = images.find((img) => img.imageId === imageId);
      if (!imageToDelete) return;

      await imageUploadService.deleteImage(imageToDelete.keys.original);

      const updatedImages = images.filter((img) => img.imageId !== imageId);
      if (imageToDelete.isPrimary && updatedImages.length > 0) {
        updatedImages[0] = { ...updatedImages[0], isPrimary: true };
      }

      onImagesChange(updatedImages);
    } catch (error) {
      console.error('Error deleting image:', error);
      toast.error(t('imageUpload.deleteFailed'));
    }
  };

  const setPrimaryImage = (imageId: string) => {
    onImagesChange(
      images.map((img) => ({
        ...img,
        isPrimary: img.imageId === imageId,
      })),
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.uploadButtonsContainer}>
        <Button
          variant="secondary"
          leadingIcon={RiImageAddLine}
          onPress={pickImages}
          disabled={disabled || uploading}
          style={styles.uploadButton}
        >
          {t('imageUpload.choosePhotos')}
        </Button>
        <Button
          variant="secondary"
          leadingIcon={RiCameraLine}
          onPress={takePhoto}
          disabled={disabled || uploading}
          style={styles.uploadButton}
        >
          {t('imageUpload.takePhoto')}
        </Button>
      </View>

      {uploading ? (
        <Loading variant="inline" size="small" text={t('imageUpload.uploading')} />
      ) : null}

      <BloomText style={styles.mutedText}>
        {t('imageUpload.imageCount', { current: images.length, max: maxImages })}
      </BloomText>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.imageGrid}>
          {images.map((image) => (
            <View key={image.imageId} style={styles.imageContainer}>
              <Image source={{ uri: image.urls.small }} style={styles.image} />

              {image.isPrimary ? (
                <View style={styles.primaryBadge}>
                  <Chip size="small" variant="solid" color="primary">
                    {t('imageUpload.primary')}
                  </Chip>
                </View>
              ) : null}

              <View style={styles.imageActions}>
                {!image.isPrimary ? (
                  <Button
                    variant="inverse"
                    size="xs"
                    iconOnly
                    leadingIcon={RiStarLine}
                    onPress={() => setPrimaryImage(image.imageId)}
                    accessibilityLabel={t('imageUpload.setPrimary', 'Set as primary image')}
                  />
                ) : null}
                <Button
                  variant="destructive"
                  size="xs"
                  iconOnly
                  leadingIcon={RiDeleteBinLine}
                  onPress={() => void deleteImage(image.imageId)}
                  accessibilityLabel={t('common.delete')}
                />
              </View>

              <View style={styles.imageInfo}>
                <BloomText style={styles.imageInfoText}>
                  {imageUploadService.formatFileSize(image.metadata.originalSize)}
                </BloomText>
              </View>
            </View>
          ))}

          {!atLimit && !uploading ? (
            <Button
              variant="secondary"
              leadingIcon={RiAddLine}
              onPress={pickImages}
              disabled={disabled}
              style={styles.addMoreButton}
            >
              {t('imageUpload.addMore')}
            </Button>
          ) : null}
        </View>
      </ScrollView>

      <BloomText style={styles.helperText}>
        {t('imageUpload.helperText')}
        {images.length === 0 ? t('imageUpload.helperPrimaryNote') : ''}
      </BloomText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  uploadButtonsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  uploadButton: {
    flexGrow: 1,
  },
  mutedText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  imageGrid: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  imageContainer: {
    position: 'relative',
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  primaryBadge: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
  },
  imageActions: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    gap: spacing.xs,
  },
  imageInfo: {
    position: 'absolute',
    bottom: spacing.sm,
    left: spacing.sm,
    right: spacing.sm,
  },
  imageInfoText: {
    fontSize: 10,
    color: colors.white,
    textAlign: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 4,
  },
  addMoreButton: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: radius.md,
  },
  helperText: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    lineHeight: 16,
  },
});
