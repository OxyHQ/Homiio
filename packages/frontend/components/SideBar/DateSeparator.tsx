import React from 'react';
import { View } from 'react-native';
import { Text } from '@oxyhq/bloom/typography';
import { colors } from '@/styles/colors';

interface DateSeparatorProps {
  label: string;
}

/**
 * Inline label + hairline divider used to group time-sorted lists
 * (Today / Yesterday / Earlier) inside the sidebar's scrollable area.
 */
export const DateSeparator = React.memo(function DateSeparator({
  label,
}: DateSeparatorProps) {
  return (
    <View className="flex-row items-center gap-2 pt-3 pb-1 px-3 mx-1">
      <Text
        style={{
          fontSize: 11,
          color: colors.primaryDark_2,
        }}
      >
        {label}
      </Text>
      <View className="h-px bg-border flex-1" />
    </View>
  );
});
