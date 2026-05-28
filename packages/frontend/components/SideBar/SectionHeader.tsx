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
 * Collapsible section header used for the "Saved Folders" and
 * "Recent Properties" sections in the sidebar. A chevron toggles between
 * the open (down) and closed (right) states.
 */
export const SectionHeader = React.memo(function SectionHeader({
  label,
  isOpen,
  onToggle,
  action,
}: SectionHeaderProps) {
  return (
    <View className="flex-row items-center pt-4 pb-1 mx-1">
      <Pressable
        onPress={onToggle}
        className="flex-1 px-3 cursor-pointer"
        accessibilityRole="button"
        accessibilityLabel={`Toggle ${label}`}
      >
        <View className="flex-row items-center gap-2">
          <Ionicons
            name={isOpen ? 'chevron-down' : 'chevron-forward'}
            size={12}
            color={colors.primaryDark}
          />
          <Text
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
      {action ? <View className="pr-3">{action}</View> : null}
    </View>
  );
});
