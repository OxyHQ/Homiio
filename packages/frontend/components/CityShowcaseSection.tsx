/**
 * City showcase — Airbnb-2026 inspired horizontal row of large city image
 * cards. Each card is a single photo with the city name overlaid in the
 * bottom-left corner under a soft scrim. Tap routes to a city-scoped
 * search.
 *
 * This sits on the home page between the property carousel and the
 * featured grid; it answers the visual question "what does this region look
 * like right now?" without leaning on long-form copy.
 *
 * Cities + photos are DB-sourced: each {@link City} carries a self-hosted cover
 * image (`coverImageId.urls`, stored in our own object storage at seed time) and
 * its populated region/country names. expo-image caches the photos aggressively
 * so re-renders feel instant; when a city has no cover image the gradient
 * fallback inherited from the underlying View shows through.
 */
import React, { useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useMediaQuery } from 'react-responsive';

import { H1, Text as BloomText } from '@oxyhq/bloom/typography';
import type { City } from '@homiio/shared-types';

import { colors } from '@/styles/colors';
import { textShadow } from '@/styles/shadows';
import { cardShadow, gridGap, PAGE_GUTTER_CLASS, pagePadding, radius, spacing, tracker } from '@/constants/styles';
import { cityRegionName, getCityImageSource } from '@/utils/cityDisplay';
import { ZoomableImage } from '@/components/ui/ZoomableImage';

interface CityShowcaseSectionProps {
  title: string;
  /** DB cities to showcase (each with populated region + cover image). */
  items: readonly City[];
  onPressCity: (city: City) => void;
}

const CARD_GAP = gridGap.normal;

export function CityShowcaseSection({ title, items, onPressCity }: CityShowcaseSectionProps) {
  const isWide = useMediaQuery({ minWidth: 768 });
  const isXL = useMediaQuery({ minWidth: 1280 });
  const pageGutter = isWide ? pagePadding.desktop : pagePadding.mobile;
  const { width: windowWidth } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [scrollX, setScrollX] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);

  /**
   * Card width adapts to viewport: tall portrait tiles on wide screens
   * (so 3 fit comfortably) and a narrower swipeable rail on mobile.
   * Aspect ratio is 3:4 — gives cities room to "breathe" vertically.
   */
  const cardWidth = isXL ? 360 : isWide ? Math.min(320, Math.max(260, windowWidth * 0.24)) : 240;
  const cardHeight = Math.round(cardWidth * 1.25);

  const totalContentWidth = items.length * cardWidth + (items.length - 1) * CARD_GAP;
  const maxScroll = Math.max(0, totalContentWidth - containerWidth + pageGutter * 2);
  const canScrollLeft = scrollX > 4;
  const canScrollRight = scrollX < maxScroll - 4;

  const scrollByPage = (direction: 'left' | 'right') => {
    const delta = (cardWidth + CARD_GAP) * (direction === 'left' ? -1 : 1);
    const next = Math.max(0, Math.min(maxScroll, scrollX + delta));
    scrollRef.current?.scrollTo({ x: next, animated: true });
    setScrollX(next);
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setScrollX(e.nativeEvent.contentOffset.x);
  };

  return (
    <View className="w-full">
      <View className={`mb-4 flex-row items-end justify-between gap-4 ${PAGE_GUTTER_CLASS}`}>
        <H1 className="min-w-0 flex-1 shrink text-[26px] font-bold leading-8 tracking-tight text-foreground">
          {title}
        </H1>
        {isWide && (canScrollLeft || canScrollRight) ? (
          <View className="flex-row items-center gap-2">
            <Pressable
              onPress={() => scrollByPage('left')}
              disabled={!canScrollLeft}
              className="h-8 w-8 items-center justify-center rounded-full bg-white"
              style={[cardShadow.sm, { opacity: canScrollLeft ? 1 : 0.3 }]}
              accessibilityRole="button"
              accessibilityLabel="Scroll left"
            >
              <Ionicons name="chevron-back" size={16} color={colors.primaryColor} />
            </Pressable>
            <Pressable
              onPress={() => scrollByPage('right')}
              disabled={!canScrollRight}
              className="h-8 w-8 items-center justify-center rounded-full bg-white"
              style={[cardShadow.sm, { opacity: canScrollRight ? 1 : 0.3 }]}
              accessibilityRole="button"
              accessibilityLabel="Scroll right"
            >
              <Ionicons name="chevron-forward" size={16} color={colors.primaryColor} />
            </Pressable>
          </View>
        ) : null}
      </View>

      <View
        className="w-full"
        onLayout={(e) => setContainerWidth(e.nativeEvent.layout.width)}
      >
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={cardWidth + CARD_GAP}
          snapToAlignment="start"
          onScroll={handleScroll}
          scrollEventThrottle={16}
          contentContainerClassName={PAGE_GUTTER_CLASS}
        >
          <View className="flex-row gap-4">
            {items.map((city) => (
              <CityCard
                key={city._id}
                city={city}
                width={cardWidth}
                height={cardHeight}
                onPress={() => onPressCity(city)}
              />
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

interface CityCardProps {
  city: City;
  width: number;
  height: number;
  onPress: () => void;
}

const CityCard: React.FC<CityCardProps> = ({ city, width, height, onPress }) => {
  const [pressed, setPressed] = useState(false);
  const imageSource = getCityImageSource(city, 'large');
  // Subtitle: the city's region (e.g. "Catalonia"), resolved from the populated
  // region ref. Falls back to a short property-count line when no region name.
  const subtitle =
    cityRegionName(city) ||
    (typeof city.propertiesCount === 'number' && city.propertiesCount > 0
      ? `${city.propertiesCount} homes`
      : undefined);

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      accessibilityRole="button"
      accessibilityLabel={`Explore homes in ${city.name}`}
      style={[styles.card, { width, height }]}
    >
      {/* The photo zooms inside the card's rounded mask on hover/press; the card
          itself never moves. Scrim + copy are siblings, so they stay put. */}
      <ZoomableImage active={pressed} style={styles.cardMedia}>
        {imageSource ? (
          <Image
            source={imageSource}
            style={styles.cardImage}
            contentFit="cover"
            transition={200}
            cachePolicy="memory-disk"
          />
        ) : (
          <LinearGradient
            colors={[colors.primaryColor, colors.secondaryLight]}
            style={[styles.cardImage, { pointerEvents: 'none' }]}
          />
        )}
      </ZoomableImage>
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']}
        locations={[0.4, 1]}
        style={[styles.cardScrim, { pointerEvents: 'none' }]}
      />
      <View style={styles.cardCopy}>
        <BloomText style={styles.cardCity}>{city.name}</BloomText>
        {subtitle ? (
          <BloomText style={styles.cardSubtitle} numberOfLines={1}>
            {subtitle}
          </BloomText>
        ) : null}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    position: 'relative',
    borderRadius: radius.photo,
    overflow: 'hidden',
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  // The masked zoom wrapper fills the card so the photo scales inside the
  // rounded corners; the scrim and copy sit above it as siblings.
  cardMedia: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  cardImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  cardScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  cardCopy: {
    position: 'absolute',
    bottom: spacing.xl,
    left: spacing.xl,
    right: spacing.xl,
    gap: 2,
  },
  cardCity: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.white,
    letterSpacing: tracker.tight,
    textShadow: textShadow({ y: 1, blur: 4, color: 'rgba(0, 0, 0, 0.35)' }),
  },
  cardSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.92)',
    textShadow: textShadow({ y: 1, blur: 3, color: 'rgba(0, 0, 0, 0.35)' }),
  },
});
