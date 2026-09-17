import React, { useCallback, useState } from 'react';
import { View, ScrollView, Pressable, Image, StyleSheet } from 'react-native';
import { Button } from '@oxy.so/bloom/button';
import { RiArrowRightSLine } from '@oxy.so/bloom/icons';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { ZoomableMediaGallery } from '@oxy.so/bloom/zoomable-media-gallery';
import { ZoomableImage } from '@/components/ui/ZoomableImage';
import { colors } from '@/styles/colors';
import { getPropertyImageSource } from '@/utils/propertyUtils';
import { usePropertyPhotoGallery } from '@/hooks/usePropertyPhotoGallery';
import { radius, spacing } from '@/constants/styles';
import { SECTION_GUTTER } from './Section';
import type { PropertyImage } from '@homiio/shared-types';

interface PhotoGalleryProps {
    images: (string | PropertyImage)[];
    onOpen?: (index: number) => void;
    t: (key: string) => string | undefined;
}

const THUMB_SIZE = 100;
const MAX_THUMBS = 5;

interface GalleryThumbProps {
    image: string | PropertyImage;
    hostRef: ReturnType<ReturnType<typeof usePropertyPhotoGallery>['registerThumbHost']>;
    onPress: () => void;
    /** Photos beyond the strip, shown as "+N" over the last thumb (0 = none). */
    overflowCount: number;
}

/**
 * One thumbnail: the photo zooms inside its rounded mask on hover/press (the
 * shared `ZoomableImage`), the tile itself never scales.
 */
const GalleryThumb: React.FC<GalleryThumbProps> = ({ image, hostRef, onPress, overflowCount }) => {
    const [active, setActive] = useState(false);
    return (
        <Pressable
            ref={hostRef}
            style={styles.galleryImageContainer}
            onPress={onPress}
            onPressIn={() => setActive(true)}
            onPressOut={() => setActive(false)}
            onHoverIn={() => setActive(true)}
            onHoverOut={() => setActive(false)}
            accessibilityRole="imagebutton"
        >
            <ZoomableImage active={active} borderRadius={radius.md} style={StyleSheet.absoluteFill}>
                <Image source={getPropertyImageSource(image, 'medium')} style={styles.galleryImage} resizeMode="cover" />
            </ZoomableImage>
            {overflowCount > 0 ? (
                <View style={styles.moreImagesOverlay}>
                    <BloomText variant="headline-semibold" style={styles.moreImagesText}>
                        +{overflowCount}
                    </BloomText>
                </View>
            ) : null}
        </Pressable>
    );
};

export const PhotoGallery: React.FC<PhotoGalleryProps> = ({ images, onOpen, t }) => {
    const { galleryRef, measureThumb, registerThumbHost, open } = usePropertyPhotoGallery(images);

    const handleImagePress = useCallback(
        (index: number) => {
            onOpen?.(index);
            open(index);
        },
        [onOpen, open],
    );

    if (!images?.length) return null;
    return (
        <>
            <View style={styles.photoGalleryContainer}>
                <View style={styles.galleryHeader}>
                    <BloomText variant="title-2-bold" style={styles.sectionTitle}>
                        {t('property.sections.photoGallery')}
                    </BloomText>
                    <Button
                        variant="link"
                        size="small"
                        trailingIcon={RiArrowRightSLine}
                        onPress={() => handleImagePress(0)}
                    >
                        {t('property.sections.viewAll')}
                    </Button>
                </View>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.galleryScroll}
                    contentContainerStyle={styles.galleryScrollContent}
                >
                    {images.slice(0, MAX_THUMBS).map((image, index) => (
                        <GalleryThumb
                            key={index}
                            image={image}
                            hostRef={registerThumbHost(index)}
                            onPress={() => handleImagePress(index)}
                            overflowCount={
                                index === MAX_THUMBS - 1 && images.length > MAX_THUMBS
                                    ? images.length - MAX_THUMBS
                                    : 0
                            }
                        />
                    ))}
                </ScrollView>
            </View>

            <ZoomableMediaGallery
                ref={galleryRef}
                measureThumb={measureThumb}
                indicatorVariant="thumbnails"
            />
        </>
    );
};

const styles = StyleSheet.create({
    // Full-bleed container: the horizontal gutter lives on the header and
    // the scroll's contentContainerStyle so the scroll track runs
    // edge-to-edge (matches HomeCarouselSection).
    photoGalleryContainer: {
        marginBottom: spacing.xl,
        paddingVertical: spacing.md,
    },
    galleryHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing.md,
        paddingHorizontal: SECTION_GUTTER,
    },
    sectionTitle: {
        color: colors.COLOR_BLACK,
        letterSpacing: -0.2,
    },
    galleryScroll: { height: THUMB_SIZE },
    galleryScrollContent: { paddingHorizontal: SECTION_GUTTER, gap: spacing.md },
    galleryImageContainer: {
        width: THUMB_SIZE,
        height: THUMB_SIZE,
        borderRadius: radius.md,
        overflow: 'hidden',
        backgroundColor: colors.COLOR_BLACK_LIGHT_6,
    },
    galleryImage: { width: '100%', height: '100%' },
    moreImagesOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: colors.overlay,
        borderRadius: radius.md,
        justifyContent: 'center',
        alignItems: 'center',
    },
    moreImagesText: { color: colors.white },
});
