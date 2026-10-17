/**
 * IconButton — the ONE app-wide icon-button primitive (headers, bars, on-photo
 * overlays, save hearts, …). A circular button with three chrome variants and a
 * pressed/hover tint. `SaveButton` composes this, so every icon-button site
 * shares one look; future icon buttons reuse it too.
 *
 * Variants:
 *  - `ghost`   flat transparent circle, pressed/hover → `bg-muted` (the shared
 *              header/bar look) — headers, bars.
 *  - `overlay` frosted card-surface circle for on-photo use (card save heart,
 *              gallery).
 *  - `filled`  brand-fill circle with a `primaryForeground` glyph.
 *
 * Owns its own pressed + web-hover state via STATIC class strings — never the
 * NativeWind-incompatible function-form `style` (AGENTS.md §NativeWind Pressable).
 * Standalone component, so it is safe inside a `.map` / a component array.
 */
import type React from 'react';
import { useState } from 'react';
import { Platform, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import type { ButtonIconComponent } from '@oxy.so/bloom/button';
import { Loading } from '@oxy.so/bloom/loading';
import { type ThemeColors, useTheme } from '@oxy.so/bloom/theme';

import { barIconSize } from '@/constants/styles';

type IconButtonVariant = 'ghost' | 'overlay' | 'filled';

const IS_WEB = Platform.OS === 'web';

/** Base chrome per variant. */
const VARIANT_BASE: Record<IconButtonVariant, string> = {
  ghost: 'p-2 rounded-full',
  overlay: 'p-2 rounded-full bg-card/95',
  filled: 'p-2 rounded-full bg-primary',
};

/** Pressed/hovered tint per variant. */
const VARIANT_ACTIVE: Record<IconButtonVariant, string> = {
  ghost: 'bg-muted',
  overlay: 'bg-card',
  filled: 'opacity-90',
};

/** Default glyph colour per variant when the caller doesn't override `color`. */
const VARIANT_ICON_COLOR: Record<IconButtonVariant, keyof ThemeColors> = {
  ghost: 'text',
  overlay: 'text',
  filled: 'primaryForeground',
};

interface IconButtonProps {
  /** A Bloom (Remix) icon component, e.g. `RiShare2Line`. */
  icon: ButtonIconComponent;
  onPress: () => void;
  accessibilityLabel: string;
  onLongPress?: () => void;
  disabled?: boolean;
  variant?: IconButtonVariant;
  /** Glyph size. Defaults to the shared `barIconSize` (20). */
  size?: number;
  /** Glyph colour. Defaults to the variant's default. */
  color?: string;
  /** Toggle-on state (e.g. a saved heart) — swaps the glyph to `activeColor`. */
  active?: boolean;
  activeColor?: string;
  /** Renders a spinner in place of the glyph. */
  loading?: boolean;
  /** Optional overlay pinned over the glyph (status checkmark, count badge, …). */
  badge?: React.ReactNode;
  /** Extra button style (e.g. absolute positioning for an on-photo overlay). */
  style?: StyleProp<ViewStyle>;
}

export const IconButton: React.FC<IconButtonProps> = ({
  icon: Icon,
  onPress,
  accessibilityLabel,
  onLongPress,
  disabled = false,
  variant = 'ghost',
  size = barIconSize,
  color,
  active = false,
  activeColor,
  loading = false,
  badge,
  style,
}) => {
  const { colors } = useTheme();
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const interactive = pressed || hovered;

  const glyphColor =
    active && activeColor ? activeColor : (color ?? colors[VARIANT_ICON_COLOR[variant]]);

  const glyph = loading ? (
    <Loading iconSize={size} color={glyphColor} showText={false} />
  ) : (
    <Icon width={size} height={size} fill={glyphColor} />
  );

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onHoverIn={IS_WEB ? () => setHovered(true) : undefined}
      onHoverOut={IS_WEB ? () => setHovered(false) : undefined}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      className={`${VARIANT_BASE[variant]} ${
        disabled ? 'opacity-60' : interactive ? VARIANT_ACTIVE[variant] : ''
      }`}
      style={style}
    >
      {badge ? (
        <View className="relative">
          {glyph}
          {badge}
        </View>
      ) : (
        glyph
      )}
    </Pressable>
  );
};
