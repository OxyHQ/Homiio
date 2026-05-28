import React from 'react';
import { View, Pressable, Platform } from 'react-native';
import { Text } from '@oxyhq/bloom/typography';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { colors } from '@/styles/colors';
import { useRentalMode } from '@/context/RentalModeContext';

const ANIM_CONFIG = { duration: 200 } as const;
const ROW_HEIGHT = 32;

/**
 * Vertical two-option segmented control in the sidebar header. A sliding
 * "card" indicator animates between the two rows (Long-term on top,
 * Vacation on bottom) via `translateY` so neither row re-mounts.
 *
 * Mirrors Clarity's Search/Computer toggle dimensions and animation
 * parameters exactly: 4px outer padding, 32px row height, rounded-12px
 * track, rounded-8px indicator, 200ms timing.
 */
export const ModeToggle = React.memo(function ModeToggle() {
  const { t } = useTranslation();
  const { mode, setMode } = useRentalMode();

  const isLongTerm = mode === 'long_term';

  const indicatorY = useSharedValue(isLongTerm ? 0 : ROW_HEIGHT);

  React.useEffect(() => {
    indicatorY.value = withTiming(isLongTerm ? 0 : ROW_HEIGHT, ANIM_CONFIG);
  }, [isLongTerm, indicatorY]);

  const indicatorStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: indicatorY.value }],
  }));

  const handleLongTerm = React.useCallback(
    () => setMode('long_term'),
    [setMode],
  );
  const handleVacation = React.useCallback(
    () => setMode('vacation'),
    [setMode],
  );

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
        <Pressable
          onPress={handleLongTerm}
          className="group/toggle flex-row items-center justify-start w-full h-8 shrink-0 relative cursor-pointer gap-1"
          accessibilityRole="button"
          accessibilityLabel={t('sidebar.mode.longTerm', {
            defaultValue: 'Long-term',
          })}
        >
          <View
            className="items-center justify-center shrink-0"
            style={{ width: ROW_HEIGHT }}
          >
            <Ionicons
              name="business-outline"
              size={16}
              color={isLongTerm ? colors.primaryDark : colors.primaryDark_2}
            />
          </View>
          <Text
            className="select-none"
            style={{
              fontSize: 14,
              flex: 1,
              color: isLongTerm ? colors.primaryDark : colors.primaryDark_2,
            }}
          >
            {t('sidebar.mode.longTerm', { defaultValue: 'Long-term' })}
          </Text>
          {Platform.OS === 'web' && (
            <View className="opacity-0 group-hover/toggle:opacity-100">
              <Text
                className="select-none"
                style={{
                  marginRight: 16,
                  fontSize: 10,
                  color: colors.primaryDark_2,
                }}
              >
                {'⌥⌃'}1
              </Text>
            </View>
          )}
        </Pressable>

        <Pressable
          onPress={handleVacation}
          className="group/toggle flex-row items-center justify-start w-full h-8 shrink-0 relative cursor-pointer gap-1"
          accessibilityRole="button"
          accessibilityLabel={t('sidebar.mode.vacation', {
            defaultValue: 'Vacation',
          })}
        >
          <View
            className="items-center justify-center shrink-0"
            style={{ width: ROW_HEIGHT }}
          >
            <Ionicons
              name="bed-outline"
              size={16}
              color={isLongTerm ? colors.primaryDark_2 : colors.primaryDark}
            />
          </View>
          <Text
            className="select-none"
            style={{
              fontSize: 14,
              flex: 1,
              color: isLongTerm ? colors.primaryDark_2 : colors.primaryDark,
            }}
          >
            {t('sidebar.mode.vacation', { defaultValue: 'Vacation' })}
          </Text>
          {Platform.OS === 'web' && (
            <View className="opacity-0 group-hover/toggle:opacity-100">
              <Text
                className="select-none"
                style={{
                  marginRight: 16,
                  fontSize: 10,
                  color: colors.primaryDark_2,
                }}
              >
                {'⌥⌃'}2
              </Text>
            </View>
          )}
        </Pressable>
      </View>
    </View>
  );
});
