import React, { useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '@/styles/colors';
import { ThemedText } from '@/components/ThemedText';
import { imageUploadService, UploadedImage } from '@/services/imageUploadService';

interface ImageUploadProps {
  images: UploadedImage[];
  onImagesChange: (images: UploadedImage[]) => void;
  maxImages?: number;
  folder?: string;
  disabled?: boolean;
}

export function ImageUpload({
  images = [],
  onImagesChange,
  maxImages = 10,
  folder = 'properties',
  disabled = false,
}: ImageUploadProps) {
  const { t } = useTranslation();
  const [uploading, setUploading] = useState(false);

  const requestPermissions = async () => {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          t('imageUpload.permissionTitle'),
          t('imageUpload.permissionMessage'),
          [{ text: t('common.ok') }],
        );
        return false;
      }
    }
    return true;
  };

  const pickImages = async () => {
    if (disabled || uploading) return;

    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    if (images.length >= maxImages) {
      Alert.alert(
        t('imageUpload.maxImagesTitle'),
        t('imageUpload.maxImagesMessage', { max: maxImages }),
        [{ text: t('common.ok') }],
      );
      return;
    }

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
      Alert.alert(t('common.error'), t('imageUpload.selectFailed'));
    }
  };

  const takePhoto = async () => {
    if (disabled || uploading) return;

    const hasPermission = await requestPermissions();
    if (!hasPermission) return;

    if (images.length >= maxImages) {
      Alert.alert(
        t('imageUpload.maxImagesTitle'),
        t('imageUpload.maxImagesMessage', { max: maxImages }),
        [{ text: t('common.ok') }],
      );
      return;
    }

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
      Alert.alert(t('common.error'), t('imageUpload.photoFailed'));
    }
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
      Alert.alert(t('common.error'), t('imageUpload.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const deleteImage = async (imageId: string) => {
    Alert.alert(t('imageUpload.deleteTitle'), t('imageUpload.deleteMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            const imageToDelete = images.find((img) => img.imageId === imageId);
            if (!imageToDelete) return;

            await imageUploadService.deleteImage(imageToDelete.keys.original);

            const updatedImages = images.filter((img) => img.imageId !== imageId);
            if (imageToDelete.isPrimary && updatedImages.length > 0) {
              updatedImages[0].isPrimary = true;
            }

            onImagesChange(updatedImages);
          } catch (error) {
            console.error('Error deleting image:', error);
            Alert.alert(t('common.error'), t('imageUpload.deleteFailed'));
          }
        },
      },
    ]);
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
        <TouchableOpacity
          style={[styles.uploadButton, disabled && styles.uploadButtonDisabled]}
          onPress={pickImages}
          disabled={disabled || uploading}
        >
          <Ionicons name="images-outline" size={24} color={colors.primaryLight} />
          <ThemedText style={styles.uploadButtonText}>{t('imageUpload.choosePhotos')}</ThemedText>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.uploadButton, disabled && styles.uploadButtonDisabled]}
          onPress={takePhoto}
          disabled={disabled || uploading}
        >
          <Ionicons name="camera-outline" size={24} color={colors.primaryLight} />
          <ThemedText style={styles.uploadButtonText}>{t('imageUpload.takePhoto')}</ThemedText>
        </TouchableOpacity>
      </View>

      {uploading ? (
        <View style={styles.uploadProgressContainer}>
          <ActivityIndicator size="small" color={colors.primaryColor} />
          <ThemedText style={styles.uploadProgressText}>{t('imageUpload.uploading')}</ThemedText>
        </View>
      ) : null}

      <View style={styles.imageCountContainer}>
        <ThemedText style={styles.imageCountText}>
          {t('imageUpload.imageCount', { current: images.length, max: maxImages })}
        </ThemedText>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageScrollView}>
        <View style={styles.imageGrid}>
          {images.map((image) => (
            <View key={image.imageId} style={styles.imageContainer}>
              <Image source={{ uri: image.urls.small }} style={styles.image} />

              {image.isPrimary ? (
                <View style={styles.primaryBadge}>
                  <ThemedText style={styles.primaryBadgeText}>{t('imageUpload.primary')}</ThemedText>
                </View>
              ) : null}

              <View style={styles.imageActions}>
                {!image.isPrimary ? (
                  <TouchableOpacity
                    style={styles.actionButton}
                    onPress={() => setPrimaryImage(image.imageId)}
                  >
                    <Ionicons name="star-outline" size={16} color={colors.white} />
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={[styles.actionButton, styles.deleteButton]}
                  onPress={() => deleteImage(image.imageId)}
                >
                  <Ionicons name="trash-outline" size={16} color={colors.white} />
                </TouchableOpacity>
              </View>

              <View style={styles.imageInfo}>
                <ThemedText style={styles.imageInfoText}>
                  {imageUploadService.formatFileSize(image.metadata.originalSize)}
                </ThemedText>
              </View>
            </View>
          ))}

          {images.length < maxImages && !uploading ? (
            <TouchableOpacity
              style={[styles.imageContainer, styles.addMoreButton]}
              onPress={pickImages}
              disabled={disabled}
            >
              <Ionicons name="add" size={32} color={colors.COLOR_BLACK_LIGHT_4} />
              <ThemedText style={styles.addMoreText}>{t('imageUpload.addMore')}</ThemedText>
            </TouchableOpacity>
          ) : null}
        </View>
      </ScrollView>

      <ThemedText style={styles.helperText}>
        {t('imageUpload.helperText')}
        {images.length === 0 ? t('imageUpload.helperPrimaryNote') : ''}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 20,
  },
  uploadButtonsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  uploadButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: 8,
    gap: 8,
  },
  uploadButtonDisabled: {
    opacity: 0.5,
  },
  uploadButtonText: {
    fontSize: 14,
    color: colors.primaryDark,
    fontWeight: '500',
  },
  uploadProgressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
    borderRadius: 8,
    marginBottom: 16,
    gap: 8,
  },
  uploadProgressText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  imageCountContainer: {
    marginBottom: 12,
  },
  imageCountText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  imageScrollView: {
    marginBottom: 16,
  },
  imageGrid: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 4,
  },
  imageContainer: {
    position: 'relative',
    width: 120,
    height: 120,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  primaryBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: colors.primaryColor,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  primaryBadgeText: {
    fontSize: 10,
    color: colors.primaryForeground,
    fontWeight: 'bold',
  },
  imageActions: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    gap: 4,
  },
  actionButton: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    backgroundColor: 'rgba(255, 59, 48, 0.8)',
  },
  imageInfo: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    right: 8,
  },
  imageInfoText: {
    fontSize: 10,
    color: colors.white,
    textAlign: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 2,
  },
  addMoreButton: {
    borderWidth: 2,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addMoreText: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    marginTop: 4,
  },
  helperText: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    lineHeight: 16,
  },
});
