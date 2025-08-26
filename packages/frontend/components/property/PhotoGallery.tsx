import React, { useState } from 'react';
import { View, ScrollView, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { getPropertyImageSource } from '@/utils/propertyUtils';
import { ImageGalleryModal } from './ImageGalleryModal';
import type { PropertyImage } from '@homiio/shared-types';

interface PhotoGalleryProps {
    images: (string | PropertyImage)[];
    onOpen?: (index: number) => void;
    t: (key: string) => string | undefined;
}

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
                    <ThemedText style={styles.sectionTitle}>{t('Photo Gallery')}</ThemedText>
                    <TouchableOpacity style={styles.viewAllButton} onPress={() => handleImagePress(0)}>
                        <ThemedText style={styles.viewAllButtonText}>{t('View All')}</ThemedText>
                        <Ionicons name="chevron-forward" size={16} color={colors.primaryColor} />
                    </TouchableOpacity>
                </View>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.galleryScroll}
                    contentContainerStyle={styles.galleryScrollContent}
                >
                    {images.slice(0, 5).map((image, index) => (
                        <TouchableOpacity
                            key={index}
                            style={styles.galleryImageContainer}
                            onPress={() => handleImagePress(index)}
                            activeOpacity={0.8}
                        >
                            <Image source={getPropertyImageSource(image as any)} style={styles.galleryImage} resizeMode="cover" />
                            {index === 4 && images.length > 5 && (
                                <View style={styles.moreImagesOverlay}>
                                    <ThemedText style={styles.moreImagesText}>+{images.length - 5}</ThemedText>
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
    photoGalleryContainer: {
        marginBottom: 20,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    galleryHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 10,
    },
    sectionTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        marginBottom: 0,
    },
    viewAllButton: { flexDirection: 'row', alignItems: 'center' },
    viewAllButtonText: { fontSize: 14, color: colors.primaryColor, marginRight: 5 },
    galleryScroll: { height: 100 },
    galleryScrollContent: { paddingHorizontal: 16 },
    galleryImageContainer: {
        width: 100,
        height: 100,
        borderRadius: 12,
        marginRight: 12,
        overflow: 'hidden',
        backgroundColor: '#f0f0f0',
    },
    galleryImage: { width: '100%', height: '100%' } as any,
    moreImagesOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        borderRadius: 12,
        justifyContent: 'center',
        alignItems: 'center',
    },
    moreImagesText: { color: 'white', fontSize: 16, fontWeight: '600' },
});
