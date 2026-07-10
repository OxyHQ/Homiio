/**
 * PriceEthicsBanner — informational warning on the property detail screen when
 * the listing is not flagged as a fair price. Publishing is allowed; this only
 * explains why the Fair Price badge is absent.
 */
import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { SECTION_GUTTER } from '@/components/property/Section';
import { useCurrency } from '@/hooks/useCurrency';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import type { PropertyPriceEthics } from '@homiio/shared-types';

interface PriceEthicsBannerProps {
  priceEthics: PropertyPriceEthics;
  currency?: string;
}

export const PriceEthicsBanner: React.FC<PriceEthicsBannerProps> = ({
  priceEthics,
  currency = 'EUR',
}) => {
  const { t } = useTranslation();
  const { convertAndFormat } = useCurrency();

  const reasonLines = useMemo(() => {
    const lines: string[] = [];
    const exceedsEthical = priceEthics.withinEthical === false;
    const aboveMarket = priceEthics.marketVerdict === 'above_average';

    if (exceedsEthical && typeof priceEthics.ethicalMax === 'number') {
      lines.push(
        t('property.priceEthics.banner.exceedsEthical', {
          max: convertAndFormat(priceEthics.ethicalMax, currency, false),
        }),
      );
    } else if (exceedsEthical) {
      lines.push(t('property.priceEthics.banner.exceedsEthicalGeneric'));
    }

    if (aboveMarket && typeof priceEthics.percentDiffFromAvg === 'number') {
      lines.push(
        t('property.priceEthics.banner.aboveMarket', {
          percent: Math.abs(priceEthics.percentDiffFromAvg),
        }),
      );
    } else if (aboveMarket) {
      lines.push(t('property.priceEthics.banner.aboveMarketGeneric'));
    }

    if (lines.length === 0) {
      lines.push(t('property.priceEthics.banner.generic'));
    }

    return lines;
  }, [convertAndFormat, currency, priceEthics, t]);

  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Ionicons name="alert-circle" size={20} color={colors.warning} />
      </View>
      <View style={styles.copy}>
        <BloomText style={styles.title}>
          {t('property.priceEthics.banner.title')}
        </BloomText>
        {reasonLines.map((line) => (
          <BloomText key={line} style={styles.body}>
            {line}
          </BloomText>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    marginHorizontal: SECTION_GUTTER,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.warningSubtle,
  },
  iconWrap: {
    marginTop: 2,
  },
  copy: {
    flex: 1,
    gap: spacing.xs,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  body: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 20,
  },
});

export default PriceEthicsBanner;
