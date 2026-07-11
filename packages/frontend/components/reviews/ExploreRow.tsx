/**
 * ExploreRow — a single tappable row in the review-explore lists (city →
 * neighborhood → building). Owns its own pressed/hovered state with static style
 * arrays (AGENTS.md §NativeWind Pressable); safe inside a `.map`.
 */
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { hairline, radius, spacing } from '@/constants/styles';

const IS_WEB = Platform.OS === 'web';

interface ExploreRowProps {
  title: string;
  subtitle?: string;
  /** Right-aligned metric (e.g. "4.6 ★"). */
  rightLabel?: string;
  onPress: () => void;
}

export const ExploreRow: React.FC<ExploreRowProps> = ({ title, subtitle, rightLabel, onPress }) => {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onHoverIn={IS_WEB ? () => setHovered(true) : undefined}
      onHoverOut={IS_WEB ? () => setHovered(false) : undefined}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={[styles.row, (pressed || hovered) && styles.rowActive]}
    >
      <View style={styles.text}>
        <BloomText style={styles.title} numberOfLines={1}>
          {title}
        </BloomText>
        {subtitle ? (
          <BloomText style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </BloomText>
        ) : null}
      </View>
      {rightLabel ? <BloomText style={styles.rightLabel}>{rightLabel}</BloomText> : null}
      <Ionicons name="chevron-forward" size={18} color={colors.COLOR_BLACK_LIGHT_4} />
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: hairline.width,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    backgroundColor: colors.surfaceElevated,
  },
  rowActive: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  subtitle: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  rightLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
});

export default ExploreRow;
