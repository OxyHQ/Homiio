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
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '@/styles/colors';
import { ThemedText } from '@/components/ThemedText';
import { imageUploadService, UploadedImage } from '@/services/imageUploadService';
import { useOxy } from '@oxyhq/services';



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
  const { oxyServices, activeSessionId } = useOxy();
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});

    const requestPermissions = async () => {
        if (Platform.OS !== 'web') {
            const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert(
                    'Permission Required',
                    'Sorry, we need camera roll permissions to upload images.',
                    [{ text: 'OK' }]
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
                'Maximum Images Reached',
                `You can upload a maximum of ${maxImages} images.`,
                [{ text: 'OK' }]
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
            Alert.alert('Error', 'Failed to select images. Please try again.');
        }
    };

    const takePhoto = async () => {
        if (disabled || uploading) return;

        const hasPermission = await requestPermissions();
        if (!hasPermission) return;

        if (images.length >= maxImages) {
            Alert.alert(
                'Maximum Images Reached',
                `You can upload a maximum of ${maxImages} images.`,
                [{ text: 'OK' }]
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
            Alert.alert('Error', 'Failed to take photo. Please try again.');
        }
    };

    const uploadImages = async (selectedImages: ImagePicker.ImagePickerAsset[]) => {
        setUploading(true);
        const newImages: UploadedImage[] = [];

        try {
                  // Upload images using the service
      const uploadedImages = await imageUploadService.uploadMultipleImages(
        selectedImages.map(img => img.uri),
        folder,
        oxyServices,
        activeSessionId || undefined
      );

            // Add primary flag to the first image if no images exist
            const processedImages = uploadedImages.map((image, index) => ({
                ...image,
                isPrimary: images.length === 0 && index === 0,
            }));

            // Add new images to existing ones
            const updatedImages = [...images, ...processedImages];
            onImagesChange(updatedImages);

        } catch (error) {
            console.error('Error uploading images:', error);
            Alert.alert('Upload Error', 'Failed to upload some images. Please try again.');
        } finally {
            setUploading(false);
            setUploadProgress({});
        }
    };

    const deleteImage = async (imageId: string) => {
        Alert.alert(
            'Delete Image',
            'Are you sure you want to delete this image?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            const imageToDelete = images.find(img => img.imageId === imageId);
                            if (!imageToDelete) return;

                                          // Delete from backend using service
              await imageUploadService.deleteImage(
                imageToDelete.keys.original,
                oxyServices,
                activeSessionId || undefined
              );

                            // Remove from local state
                            const updatedImages = images.filter(img => img.imageId !== imageId);

                            // If deleted image was primary, make first remaining image primary
                            if (imageToDelete.isPrimary && updatedImages.length > 0) {
                                updatedImages[0].isPrimary = true;
                            }

                            onImagesChange(updatedImages);
                        } catch (error) {
                            console.error('Error deleting image:', error);
                            Alert.alert('Error', 'Failed to delete image. Please try again.');
                        }
                    },
                },
            ]
        );
    };

    const setPrimaryImage = (imageId: string) => {
        const updatedImages = images.map(img => ({
            ...img,
            isPrimary: img.imageId === imageId,
        }));
        onImagesChange(updatedImages);
    };

    const formatFileSize = (bytes: number): string => {
        return imageUploadService.formatFileSize(bytes);
    };

    return (
        <View style={styles.container}>
            {/* Upload Buttons */}
            <View style={styles.uploadButtonsContainer}>
                <TouchableOpacity
                    style={[styles.uploadButton, disabled && styles.uploadButtonDisabled]}
                    onPress={pickImages}
                    disabled={disabled || uploading}
                >
                    <Ionicons name="images-outline" size={24} color={colors.primaryLight} />
                    <ThemedText style={styles.uploadButtonText}>Choose Photos</ThemedText>
                </TouchableOpacity>

                <TouchableOpacity
                    style={[styles.uploadButton, disabled && styles.uploadButtonDisabled]}
                    onPress={takePhoto}
                    disabled={disabled || uploading}
                >
                    <Ionicons name="camera-outline" size={24} color={colors.primaryLight} />
                    <ThemedText style={styles.uploadButtonText}>Take Photo</ThemedText>
                </TouchableOpacity>
            </View>

            {/* Upload Progress */}
            {uploading && (
                <View style={styles.uploadProgressContainer}>
                    <ActivityIndicator size="small" color={colors.primaryColor} />
                    <ThemedText style={styles.uploadProgressText}>Uploading images...</ThemedText>
                </View>
            )}

            {/* Image Count */}
            <View style={styles.imageCountContainer}>
                <ThemedText style={styles.imageCountText}>
                    {images.length} of {maxImages} images uploaded
                </ThemedText>
            </View>

            {/* Image Grid */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.imageScrollView}>
                <View style={styles.imageGrid}>
                    {images.map((image, index) => (
                        <View key={image.imageId} style={styles.imageContainer}>
                            <Image source={{ uri: image.urls.small }} style={styles.image} />

                            {/* Primary Badge */}
                            {image.isPrimary && (
                                <View style={styles.primaryBadge}>
                                    <ThemedText style={styles.primaryBadgeText}>Primary</ThemedText>
                                </View>
                            )}

                            {/* Image Actions */}
                            <View style={styles.imageActions}>
                                {!image.isPrimary && (
                                    <TouchableOpacity
                                        style={styles.actionButton}
                                        onPress={() => setPrimaryImage(image.imageId)}
                                    >
                                        <Ionicons name="star-outline" size={16} color="white" />
                                    </TouchableOpacity>
                                )}

                                <TouchableOpacity
                                    style={[styles.actionButton, styles.deleteButton]}
                                    onPress={() => deleteImage(image.imageId)}
                                >
                                    <Ionicons name="trash-outline" size={16} color="white" />
                                </TouchableOpacity>
                            </View>

                            {/* Image Info */}
                            <View style={styles.imageInfo}>
                                <ThemedText style={styles.imageInfoText}>
                                    {formatFileSize(image.metadata.originalSize)}
                                </ThemedText>
                            </View>
                        </View>
                    ))}

                    {/* Add More Button */}
                    {images.length < maxImages && !uploading && (
                        <TouchableOpacity
                            style={[styles.imageContainer, styles.addMoreButton]}
                            onPress={pickImages}
                            disabled={disabled}
                        >
                            <Ionicons name="add" size={32} color={colors.COLOR_BLACK_LIGHT_4} />
                            <ThemedText style={styles.addMoreText}>Add More</ThemedText>
                        </TouchableOpacity>
                    )}
                </View>
            </ScrollView>

            {/* Helper Text */}
            <ThemedText style={styles.helperText}>
                Upload high-quality images of your property. Include photos of all rooms, exterior, and any special features.
                {images.length === 0 && ' The first image will be set as the primary image.'}
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
        color: 'white',
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
        color: 'white',
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
