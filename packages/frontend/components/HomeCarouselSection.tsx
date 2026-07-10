/**
 * Horizontal carousel used across the home page for properties, cities,
 * and tips. Renders an optional eyebrow label, an H1-sized title, an
 * optional "View all" link, and a snap-to-card horizontal scroller with
 * left/right arrow controls that only appear when the content overflows
 * on wide breakpoints (hidden on mobile — touch swipe is enough there).
 *
 * Section rhythm is owned entirely by the parent (NativeWind `gap`); this
 * component renders only its header + scroller and carries no outer margin.
 */
import React, { useRef, useState } from 'react';
import {
  View,
  TouchableOpacity,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMediaQuery } from 'react-responsive';

import { H1, Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { cardShadow, gridGap, spacing, tracker } from '@/constants/styles';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';

interface HomeCarouselSectionProps<T> {
  /** Optional small uppercase label above the title (Airbnb-2026 pattern). */
  eyebrow?: string;
  title: string;
  items: T[];
  loading: boolean;
  /** Shown below the header when loading is false and `items` is empty. */
  emptyText?: string;
  renderItem: (item: T, idx: number) => React.ReactNode;
  onViewAll?: () => void;
  viewAllText?: string;
  minItemsToShow?: number;
  maxCardWidth?: number;
}

const CARD_GAP = gridGap.normal;
const HORIZONTAL_PADDING = spacing['2xl'] * 2;

export function HomeCarouselSection<T>({
  eyebrow,
  title,
  items,
  loading,
  emptyText,
  renderItem,
  onViewAll,
  viewAllText = 'View All',
  minItemsToShow: _minItemsToShow = 2,
  maxCardWidth = 220,
}: HomeCarouselSectionProps<T>) {
  const carouselRef = useRef<ScrollView>(null);
  const [_carouselIndex, setCarouselIndex] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollX, setScrollX] = useState(0);
  const [_isDragging, setIsDragging] = useState(false);
  const isWide = useMediaQuery({ minWidth: 768 });

  let calculatedCardWidth = maxCardWidth;

  if (containerWidth > 0) {
    const availableWidth = Math.max(0, containerWidth - HORIZONTAL_PADDING);
    const minCardsToFit = Math.max(
      1,
      Math.ceil((availableWidth + CARD_GAP) / (maxCardWidth + CARD_GAP)),
    );

    if (items.length >= minCardsToFit) {
      const totalGaps = (minCardsToFit - 1) * CARD_GAP;
      const exactWidth = (availableWidth - totalGaps) / minCardsToFit;
      calculatedCardWidth = Math.min(maxCardWidth, Math.floor(exactWidth));
    } else {
      calculatedCardWidth = maxCardWidth;
    }
  }

  const totalCardsWidth = items.length * calculatedCardWidth + (items.length - 1) * CARD_GAP;
  const availableScrollWidth = containerWidth - HORIZONTAL_PADDING;
  const maxScroll = Math.max(0, totalCardsWidth - availableScrollWidth);
  const itemsPerPage =
    containerWidth > 0
      ? Math.floor((availableScrollWidth + CARD_GAP) / (calculatedCardWidth + CARD_GAP))
      : 1;

  const snapToNearestCard = (currentScrollX: number) => {
    if (calculatedCardWidth <= 0) return 0;

    const cardSpacing = calculatedCardWidth + CARD_GAP;
    const nearestIndex = Math.round(currentScrollX / cardSpacing);
    const clampedIndex = Math.max(0, Math.min(nearestIndex, items.length - 1));
    const targetScrollX = clampedIndex * cardSpacing;

    return Math.min(targetScrollX, maxScroll);
  };

  const handleScrollLeft = () => {
    if (!disableLeftArrow) {
      const cardSpacing = calculatedCardWidth + CARD_GAP;
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
      const cardSpacing = calculatedCardWidth + CARD_GAP;
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

        const currentIndex = Math.round(clampedScroll / (calculatedCardWidth + CARD_GAP));
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

    const snappedScrollX = snapToNearestCard(clampedScroll);

    if (Math.abs(snappedScrollX - clampedScroll) > 2) {
      carouselRef.current?.scrollTo({ x: snappedScrollX, animated: true });
      setScrollX(snappedScrollX);
    } else {
      setScrollX(clampedScroll);
    }

    const snappedIndex = Math.round(snappedScrollX / (calculatedCardWidth + CARD_GAP));
    const clampedIndex = Math.max(0, Math.min(snappedIndex, items.length - 1));
    setCarouselIndex(clampedIndex);
  };

  const handleMomentumScrollEnd =
    calculatedCardWidth > 0
      ? (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const x = e.nativeEvent.contentOffset.x;
        const clampedScroll = Math.min(x, maxScroll);

        const snappedScrollX = snapToNearestCard(clampedScroll);

        if (Math.abs(snappedScrollX - clampedScroll) > 1) {
          carouselRef.current?.scrollTo({ x: snappedScrollX, animated: true });
          setScrollX(snappedScrollX);
        } else {
          setScrollX(clampedScroll);
        }

        const snappedIndex = Math.round(snappedScrollX / (calculatedCardWidth + CARD_GAP));
        const clampedIndex = Math.max(0, Math.min(snappedIndex, items.length - 1));
        setCarouselIndex(clampedIndex);
      }
      : undefined;

  const disableRightArrow = scrollX >= maxScroll || maxScroll <= 0;
  const disableLeftArrow = scrollX <= 0;

  return (
    <View>
      <View className="mb-4 flex-row items-end justify-between gap-4 px-4">
        <View className="min-w-0 flex-1 shrink">
          {eyebrow ? <SectionEyebrow>{eyebrow}</SectionEyebrow> : null}
          <H1
            className="text-[26px] font-bold leading-8 text-foreground"
            style={{ letterSpacing: tracker.tight }}
          >
            {title}
          </H1>
        </View>
        <View className="flex-row items-center gap-3">
          {onViewAll && (
            <TouchableOpacity onPress={onViewAll} hitSlop={8}>
              <BloomText className="text-sm font-semibold underline text-foreground">
                {viewAllText}
              </BloomText>
            </TouchableOpacity>
          )}
          {isWide && !(disableLeftArrow && disableRightArrow) ? (
            <View className="flex-row items-center gap-2">
              <TouchableOpacity
                onPress={handleScrollLeft}
                disabled={disableLeftArrow}
                className="h-8 w-8 items-center justify-center rounded-full bg-white"
                style={[cardShadow.sm, { opacity: disableLeftArrow ? 0.3 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Scroll left"
              >
                <Ionicons name="chevron-back" size={16} color={colors.primaryColor} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleScrollRight}
                disabled={disableRightArrow}
                className="h-8 w-8 items-center justify-center rounded-full bg-white"
                style={[cardShadow.sm, { opacity: disableRightArrow ? 0.3 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Scroll right"
              >
                <Ionicons name="chevron-forward" size={16} color={colors.primaryColor} />
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>
      <View
        className="flex-row items-center"
        onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      >
        {!loading && items.length === 0 && emptyText ? (
          <View className="px-4 py-2">
            <BloomText className="text-sm text-muted-foreground">{emptyText}</BloomText>
          </View>
        ) : (
          <ScrollView
            ref={carouselRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            className="flex-row"
            contentContainerClassName="justify-start px-4"
            scrollEnabled={true}
            onScrollBeginDrag={handleScrollBeginDrag}
            onScrollEndDrag={handleScrollEndDrag}
            onMomentumScrollEnd={handleMomentumScrollEnd}
            onScroll={handleScroll}
            scrollEventThrottle={8}
            decelerationRate={0.8}
            snapToInterval={calculatedCardWidth + CARD_GAP}
            snapToAlignment="start"
            bounces={false}
          >
            <View className="flex-row" style={{ gap: CARD_GAP }}>
              {loading
                ? Array.from({ length: 4 }).map((_, idx) => (
                  <View
                    key={idx}
                    className="h-[200px] rounded-2xl bg-muted"
                    style={{ width: calculatedCardWidth }}
                  />
                ))
                : items.map((item, idx) => (
                  <View key={idx} style={{ width: calculatedCardWidth }}>
                    {renderItem(item, idx)}
                  </View>
                ))}
            </View>
          </ScrollView>
        )}
      </View>
    </View>
  );
}
