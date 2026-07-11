/**
 * ReviewTabPill — a sub-tab pill for the address review sections. Owns its own
 * pressed/hovered state with static style arrays (AGENTS.md §NativeWind
 * Pressable); safe inside a `.map`.
 */
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet } from 'react-native';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { hairline, radius, spacing } from '@/constants/styles';

const IS_WEB = Platform.OS === 'web';

interface ReviewTabPillProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

export const ReviewTabPill: React.FC<ReviewTabPillProps> = ({ label, active, onPress }) => {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onHoverIn={IS_WEB ? () => setHovered(true) : undefined}
      onHoverOut={IS_WEB ? () => setHovered(false) : undefined}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={[
        styles.pill,
        active && styles.pillActive,
        !active && (pressed || hovered) && styles.pillHovered,
      ]}
    >
      <BloomText style={[styles.label, active && styles.labelActive]}>{label}</BloomText>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: hairline.width,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    backgroundColor: colors.surfaceElevated,
  },
  pillHovered: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  pillActive: {
    backgroundColor: colors.COLOR_BLACK,
    borderColor: colors.COLOR_BLACK,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  labelActive: {
    color: colors.white,
  },
});

export default ReviewTabPill;
