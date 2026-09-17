/**
 * SaleDetailsSection — the "For sale" block on the property detail page.
 *
 * Display-only summary of a sale listing's commercial terms: the headline
 * asking price, derived price per m², an optional estimated gross yield, the
 * onward-chain status, and a "price reduced" indicator. Rendered only for
 * listings whose `intents` include `sale` (the screen gates it), reusing the
 * flat `Section` primitive + Bloom typography so it matches the rest of the page.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Divider } from '@oxy.so/bloom/divider';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { RiArrowDownLine } from '@oxy.so/bloom/icons';
import { Chip } from '@oxy.so/bloom/chip';

import { Section } from '@/components/property/Section';
import { MoneyText } from '@/components/MoneyText';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
import { formatPercentage, type PropertySale } from '@homiio/shared-types';
import { useFormatting } from '@/utils/format';

interface Props {
  sale: PropertySale;
}

const PERCENT_MAX_FRACTION_DIGITS = 1;

/** Chain-status → i18n key + fallback. */
const CHAIN_STATUS_LABEL: Record<
  NonNullable<PropertySale['chainStatus']>,
  { key: string }
> = {
  no_chain: { key: 'listing.sale.chainStatus.noChain' },
  chain: { key: 'listing.sale.chainStatus.chain' },
  unknown: { key: 'listing.sale.chainStatus.unknown' },
};

export const SaleDetailsSection: React.FC<Props> = ({ sale }) => {
  const { t } = useTranslation();
  const { locale } = useFormatting();

  const chain = sale.chainStatus ? CHAIN_STATUS_LABEL[sale.chainStatus] : undefined;

  return (
    <Section title={t('listing.sale.sectionTitle')}>
      <View style={styles.headline}>
        <MoneyText
          amount={sale.price}
          currency={sale.currency}
          style={styles.price}
        />
        {sale.isPriceReduced ? (
          <Chip
            variant="subtle"
            color="success"
            size="small"
            startIcon={<RiArrowDownLine width={14} height={14} fill={colors.success} />}
          >
            {t('listing.sale.priceReduced')}
          </Chip>
        ) : null}
      </View>

      {sale.pricePerSqm !== undefined ? (
        <>
          <Divider />
          <View style={styles.row}>
            <BloomText style={styles.label}>
              {t('listing.sale.pricePerSqm')}
            </BloomText>
            <BloomText style={styles.value}>
              <MoneyText
                amount={sale.pricePerSqm}
                currency={sale.currency}
                style={styles.value}
              />
            </BloomText>
          </View>
        </>
      ) : null}

      {sale.estimatedYield !== undefined ? (
        <>
          <Divider />
          <View style={styles.row}>
            <BloomText style={styles.label}>
              {t('listing.sale.estimatedYield')}
            </BloomText>
            <BloomText style={styles.value}>
              {formatPercentage(sale.estimatedYield, locale, {
                input: 'percent',
                maximumFractionDigits: PERCENT_MAX_FRACTION_DIGITS,
              })}
            </BloomText>
          </View>
        </>
      ) : null}

      {chain ? (
        <>
          <Divider />
          <View style={styles.row}>
            <BloomText style={styles.label}>
              {t('listing.sale.chainStatus.label')}
            </BloomText>
            <BloomText style={styles.value}>{t(chain.key)}</BloomText>
          </View>
        </>
      ) : null}
    </Section>
  );
};

const styles = StyleSheet.create({
  headline: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingBottom: spacing.sm,
  },
  price: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    letterSpacing: -0.4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    gap: spacing.lg,
  },
  label: {
    fontSize: 15,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  value: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
});

export default SaleDetailsSection;
