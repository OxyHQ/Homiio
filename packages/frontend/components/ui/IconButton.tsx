/**
 * IconButton — the ONE app-wide icon-button primitive (headers, bars, on-photo
 * overlays, save hearts, …). A circular button with three chrome variants and a
 * pressed/hover tint. `SaveButton` composes this, so every icon-button site
 * shares one look; future icon buttons reuse it too.
 *
 * Variants:
 *  - `ghost`   flat transparent circle, pressed/hover → `mutedSubtle` bg (the
 *              shared header/bar look) — headers, bars.
 *  - `overlay` frosted-white circle for on-photo use (card save heart, gallery).
 *  - `filled`  brand-fill circle with a `primaryForeground` glyph.
 *
 * Owns its own pressed + web-hover state via STATIC style arrays — never the
 * NativeWind-incompatible function-form `style` (AGENTS.md §NativeWind Pressable).
 * Standalone component, so it is safe inside a `.map` / a component array.
 */
import React, { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Loading } from '@oxyhq/bloom/loading';

import { colors } from '@/styles/colors';
import { barIconButton, barIconButtonPressed, barIconSize, radius, spacing } from '@/constants/styles';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export type IconButtonVariant = 'ghost' | 'overlay' | 'filled';

const IS_WEB = Platform.OS === 'web';

/** Base chrome per variant. `ghost` reuses the shared bar token. */
const VARIANT_BASE: Record<IconButtonVariant, ViewStyle> = {
  ghost: barIconButton,
  overlay: {
    padding: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
  },
  filled: {
    padding: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.primaryColor,
  },
};

/** Pressed/hovered tint per variant. */
const VARIANT_ACTIVE: Record<IconButtonVariant, ViewStyle> = {
  ghost: barIconButtonPressed,
  overlay: { backgroundColor: colors.white },
  filled: { opacity: 0.9 },
};

/** Default glyph colour per variant when the caller doesn't override `color`. */
const VARIANT_ICON_COLOR: Record<IconButtonVariant, string> = {
  ghost: colors.COLOR_BLACK,
  overlay: colors.COLOR_BLACK,
  filled: colors.primaryForeground,
};

interface IconButtonProps {
  icon: IoniconName;
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
  icon,
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
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const interactive = pressed || hovered;

  const glyphColor = active && activeColor
    ? activeColor
    : color ?? VARIANT_ICON_COLOR[variant];

  const glyph = loading ? (
    <Loading iconSize={size} color={glyphColor} showText={false} />
  ) : (
    <Ionicons name={icon} size={size} color={glyphColor} />
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
      style={[
        VARIANT_BASE[variant],
        interactive && !disabled ? VARIANT_ACTIVE[variant] : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      {badge ? (
        <View style={styles.badgeWrap}>
          {glyph}
          {badge}
        </View>
      ) : (
        glyph
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  badgeWrap: {
    position: 'relative',
  },
  disabled: {
    opacity: 0.6,
  },
});

export default IconButton;
