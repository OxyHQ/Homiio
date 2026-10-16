/**
 * A photo call-to-action card: headline, one line of copy and a Bloom button
 * over a bottom scrim, with an optional reassurance line under the button.
 * The caller lays it out (full width, or `flex-1` beside a sibling).
 *
 * The card itself is not pressable — only the button is — so web never renders
 * a nested `<button>`. The photo zooms inside the card on hover (web).
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { InverseButton } from '@oxy.so/bloom/button';
import { Text } from '@oxy.so/bloom/typography';

import { ZoomableImage } from '@/components/ui/ZoomableImage';

interface CtaBannerProps {
  title: string;
  subtitle: string;
  ctaLabel: string;
  imageUrl: string;
  onPress: () => void;
  /** Small reassurance line under the button (e.g. "No license needed."). */
  trustLine?: string;
}

export function CtaBanner({
  title,
  subtitle,
  ctaLabel,
  imageUrl,
  onPress,
  trustLine,
}: CtaBannerProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <View
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="min-h-[240px] flex-1 justify-end overflow-hidden rounded-3xl bg-muted"
    >
      <ZoomableImage active={hovered} style={StyleSheet.absoluteFill}>
        <Image
          source={{ uri: imageUrl }}
          className="absolute inset-0"
          contentFit="cover"
          transition={250}
          cachePolicy="memory-disk"
        />
      </ZoomableImage>
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.75)']}
        locations={[0.2, 1]}
        className="absolute inset-0"
        style={{ pointerEvents: 'none' }}
      />
      <View className="items-start gap-1 p-5">
        <Text className="text-title-2-bold text-white" numberOfLines={2}>
          {title}
        </Text>
        <Text className="text-body-2-regular text-white/90" numberOfLines={2}>
          {subtitle}
        </Text>
        <View className="mt-2">
          <InverseButton size="md" onPress={onPress}>
            {ctaLabel}
          </InverseButton>
        </View>
        {trustLine ? (
          <Text className="text-caption-1-regular text-white/80">{trustLine}</Text>
        ) : null}
      </View>
    </View>
  );
}
