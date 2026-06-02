/**
 * SearchActionPill — a labelled pill button for the search results top bar
 * (Filters / Sort / Save). Shares the Airbnb-2026 pill language with
 * `SearchSummaryBar`: hairline-bordered, surface-filled, icon + label, with a
 * clear *active* state (primary tint + border) and an optional count badge.
 *
 * Three visual states:
 *  - Idle: surface background, hairline border, neutral icon + label.
 *  - Active: primary-subtle fill, primary border, primary icon + label — used
 *    when the control carries a non-default value (filters applied, a non-
 *    default sort, or an already-saved search).
 *  - Pressed/hovered: a slightly darker overlay, driven by state (NativeWind's
 *    css-interop swallows React Native's function-form `style`, so we never use
 *    it — see `SearchSummaryBar` for the canonical note).
 *
 * `count` renders a small badge over the icon (e.g. the number of active
 * filters); `>99` collapses to `99+`.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { shadowToken } from '@/styles/shadows';
import { hairline, radius, spacing, tracker } from '@/constants/styles';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const ICON_SIZE = 16;
const COUNT_CAP = 99;

interface SearchActionPillProps {
  label: string;
  /** Icon name; switches with `active` when an `activeIcon` is supplied. */
  icon: IoniconName;
  /** Optional filled-state icon (e.g. `bookmark` when saved). */
  activeIcon?: IoniconName;
  /** Drives the primary-tinted active treatment. */
  active?: boolean;
  /** Optional count badge over the icon (active-filter count). Hidden when `<= 0`. */
  count?: number;
  onPress: () => void;
  accessibilityLabel: string;
}

export const SearchActionPill: React.FC<SearchActionPillProps> = ({
  label,
  icon,
  activeIcon,
  active = false,
  count,
  onPress,
  accessibilityLabel,
}) => {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);

  const iconName = active && activeIcon ? activeIcon : icon;
  const tint = active ? colors.primaryColor : colors.COLOR_BLACK;
  const showCount = typeof count === 'number' && count > 0;

  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.pill,
        active ? styles.pillActive : null,
        (pressed || hovered) ? styles.pillPressed : null,
        (pressed || hovered) && active ? styles.pillPressedActive : null,
      ]}
    >
      <View style={styles.iconWrap}>
        <Ionicons name={iconName} size={ICON_SIZE} color={tint} />
        {showCount ? (
          <View style={styles.countBadge}>
            <BloomText style={styles.countText}>
              {count > COUNT_CAP ? `${COUNT_CAP}+` : count}
            </BloomText>
          </View>
        ) : null}
      </View>
      <BloomText
        style={[styles.label, active ? styles.labelActive : null]}
        numberOfLines={1}
      >
        {label}
      </BloomText>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: hairline.width,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  pillActive: {
    borderColor: colors.primaryColor,
    backgroundColor: colors.primaryLight_1,
  },
  pillPressed: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_8,
  },
  pillPressedActive: {
    // Keep the primary identity while pressed; just deepen slightly.
    backgroundColor: colors.primaryLight_2,
  },
  iconWrap: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    letterSpacing: tracker.wide,
  },
  labelActive: {
    color: colors.primaryColor,
  },
  countBadge: {
    position: 'absolute',
    top: -8,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primaryColor,
    ...shadowToken({ y: 1, blur: 2, color: colors.COLOR_BLACK, opacity: 0.18, elevation: 2 }),
  },
  countText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.primaryForeground,
    lineHeight: 13,
  },
});

export default SearchActionPill;
