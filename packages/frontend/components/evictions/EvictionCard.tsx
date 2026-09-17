/**
 * EvictionCard — one flat row on the solidarity board.
 *
 * Layout: [ date block ] [ title · location · status + attendees ] [ cover ]
 *
 * The surface is a pressable Bloom `Card` (it owns the press feedback). On web
 * the wrapper owns ONE `onPointerEnter`/`onPointerLeave` pair and feeds `active`
 * to the cover `ZoomableImage`, so the photo zooms inside its rounded mask on
 * hover anywhere on the card — the card itself never scales (see
 * docs/frontend-conventions.md §ZoomableImage). It's its own component, so no
 * hooks run inside the board's `.map`.
 */
import React, { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Card } from '@oxy.so/bloom/card';
import { RiGroupLine, RiMapPinLine } from '@oxy.so/bloom/icons';
import { Text as BloomText } from '@oxy.so/bloom/typography';
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
  const [hovered, setHovered] = useState(false);

  const coverUrl = eviction.coverImage?.url
    ? resolveBackendImageUrl(eviction.coverImage.url)
    : undefined;

  const locationLine = [eviction.location.label, eviction.location.city]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' · ');

  return (
    <View
      onPointerEnter={IS_WEB ? () => setHovered(true) : undefined}
      onPointerLeave={IS_WEB ? () => setHovered(false) : undefined}
    >
      <Card
        variant="outlined"
        radius="radius-16"
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={eviction.title}
        style={styles.card}
      >
        <EvictionDateBlock scheduledAt={eviction.scheduledAt} locale={locale} />

        <View style={styles.body}>
          <BloomText style={styles.title} numberOfLines={2} ellipsizeMode="tail">
            {eviction.title}
          </BloomText>
          {locationLine ? (
            <View style={styles.inlineRow}>
              <RiMapPinLine width={14} height={14} fill={colors.textSecondary} />
              <BloomText style={styles.location} numberOfLines={1} ellipsizeMode="tail">
                {locationLine}
              </BloomText>
            </View>
          ) : null}
          <View style={styles.metaRow}>
            <EvictionStatusBadge status={eviction.status} />
            <View style={styles.inlineRow}>
              <RiGroupLine width={14} height={14} fill={colors.textSecondary} />
              <BloomText style={styles.attendeeCount}>{eviction.attendeeCount}</BloomText>
            </View>
          </View>
        </View>

        {coverUrl ? (
          <ZoomableImage
            borderRadius={radius.md}
            aspectRatio={1}
            active={hovered}
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
      </Card>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
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
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minWidth: 0,
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
