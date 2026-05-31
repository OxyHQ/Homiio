import React from 'react';
import { View, Pressable, Platform } from 'react-native';
import { Text } from '@oxyhq/bloom/typography';
import { Home, CalendarDays, Tag, Repeat } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { colors } from '@/styles/colors';
import { useRentalMode } from '@/context/RentalModeContext';
import type { BrowseMode } from '@/components/search/types';

const ANIM_CONFIG = { duration: 200 } as const;
const ROW_HEIGHT = 32;

/**
 * The four top-level browse rows, in display order. The two rent sub-modes
 * (Long-term, Vacation) sit first so the existing rent distinction stays
 * visible; Buy and Exchange are added as peers. The row index drives the
 * sliding indicator's `translateY`.
 */
interface ModeRow {
  mode: BrowseMode;
  icon: LucideIcon;
  labelKey: string;
  labelFallback: string;
  shortcut: string;
}

const MODE_ROWS: readonly ModeRow[] = [
  { mode: 'long_term', icon: Home, labelKey: 'sidebar.mode.longTerm', labelFallback: 'Long-term', shortcut: '1' },
  { mode: 'vacation', icon: CalendarDays, labelKey: 'sidebar.mode.vacation', labelFallback: 'Vacation', shortcut: '2' },
  { mode: 'buy', icon: Tag, labelKey: 'sidebar.mode.buy', labelFallback: 'Buy', shortcut: '3' },
  { mode: 'exchange', icon: Repeat, labelKey: 'sidebar.mode.exchange', labelFallback: 'Exchange', shortcut: '4' },
] as const;

interface ModeRowButtonProps {
  row: ModeRow;
  active: boolean;
  onSelect: (mode: BrowseMode) => void;
}

/**
 * A single tappable browse row. Extracted as its own component (rather than a
 * `.map()` body) so each row can keep the web hover affordance local — and so
 * no hook runs inside a loop. Sits ABOVE the sliding indicator; the active row
 * reads against the light indicator card via the brand-dark text/icon color.
 */
const ModeRowButton = React.memo(function ModeRowButton({
  row,
  active,
  onSelect,
}: ModeRowButtonProps) {
  const { t } = useTranslation();
  const Icon = row.icon;
  const label = t(row.labelKey, { defaultValue: row.labelFallback });
  const color = active ? colors.primaryDark : colors.primaryDark_2;
  const handlePress = React.useCallback(() => onSelect(row.mode), [onSelect, row.mode]);

  return (
    <Pressable
      onPress={handlePress}
      className="group/toggle flex-row items-center justify-start w-full h-8 shrink-0 relative cursor-pointer gap-1"
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <View className="items-center justify-center shrink-0" style={{ width: ROW_HEIGHT }}>
        <Icon size={18} color={color} />
      </View>
      <Text className="select-none" style={{ fontSize: 14, flex: 1, color }}>
        {label}
      </Text>
      {Platform.OS === 'web' && (
        <View className="opacity-0 group-hover/toggle:opacity-100">
          <Text
            className="select-none"
            style={{ marginRight: 16, fontSize: 10, color: colors.primaryDark_2 }}
          >
            {'⌥⌃'}
            {row.shortcut}
          </Text>
        </View>
      )}
    </Pressable>
  );
});

/**
 * Vertical segmented control in the sidebar header. A sliding "card" indicator
 * animates between the four browse rows (Long-term, Vacation, Buy, Exchange)
 * via `translateY` so no row re-mounts. The selection drives the global
 * {@link useRentalMode} browse mode, which routes straight into the same
 * `intent` + `rentMode` the search already filters on.
 *
 * Mirrors Clarity's segmented-toggle dimensions and animation parameters: 4px
 * outer padding, 32px row height, rounded-12px track, rounded-8px indicator,
 * 200ms timing.
 */
export const ModeToggle = React.memo(function ModeToggle() {
  const { browseMode, setBrowseMode } = useRentalMode();

  const activeIndex = Math.max(
    0,
    MODE_ROWS.findIndex((row) => row.mode === browseMode),
  );

  const indicatorY = useSharedValue(activeIndex * ROW_HEIGHT);

  React.useEffect(() => {
    indicatorY.value = withTiming(activeIndex * ROW_HEIGHT, ANIM_CONFIG);
  }, [activeIndex, indicatorY]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: indicatorY.value }],
  }));

  return (
    <View style={{ padding: 4, position: 'relative' }}>
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: colors.COLOR_BLACK_LIGHT_7,
          borderRadius: 12,
        }}
      />

      <Animated.View
        style={[
          {
            position: 'absolute',
            left: 4,
            right: 4,
            top: 4,
            height: ROW_HEIGHT,
            backgroundColor: colors.primaryLight,
            borderRadius: 8,
          },
          indicatorStyle,
        ]}
      />

      <View className="flex-col">
        {MODE_ROWS.map((row) => (
          <ModeRowButton
            key={row.mode}
            row={row}
            active={row.mode === browseMode}
            onSelect={setBrowseMode}
          />
        ))}
      </View>
    </View>
  );
});
