/**
 * BasicInfoSection — top-of-fold property summary used on the detail
 * page.
 *
 * Composition:
 *  1. Rent label + amount (via shared `CurrencyFormatter`).
 *  2. External-source badge if the listing came from a scraper feed.
 *  3. Truncated "About this property" body (via shared TruncatedDescription).
 *  4. Active-viewing banner.
 *
 * Migrated to Bloom Typography + Badge + Button — no raw `<Text>`,
 * no inline font sizes, no hand-rolled chips.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { CurrencyFormatter } from '@/components/CurrencyFormatter';
import { TruncatedDescription } from '@/components/ui/TruncatedDescription';
import { SECTION_GUTTER } from '@/components/property/Section';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import { type Property } from '@homiio/shared-types';
import type { RentalMode } from '@/utils/propertyUtils';

interface Props {
  property: Property | null | undefined;
  /** The active rent experience — selects which priced block headlines here. */
  mode: RentalMode;
  hasActiveViewing: boolean;
  onViewingsPress: () => void;
}

export const BasicInfoSection: React.FC<Props> = ({
  property,
  mode,
  hasActiveViewing,
  onViewingsPress,
}) => {
  const { t } = useTranslation();
  // Read the active mode's priced block — the unit is fixed per block.
  const isVacation = mode === 'vacation';
  const rentAmount = isVacation
    ? property?.shortTermRent?.nightlyRate ?? 0
    : property?.longTermRent?.monthlyAmount ?? 0;
  const rentCurrency =
    (isVacation ? property?.shortTermRent?.currency : property?.longTermRent?.currency) || 'USD';
  const description = property?.description;

  const rentLabel = isVacation
    ? t('property.sections.nightlyRent')
    : t('property.sections.monthlyRent');

  return (
    <View style={styles.container}>
      <View style={styles.priceRow}>
        <BloomText style={styles.priceLabel}>{rentLabel}</BloomText>
        <CurrencyFormatter
          amount={rentAmount}
          originalCurrency={rentCurrency}
          showConversion
        />
      </View>

      {property?.isExternal && property?.source && property.source !== 'internal' ? (
        <View style={styles.badgeRow}>
          <View style={styles.sourceBadge}>
            <Ionicons
              name="globe-outline"
              size={14}
              color={colors.COLOR_BLACK_LIGHT_3}
            />
            <BloomText style={styles.sourceBadgeText}>
              {`${t('property.sections.sourcedFrom')} ${property.source.charAt(0).toUpperCase()}${property.source.slice(1)}`}
            </BloomText>
          </View>
        </View>
      ) : null}

      {description && description.trim() !== '' ? (
        <View style={styles.descriptionBlock}>
          <BloomText style={styles.aboutTitle}>
            {t('property.about.title')}
          </BloomText>
          <TruncatedDescription text={description} />
        </View>
      ) : null}

      {hasActiveViewing ? (
        <View style={styles.viewingBanner}>
          <View style={styles.viewingBannerIcon}>
            <Ionicons name="calendar" size={20} color={colors.primaryColor} />
          </View>
          <BloomText style={styles.viewingBannerText}>
            {t('viewings.banner.hasViewing')}
          </BloomText>
          <Button
            onPress={onViewingsPress}
            variant="primary"
            size="small"
            accessibilityLabel={
              t('viewings.banner.viewDetails')
            }
          >
            {t('viewings.banner.viewDetails')}
          </Button>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
    paddingHorizontal: SECTION_GUTTER,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  priceLabel: {
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  badgeRow: {
    flexDirection: 'row',
  },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.mutedSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 9999,
    gap: 6,
  },
  sourceBadgeText: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
    fontWeight: '500',
  },
  descriptionBlock: {
    gap: spacing.md,
  },
  aboutTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    letterSpacing: -0.2,
  },
  viewingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.primaryLight_2,
  },
  viewingBannerIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewingBannerText: {
    flex: 1,
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
});

export default BasicInfoSection;
