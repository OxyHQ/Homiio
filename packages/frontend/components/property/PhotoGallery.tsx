import React, { useState } from 'react';
import { View, ScrollView, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { getPropertyImageSource } from '@/utils/propertyUtils';
import { radius, spacing } from '@/constants/styles';
import { SECTION_GUTTER } from './Section';
import { ImageGalleryModal } from './ImageGalleryModal';
import type { PropertyImage } from '@homiio/shared-types';

interface PhotoGalleryProps {
    images: (string | PropertyImage)[];
    onOpen?: (index: number) => void;
    t: (key: string) => string | undefined;
}

const THUMB_SIZE = 100;
const MAX_THUMBS = 5;

export const PhotoGallery: React.FC<PhotoGalleryProps> = ({ images, onOpen, t }) => {
    const [modalVisible, setModalVisible] = useState(false);
    const [selectedIndex, setSelectedIndex] = useState(0);

    const handleImagePress = (index: number) => {
        setSelectedIndex(index);
        setModalVisible(true);
        onOpen?.(index);
    };

    if (!images?.length) return null;
    return (
        <>
            <View style={styles.photoGalleryContainer}>
                <View style={styles.galleryHeader}>
                    <BloomText style={styles.sectionTitle}>{t('Photo Gallery')}</BloomText>
                    <TouchableOpacity style={styles.viewAllButton} onPress={() => handleImagePress(0)}>
                        <BloomText style={styles.viewAllButtonText}>{t('View All')}</BloomText>
                        <Ionicons name="chevron-forward" size={16} color={colors.primaryColor} />
                    </TouchableOpacity>
                </View>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.galleryScroll}
                    contentContainerStyle={styles.galleryScrollContent}
                >
                    {images.slice(0, MAX_THUMBS).map((image, index) => (
                        <TouchableOpacity
                            key={index}
                            style={styles.galleryImageContainer}
                            onPress={() => handleImagePress(index)}
                            activeOpacity={0.8}
                        >
                            <Image source={getPropertyImageSource(image, 'medium')} style={styles.galleryImage} resizeMode="cover" />
                            {index === MAX_THUMBS - 1 && images.length > MAX_THUMBS && (
                                <View style={styles.moreImagesOverlay}>
                                    <BloomText style={styles.moreImagesText}>+{images.length - MAX_THUMBS}</BloomText>
                                </View>
                            )}
                        </TouchableOpacity>
                    ))}
                </ScrollView>
            </View>

            <ImageGalleryModal
                visible={modalVisible}
                images={images}
                initialIndex={selectedIndex}
                onClose={() => setModalVisible(false)}
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
        fontSize: 20,
        fontWeight: '700',
        color: colors.COLOR_BLACK,
        letterSpacing: -0.2,
    },
    viewAllButton: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
    viewAllButtonText: { fontSize: 14, color: colors.primaryColor },
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
    moreImagesText: { color: colors.white, fontSize: 16, fontWeight: '600' },
});
