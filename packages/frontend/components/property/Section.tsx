/**
 * Section / SectionHeader — flat content primitives for the property
 * detail page (Airbnb-2026 aesthetic).
 *
 * Gutter ownership: the horizontal page gutter lives HERE (and in the
 * other section roots), NOT on the screen's page container. Putting the
 * gutter on the page container would trap horizontally-scrolling bodies
 * (photo rows, carousels) inside the padding so they couldn't bleed to
 * the screen edge. Instead each section is inset by its own
 * `SECTION_GUTTER`, and a section whose body scrolls horizontally can
 * opt out via `fullBleed` — the header stays inset, the scroll track
 * runs edge-to-edge, and the scroller re-applies the gutter to its
 * `contentContainerStyle` so the first/last items still align.
 *
 * Beyond the gutter these primitives add NO card, NO shadow, and NO
 * outer vertical margin — content sits directly on the page background.
 *
 * Use `SectionHeader` for the canonical section title (≈20px, 700
 * weight, tight to its body). Use `Section` to wrap a title + body with
 * a consistent title→content gap.
 */
import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

/**
 * Single source of truth for the property-detail horizontal gutter.
 * Section roots that don't use these primitives (e.g. the colored Sindi
 * banners, the host row) import this so every block lines up to the
 * same left/right edge.
 */
export const SECTION_GUTTER = spacing.xl;

interface SectionHeaderProps {
  title: string;
  /** Optional supporting line below the title (muted, smaller). */
  subtitle?: string;
}

/**
 * Canonical flat section heading. Always inset by the gutter (titles
 * stay aligned even when the section body is full-bleed). Tight to
 * whatever follows it — the gap to body is owned by `Section` (or the
 * consumer) so a header can also stand alone above custom layouts.
 */
export const SectionHeader: React.FC<SectionHeaderProps> = ({ title, subtitle }) => (
  <View style={styles.header}>
    <BloomText style={styles.title}>{title}</BloomText>
    {subtitle ? <BloomText style={styles.subtitle}>{subtitle}</BloomText> : null}
  </View>
);

interface SectionProps {
  /** Optional title rendered via `SectionHeader`. */
  title?: string;
  /** Optional muted line under the title. */
  subtitle?: string;
  children: React.ReactNode;
  /** Extra style for the body wrapper (e.g. a `gap`). */
  bodyStyle?: ViewStyle;
  /**
   * Drop the horizontal gutter on the BODY so a horizontally-scrolling
   * child (ScrollView/FlatList/carousel) can run edge-to-edge. The
   * header stays inset. The scroll child must re-apply
   * `paddingHorizontal: SECTION_GUTTER` to its `contentContainerStyle`.
   */
  fullBleed?: boolean;
}

/**
 * Flat section wrapper: optional header + body, with a consistent
 * title→content gap and a horizontal gutter (unless `fullBleed`).
 */
export const Section: React.FC<SectionProps> = ({
  title,
  subtitle,
  children,
  bodyStyle,
  fullBleed = false,
}) => (
  <View>
    {title ? <SectionHeader title={title} subtitle={subtitle} /> : null}
    <View
      style={[
        fullBleed ? styles.bodyFullBleed : styles.body,
        title ? styles.bodyWithHeader : undefined,
        bodyStyle,
      ]}
    >
      {children}
    </View>
  </View>
);

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: SECTION_GUTTER,
    gap: spacing.xs,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 20,
  },
  body: {
    paddingHorizontal: SECTION_GUTTER,
  },
  bodyFullBleed: {
    paddingHorizontal: 0,
  },
  bodyWithHeader: {
    marginTop: spacing.md,
  },
});

export default Section;
