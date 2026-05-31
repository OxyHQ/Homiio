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

import { Divider } from '@oxyhq/bloom/divider';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { Ionicons } from '@expo/vector-icons';

import { Section } from '@/components/property/Section';
import { CurrencyFormatter } from '@/components/CurrencyFormatter';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
import type { PropertySale } from '@homiio/shared-types';

interface Props {
  sale: PropertySale;
}

const PERCENT_MAX_FRACTION_DIGITS = 1;

/** Chain-status → i18n key + fallback. */
const CHAIN_STATUS_LABEL: Record<
  NonNullable<PropertySale['chainStatus']>,
  { key: string; fallback: string }
> = {
  no_chain: { key: 'listing.sale.chainStatus.noChain', fallback: 'No chain' },
  chain: { key: 'listing.sale.chainStatus.chain', fallback: 'In a chain' },
  unknown: { key: 'listing.sale.chainStatus.unknown', fallback: 'Unknown' },
};

export const SaleDetailsSection: React.FC<Props> = ({ sale }) => {
  const { t } = useTranslation();

  const chain = sale.chainStatus ? CHAIN_STATUS_LABEL[sale.chainStatus] : undefined;

  return (
    <Section title={t('listing.sale.sectionTitle', 'For sale')}>
      <View style={styles.headline}>
        <CurrencyFormatter
          amount={sale.price}
          originalCurrency={sale.currency}
          showConversion={false}
          style={styles.price}
        />
        {sale.isPriceReduced ? (
          <View style={styles.reducedChip}>
            <Ionicons name="trending-down" size={14} color={colors.success} />
            <BloomText style={styles.reducedText}>
              {t('listing.sale.priceReduced', 'Price reduced')}
            </BloomText>
          </View>
        ) : null}
      </View>

      {sale.pricePerSqm !== undefined ? (
        <>
          <Divider />
          <View style={styles.row}>
            <BloomText style={styles.label}>
              {t('listing.sale.pricePerSqm', 'Price per m²')}
            </BloomText>
            <BloomText style={styles.value}>
              <CurrencyFormatter
                amount={sale.pricePerSqm}
                originalCurrency={sale.currency}
                showConversion={false}
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
              {t('listing.sale.estimatedYield', 'Estimated yield')}
            </BloomText>
            <BloomText style={styles.value}>
              {`${sale.estimatedYield.toLocaleString(undefined, {
                maximumFractionDigits: PERCENT_MAX_FRACTION_DIGITS,
              })}%`}
            </BloomText>
          </View>
        </>
      ) : null}

      {chain ? (
        <>
          <Divider />
          <View style={styles.row}>
            <BloomText style={styles.label}>
              {t('listing.sale.chainStatus.label', 'Chain status')}
            </BloomText>
            <BloomText style={styles.value}>{t(chain.key, chain.fallback)}</BloomText>
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
  reducedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    backgroundColor: colors.successSubtle,
  },
  reducedText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.success,
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
