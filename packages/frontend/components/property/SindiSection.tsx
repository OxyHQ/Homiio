/**
 * SindiSection — the single "Ask Sindi about this home" block on the
 * property detail page.
 *
 * Sindi is Homiio's AI rental assistant (the `(tabs)/sindi` chat). On this
 * screen we surface it as a flat Airbnb-2026 section that:
 *  - states the value proposition (a 24/7 assistant that knows THIS listing),
 *  - folds in the verification trust signal when the listing is verified
 *    (Sindi reviewed it for authenticity), and
 *  - offers quick prompt chips + ONE primary CTA, all of which ask Sindi in
 *    the SDK's one sheet (`useAskAgent().ask('sindi', turn)`), the turn naming
 *    this listing so Sindi reads it with `getListing`.
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
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAskAgent } from '@alia.onl/sdk';

import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import { RiVerifiedBadgeFill } from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text } from '@oxy.so/bloom/typography';

import { SECTION_GUTTER } from '@/components/property/Section';
import { SindiIcon } from '@/assets/icons';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import { getPropertyTitle } from '@/utils/propertyUtils';
import type { Property } from '@homiio/shared-types';

interface SindiSectionProps {
  property: Property;
}

const SINDI_ICON_SIZE = 28;
/** The quick prompts, kept to four so the row stays a tidy two lines on phones. */
const PROMPT_KEYS = [
  'sindi.property.prompts.budget',
  'sindi.property.prompts.costs',
  'sindi.property.prompts.area',
  'sindi.property.prompts.rights',
] as const;

export function SindiSection({ property }: SindiSectionProps) {
  const { t } = useTranslation();
  const { ask } = useAskAgent();
  const { colors: themeColors } = useTheme();

  // The listing travels IN the turn, by id, so the question reads "this home"
  // whatever page the sheet is later reopened over.
  const askSindi = (question: string) =>
    ask('sindi', {
      text: `${question}\n\n${t('sindi.property.context', {
        title: getPropertyTitle(property),
        id: property.id,
      })}`,
    });

  const isVerified = Boolean(property.isVerified);

  // Subtitle adapts to the verification state so the one section carries the
  // trust signal the old static card used to (without a second banner).
  const subtitle = isVerified ? t('sindi.property.subtitleVerified') : t('sindi.property.subtitle');

  return (
    <View>
      <View style={styles.header}>
        <View style={styles.iconBadge}>
          <SindiIcon size={SINDI_ICON_SIZE} color={colors.primaryForeground} />
        </View>
        <View style={styles.headerText}>
          <Text variant="title-3-bold" style={{ color: themeColors.text }}>
            {t('sindi.property.title')}
          </Text>
          <Text variant="body-2-regular" style={{ color: themeColors.textSecondary }}>
            {subtitle}
          </Text>
        </View>
      </View>

      <View style={styles.body}>
        {isVerified ? (
          <View style={styles.verifiedRow}>
            <Chip
              variant="subtle"
              color="success"
              startIcon={<RiVerifiedBadgeFill width={16} height={16} fill={themeColors.success} />}
            >
              {t('sindi.property.verified')}
            </Chip>
          </View>
        ) : null}

        <View style={styles.chipRow}>
          {PROMPT_KEYS.map((key) => (
            <Chip key={key} size="md" onPress={() => askSindi(t(key))} accessibilityLabel={t(key)}>
              {t(key)}
            </Chip>
          ))}
        </View>

        <Button
          onPress={() => askSindi(t('sindi.property.defaultQuestion'))}
          size="lg"
          icon={<SindiIcon size={18} color={colors.primaryForeground} />}
          iconPosition="left"
          accessibilityLabel={t('sindi.property.askAccessible')}
          accessibilityHint={t('sindi.property.askHint')}
          tone="accent"
          appearance="solid"
        >
          {t('sindi.property.title')}
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
  body: {
    paddingHorizontal: SECTION_GUTTER,
    marginTop: spacing.lg,
    gap: spacing.lg,
  },
  verifiedRow: {
    flexDirection: 'row',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
