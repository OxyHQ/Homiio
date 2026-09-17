/**
 * SearchActionPill — a labelled filter pill for listing toolbars (Filters /
 * Sort), built on Bloom `Chip`.
 *
 * `active` is the chip's `selected` state (brand tone) and is used when the
 * control carries a non-default value — filters applied, a non-default sort.
 * `count` overlays a Bloom `Badge` on the pill (the number of active filters);
 * Bloom caps it at `99+`.
 *
 * The icon is a Remix component (`RiEqualizerLine`), not an element, so the
 * pill can colour it to match its own state.
 */
import React from 'react';
import { StyleSheet } from 'react-native';

import { Badge } from '@oxy.so/bloom/badge';
import { Chip } from '@oxy.so/bloom/chip';
import type { ButtonIconComponent } from '@oxy.so/bloom/button';

import { useColors } from '@/hooks/useThemeColor';

const ICON_SIZE = 16;
const COUNT_CAP = 99;

export interface SearchActionPillProps {
  label: string;
  /** Remix icon component; switches to `activeIcon` while `active`. */
  icon: ButtonIconComponent;
  /** Optional filled-state icon (e.g. `RiBookmarkFill` when saved). */
  activeIcon?: ButtonIconComponent;
  /** Drives the selected (brand-tinted) treatment. */
  active?: boolean;
  /** Optional count badge (active-filter count). Hidden when `<= 0`. */
  count?: number;
  onPress?: () => void;
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
  const colors = useColors();
  const Icon = active && activeIcon ? activeIcon : icon;
  const showCount = typeof count === 'number' && count > 0;

  const chip = (
    <Chip
      variant={active ? 'subtle' : 'outlined'}
      size="large"
      selected={active}
      onPress={onPress}
      startIcon={
        <Icon
          width={ICON_SIZE}
          height={ICON_SIZE}
          fill={active ? colors.primarySubtleForeground : colors.text}
        />
      }
      accessibilityLabel={accessibilityLabel}
      style={styles.pill}
    >
      {label}
    </Chip>
  );

  if (!showCount) return chip;
  return (
    <Badge content={count} max={COUNT_CAP} color="primary" variant="solid" size="small">
      {chip}
    </Badge>
  );
};

const styles = StyleSheet.create({
  // A toolbar pill sits beside the 48px search summary, so it is taller and
  // roomier than an inline tag chip.
  pill: {
    height: 36,
    paddingHorizontal: 12,
  },
});

export default SearchActionPill;
