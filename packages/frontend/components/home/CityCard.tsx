/**
 * A destination tile: the city's photo with its name and region, a 4:5
 * portrait that zooms its photo on hover (web) or press (native).
 */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import type { City } from '@homiio/shared-types';

import { colors } from '@/styles/colors';
import { textShadow } from '@/styles/shadows';
import { radius, spacing, tracker } from '@/constants/styles';
import { cityRegionName, getCityImageSource } from '@/utils/cityDisplay';
import { ZoomableImage } from '@/components/ui/ZoomableImage';

interface CityCardProps {
  city: City;
  onPress: () => void;
}

/**
 * Tall 4:5 portrait tile: a narrow swipeable rail on mobile, wider tiles from
 * `md` (so ~3 fit comfortably) and the widest from `xl`.
 */
export function CityCard({ city, onPress }: CityCardProps) {
  const [pressed, setPressed] = useState(false);
  // Hover anywhere on the card zooms its photo (web); press does it on native.
  // `onHoverIn/Out` are Pressable-only + web-only (native ignores them).
  const [hovered, setHovered] = useState(false);
  const imageSource = getCityImageSource(city, 'medium');
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
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={`Explore homes in ${city.name}`}
      className="aspect-[4/5] w-[240px] md:w-[280px] xl:w-[360px]"
      style={styles.card}
    >
      {/* The photo zooms inside the card's rounded mask on hover (anywhere on the
          card) / press; the card itself never moves. Scrim + copy are siblings,
          so they stay put. */}
      <ZoomableImage active={hovered || pressed} style={styles.cardMedia}>
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
}

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
