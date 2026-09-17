/**
 * PriceEthicsBanner — informational warning on the property detail screen when
 * the listing is not flagged as a fair price. Publishing is allowed; this only
 * explains why the Fair Price badge is absent.
 */
import React, { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  AdmonitionContent,
  AdmonitionIcon,
  AdmonitionRoot,
  AdmonitionRow,
  AdmonitionText,
} from '@oxy.so/bloom/admonition';

import { SECTION_GUTTER } from '@/components/property/Section';
import { useFormatting } from '@/utils/format';
import { formatMoney, type PropertyPriceEthics } from '@homiio/shared-types';

interface PriceEthicsBannerProps {
  priceEthics: PropertyPriceEthics;
  currency?: string;
}

export const PriceEthicsBanner: React.FC<PriceEthicsBannerProps> = ({
  priceEthics,
  currency = 'EUR',
}) => {
  const { t } = useTranslation();
  const { locale } = useFormatting();

  const reasonLines = useMemo(() => {
    const lines: string[] = [];
    const exceedsEthical = priceEthics.withinEthical === false;
    const aboveMarket = priceEthics.marketVerdict === 'above_average';

    if (exceedsEthical && typeof priceEthics.ethicalMax === 'number') {
      lines.push(
        t('property.priceEthics.banner.exceedsEthical', {
          max: formatMoney(priceEthics.ethicalMax, currency, locale),
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
  }, [locale, currency, priceEthics, t]);

  return (
    <AdmonitionRoot type="warning" style={styles.container}>
      <AdmonitionRow>
        <AdmonitionIcon />
        <AdmonitionContent style={styles.copy}>
          <AdmonitionText style={styles.title}>
            {t('property.priceEthics.banner.title')}
          </AdmonitionText>
          {reasonLines.map((line) => (
            <AdmonitionText key={line}>{line}</AdmonitionText>
          ))}
        </AdmonitionContent>
      </AdmonitionRow>
    </AdmonitionRoot>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: SECTION_GUTTER,
  },
  copy: {
    gap: 4,
  },
  title: {
    fontWeight: '700',
  },
});

export default PriceEthicsBanner;
