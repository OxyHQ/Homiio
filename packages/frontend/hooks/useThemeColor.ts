/**
 * Theme hooks backed by Bloom — the single source of truth for colors.
 *
 * - `useThemeColor(key)` re-exports Bloom's hook so any Bloom `ThemeColors` key
 *   resolves to the active light/dark value.
 * - `useColors()` returns Bloom's `ThemeColors` merged with Homiio's
 *   `DomainColors` (yellow secondary, chat palette), mirroring the accounts
 *   app's pattern. Prefer this in components that need live light/dark values.
 */

import { useMemo } from 'react';
import { useTheme, useThemeColor } from '@oxyhq/bloom/theme';
import type { ThemeColors } from '@oxyhq/bloom/theme';
import { DomainColors, type DomainColorKey } from '@/styles/colors';

export { useThemeColor };

/** Bloom theme colors merged with Homiio-specific domain colors. */
export type AppColors = ThemeColors & Record<DomainColorKey, string>;

/**
 * Single hook that gives every component a merged colour palette: Bloom's
 * ThemeColors (background, text, border, primary, status …) plus Homiio's
 * DomainColors (yellow secondary, rating star, chat/message palette).
 */
export function useColors(): AppColors {
  const { mode, colors } = useTheme();

  return useMemo<AppColors>(() => {
    const domain = DomainColors[mode];
    return { ...colors, ...domain };
  }, [mode, colors]);
}
