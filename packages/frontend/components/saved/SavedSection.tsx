/**
 * One section of the Saved screen: a level-2 heading, an optional line under
 * it, an optional action at the right, then the content — the Bloom housing
 * template's `Section`, in Homiio's theme.
 */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@oxy.so/bloom/theme';
import { Text } from '@oxy.so/bloom/typography';

interface SavedSectionProps {
  title: string;
  description?: string;
  /** Right of the heading (a "New folder" button, a "View all" link). */
  action?: React.ReactNode;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SavedSection({ title, description, action, children, style, testID }: SavedSectionProps) {
  const theme = useTheme();
  return (
    <View style={[{ gap: 16 }, style]} testID={testID}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text role="heading" aria-level={2} variant="title-3-semibold" style={{ color: theme.colors.text }}>
            {title}
          </Text>
          {description ? (
            <Text variant="body-2-regular" style={{ color: theme.colors.textSecondary }}>
              {description}
            </Text>
          ) : null}
        </View>
        {action}
      </View>
      {children}
    </View>
  );
}
