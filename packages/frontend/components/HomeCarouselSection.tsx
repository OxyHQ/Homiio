/**
 * Horizontal carousel used across the home page for properties, cities,
 * and tips. Renders an optional eyebrow label, an H1-sized title, an
 * optional "View all" link, and a snap-to-card horizontal scroller with
 * left/right arrow controls that only appear when the content overflows
 * on wide breakpoints (hidden on mobile — touch swipe is enough there).
 *
 * Section rhythm is owned by the parent — this component renders the
 * scroller and only adds a small bottom margin so consecutive sections
 * still breathe even when no eyebrow is passed.
 */
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
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={styles.headerText}>
          {eyebrow ? <SectionEyebrow>{eyebrow}</SectionEyebrow> : null}
          <H1 style={styles.sectionTitle}>{title}</H1>
        </View>
        <View style={styles.headerActions}>
          {onViewAll && (
            <TouchableOpacity onPress={onViewAll} hitSlop={8}>
              <BloomText style={styles.viewAllText}>{viewAllText}</BloomText>
            </TouchableOpacity>
          )}
          {isWide && !(disableLeftArrow && disableRightArrow) ? (
            <View style={styles.arrowGroup}>
              <TouchableOpacity
                onPress={handleScrollLeft}
                disabled={disableLeftArrow}
                style={[styles.arrowButton, { opacity: disableLeftArrow ? 0.3 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="Scroll left"
              >
                <Ionicons name="chevron-back" size={16} color={colors.primaryColor} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleScrollRight}
                disabled={disableRightArrow}
                style={[styles.arrowButton, { opacity: disableRightArrow ? 0.3 : 1 }]}
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
        style={styles.scrollWrapper}
        onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      >
        <ScrollView
          ref={carouselRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.horizontalScroll}
          contentContainerStyle={styles.horizontalScrollContent}
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
          <View style={styles.rowFlex}>
            {loading
              ? Array.from({ length: 4 }).map((_, idx) => (
                <View
                  key={idx}
                  style={[
                    styles.skeleton,
                    {
                      width: calculatedCardWidth,
                    },
                  ]}
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
    marginBottom: spacing['3xl'],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  headerText: {
    flex: 1,
    flexShrink: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  sectionTitle: {
    fontSize: 26,
    color: colors.COLOR_BLACK,
    fontWeight: '700',
    letterSpacing: tracker.tight,
    lineHeight: 32,
  },
  viewAllText: {
    color: colors.COLOR_BLACK,
    fontWeight: '600',
    fontSize: 14,
    textDecorationLine: 'underline',
  },
  arrowGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  scrollWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  horizontalScroll: {
    flexDirection: 'row',
  },
  horizontalScrollContent: {
    paddingHorizontal: spacing.lg,
    justifyContent: 'flex-start',
  },
  rowFlex: {
    flexDirection: 'row',
    gap: CARD_GAP,
  },
  skeleton: {
    height: 200,
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
    borderRadius: 16,
  },
  arrowButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    ...cardShadow.sm,
  },
});
