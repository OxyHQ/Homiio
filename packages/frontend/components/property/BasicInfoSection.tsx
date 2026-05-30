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
import { H2, Text as BloomText } from '@oxyhq/bloom/typography';

import { CurrencyFormatter } from '@/components/CurrencyFormatter';
import { TruncatedDescription } from '@/components/ui/TruncatedDescription';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

type PriceUnitKey = 'day' | 'night' | 'week' | 'month' | 'year';

interface Property {
  priceUnit?: PriceUnitKey;
  rent?: { amount?: number; currency?: string; paymentFrequency?: string };
  description?: string;
  isExternal?: boolean;
  source?: string;
}

interface Props {
  property: Property | null | undefined;
  hasActiveViewing: boolean;
  onViewingsPress: () => void;
}

export const BasicInfoSection: React.FC<Props> = ({
  property,
  hasActiveViewing,
  onViewingsPress,
}) => {
  const { t } = useTranslation();
  const priceUnit: PriceUnitKey = property?.priceUnit ?? 'month';
  const rentAmount = property?.rent?.amount ?? 0;
  const rentCurrency = property?.rent?.currency || 'USD';
  const description = property?.description;

  const getRentLabel = (unit: PriceUnitKey): string => {
    switch (unit) {
      case 'day':
        return t('Daily Rent', 'Daily Rent') || 'Daily Rent';
      case 'night':
        return t('Nightly Rent', 'Nightly Rent') || 'Nightly Rent';
      case 'week':
        return t('Weekly Rent', 'Weekly Rent') || 'Weekly Rent';
      case 'month':
        return t('Monthly Rent', 'Monthly Rent') || 'Monthly Rent';
      case 'year':
        return t('Yearly Rent', 'Yearly Rent') || 'Yearly Rent';
      default:
        return t('Rent', 'Rent') || 'Rent';
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.priceRow}>
        <BloomText style={styles.priceLabel}>{getRentLabel(priceUnit)}</BloomText>
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
              {`${t('Sourced from', 'Sourced from') || 'Sourced from'} ${property.source.charAt(0).toUpperCase()}${property.source.slice(1)}`}
            </BloomText>
          </View>
        </View>
      ) : null}

      {description && description.trim() !== '' ? (
        <View style={styles.descriptionBlock}>
          <H2 style={styles.aboutTitle}>
            {t('property.about.title', 'About this property') || 'About this property'}
          </H2>
          <TruncatedDescription text={description} />
        </View>
      ) : null}

      {hasActiveViewing ? (
        <View style={styles.viewingBanner}>
          <View style={styles.viewingBannerIcon}>
            <Ionicons name="calendar" size={20} color={colors.primaryColor} />
          </View>
          <BloomText style={styles.viewingBannerText}>
            {t('viewings.banner.hasViewing', 'You have a viewing scheduled') ||
              'You have a viewing scheduled'}
          </BloomText>
          <Button
            onPress={onViewingsPress}
            variant="primary"
            size="small"
            accessibilityLabel={
              t('viewings.banner.viewDetails', 'View details') || 'View details'
            }
          >
            {t('viewings.banner.viewDetails', 'View details') || 'View details'}
          </Button>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.xl,
    marginBottom: spacing['2xl'],
    gap: spacing.lg,
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
    fontSize: 22,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
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
