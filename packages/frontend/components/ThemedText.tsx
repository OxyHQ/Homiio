/**
 * ThemedText — thin shim over Bloom Typography that preserves Homiio's
 * font identity (Phudu for display, Roboto for body) and 16px default
 * body size. Internally renders Bloom `Text`/`P`/`H1`/`H2` so the design
 * system stays consistent with the rest of the Oxy ecosystem; consumers
 * can keep importing this component for the historical `type` API while
 * new code is encouraged to import directly from `@oxyhq/bloom/typography`.
 *
 * The web font stack is overridden globally in `app/_layout.tsx` via the
 * `--bloom-font-display` / `--bloom-font-sans` CSS variables; on native
 * we keep the explicit `fontFamily` here because Bloom resolves to
 * BlomusModernus otherwise.
 */
import React from 'react';
import {
  Platform,
  StyleSheet,
  type StyleProp,
  type TextProps,
  type TextStyle,
} from 'react-native';

import { H1, H2, P, Text } from '@oxyhq/bloom/typography';

import { phuduFontWeights, robotoFontWeights } from '@/styles/fonts';

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

/**
 * On native we apply Homiio's literal font family names. On web the
 * variables `var(--bloom-font-display/sans)` are remapped in
 * `app/_layout.tsx`, so we only need to provide a sensible fallback in
 * case a consumer renders the component outside the provider.
 */
const NATIVE_BODY_FAMILY = robotoFontWeights.regular;
const NATIVE_BODY_SEMIBOLD = robotoFontWeights.medium;
const NATIVE_DISPLAY_FAMILY = phuduFontWeights.bold;
const NATIVE_DISPLAY_SEMIBOLD = phuduFontWeights.semiBold;

const isNative = Platform.OS !== 'web';

const typeStyles = StyleSheet.create({
  default: {
    fontSize: 16,
    lineHeight: 24,
    ...(isNative ? { fontFamily: NATIVE_BODY_FAMILY } : null),
  },
  defaultSemiBold: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    ...(isNative ? { fontFamily: NATIVE_BODY_SEMIBOLD } : null),
  },
  title: {
    fontSize: 32,
    lineHeight: 36,
    fontWeight: '700',
    ...(isNative ? { fontFamily: NATIVE_DISPLAY_FAMILY } : null),
  },
  subtitle: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '700',
    ...(isNative ? { fontFamily: NATIVE_DISPLAY_SEMIBOLD } : null),
  },
  link: {
    fontSize: 16,
    lineHeight: 30,
    color: '#0a7ea4',
    ...(isNative ? { fontFamily: NATIVE_BODY_FAMILY } : null),
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
