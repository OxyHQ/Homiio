/**
 * SindiSection — the single "Ask Sindi about this home" block on the
 * property detail page.
 *
 * Sindi is Homiio's AI rental assistant (the `(tabs)/sindi` chat). On this
 * screen we surface it as a flat Airbnb-2026 section that:
 *  - states the value proposition (a 24/7 assistant that knows THIS listing),
 *  - folds in the verification trust signal when the listing is verified
 *    (Sindi reviewed it for authenticity), and
 *  - offers quick AI prompt chips + ONE primary CTA, all of which open
 *    `SindiChatBottomSheet` (the live chat seeded with the property context).
 *
 * This deliberately replaces the prior pair of stacked gold banners
 * (`SindiSection` CTA + the static `SindiAnalysis` verified card) which
 * duplicated each other. The trust line below is the one piece of real
 * information that the old verified card contributed; everything else is the
 * single CTA presented once.
 *
 * Flat aesthetic (matches the other detail sections via the `Section`
 * primitive): no card, no shadow, content sits on the page background and
 * aligns to `SECTION_GUTTER`. The only filled surface is the brand-gold
 * primary CTA — its label/icon use `colors.primaryForeground` (BLACK on the
 * `yellow` preset), resolved automatically by the Bloom `Button`.
 */
import React, { useContext, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { SECTION_GUTTER } from '@/components/property/Section';
import { SindiIcon } from '@/assets/icons';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import { SindiChatBottomSheet } from './SindiChatBottomSheet';
import { useSindiSuggestions } from '@/hooks/useSindiSuggestions';
import { colors } from '@/styles/colors';
import { hairline, radius, spacing } from '@/constants/styles';
import { Property, SindiSuggestion } from '@homiio/shared-types';

interface SindiSectionProps {
  property: Property;
}

const SINDI_ICON_SIZE = 28;
const VERIFIED_DOT_SIZE = 8;
/** Quick-prompt chips are capped so the row stays a tidy two lines on phones. */
const MAX_SUGGESTIONS = 4;

interface SuggestionChipProps {
  label: string;
  onPress: () => void;
}

/**
 * Quick-prompt chip — owns its own pressed/hovered state because it renders
 * inside a `.map()` (hooks can't run in the map body). Static style array +
 * onPressIn/Out/Hover state, never a function-form `style` (NativeWind v4
 * swallows the function and the chip renders unstyled).
 */
const SuggestionChip: React.FC<SuggestionChipProps> = ({ label, onPress }) => {
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={[styles.chip, (pressed || hovered) && styles.chipActive]}
    >
      <BloomText style={styles.chipLabel}>{label}</BloomText>
    </Pressable>
  );
};

export function SindiSection({ property }: SindiSectionProps) {
  const bottomSheet = useContext(BottomSheetContext);
  const { suggestions } = useSindiSuggestions({ property });

  const openSindi = (initialMessage?: string) => {
    bottomSheet.openBottomSheet(
      <SindiChatBottomSheet
        property={property}
        onClose={bottomSheet.closeBottomSheet}
        initialMessage={initialMessage}
      />,
    );
  };

  const visibleSuggestions = suggestions.slice(0, MAX_SUGGESTIONS);
  const isVerified = Boolean(property.isVerified);

  // Subtitle adapts to the verification state so the one section carries the
  // trust signal the old static card used to (without a second banner).
  const subtitle = isVerified
    ? 'Sindi reviewed this listing for authenticity. Ask anything about the home, the area, your rights, or hidden costs.'
    : 'Your 24/7 rental assistant. Ask anything about the home, the area, your rights, or hidden costs.';

  return (
    <View>
      <View style={styles.header}>
        <View style={styles.iconBadge}>
          <SindiIcon size={SINDI_ICON_SIZE} color={colors.primaryForeground} />
        </View>
        <View style={styles.headerText}>
          <BloomText style={styles.title}>Ask Sindi about this home</BloomText>
          <BloomText style={styles.subtitle}>{subtitle}</BloomText>
        </View>
      </View>

      <View style={styles.body}>
        {isVerified ? (
          <View style={styles.verifiedRow} accessibilityRole="text">
            <View style={styles.verifiedDot} />
            <BloomText style={styles.verifiedLabel}>
              Verified by Sindi
            </BloomText>
          </View>
        ) : null}

        {visibleSuggestions.length > 0 ? (
          <View style={styles.chipRow}>
            {visibleSuggestions.map((suggestion: SindiSuggestion, index: number) => (
              <SuggestionChip
                key={`${suggestion.text}-${index}`}
                label={suggestion.text}
                onPress={() => openSindi(suggestion.text)}
              />
            ))}
          </View>
        ) : null}

        <Button
          onPress={() => openSindi()}
          variant="primary"
          size="large"
          icon={
            <SindiIcon size={18} color={colors.primaryForeground} />
          }
          iconPosition="left"
          accessibilityLabel="Ask Sindi AI about this home"
          accessibilityHint="Opens a chat with Sindi about this property"
        >
          Ask Sindi about this home
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Icon badge + title/subtitle share one gutter so the section lines up to
  // the same left edge as every other detail block. Title/subtitle mirror the
  // canonical `SectionHeader` typography (20/700 title, 14 muted subtitle) —
  // inlined here rather than reusing `SectionHeader` so the gutter isn't
  // applied twice (which would push the title right of the icon).
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingHorizontal: SECTION_GUTTER,
  },
  iconBadge: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.primaryColor,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
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
    marginTop: spacing.lg,
    gap: spacing.lg,
  },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.mutedSubtle,
  },
  verifiedDot: {
    width: VERIFIED_DOT_SIZE,
    height: VERIFIED_DOT_SIZE,
    borderRadius: VERIFIED_DOT_SIZE / 2,
    backgroundColor: colors.success,
  },
  verifiedLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: hairline.width,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    backgroundColor: colors.surfaceElevated,
  },
  chipActive: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.COLOR_BLACK,
  },
});
