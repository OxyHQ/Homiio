import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from '@oxyhq/bloom/typography';
import { colors } from '@/styles/colors';

/**
 * Hairline rule trailing the date label. Uses an explicit Bloom token at
 * `StyleSheet.hairlineWidth` so it renders as the same subtle line on web and
 * native (the `bg-border` color class doesn't reliably resolve `--border` on
 * native).
 */
const styles = StyleSheet.create({
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
});

interface DateSeparatorProps {
  label: string;
}

/**
 * Inline label + hairline divider used to group time-sorted lists
 * (Today / Yesterday / Earlier) inside the sidebar's scrollable area.
 * Matches Clarity's structure: opacity-80 wrapper, 11px label at 60%
 * muted-foreground, and a 1px border flex line.
 */
export const DateSeparator = React.memo(function DateSeparator({
  label,
}: DateSeparatorProps) {
  return (
    <View className="flex-row items-center gap-2 pt-3 pb-1 px-3 opacity-80 mx-1">
      <Text
        className="select-none shrink-0"
        style={{
          fontSize: 11,
          color: `${colors.primaryDark_2}99`,
        }}
      >
        {label}
      </Text>
      <View style={styles.rule} />
    </View>
  );
});
