/**
 * BasicInfoSection — top-of-fold property summary used on the detail
 * page.
 *
 * Composition:
 *  1. Rent label + amount (via shared `MoneyText`).
 *  2. External-source badge if the listing came from a scraper feed.
 *  3. Truncated "About this property" body (via shared TruncatedDescription).
 *  4. Active-viewing banner.
 *
 * Bloom Typography + Chip (source) + Admonition (viewing banner) + Button —
 * no raw `<Text>`, no hand-rolled chips or banners.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  AdmonitionButton,
  AdmonitionContent,
  AdmonitionRoot,
  AdmonitionRow,
  AdmonitionText,
} from '@oxy.so/bloom/admonition';
import { Chip } from '@oxy.so/bloom/chip';
import { RiCalendarLine, RiGlobalLine } from '@oxy.so/bloom/icons';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { MoneyText } from '@/components/MoneyText';
import { TruncatedDescription } from '@/components/ui/TruncatedDescription';
import { SECTION_GUTTER } from '@/components/property/Section';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
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
        <BloomText variant="headline-regular" style={styles.priceLabel}>
          {rentLabel}
        </BloomText>
        <MoneyText
          amount={rentAmount}
          currency={rentCurrency}
        />
      </View>

      {property?.isExternal && property?.source && property.source !== 'internal' ? (
        <Chip
          size="large"
          startIcon={<RiGlobalLine width={14} height={14} fill={colors.COLOR_BLACK_LIGHT_3} />}
        >
          {`${t('property.sections.sourcedFrom')} ${property.source.charAt(0).toUpperCase()}${property.source.slice(1)}`}
        </Chip>
      ) : null}

      {description && description.trim() !== '' ? (
        <View style={styles.descriptionBlock}>
          <BloomText variant="title-2-bold" style={styles.aboutTitle}>
            {t('property.about.title')}
          </BloomText>
          <TruncatedDescription text={description} />
        </View>
      ) : null}

      {hasActiveViewing ? (
        <AdmonitionRoot type="tip">
          <AdmonitionRow style={styles.viewingRow}>
            <RiCalendarLine width={20} height={20} fill={colors.primaryColor} />
            <AdmonitionContent>
              <AdmonitionText>{t('viewings.banner.hasViewing')}</AdmonitionText>
            </AdmonitionContent>
            <AdmonitionButton
              onPress={onViewingsPress}
              accessibilityLabel={t('viewings.banner.viewDetails')}
            >
              {t('viewings.banner.viewDetails')}
            </AdmonitionButton>
          </AdmonitionRow>
        </AdmonitionRoot>
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
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  descriptionBlock: {
    gap: spacing.md,
  },
  aboutTitle: {
    color: colors.COLOR_BLACK,
    letterSpacing: -0.2,
  },
  viewingRow: {
    alignItems: 'center',
  },
});

export default BasicInfoSection;
