/**
 * Airbnb-style 1-large + 4-small photo grid for the property detail hero.
 *
 * Layout:
 *   - Web/desktop: 5 photos, one large tile on the left at 50% width,
 *     a 2x2 grid on the right also at 50% width.
 *   - Tablet/mobile (or fewer than 5 photos): falls back to the
 *     traditional horizontal carousel via the existing PhotoGallery
 *     component, so consumers can render this once and let it pick
 *     the right presentation.
 *
 * Tapping any tile opens the existing ImageGalleryModal at that index.
 * A "Show all photos" overlay button sits in the bottom-right of the
 * grid container — Bloom outline button, anchored over the trailing
 * tile so it reads as a peeking action like Airbnb's hero.
 */
import React, { useCallback, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';

import { ImageGalleryModal } from './ImageGalleryModal';
import { PhotoGallery } from './PhotoGallery';
import { getPropertyImageSource } from '@/utils/propertyUtils';
import { colors } from '@/styles/colors';
import { radius } from '@/constants/styles';
import type { PropertyImage } from '@homiio/shared-types';

export interface PhotoGridProps {
  images: (string | PropertyImage)[];
  /** i18n translator passed through to the mobile carousel fallback. */
  t: (key: string) => string | undefined;
}

const GRID_BREAKPOINT = 768;
const MIN_GRID_PHOTOS = 5;

export const PhotoGrid: React.FC<PhotoGridProps> = ({ images, t }) => {
  const { t: tLocal } = useTranslation();
  const { width } = useWindowDimensions();
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const openModalAt = useCallback((index: number) => {
    setSelectedIndex(index);
    setModalVisible(true);
  }, []);

  const closeModal = useCallback(() => setModalVisible(false), []);

  if (!images?.length) return null;

  // Below the breakpoint or with fewer than five photos, keep the
  // existing horizontal scroller. The grid only makes sense when we
  // have the screen real estate AND the imagery to fill it.
  const shouldRenderGrid =
    Platform.OS === 'web' && width >= GRID_BREAKPOINT && images.length >= MIN_GRID_PHOTOS;

  if (!shouldRenderGrid) {
    return <PhotoGallery images={images} t={t} />;
  }

  const heroImage = images[0];
  const sideImages = images.slice(1, 5);

  return (
    <>
      <View style={styles.outer}>
        <View style={styles.grid}>
          <Pressable
            style={styles.heroTile}
            onPress={() => openModalAt(0)}
            accessibilityRole="imagebutton"
            accessibilityLabel={tLocal('property.photos.hero', 'Open photo 1')}
          >
            <ExpoImage
              source={getPropertyImageSource(heroImage as PropertyImage)}
              style={styles.heroImage}
              contentFit="cover"
              transition={200}
            />
          </Pressable>
          <View style={styles.sideColumn}>
            {sideImages.map((image, idx) => {
              const absoluteIndex = idx + 1;
              const isTopRight = idx === 1;
              const isBottomLeft = idx === 2;
              const isBottomRight = idx === 3;
              return (
                <Pressable
                  key={`side-${idx}`}
                  style={[
                    styles.sideTile,
                    isTopRight && styles.sideTileTopRight,
                    isBottomLeft && styles.sideTileBottomLeft,
                    isBottomRight && styles.sideTileBottomRight,
                  ]}
                  onPress={() => openModalAt(absoluteIndex)}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={tLocal(
                    'property.photos.tile',
                    `Open photo ${absoluteIndex + 1}`,
                  )}
                >
                  <ExpoImage
                    source={getPropertyImageSource(image as PropertyImage)}
                    style={styles.sideImage}
                    contentFit="cover"
                    transition={200}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={styles.showAllAnchor}>
          <Button
            variant="secondary"
            size="small"
            onPress={() => openModalAt(0)}
            icon={<Ionicons name="grid-outline" size={14} color={colors.COLOR_BLACK} />}
            iconPosition="left"
            accessibilityLabel={tLocal('property.photos.showAll', 'Show all photos')}
          >
            {tLocal('property.photos.showAll', 'Show all photos')}
          </Button>
        </View>
      </View>
      <ImageGalleryModal
        visible={modalVisible}
        images={images}
        initialIndex={selectedIndex}
        onClose={closeModal}
      />
    </>
  );
};

const GAP = 8;

const styles = StyleSheet.create({
  outer: {
    position: 'relative',
    marginHorizontal: 16,
    marginBottom: 24,
    borderRadius: radius.photo,
    overflow: 'hidden',
    backgroundColor: colors.white,
  },
  grid: {
    flexDirection: 'row',
    gap: GAP,
    height: 480,
  },
  heroTile: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: colors.COLOR_BLACK_LIGHT_6,
    borderTopLeftRadius: radius.photo,
    borderBottomLeftRadius: radius.photo,
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  sideColumn: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
  },
  sideTile: {
    flexBasis: '48%',
    flexGrow: 1,
    flexShrink: 0,
    maxWidth: '49%',
    height: (480 - GAP) / 2,
    overflow: 'hidden',
    backgroundColor: colors.COLOR_BLACK_LIGHT_6,
  },
  sideTileTopRight: {
    borderTopRightRadius: radius.photo,
  },
  sideTileBottomLeft: {},
  sideTileBottomRight: {
    borderBottomRightRadius: radius.photo,
  },
  sideImage: {
    width: '100%',
    height: '100%',
  },
  showAllAnchor: {
    position: 'absolute',
    right: 16,
    bottom: 16,
  },
});

export default PhotoGrid;
