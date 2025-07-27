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
    cardWidth?: number; // Optional override
    cardGap?: number; // Optional override
}

export function HomeCarouselSection<T>({
    title,
    items,
    loading,
    renderItem,
    onViewAll,
    viewAllText = 'View All',
    cardWidth = 200,
    cardGap = 15,
}: HomeCarouselSectionProps<T>) {
    const carouselRef = useRef<ScrollView>(null);
    const [carouselIndex, setCarouselIndex] = useState(0);
    const [containerWidth, setContainerWidth] = useState(0);
    const [scrollX, setScrollX] = useState(0);
    // Use cardWidth + cardGap for scroll calculations
    const leftSpacer = cardGap;
    const totalContentWidth = items.length * (cardWidth + cardGap) + leftSpacer;
    const itemsPerPage = containerWidth > 0 ? Math.floor(containerWidth / (cardWidth + cardGap)) : 1;
    const maxScroll = Math.max(0, totalContentWidth - containerWidth);
    const maxCarouselIndex = cardWidth > 0 ? Math.max(0, Math.ceil((totalContentWidth - containerWidth) / (cardWidth + cardGap))) : 0;

    const handleScrollLeft = () => {
        if (!disableLeftArrow) {
            const newScrollX = Math.max(0, scrollX - (cardWidth + cardGap));
            carouselRef.current?.scrollTo({ x: newScrollX, animated: true });
            setScrollX(newScrollX);
            const newIndex = Math.max(0, Math.round(newScrollX / (cardWidth + cardGap)));
            setCarouselIndex(newIndex);
        }
    };

    const handleScrollRight = () => {
        if (!disableRightArrow) {
            const newIndex = carouselIndex + 1;
            setCarouselIndex(newIndex);
            if (cardWidth > 0) {
                const scrollX = Math.min(newIndex * (cardWidth + cardGap), maxScroll);
                carouselRef.current?.scrollTo({ x: scrollX, animated: true });
                setScrollX(scrollX);
            }
        }
    };

    const handleScroll = cardWidth > 0 ? (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const x = e.nativeEvent.contentOffset.x;
        setScrollX(x);
        const clampedScroll = Math.min(x, maxScroll);
        const clampedIndex = Math.max(0, Math.round(clampedScroll / (cardWidth + cardGap)));
        setCarouselIndex(clampedIndex);
    } : undefined;

    const disableRightArrow = (scrollX + containerWidth) >= (totalContentWidth - cardGap - 1); // -1 for floating point tolerance
    const disableLeftArrow = scrollX <= 0;
    return (
        <View style={styles.section}>
            <View style={styles.sectionHeader}>
                <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
                {onViewAll && (
                    <TouchableOpacity onPress={onViewAll}>
                        <ThemedText style={styles.viewAllText}>{viewAllText}</ThemedText>
                    </TouchableOpacity>
                )}
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
                    contentContainerStyle={{}}
                    scrollEnabled={true}
                    onMomentumScrollEnd={cardWidth > 0 ? (e) => {
                        const x = e.nativeEvent.contentOffset.x;
                        const clampedScroll = Math.min(x, maxScroll);
                        const clampedIndex = Math.max(0, Math.round(clampedScroll / (cardWidth + cardGap)));
                        setCarouselIndex(clampedIndex);
                    } : undefined}
                    onScroll={handleScroll}
                    scrollEventThrottle={16}
                >
                    {/* Left spacer for visual balance */}
                    <View style={{ width: leftSpacer }} />
                    {loading
                        ? Array.from({ length: 4 }).map((_, idx) => (
                            <View key={idx} style={{ width: cardWidth, marginRight: cardGap }}>{/* Skeleton */}</View>
                        ))
                        : items.map((item, idx) => (
                            <View key={idx} style={{ width: cardWidth, marginRight: cardGap }}>
                                {renderItem(item, idx)}
                            </View>
                        ))}
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
        fontFamily: phuduFontWeights.semiBold,
        letterSpacing: -0.3,
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