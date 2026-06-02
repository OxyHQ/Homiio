import React, { ReactNode } from 'react';
import { View, StyleSheet } from 'react-native';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
import { SECTION_GUTTER } from '@/components/property/Section';

type BaseWidgetProps = {
  title?: string;
  icon?: ReactNode;
  children: ReactNode;
  noPadding?: boolean;
};

/**
 * Flat section shell for the right-rail widgets — the rail reads as ONE
 * continuous panel, so this primitive adds NO card chrome: no border, no
 * rounded box, no shadow, no filled surface. Content sits directly on the
 * rail background (the WidgetManager owns the hairline dividers + vertical
 * rhythm between sections).
 *
 * Mirrors `components/property/Section.tsx`: an optional `SectionHeader`-style
 * title (20px / 700 / -0.2 tracking, with the optional `icon` aligned to the
 * right of the title row) inset by `SECTION_GUTTER`, then a body inset by the
 * same gutter with a `spacing.sm` title→content gap. `noPadding` lets a child
 * own its own edge-to-edge layout (e.g. lists).
 */
export function BaseWidget({ title, icon, children, noPadding = false }: BaseWidgetProps) {
  return (
    <View style={styles.section}>
      {title && (
        <View style={styles.header}>
          <BloomText style={styles.title}>{title}</BloomText>
          {icon && <View style={styles.icon}>{icon}</View>}
        </View>
      )}
      <View
        style={[
          noPadding ? styles.bodyFullBleed : styles.body,
          title ? styles.bodyWithHeader : undefined,
        ]}
      >
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    pointerEvents: 'auto',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: SECTION_GUTTER,
  },
  title: {
    flexShrink: 1,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: colors.COLOR_BLACK,
  },
  icon: {
    flexShrink: 0,
  },
  body: {
    paddingHorizontal: SECTION_GUTTER,
  },
  bodyFullBleed: {
    paddingHorizontal: 0,
  },
  bodyWithHeader: {
    marginTop: spacing.sm,
  },
});
