import React, { useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
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
  minItemsToShow: _minItemsToShow = 2,
}: HomeCarouselSectionProps<T>) {
  const carouselRef = useRef<ScrollView>(null);
  const [_carouselIndex, setCarouselIndex] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollX, setScrollX] = useState(0);
  const [_isDragging, setIsDragging] = useState(false);

  // Max card width and gap values
  const maxCardWidth = 180;
  const cardGap = 16;

  // Calculate card width to fit within container while respecting a max width
  const horizontalPadding = 32; // 16px left + 16px right
  let calculatedCardWidth = maxCardWidth;

  if (containerWidth > 0) {
    const availableWidth = Math.max(0, containerWidth - horizontalPadding);

    // Minimum number of cards needed so that per-card width does not exceed maxCardWidth
    const minCardsToFit = Math.max(1, Math.ceil((availableWidth + cardGap) / (maxCardWidth + cardGap)));

    if (items.length >= minCardsToFit) {
      const totalGaps = (minCardsToFit - 1) * cardGap;
      const exactWidth = (availableWidth - totalGaps) / minCardsToFit;
      calculatedCardWidth = Math.min(maxCardWidth, Math.floor(exactWidth));
    } else {
      // Not enough cards to fill the viewport; keep max size and align left
      calculatedCardWidth = maxCardWidth;
    }
  }

  // Calculate maxScroll so the last card is perfectly aligned
  const totalCardsWidth = items.length * calculatedCardWidth + (items.length - 1) * cardGap;
  const availableScrollWidth = containerWidth - horizontalPadding; // Account for horizontal padding
  const maxScroll = Math.max(0, totalCardsWidth - availableScrollWidth);
  const totalContentWidth =
    items.length * calculatedCardWidth + (items.length - 1) * cardGap + horizontalPadding;
  const itemsPerPage =
    containerWidth > 0
      ? Math.floor((availableScrollWidth + cardGap) / (calculatedCardWidth + cardGap))
      : 1;
  const _maxCarouselIndex =
    calculatedCardWidth > 0
      ? Math.max(
        0,
        Math.ceil((totalContentWidth - containerWidth) / (calculatedCardWidth + cardGap)),
      )
      : 0;

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
      const cardSpacing = calculatedCardWidth + cardGap;
      const pageStride = Math.max(1, itemsPerPage) * cardSpacing;
      const currentPage = Math.floor(scrollX / pageStride);
      const targetPage = Math.max(0, currentPage - 1);
      const targetScrollX = Math.max(0, targetPage * pageStride);

      carouselRef.current?.scrollTo({ x: targetScrollX, animated: true });
      setScrollX(targetScrollX);
      const targetIndex = Math.round(targetScrollX / cardSpacing);
      setCarouselIndex(targetIndex);
    }
  };

  const handleScrollRight = () => {
    if (!disableRightArrow) {
      const cardSpacing = calculatedCardWidth + cardGap;
      const pageStride = Math.max(1, itemsPerPage) * cardSpacing;
      const currentPage = Math.floor(scrollX / pageStride);
      const targetScrollX = Math.min(maxScroll, (currentPage + 1) * pageStride);

      carouselRef.current?.scrollTo({ x: targetScrollX, animated: true });
      setScrollX(targetScrollX);
      const targetIndex = Math.round(targetScrollX / cardSpacing);
      setCarouselIndex(targetIndex);
    }
  };

  const handleScroll =
    calculatedCardWidth > 0
      ? (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const x = e.nativeEvent.contentOffset.x;
        const clampedScroll = Math.min(x, maxScroll);
        setScrollX(clampedScroll);

        // Update carousel index based on current scroll position
        const currentIndex = Math.round(clampedScroll / (calculatedCardWidth + cardGap));
        const clampedIndex = Math.max(0, Math.min(currentIndex, items.length - 1));
        setCarouselIndex(clampedIndex);
      }
      : undefined;

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

  const handleMomentumScrollEnd =
    calculatedCardWidth > 0
      ? (e: NativeSyntheticEvent<NativeScrollEvent>) => {
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
      }
      : undefined;

  const disableRightArrow = scrollX >= maxScroll || maxScroll <= 0;
  const disableLeftArrow = scrollX <= 0;

  return (
    <View style={[styles.section, { paddingHorizontal: 0 }]}>
      {' '}
      {/* Remove extra section padding */}
      <View style={styles.sectionHeader}>
        <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
        {onViewAll && (
          <TouchableOpacity onPress={onViewAll}>
            <ThemedText style={styles.viewAllText}>{viewAllText}</ThemedText>
          </TouchableOpacity>
        )}
        {disableLeftArrow && disableRightArrow ? null : (
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <TouchableOpacity
              onPress={handleScrollLeft}
              disabled={disableLeftArrow}
              style={[styles.arrowButton, { opacity: disableLeftArrow ? 0.3 : 1, marginRight: 8 }]}
            >
              <Ionicons name="chevron-back" size={20} color={colors.primaryColor} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleScrollRight}
              disabled={disableRightArrow}
              style={[styles.arrowButton, { opacity: disableRightArrow ? 0.3 : 1 }]}
            >
              <Ionicons name="chevron-forward" size={20} color={colors.primaryColor} />
            </TouchableOpacity>
          </View>
        )}
      </View>
      <View
        style={{ flexDirection: 'row', alignItems: 'center' }}
        onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      >
        <ScrollView
          ref={carouselRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.horizontalScroll}
          contentContainerStyle={{ paddingHorizontal: 16, justifyContent: 'flex-start' }}
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
                <View
                  key={idx}
                  style={{
                    width: calculatedCardWidth,
                    height: 200,
                    backgroundColor: '#f0f0f0',
                    borderRadius: 8,
                  }}
                />
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




