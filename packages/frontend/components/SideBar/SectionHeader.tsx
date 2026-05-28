import React from 'react';
import { View, Pressable } from 'react-native';
import { Text } from '@oxyhq/bloom/typography';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';

interface SectionHeaderProps {
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  /** Optional action button on the right (e.g. "+" to create). */
  action?: React.ReactNode;
}

/**
 * Collapsible section header used for the "Saved Folders" and "Recently
 * viewed" sections. The chevron is a single icon that rotates between 0°
 * (open) and -90° (closed) — mirrors Clarity's single-icon transform.
 */
export const SectionHeader = React.memo(function SectionHeader({
  label,
  isOpen,
  onToggle,
  action,
}: SectionHeaderProps) {
  if (action) {
    return (
      <View className="flex-row items-center pt-4 pb-1 mx-1">
        <Pressable
          onPress={onToggle}
          className="flex-1 px-3 cursor-pointer"
          accessibilityRole="button"
          accessibilityLabel={`Toggle ${label}`}
        >
          <View className="inline-flex flex-row items-center gap-2">
            <Ionicons
              name="chevron-down"
              size={12}
              color={colors.primaryDark}
              style={{
                transform: [{ rotate: isOpen ? '0deg' : '-90deg' }],
              }}
            />
            <Text
              className="select-none"
              style={{
                fontSize: 12,
                fontWeight: '600',
                color: colors.primaryDark,
              }}
            >
              {label}
            </Text>
          </View>
        </Pressable>
        <View className="pr-3">{action}</View>
      </View>
    );
  }

  return (
    <Pressable
      onPress={onToggle}
      className="pt-4 pb-1 px-3 w-full mx-1 cursor-pointer"
      accessibilityRole="button"
      accessibilityLabel={`Toggle ${label}`}
    >
      <View className="inline-flex flex-row items-center gap-2">
        <Ionicons
          name="chevron-down"
          size={12}
          color={colors.primaryDark}
          style={{
            transform: [{ rotate: isOpen ? '0deg' : '-90deg' }],
          }}
        />
        <Text
          className="select-none"
          style={{
            fontSize: 12,
            fontWeight: '600',
            color: colors.primaryDark,
          }}
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
});
