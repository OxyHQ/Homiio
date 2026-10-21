/**
 * Multi-image picker + uploader (the listing's photos, a review's photos) on
 * Bloom's `SortablePhotoGrid`: the photos in order with the first marked as the
 * cover, drag to reorder on web and move buttons everywhere, a tile per upload
 * in flight (with retry when it fails) and the add tile.
 *
 * The data is unchanged: `images` are `UploadedImage`s from
 * `imageUploadService`, and a photo only joins them once the upload API has
 * returned it. A set picked together is sent in as many requests as the
 * per-request byte budget needs (`planUploadBatches`, `shared-types`), and each
 * request's photos join the list as it lands. The cover is the image flagged `isPrimary`: the grid draws it
 * first, and a reorder makes the new first photo the primary one. Nothing is
 * rewritten until the host reorders or removes, so an untouched list is saved
 * exactly as it was loaded.
 *
 * Every change is handed to the owner as an UPDATE of the current list, the way
 * `setState` takes one, never as a finished list. An upload resolves renders
 * after it started, and the list it started from may have changed meanwhile —
 * another upload landed, a photo was removed — so only the owner, applying the
 * update to what it holds now, can produce the right next list.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { Button } from '@oxy.so/bloom/button';
import { RiCameraLine } from '@oxy.so/bloom/icons';
import { SortablePhotoGrid, type SortablePhoto } from '@oxy.so/bloom/sortable-media';
import { confirm } from '@oxy.so/bloom/surfaces';
import { toast } from '@oxy.so/bloom/toast';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import {
  IMAGE_UPLOAD_MAX_FILE_BYTES,
  IMAGE_UPLOAD_MAX_FILES_PER_REQUEST,
  planUploadBatches,
} from '@homiio/shared-types';
import { spacing } from '@/constants/styles';
import { logger } from '@/utils/logger';
import { coverFirst } from '@/utils/propertyPhotos';
import { imageUploadService, type UploadedImage } from '@/services/imageUploadService';

/** The next photo list, from the current one. */
export type ImagesUpdate = (current: UploadedImage[]) => UploadedImage[];

interface ImageUploadProps {
  images: UploadedImage[];
  /** Apply `update` to the photos as they are when it is applied. */
  onImagesChange: (update: ImagesUpdate) => void;
  maxImages?: number;
  folder?: string;
  disabled?: boolean;
}

/** A picked photo whose upload is running or failed; not in `images` yet. */
interface PendingPhoto {
  id: string;
  uri: string;
  status: 'uploading' | 'error';
  /** The picked file's size, when the picker reports one; plans the requests. */
  sizeBytes?: number;
}

const UPLOAD_LIMITS = {
  maxFileBytes: IMAGE_UPLOAD_MAX_FILE_BYTES,
  maxFilesPerRequest: IMAGE_UPLOAD_MAX_FILES_PER_REQUEST,
};

const IS_NATIVE = Platform.OS !== 'web';
let pendingCounter = 0;

export function ImageUpload({
  images = [],
  onImagesChange,
  maxImages = 10,
  folder = 'properties',
  disabled = false,
}: ImageUploadProps) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingPhoto[]>([]);

  const ordered = useMemo(() => coverFirst(images), [images]);
  const total = images.length + pending.length;
  const atLimit = total >= maxImages;

  const photos = useMemo<SortablePhoto[]>(
    () => [
      ...ordered.map((image) => ({
        id: image.imageId,
        uri: image.urls.small || image.urls.original,
        alt: image.caption || undefined,
      })),
      ...pending,
    ],
    [ordered, pending],
  );

  const labels = useMemo(
    () => ({
      photo: (position: number, count: number) =>
        t('imageUpload.grid.photo', { position, total: count }),
      cover: t('imageUpload.grid.cover'),
      moveEarlier: (position: number) => t('imageUpload.grid.moveEarlier', { position }),
      moveLater: (position: number) => t('imageUpload.grid.moveLater', { position }),
      remove: (position: number) => t('imageUpload.grid.remove', { position }),
      retry: (position: number) => t('imageUpload.grid.retry', { position }),
      retryAction: t('imageUpload.grid.retryAction'),
      uploading: (position: number) => t('imageUpload.grid.uploading', { position }),
      failed: t('imageUpload.grid.failed'),
      add: t('imageUpload.grid.add'),
      moved: (position: number, count: number) =>
        t('imageUpload.grid.moved', { position, total: count }),
    }),
    [t],
  );

  /** One request: these photos land together or fail together. */
  const uploadRequest = useCallback(
    async (batch: PendingPhoto[]): Promise<boolean> => {
      const ids = new Set(batch.map((photo) => photo.id));
      try {
        const response = await imageUploadService.uploadMultipleImages(
          batch.map((photo) => photo.uri),
          folder,
        );
        setPending((list) => list.filter((photo) => !ids.has(photo.id)));
        onImagesChange((current) => [
          ...current,
          ...response.data.images.map<UploadedImage>((image, index) => ({
            imageId: image.imageId,
            fileId: image.fileId,
            urls: {
              small: image.urls.small ?? image.urls.original ?? '',
              medium: image.urls.medium ?? image.urls.original ?? '',
              large: image.urls.large ?? image.urls.original ?? '',
              original: image.urls.original ?? '',
            },
            keys: image.keys,
            metadata: image.metadata,
            // The first photo of an empty list is the cover.
            isPrimary: current.length === 0 && index === 0,
          })),
        ]);
        return true;
      } catch (error) {
        logger.error('Error uploading images', error);
        setPending((list) =>
          list.map((photo) => (ids.has(photo.id) ? { ...photo, status: 'error' as const } : photo)),
        );
        return false;
      }
    },
    [folder, onImagesChange],
  );

  /**
   * Every picked photo, in as many requests as the byte budget needs, one
   * after another. A request that fails marks only its own photos for retry;
   * the rest still go, and the person hears about it once.
   */
  const upload = useCallback(
    async (batch: PendingPhoto[]) => {
      const ids = new Set(batch.map((photo) => photo.id));
      setPending((list) => [
        ...list.filter((photo) => !ids.has(photo.id)),
        ...batch.map((photo) => ({ ...photo, status: 'uploading' as const })),
      ]);
      let failed = false;
      for (const request of planUploadBatches(batch, (photo) => photo.sizeBytes, UPLOAD_LIMITS)) {
        if (!(await uploadRequest(request))) failed = true;
      }
      if (failed) toast.error(t('imageUpload.uploadFailed'));
    },
    [uploadRequest, t],
  );

  const requestPermissions = async () => {
    if (!IS_NATIVE) return true;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status === 'granted') return true;
    toast.error(t('imageUpload.permissionTitle'), {
      description: t('imageUpload.permissionMessage'),
    });
    return false;
  };

  const guardLimit = () => {
    if (!atLimit) return true;
    toast.warning(t('imageUpload.maxImagesTitle'), {
      description: t('imageUpload.maxImagesMessage', { max: maxImages }),
    });
    return false;
  };

  const startUploads = (assets: ImagePicker.ImagePickerAsset[]) => {
    const batch = assets.slice(0, maxImages - total).map((asset) => ({
      id: `pending-${(pendingCounter += 1)}`,
      uri: asset.uri,
      status: 'uploading' as const,
      sizeBytes: asset.fileSize ?? asset.file?.size,
    }));
    if (batch.length > 0) void upload(batch);
  };

  const pickImages = async () => {
    if (disabled || !(await requestPermissions()) || !guardLimit()) return;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 0.8,
        aspect: [4, 3],
        allowsEditing: false,
      });
      if (!result.canceled && result.assets) startUploads(result.assets);
    } catch (error) {
      logger.error('Error picking images', error);
      toast.error(t('imageUpload.selectFailed'));
    }
  };

  const takePhoto = async () => {
    if (disabled || !(await requestPermissions()) || !guardLimit()) return;
    try {
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        aspect: [4, 3],
        allowsEditing: false,
      });
      if (!result.canceled && result.assets) startUploads(result.assets);
    } catch (error) {
      logger.error('Error taking photo', error);
      toast.error(t('imageUpload.photoFailed'));
    }
  };

  /** A reorder of the uploaded photos: store the grid's order, the first as the cover. */
  const handleReorder = (next: SortablePhoto[]) => {
    onImagesChange((current) => {
      const byId = new Map(current.map((image) => [image.imageId, image]));
      const reordered = next.flatMap((photo) => {
        const image = byId.get(photo.id);
        return image ? [image] : [];
      });
      return reordered.map((image, index) => ({ ...image, isPrimary: index === 0 }));
    });
    // Uploads in flight keep their place after the uploaded photos.
  };

  const handleRemove = async (id: string) => {
    if (pending.some((photo) => photo.id === id)) {
      setPending((list) => list.filter((photo) => photo.id !== id));
      return;
    }
    const image = images.find((candidate) => candidate.imageId === id);
    if (!image) return;
    const ok = await confirm({
      title: t('imageUpload.deleteTitle'),
      description: t('imageUpload.deleteMessage'),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    // Nothing to delete server-side: the photo is a file in the person's own
    // Oxy account, and leaving the listing is all removing it here means.
    onImagesChange((current) => {
      const remaining = coverFirst(current).filter((candidate) => candidate.imageId !== id);
      return image.isPrimary && remaining.length > 0
        ? [{ ...remaining[0], isPrimary: true }, ...remaining.slice(1)]
        : remaining;
    });
  };

  const handleRetry = (id: string) => {
    const photo = pending.find((candidate) => candidate.id === id);
    if (photo) void upload([photo]);
  };

  return (
    <View style={styles.container}>
      <SortablePhotoGrid
        photos={photos}
        onReorder={handleReorder}
        onRemove={(id) => void handleRemove(id)}
        onRetry={handleRetry}
        onAdd={() => void pickImages()}
        maxPhotos={maxImages}
        addHint={t('imageUpload.imageCount', { current: images.length, max: maxImages })}
        disabled={disabled}
        labels={labels}
        accessibilityLabel={t('imageUpload.grid.label')}
        testID="image-upload-grid"
      />

      {IS_NATIVE ? (
        <Button
          leadingIcon={RiCameraLine}
          onPress={() => void takePhoto()}
          disabled={disabled || atLimit}
          style={styles.cameraButton}
          tone="neutral"
          appearance="outline"
        >
          {t('imageUpload.takePhoto')}
        </Button>
      ) : null}

      <BloomText className="text-xs leading-4 text-muted-foreground">
        {t('imageUpload.helperText')}
      </BloomText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  cameraButton: {
    alignSelf: 'flex-start',
  },
});
