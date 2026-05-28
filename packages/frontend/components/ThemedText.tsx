/**
 * ThemedText — thin shim over Bloom Typography that preserves the
 * historical `type` API used across Homiio. The visual font identity is
 * fully owned by `BloomThemeProvider` (display + sans tokens), so we no
 * longer set `fontFamily` here. Sizes/weights remain to match the
 * existing call sites.
 */
import React from 'react';
import {
  StyleSheet,
  type StyleProp,
  type TextProps,
  type TextStyle,
} from 'react-native';

import { H1, H2, P, Text } from '@oxyhq/bloom/typography';

export type ThemedTextType =
  | 'default'
  | 'title'
  | 'defaultSemiBold'
  | 'subtitle'
  | 'link';

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?: ThemedTextType;
};

const typeStyles = StyleSheet.create({
  default: {
    fontSize: 16,
    lineHeight: 24,
  },
  defaultSemiBold: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
  },
  title: {
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
  },
  link: {
    fontSize: 16,
    lineHeight: 30,
    color: '#0a7ea4',
  },
});

export function ThemedText({
  style,
  type = 'default',
  ...rest
}: ThemedTextProps) {
  const resolvedStyle: StyleProp<TextStyle> = [typeStyles[type], style];

  if (type === 'title') {
    return <H1 {...rest} style={resolvedStyle} />;
  }
  if (type === 'subtitle') {
    return <H2 {...rest} style={resolvedStyle} />;
  }
  if (type === 'default') {
    return <P {...rest} style={resolvedStyle} />;
  }
  return <Text {...rest} style={resolvedStyle} />;
}
