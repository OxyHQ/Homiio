import React, { useState, useRef } from 'react';
import {
    View,
    Modal,
    ScrollView,
    Image,
    TouchableOpacity,
    StyleSheet,
    SafeAreaView,
    Text,
    StatusBar,
    useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getPropertyImageSource } from '@/utils/propertyUtils';
import type { PropertyImage } from '@homiio/shared-types';

interface ImageGalleryModalProps {
    visible: boolean;
    images: (string | PropertyImage)[];
    initialIndex: number;
    onClose: () => void;
}

export const ImageGalleryModal: React.FC<ImageGalleryModalProps> = ({
    visible,
    images,
    initialIndex,
    onClose,
}) => {
    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const scrollViewRef = useRef<ScrollView>(null);
    const { width: screenWidth } = useWindowDimensions();

    const goToNext = () => {
        if (currentIndex < images.length - 1) {
            const nextIndex = currentIndex + 1;
            setCurrentIndex(nextIndex);
            scrollViewRef.current?.scrollTo({ 
                x: nextIndex * screenWidth, 
                animated: true 
            });
        }
    };

    const goToPrevious = () => {
        if (currentIndex > 0) {
            const prevIndex = currentIndex - 1;
            setCurrentIndex(prevIndex);
            scrollViewRef.current?.scrollTo({ 
                x: prevIndex * screenWidth, 
                animated: true 
            });
        }
    };

    const onScroll = (event: any) => {
        const offsetX = event.nativeEvent.contentOffset.x;
        const index = Math.round(offsetX / screenWidth);
        if (index !== currentIndex) {
            setCurrentIndex(index);
        }
    };

    const onMomentumScrollEnd = (event: any) => {
        const offsetX = event.nativeEvent.contentOffset.x;
        const index = Math.round(offsetX / screenWidth);
        setCurrentIndex(index);
    };

    return (
        <Modal
            visible={visible}
            transparent={false}
            animationType="fade"
            onRequestClose={onClose}
        >
            <StatusBar barStyle="light-content" backgroundColor="black" />
            <SafeAreaView style={styles.container}>
                {/* Header */}
                <View style={styles.header}>
                    <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                        <Ionicons name="close" size={28} color="white" />
                    </TouchableOpacity>
                    <Text style={styles.counter}>
                        {currentIndex + 1} / {images.length}
                    </Text>
                </View>

                {/* Image Gallery */}
                <View style={styles.galleryContainer}>
                    <ScrollView
                        ref={scrollViewRef}
                        horizontal
                        pagingEnabled
                        showsHorizontalScrollIndicator={false}
                        onScroll={onScroll}
                        onMomentumScrollEnd={onMomentumScrollEnd}
                        scrollEventThrottle={16}
                        contentContainerStyle={styles.scrollContent}
                    >
                        {images.map((item, index) => (
                            <View key={index} style={[styles.imageContainer, { width: screenWidth }]}>
                                <Image
                                    source={getPropertyImageSource(item)}
                                    style={styles.image}
                                    resizeMode="contain"
                                />
                            </View>
                        ))}
                    </ScrollView>

                    {/* Navigation Arrows */}
                    {currentIndex > 0 && (
                        <TouchableOpacity style={styles.leftArrow} onPress={goToPrevious}>
                            <View style={styles.arrowContainer}>
                                <Ionicons name="chevron-back" size={24} color="white" />
                            </View>
                        </TouchableOpacity>
                    )}

                    {currentIndex < images.length - 1 && (
                        <TouchableOpacity style={styles.rightArrow} onPress={goToNext}>
                            <View style={styles.arrowContainer}>
                                <Ionicons name="chevron-forward" size={24} color="white" />
                            </View>
                        </TouchableOpacity>
                    )}
                </View>

                {/* Thumbnail Strip */}
                <View style={styles.thumbnailContainer}>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.thumbnailList}
                    >
                        {images.map((item, index) => (
                            <TouchableOpacity
                                key={index}
                                style={[
                                    styles.thumbnail,
                                    index === currentIndex && styles.activeThumbnail,
                                ]}
                                onPress={() => {
                                    setCurrentIndex(index);
                                    scrollViewRef.current?.scrollTo({ 
                                        x: index * screenWidth, 
                                        animated: true 
                                    });
                                }}
                            >
                                <Image
                                    source={getPropertyImageSource(item)}
                                    style={styles.thumbnailImage}
                                    resizeMode="cover"
                                />
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>
            </SafeAreaView>
        </Modal>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: 'black',
    },
    header: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        paddingVertical: 15,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
    },
    closeButton: {
        padding: 5,
    },
    counter: {
        color: 'white',
        fontSize: 16,
        fontWeight: '500',
    },
    galleryContainer: {
        flex: 1,
        position: 'relative',
    },
    scrollContent: {
        flexDirection: 'row',
    },
    imageContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    image: {
        width: '100%',
        height: '100%',
    },
    leftArrow: {
        position: 'absolute',
        left: 20,
        top: '50%',
        transform: [{ translateY: -25 }],
    },
    rightArrow: {
        position: 'absolute',
        right: 20,
        top: '50%',
        transform: [{ translateY: -25 }],
    },
    arrowContainer: {
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        borderRadius: 25,
        width: 50,
        height: 50,
        justifyContent: 'center',
        alignItems: 'center',
    },
    thumbnailContainer: {
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        paddingVertical: 15,
    },
    thumbnailList: {
        paddingHorizontal: 20,
    },
    thumbnail: {
        width: 60,
        height: 60,
        marginRight: 10,
        borderRadius: 8,
        overflow: 'hidden',
        borderWidth: 2,
        borderColor: 'transparent',
    },
    activeThumbnail: {
        borderColor: 'white',
    },
    thumbnailImage: {
        width: '100%',
        height: '100%',
    },
});
