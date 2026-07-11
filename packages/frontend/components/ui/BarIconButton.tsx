/**
 * BarIconButton — the ONE reusable circular header/bar icon button (back, share,
 * viewings, host, …). Flat + transparent with a pressed/hover tint, matching the
 * property sticky bar. Consumes the shared `barIconButton` / `barIconButtonPressed`
 * / `barIconSize` tokens so no screen hand-rolls this chrome again.
 *
 * Owns its own pressed + web-hover state via a STATIC style array — never the
 * NativeWind-incompatible function-form `style` (AGENTS.md §NativeWind Pressable).
 * It's a standalone component, so it is safe to render inside a `.map` / a
 * component array (each instance owns its own hooks).
 */
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '@/styles/colors';
import { barIconButton, barIconButtonPressed, barIconSize } from '@/constants/styles';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const IS_WEB = Platform.OS === 'web';

interface BarIconButtonProps {
  icon: IoniconName;
  onPress: () => void;
  accessibilityLabel: string;
  /** Glyph size. Defaults to the shared `barIconSize` (20). */
  size?: number;
  /** Glyph colour. Defaults to the standard bar icon black. */
  color?: string;
  disabled?: boolean;
  /** Optional overlay pinned over the icon (e.g. a status checkmark badge). */
  badge?: React.ReactNode;
}

export const BarIconButton: React.FC<BarIconButtonProps> = ({
  icon,
  onPress,
  accessibilityLabel,
  size = barIconSize,
  color = colors.COLOR_BLACK,
  disabled = false,
  badge,
}) => {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const active = pressed || hovered;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onHoverIn={IS_WEB ? () => setHovered(true) : undefined}
      onHoverOut={IS_WEB ? () => setHovered(false) : undefined}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={[barIconButton, active && barIconButtonPressed]}
    >
      {badge ? (
        <View style={styles.badgeWrap}>
          <Ionicons name={icon} size={size} color={color} />
          {badge}
        </View>
      ) : (
        <Ionicons name={icon} size={size} color={color} />
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  badgeWrap: {
    position: 'relative',
  },
});

export default BarIconButton;
