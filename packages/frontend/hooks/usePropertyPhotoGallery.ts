import { useCallback, useMemo, useRef } from 'react';
import type { View } from 'react-native';
import {
  type GalleryImage,
  type MeasureThumb,
  type ZoomableImageGalleryHandle,
} from '@oxyhq/bloom/zoomable-image-gallery';
import { getPropertyGalleryImages } from '@/utils/propertyUtils';
import type { PropertyImage } from '@homiio/shared-types';

/** Measurable host node registered per gallery index for the fly-in/fly-back. */
type ThumbHost = Pick<View, 'measureInWindow'>;

export interface PropertyPhotoGallery {
  /** Ref for the mounted `<ZoomableImageGallery>`. */
  galleryRef: React.RefObject<ZoomableImageGalleryHandle | null>;
  /** Measures any registered thumbnail by its gallery index (dismiss fly-back). */
  measureThumb: MeasureThumb;
  /**
   * Stable callback-ref factory: attach `ref={registerThumbHost(index)}` to the
   * host of the thumbnail that opens the gallery at `index`, so the open/close
   * transitions can fly from/to its measured on-screen rect.
   */
  registerThumbHost: (index: number) => (node: ThumbHost | null) => void;
  /** Open the fullscreen viewer at `index`, flying in from its thumbnail. */
  open: (index: number) => void;
}

/**
 * Wires a property photo list to the Bloom `ZoomableImageGallery`: builds the
 * index-aligned `GalleryImage[]`, keeps a per-index registry of thumbnail host
 * nodes, and exposes the measured-origin `open`/`measureThumb` seam. Both the
 * mobile carousel (`PhotoGallery`) and the desktop hero grid (`PhotoGrid`) share
 * this so a tap flies the zoom from the tapped tile rather than a center fade.
 */
export function usePropertyPhotoGallery(
  images: (string | PropertyImage)[],
): PropertyPhotoGallery {
  const galleryRef = useRef<ZoomableImageGalleryHandle>(null);
  const galleryImages = useMemo<GalleryImage[]>(
    () => getPropertyGalleryImages(images),
    [images],
  );

  // Registry of thumbnail host nodes keyed by gallery index. Stable per-index
  // callback refs (cached) so a host is not detached/reattached every render.
  const thumbHostsRef = useRef<Map<number, ThumbHost>>(new Map());
  const registerCallbacksRef = useRef<Map<number, (node: ThumbHost | null) => void>>(
    new Map(),
  );

  const registerThumbHost = useCallback((index: number) => {
    const cache = registerCallbacksRef.current;
    const existing = cache.get(index);
    if (existing) return existing;
    const callback = (node: ThumbHost | null) => {
      if (node) thumbHostsRef.current.set(index, node);
      else thumbHostsRef.current.delete(index);
    };
    cache.set(index, callback);
    return callback;
  }, []);

  const measureThumb = useCallback<MeasureThumb>(
    (index) =>
      new Promise((resolve) => {
        const node = thumbHostsRef.current.get(index);
        if (!node) {
          resolve(null);
          return;
        }
        node.measureInWindow((x, y, width, height) => {
          resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
        });
      }),
    [],
  );

  const open = useCallback(
    (index: number) => {
      if (galleryImages.length === 0) return;
      void measureThumb(index).then((rect) => {
        galleryRef.current?.open(galleryImages, index, rect ?? undefined);
      });
    },
    [galleryImages, measureThumb],
  );

  return { galleryRef, measureThumb, registerThumbHost, open };
}
