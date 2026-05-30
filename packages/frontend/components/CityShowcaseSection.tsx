/**
 * City showcase — Airbnb-2026 inspired horizontal row of large city image
 * cards. Each card is a single photo with the city name overlaid in the
 * bottom-left corner under a soft scrim. Tap routes to a city-scoped
 * search.
 *
 * This sits on the home page between the property carousel and the
 * featured grid; it answers the visual question "what does Spain look
 * like right now?" without leaning on long-form copy.
 *
 * Photos come from the Unsplash open library, queried by city name.
 * Each photo is a 1280-wide JPEG; expo-image caches them aggressively
 * so re-renders feel instant. If the user has no network or a photo
 * 404s, the gradient fallback inherited from the underlying View shows
 * through.
 */
import React, { useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useMediaQuery } from 'react-responsive';

import { H1, Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { cardShadow, gridGap, radius, spacing, tracker } from '@/constants/styles';

export interface CityShowcaseItem {
  id: string;
  name: string;
  subtitle?: string;
  imageUrl: string;
}

interface CityShowcaseSectionProps {
  title: string;
  items: readonly CityShowcaseItem[];
  onPressCity: (item: CityShowcaseItem) => void;
}

const CARD_GAP = gridGap.normal;

export function CityShowcaseSection({ title, items, onPressCity }: CityShowcaseSectionProps) {
  const isWide = useMediaQuery({ minWidth: 768 });
  const isXL = useMediaQuery({ minWidth: 1280 });
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
  const maxScroll = Math.max(0, totalContentWidth - containerWidth + spacing['2xl'] * 2);
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
    <View style={styles.section}>
      <View style={styles.header}>
        <H1 style={styles.title}>{title}</H1>
        {isWide && (canScrollLeft || canScrollRight) ? (
          <View style={styles.arrowGroup}>
            <TouchableOpacity
              onPress={() => scrollByPage('left')}
              disabled={!canScrollLeft}
              style={[styles.arrowButton, { opacity: canScrollLeft ? 1 : 0.3 }]}
              accessibilityRole="button"
              accessibilityLabel="Scroll left"
            >
              <Ionicons name="chevron-back" size={16} color={colors.primaryColor} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => scrollByPage('right')}
              disabled={!canScrollRight}
              style={[styles.arrowButton, { opacity: canScrollRight ? 1 : 0.3 }]}
              accessibilityRole="button"
              accessibilityLabel="Scroll right"
            >
              <Ionicons name="chevron-forward" size={16} color={colors.primaryColor} />
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <View
        style={styles.scrollWrapper}
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
          contentContainerStyle={styles.scrollContent}
        >
          <View style={styles.rowFlex}>
            {items.map((item) => (
              <CityCard
                key={item.id}
                item={item}
                width={cardWidth}
                height={cardHeight}
                onPress={() => onPressCity(item)}
              />
            ))}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}

interface CityCardProps {
  item: CityShowcaseItem;
  width: number;
  height: number;
  onPress: () => void;
}

const CityCard: React.FC<CityCardProps> = ({ item, width, height, onPress }) => {
  const [hovered, setHovered] = useState(false);
  const isWeb = Platform.OS === 'web';

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={`Explore homes in ${item.name}`}
      style={[
        styles.card,
        { width, height },
        hovered && isWeb ? styles.cardHover : null,
      ]}
    >
      <Image
        source={{ uri: item.imageUrl }}
        style={styles.cardImage}
        contentFit="cover"
        transition={200}
        cachePolicy="memory-disk"
      />
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.55)']}
        locations={[0.4, 1]}
        style={styles.cardScrim}
        pointerEvents="none"
      />
      <View style={styles.cardCopy}>
        <BloomText style={styles.cardCity}>{item.name}</BloomText>
        {item.subtitle ? (
          <BloomText style={styles.cardSubtitle} numberOfLines={1}>
            {item.subtitle}
          </BloomText>
        ) : null}
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  section: {
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    paddingHorizontal: spacing['2xl'],
    marginBottom: spacing.lg,
    gap: spacing.lg,
  },
  title: {
    fontSize: 26,
    color: colors.COLOR_BLACK,
    fontWeight: '700',
    letterSpacing: tracker.tight,
    lineHeight: 32,
    flex: 1,
    flexShrink: 1,
  },
  arrowGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  arrowButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    ...cardShadow.sm,
  },
  scrollWrapper: {
    width: '100%',
  },
  scrollContent: {
    paddingHorizontal: spacing['2xl'],
  },
  rowFlex: {
    flexDirection: 'row',
    gap: CARD_GAP,
  },
  card: {
    position: 'relative',
    borderRadius: radius.photo,
    overflow: 'hidden',
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
    ...cardShadow.sm,
  },
  cardHover: {
    transform: [{ scale: 1.01 }],
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
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  cardSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.92)',
    textShadowColor: 'rgba(0, 0, 0, 0.35)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
});
