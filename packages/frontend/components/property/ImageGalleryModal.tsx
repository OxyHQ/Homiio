import React, { useState, useRef, useCallback, useMemo } from 'react';
import {
    View,
    Modal,
    ScrollView,
    Image,
    TouchableOpacity,
    StyleSheet,
    Text,
    StatusBar,
    useWindowDimensions,
    NativeSyntheticEvent,
    NativeScrollEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
    Gesture,
    GestureDetector,
    GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
    useSharedValue,
    useAnimatedStyle,
    withSpring,
    runOnJS,
} from 'react-native-reanimated';
import { getPropertyImageSource } from '@/utils/propertyUtils';
import type { PropertyImage } from '@homiio/shared-types';
import { colors } from '@/styles/colors';

interface ImageGalleryModalProps {
    visible: boolean;
    images: (string | PropertyImage)[];
    initialIndex: number;
    onClose: () => void;
}

const MAX_SCALE = 3;
const MIN_SCALE = 1;
const DAMPING_FACTOR = 0.8;
const ZOOM_THRESHOLD = 1.1;

export const ImageGalleryModal: React.FC<ImageGalleryModalProps> = ({
    visible,
    images,
    initialIndex,
    onClose,
}) => {
    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const scrollViewRef = useRef<ScrollView>(null);
    const { width: screenWidth } = useWindowDimensions();
    const { top: safeAreaTop, bottom: safeAreaBottom } = useSafeAreaInsets();

    // Zoom functionality
    const scale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const [isZoomed, setIsZoomed] = useState(false);

    // Store the base scale for pinch gestures
    const baseScale = useSharedValue(1);
    const lastScale = useSharedValue(1);

    // Store accumulated translation for smooth panning
    const savedTranslateX = useSharedValue(0);
    const savedTranslateY = useSharedValue(0);

    const resetZoom = useCallback(() => {
        // Reset immediately without animation for better UX when changing images.
        scale.value = 1;
        translateX.value = 0;
        translateY.value = 0;
        savedTranslateX.value = 0;
        savedTranslateY.value = 0;
        baseScale.value = 1;
        lastScale.value = 1;
        setIsZoomed(false);
    }, [scale, translateX, translateY, savedTranslateX, savedTranslateY, baseScale, lastScale]);

    const zoomIn = useCallback(() => {
        const newScale = Math.min(scale.value * 1.5, MAX_SCALE);
        scale.value = withSpring(newScale);
        baseScale.value = newScale;
        lastScale.value = newScale;
        setIsZoomed(newScale > 1);
    }, [scale, baseScale, lastScale]);

    const zoomOut = useCallback(() => {
        const newScale = Math.max(scale.value / 1.5, MIN_SCALE);
        scale.value = withSpring(newScale);
        baseScale.value = newScale;
        lastScale.value = newScale;
        if (newScale === 1) {
            translateX.value = withSpring(0);
            translateY.value = withSpring(0);
            savedTranslateX.value = 0;
            savedTranslateY.value = 0;
            setIsZoomed(false);
        } else {
            setIsZoomed(true);
        }
    }, [scale, baseScale, lastScale, translateX, translateY, savedTranslateX, savedTranslateY]);

    const zoomToPoint = useCallback((x: number, y: number) => {
        if (scale.value > 1) {
            resetZoom();
            return;
        }
        // Zoom to 2x at the tapped point.
        const newScale = 2;
        const centerX = screenWidth / 2;
        const centerY = screenWidth * 0.75; // Approximate aspect ratio center
        const offsetX = (centerX - x) * 0.5;
        const offsetY = (centerY - y) * 0.5;

        const maxOffset = screenWidth * 0.2;
        const constrainedOffsetX = Math.max(-maxOffset, Math.min(maxOffset, offsetX));
        const constrainedOffsetY = Math.max(-maxOffset, Math.min(maxOffset, offsetY));

        scale.value = withSpring(newScale);
        translateX.value = withSpring(constrainedOffsetX);
        translateY.value = withSpring(constrainedOffsetY);
        savedTranslateX.value = constrainedOffsetX;
        savedTranslateY.value = constrainedOffsetY;
        baseScale.value = newScale;
        lastScale.value = newScale;
        setIsZoomed(true);
    }, [scale, translateX, translateY, savedTranslateX, savedTranslateY, baseScale, lastScale, screenWidth, resetZoom]);

    // Modern Gesture API replaces deprecated useAnimatedGestureHandler.
    // The deprecated hook breaks on Reanimated 4 + New Architecture because
    // its onActive callback is wired through addListener on the UI thread.
    const doubleTap = useMemo(
        () =>
            Gesture.Tap()
                .numberOfTaps(2)
                .onEnd((event) => {
                    'worklet';
                    runOnJS(zoomToPoint)(event.x, event.y);
                }),
        [zoomToPoint],
    );

    const pinch = useMemo(
        () =>
            Gesture.Pinch()
                .onStart(() => {
                    'worklet';
                    baseScale.value = lastScale.value;
                    runOnJS(setIsZoomed)(true);
                })
                .onUpdate((event) => {
                    'worklet';
                    const newScale = Math.max(
                        MIN_SCALE,
                        Math.min(MAX_SCALE, baseScale.value * (event.scale || 1)),
                    );
                    scale.value = newScale;
                })
                .onEnd(() => {
                    'worklet';
                    lastScale.value = scale.value;
                    if (scale.value < ZOOM_THRESHOLD) {
                        scale.value = withSpring(1);
                        translateX.value = withSpring(0);
                        translateY.value = withSpring(0);
                        savedTranslateX.value = 0;
                        savedTranslateY.value = 0;
                        baseScale.value = 1;
                        lastScale.value = 1;
                        runOnJS(setIsZoomed)(false);
                    } else {
                        runOnJS(setIsZoomed)(true);
                    }
                }),
        [scale, baseScale, lastScale, translateX, translateY, savedTranslateX, savedTranslateY],
    );

    const pan = useMemo(
        () =>
            Gesture.Pan()
                .enabled(isZoomed)
                .minPointers(1)
                .maxPointers(1)
                .activeOffsetX([-5, 5])
                .activeOffsetY([-5, 5])
                .onStart(() => {
                    'worklet';
                    if (scale.value <= 1) return;
                    savedTranslateX.value = translateX.value;
                    savedTranslateY.value = translateY.value;
                })
                .onUpdate((event) => {
                    'worklet';
                    if (scale.value <= 1) return;
                    const nextX = savedTranslateX.value + event.translationX * DAMPING_FACTOR;
                    const nextY = savedTranslateY.value + event.translationY * DAMPING_FACTOR;
                    const maxTranslation = 100 * scale.value;
                    translateX.value = Math.max(-maxTranslation, Math.min(maxTranslation, nextX));
                    translateY.value = Math.max(-maxTranslation, Math.min(maxTranslation, nextY));
                })
                .onEnd(() => {
                    'worklet';
                    if (scale.value <= 1) return;
                    savedTranslateX.value = translateX.value;
                    savedTranslateY.value = translateY.value;
                }),
        [isZoomed, scale, translateX, translateY, savedTranslateX, savedTranslateY],
    );

    const composedGesture = useMemo(
        () => Gesture.Simultaneous(doubleTap, pinch, pan),
        [doubleTap, pinch, pan],
    );

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [
            { scale: scale.value },
            { translateX: translateX.value },
            { translateY: translateY.value },
        ],
    }));

    const goToNext = useCallback(() => {
        if (currentIndex < images.length - 1) {
            const nextIndex = currentIndex + 1;
            setCurrentIndex(nextIndex);
            resetZoom();
            scrollViewRef.current?.scrollTo({
                x: nextIndex * screenWidth,
                animated: true,
            });
        }
    }, [currentIndex, images.length, screenWidth, resetZoom]);

    const goToPrevious = useCallback(() => {
        if (currentIndex > 0) {
            const prevIndex = currentIndex - 1;
            setCurrentIndex(prevIndex);
            resetZoom();
            scrollViewRef.current?.scrollTo({
                x: prevIndex * screenWidth,
                animated: true,
            });
        }
    }, [currentIndex, screenWidth, resetZoom]);

    const onScroll = useCallback(
        (event: NativeSyntheticEvent<NativeScrollEvent>) => {
            const offsetX = event.nativeEvent.contentOffset.x;
            const index = Math.round(offsetX / screenWidth);
            if (index !== currentIndex) {
                setCurrentIndex(index);
                resetZoom();
            }
        },
        [currentIndex, screenWidth, resetZoom],
    );

    const onMomentumScrollEnd = useCallback(
        (event: NativeSyntheticEvent<NativeScrollEvent>) => {
            const offsetX = event.nativeEvent.contentOffset.x;
            const index = Math.round(offsetX / screenWidth);
            setCurrentIndex(index);
            resetZoom();
        },
        [screenWidth, resetZoom],
    );

    return (
        <Modal
            visible={visible}
            transparent={false}
            animationType="fade"
            onRequestClose={onClose}
            statusBarTranslucent={true}
        >
            <StatusBar barStyle="light-content" backgroundColor="black" translucent={true} />
            <GestureHandlerRootView style={styles.container}>
                {/* Image Gallery - Full Screen behind safe area */}
                <View style={styles.fullScreenGalleryContainer}>
                    <ScrollView
                        ref={scrollViewRef}
                        horizontal
                        pagingEnabled={true}
                        scrollEnabled={true}
                        showsHorizontalScrollIndicator={false}
                        onScroll={onScroll}
                        onMomentumScrollEnd={onMomentumScrollEnd}
                        scrollEventThrottle={16}
                        contentContainerStyle={styles.scrollContent}
                        decelerationRate="fast"
                    >
                        {images.map((item, index) => (
                            <View
                                key={`${index}-${currentIndex}`}
                                style={[styles.imageContainer, { width: screenWidth }]}
                            >
                                {index === currentIndex ? (
                                    <GestureDetector gesture={composedGesture}>
                                        <Animated.View style={styles.imageWrapper}>
                                            <Animated.Image
                                                source={getPropertyImageSource(item, 'large')}
                                                style={[styles.image, animatedStyle]}
                                                resizeMode="contain"
                                            />
                                        </Animated.View>
                                    </GestureDetector>
                                ) : (
                                    <View style={styles.imageWrapper}>
                                        <Image
                                            source={getPropertyImageSource(item, 'large')}
                                            style={styles.image}
                                            resizeMode="contain"
                                        />
                                    </View>
                                )}
                            </View>
                        ))}
                    </ScrollView>

                    {/* Zoom Controls */}
                    <View style={[styles.zoomControls, { bottom: safeAreaBottom + 100 }]}>
                        <TouchableOpacity style={styles.zoomButton} onPress={zoomOut}>
                            <Ionicons name="remove" size={20} color={colors.white} />
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.zoomButton} onPress={resetZoom}>
                            <Ionicons name="contract" size={20} color={colors.white} />
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.zoomButton} onPress={zoomIn}>
                            <Ionicons name="add" size={20} color={colors.white} />
                        </TouchableOpacity>
                    </View>

                    {/* Navigation Arrows - always visible */}
                    {currentIndex > 0 && (
                        <TouchableOpacity style={[styles.leftArrow, { top: '50%' }]} onPress={goToPrevious}>
                            <View style={styles.arrowContainer}>
                                <Ionicons name="chevron-back" size={24} color={colors.white} />
                            </View>
                        </TouchableOpacity>
                    )}

                    {currentIndex < images.length - 1 && (
                        <TouchableOpacity style={[styles.rightArrow, { top: '50%' }]} onPress={goToNext}>
                            <View style={styles.arrowContainer}>
                                <Ionicons name="chevron-forward" size={24} color={colors.white} />
                            </View>
                        </TouchableOpacity>
                    )}
                </View>

                {/* Header - Overlay on top with safe area */}
                <View style={[styles.headerOverlay, { paddingTop: safeAreaTop + 15 }]}>
                    <TouchableOpacity onPress={onClose} style={styles.closeButton}>
                        <Ionicons name="close" size={28} color={colors.white} />
                    </TouchableOpacity>
                    <Text style={styles.counter}>
                        {currentIndex + 1} / {images.length}
                    </Text>
                </View>

                {/* Thumbnail Strip - Overlay at bottom */}
                <View style={[styles.thumbnailOverlay, { paddingBottom: safeAreaBottom + 15 }]}>
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
                                    resetZoom();
                                    scrollViewRef.current?.scrollTo({
                                        x: index * screenWidth,
                                        animated: true,
                                    });
                                }}
                            >
                                <Image
                                    source={getPropertyImageSource(item, 'small')}
                                    style={styles.thumbnailImage}
                                    resizeMode="cover"
                                />
                            </TouchableOpacity>
                        ))}
                    </ScrollView>
                </View>
            </GestureHandlerRootView>
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
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
    },
    closeButton: {
        padding: 5,
    },
    counter: {
        color: colors.white,
        fontSize: 16,
        fontWeight: '500',
    },
    galleryContainer: {
        flex: 1,
        position: 'relative',
    },
    fullScreenGalleryContainer: {
        flex: 1,
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
    },
    headerOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        zIndex: 1,
    },
    scrollContent: {
        flexDirection: 'row',
    },
    imageContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    imageWrapper: {
        flex: 1,
        width: '100%',
        height: '100%',
        justifyContent: 'center',
        alignItems: 'center',
    },
    image: {
        width: '100%',
        height: '100%',
    },
    zoomControls: {
        position: 'absolute',
        right: 20,
        flexDirection: 'row',
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        borderRadius: 25,
        padding: 5,
        zIndex: 2,
    },
    zoomButton: {
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        borderRadius: 20,
        width: 40,
        height: 40,
        justifyContent: 'center',
        alignItems: 'center',
        marginHorizontal: 2,
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
        paddingTop: 15,
    },
    thumbnailOverlay: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        paddingTop: 15,
        zIndex: 1,
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
        borderColor: colors.white,
    },
    thumbnailImage: {
        width: '100%',
        height: '100%',
    },
});
