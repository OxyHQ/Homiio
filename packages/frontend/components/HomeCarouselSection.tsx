import React, { useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ScrollView, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { phuduFontWeights } from '@/styles/fonts';
import { ThemedText } from './ThemedText';

interface HomeCarouselSectionProps<T> {
    title: string;
    items: T[];
    loading: boolean;
    renderItem: (item: T, idx: number) => React.ReactNode;
    onViewAll?: () => void;
    viewAllText?: string;
    minItemsToShow?: number; // Minimum number of items to show at start
}

export function HomeCarouselSection<T>({
    title,
    items,
    loading,
    renderItem,
    onViewAll,
    viewAllText = 'View All',
    minItemsToShow = 2,
}: HomeCarouselSectionProps<T>) {
    const carouselRef = useRef<ScrollView>(null);
    const [carouselIndex, setCarouselIndex] = useState(0);
    const [containerWidth, setContainerWidth] = useState(0);
    const [scrollX, setScrollX] = useState(0);
    const [isDragging, setIsDragging] = useState(false);

    // Fixed card width and gap values
    const cardWidth = 200;
    const cardGap = 16;

    // Calculate card width to fit properly within container with consistent padding and gaps
    const horizontalPadding = 32; // 16px left + 16px right
    let calculatedCardWidth = cardWidth;

    if (containerWidth > 0) {
        const availableWidth = containerWidth - horizontalPadding;

        // Calculate how many cards can fit with the desired gap, ensuring minimum items to show
        const maxCardsToFit = Math.floor((availableWidth + cardGap) / (cardWidth + cardGap));
        const cardsToFit = Math.max(minItemsToShow, Math.min(items.length, maxCardsToFit));

        if (cardsToFit > 0) {
            // Calculate the exact card width needed to fit the cards with proper gaps
            const totalGaps = (cardsToFit - 1) * cardGap;
            const calculatedWidth = (availableWidth - totalGaps) / cardsToFit;

            // Use the calculated width if it's reasonable (minimum 140px)
            if (calculatedWidth >= 140) {
                calculatedCardWidth = Math.floor(calculatedWidth);
            } else {
                // If calculated width is too small, use the fixed card width
                calculatedCardWidth = cardWidth;
            }
        }
    }

    // Calculate maxScroll so the last card is perfectly aligned
    const totalCardsWidth = items.length * calculatedCardWidth + (items.length - 1) * cardGap;
    const availableScrollWidth = containerWidth - horizontalPadding; // Account for horizontal padding
    const maxScroll = Math.max(0, totalCardsWidth - availableScrollWidth);
    const totalContentWidth = items.length * calculatedCardWidth + (items.length - 1) * cardGap + horizontalPadding;
    const itemsPerPage = containerWidth > 0 ? Math.floor((availableScrollWidth + cardGap) / (calculatedCardWidth + cardGap)) : 1;
    const maxCarouselIndex = calculatedCardWidth > 0 ? Math.max(0, Math.ceil((totalContentWidth - containerWidth) / (calculatedCardWidth + cardGap))) : 0;

    // Fast magnetic snap function
    const snapToNearestCard = (currentScrollX: number) => {
        if (calculatedCardWidth <= 0) return 0;

        const cardSpacing = calculatedCardWidth + cardGap;
        const nearestIndex = Math.round(currentScrollX / cardSpacing);
        const clampedIndex = Math.max(0, Math.min(nearestIndex, items.length - 1));
        const targetScrollX = clampedIndex * cardSpacing;

        return Math.min(targetScrollX, maxScroll);
    };

    const handleScrollLeft = () => {
        if (!disableLeftArrow) {
            const currentIndex = Math.round(scrollX / (calculatedCardWidth + cardGap));
            const targetIndex = Math.max(0, currentIndex - 1);
            const targetScrollX = targetIndex * (calculatedCardWidth + cardGap);

            carouselRef.current?.scrollTo({ x: targetScrollX, animated: true });
            setScrollX(targetScrollX);
            setCarouselIndex(targetIndex);
        }
    };

    const handleScrollRight = () => {
        if (!disableRightArrow) {
            const currentIndex = Math.round(scrollX / (calculatedCardWidth + cardGap));
            const targetIndex = Math.min(items.length - 1, currentIndex + 1);
            const targetScrollX = Math.min(targetIndex * (calculatedCardWidth + cardGap), maxScroll);

            carouselRef.current?.scrollTo({ x: targetScrollX, animated: true });
            setScrollX(targetScrollX);
            setCarouselIndex(targetIndex);
        }
    };

    const handleScroll = calculatedCardWidth > 0 ? (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const x = e.nativeEvent.contentOffset.x;
        const clampedScroll = Math.min(x, maxScroll);
        setScrollX(clampedScroll);

        // Update carousel index based on current scroll position
        const currentIndex = Math.round(clampedScroll / (calculatedCardWidth + cardGap));
        const clampedIndex = Math.max(0, Math.min(currentIndex, items.length - 1));
        setCarouselIndex(clampedIndex);
    } : undefined;

    const handleScrollBeginDrag = () => {
        setIsDragging(true);
    };

    const handleScrollEndDrag = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        setIsDragging(false);
        const x = e.nativeEvent.contentOffset.x;
        const clampedScroll = Math.min(x, maxScroll);

        // Immediate snap on drag end for faster response
        const snappedScrollX = snapToNearestCard(clampedScroll);

        if (Math.abs(snappedScrollX - clampedScroll) > 2) {
            carouselRef.current?.scrollTo({ x: snappedScrollX, animated: true });
            setScrollX(snappedScrollX);
        } else {
            setScrollX(clampedScroll);
        }

        const snappedIndex = Math.round(snappedScrollX / (calculatedCardWidth + cardGap));
        const clampedIndex = Math.max(0, Math.min(snappedIndex, items.length - 1));
        setCarouselIndex(clampedIndex);
    };

    const handleMomentumScrollEnd = calculatedCardWidth > 0 ? (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const x = e.nativeEvent.contentOffset.x;
        const clampedScroll = Math.min(x, maxScroll);

        // Apply magnetic snap with very low threshold for faster response
        const snappedScrollX = snapToNearestCard(clampedScroll);

        if (Math.abs(snappedScrollX - clampedScroll) > 1) {
            carouselRef.current?.scrollTo({ x: snappedScrollX, animated: true });
            setScrollX(snappedScrollX);
        } else {
            setScrollX(clampedScroll);
        }

        const snappedIndex = Math.round(snappedScrollX / (calculatedCardWidth + cardGap));
        const clampedIndex = Math.max(0, Math.min(snappedIndex, items.length - 1));
        setCarouselIndex(clampedIndex);
    } : undefined;

    const disableRightArrow = scrollX >= maxScroll || maxScroll <= 0;
    const disableLeftArrow = scrollX <= 0;

    return (
        <View style={[styles.section, { paddingHorizontal: 0 }]}> {/* Remove extra section padding */}
            <View style={styles.sectionHeader}>
                <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
                {onViewAll && (
                    <TouchableOpacity onPress={onViewAll}>
                        <ThemedText style={styles.viewAllText}>{viewAllText}</ThemedText>
                    </TouchableOpacity>
                )}
                {(disableLeftArrow && disableRightArrow) ? null : (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <TouchableOpacity
                            onPress={handleScrollLeft}
                            disabled={disableLeftArrow}
                            style={[
                                styles.arrowButton,
                                { opacity: disableLeftArrow ? 0.3 : 1, marginRight: 8 },
                            ]}
                        >
                            <Ionicons name="chevron-back" size={20} color={colors.primaryColor} />
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={handleScrollRight}
                            disabled={disableRightArrow}
                            style={[
                                styles.arrowButton,
                                { opacity: disableRightArrow ? 0.3 : 1 },
                            ]}
                        >
                            <Ionicons name="chevron-forward" size={20} color={colors.primaryColor} />
                        </TouchableOpacity>
                    </View>
                )}
            </View>
            <View
                style={{ flexDirection: 'row', alignItems: 'center' }}
                onLayout={e => setContainerWidth(e.nativeEvent.layout.width)}
            >
                <ScrollView
                    ref={carouselRef}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.horizontalScroll}
                    contentContainerStyle={{ paddingHorizontal: 16 }}
                    scrollEnabled={true}
                    onScrollBeginDrag={handleScrollBeginDrag}
                    onScrollEndDrag={handleScrollEndDrag}
                    onMomentumScrollEnd={handleMomentumScrollEnd}
                    onScroll={handleScroll}
                    scrollEventThrottle={8}
                    decelerationRate={0.8}
                    snapToInterval={calculatedCardWidth + cardGap}
                    snapToAlignment="start"
                    bounces={false}
                >
                    <View style={{ flexDirection: 'row', gap: 16 }}>
                        {loading
                            ? Array.from({ length: 4 }).map((_, idx) => (
                                <View key={idx} style={{ width: calculatedCardWidth, height: 200, backgroundColor: '#f0f0f0', borderRadius: 8 }} />
                            ))
                            : items.map((item, idx) => (
                                <View key={idx} style={{ width: calculatedCardWidth }}>
                                    {renderItem(item, idx)}
                                </View>
                            ))}
                    </View>
                </ScrollView>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    section: {
        marginBottom: 24,
    },
    sectionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
        paddingHorizontal: 16,
    },
    sectionTitle: {
        fontSize: 24,
        color: colors.COLOR_BLACK,
        fontFamily: phuduFontWeights.bold,
        fontWeight: 'bold',
    },
    viewAllText: {
        color: colors.primaryColor,
        fontWeight: '600',
        fontSize: 16,
        marginLeft: 12,
    },
    horizontalScroll: {
        flexDirection: 'row',
    },
    arrowButton: {
        width: 32,
        height: 32,
        borderRadius: 16,
        backgroundColor: '#fff',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 2,
        elevation: 2,
    },
}); 