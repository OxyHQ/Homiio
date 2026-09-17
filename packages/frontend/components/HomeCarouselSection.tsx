/**
 * Horizontal carousel used across the home page for properties, cities,
 * and tips. Renders an optional eyebrow label, an H1-sized title and an
 * optional "View all" link above a Bloom `Carousel`.
 *
 * Scrolling, snapping and the prev/next arrows are Bloom's (`@oxy.so/bloom/carousel`);
 * this component only owns the section header and the card width, which it
 * sizes so a whole number of cards (never wider than `maxCardWidth`) fits the
 * row. Arrows show on wide breakpoints only (touch swipe is enough on mobile);
 * dots are off because a row of cards is not a one-slide-at-a-time gallery.
 *
 * Section rhythm is owned entirely by the parent (NativeWind `gap`); this
 * component renders only its header + carousel and carries no outer margin.
 */
import React, { useState } from 'react';
import { View, Pressable } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useMediaQuery } from 'react-responsive';

import { H1, Text as BloomText } from '@oxy.so/bloom/typography';
import { Carousel, CarouselItem } from '@oxy.so/bloom/carousel';

import { gridGap, PAGE_GUTTER_CLASS } from '@/constants/styles';
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
const SKELETON_COUNT = 4;

/** Widest card width at which a whole number of cards fills `trackWidth`. */
function fitCardWidth(trackWidth: number, maxCardWidth: number, itemCount: number): number {
  if (trackWidth <= 0) return maxCardWidth;
  const cardsToFit = Math.max(1, Math.ceil((trackWidth + CARD_GAP) / (maxCardWidth + CARD_GAP)));
  if (itemCount < cardsToFit) return maxCardWidth;
  const exact = (trackWidth - (cardsToFit - 1) * CARD_GAP) / cardsToFit;
  return Math.min(maxCardWidth, Math.floor(exact));
}

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
  const [trackWidth, setTrackWidth] = useState(0);
  const isWide = useMediaQuery({ minWidth: 768 });

  const count = loading ? SKELETON_COUNT : items.length;
  const cardWidth = fitCardWidth(trackWidth, maxCardWidth, count);
  // Arrows only earn their row when the cards actually overflow the track.
  const overflows = trackWidth > 0 && count * cardWidth + (count - 1) * CARD_GAP > trackWidth + 1;

  return (
    <Animated.View entering={FadeInDown.duration(420)}>
      <View className={`mb-4 flex-row items-end justify-between gap-4 ${PAGE_GUTTER_CLASS}`}>
        <View className="min-w-0 flex-1 shrink">
          {eyebrow ? <SectionEyebrow>{eyebrow}</SectionEyebrow> : null}
          <H1
            className="text-[26px] font-bold leading-8 tracking-tight text-foreground"
          >
            {title}
          </H1>
        </View>
        {onViewAll ? (
          <Pressable onPress={onViewAll} hitSlop={8} accessibilityRole="button">
            <BloomText className="text-sm font-semibold underline text-foreground">
              {viewAllText}
            </BloomText>
          </Pressable>
        ) : null}
      </View>
      <View className={PAGE_GUTTER_CLASS}>
        {/* Measured inside the gutter, so the width is the track's own. */}
        <View onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}>
          {!loading && items.length === 0 && emptyText ? (
            <View className="py-2">
              <BloomText className="text-sm text-muted-foreground">{emptyText}</BloomText>
            </View>
          ) : (
            <Carousel
              accessibilityLabel={title}
              gap={CARD_GAP}
              showDots={false}
              showArrows={isWide && overflows}
            >
              {loading
                ? Array.from({ length: SKELETON_COUNT }).map((_, idx) => (
                  <CarouselItem key={`skeleton-${idx}`} width={cardWidth}>
                    <View className="h-[200px] rounded-2xl bg-muted" />
                  </CarouselItem>
                ))
                : items.map((item, idx) => (
                  <CarouselItem key={idx} width={cardWidth}>
                    {renderItem(item, idx)}
                  </CarouselItem>
                ))}
            </Carousel>
          )}
        </View>
      </View>
    </Animated.View>
  );
}
