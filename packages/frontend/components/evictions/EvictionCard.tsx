/**
 * EvictionCard — one flat row on the solidarity board.
 *
 * Layout: [ date block ] [ title · location · status + attendees ] [ cover ]
 *
 * The whole card owns ONE hover/press state and feeds `active` to the cover
 * `ZoomableImage` so the photo zooms inside its rounded mask on hover anywhere
 * on the card — the card itself never scales (AGENTS.md §ZoomableImage). Static
 * style arrays + `onPressIn/Out` (never the NativeWind-incompatible function-form
 * `style`); it's its own component, so no hooks run inside the board's `.map`.
 */
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import type { EvictionCase } from '@homiio/shared-types';

import { ZoomableImage } from '@/components/ui/ZoomableImage';
import { resolveBackendImageUrl } from '@/utils/imageUrl';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import { EvictionStatusBadge } from './EvictionStatusBadge';
import { EvictionDateBlock } from './EvictionDateBlock';

const IS_WEB = Platform.OS === 'web';

interface EvictionCardProps {
  eviction: EvictionCase;
  locale: string;
  onPress: () => void;
}

export const EvictionCard: React.FC<EvictionCardProps> = ({ eviction, locale, onPress }) => {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);

  const coverUrl = eviction.coverImage?.url
    ? resolveBackendImageUrl(eviction.coverImage.url)
    : undefined;

  const locationLine = [eviction.location.label, eviction.location.city]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' · ');

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onHoverIn={IS_WEB ? () => setHovered(true) : undefined}
      onHoverOut={IS_WEB ? () => setHovered(false) : undefined}
      accessibilityRole="button"
      accessibilityLabel={eviction.title}
      style={[styles.card, pressed && styles.cardPressed]}
    >
      <EvictionDateBlock scheduledAt={eviction.scheduledAt} locale={locale} />

      <View style={styles.body}>
        <BloomText style={styles.title} numberOfLines={2} ellipsizeMode="tail">
          {eviction.title}
        </BloomText>
        {locationLine ? (
          <View style={styles.locationRow}>
            <Ionicons name="location-outline" size={14} color={colors.textSecondary} />
            <BloomText style={styles.location} numberOfLines={1} ellipsizeMode="tail">
              {locationLine}
            </BloomText>
          </View>
        ) : null}
        <View style={styles.metaRow}>
          <EvictionStatusBadge status={eviction.status} />
          <View style={styles.attendees}>
            <Ionicons name="people-outline" size={14} color={colors.textSecondary} />
            <BloomText style={styles.attendeeCount}>{eviction.attendeeCount}</BloomText>
          </View>
        </View>
      </View>

      {coverUrl ? (
        <ZoomableImage
          borderRadius={radius.md}
          aspectRatio={1}
          active={hovered || pressed}
          style={styles.cover}
        >
          <Image
            source={{ uri: coverUrl }}
            style={styles.coverImage}
            contentFit="cover"
            accessibilityIgnoresInvertColors
          />
        </ZoomableImage>
      ) : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  cardPressed: {
    backgroundColor: colors.mutedSubtle,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: spacing.xs,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  location: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    color: colors.textSecondary,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  attendees: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  attendeeCount: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  cover: {
    width: 72,
    height: 72,
  },
  coverImage: {
    width: '100%',
    height: '100%',
  },
});

export default EvictionCard;
