/**
 * PricingDetails — "Pricing & Costs" block on the property detail.
 *
 * Migrated to Bloom Typography + Divider so the values inherit the canonical
 * type scale and the row separators are the canonical hairline. Prices render
 * through `CurrencyFormatter` (converts to the user's display currency) instead
 * of a hardcoded symbol.
 *
 * Folds in the "Cost to move in" breakdown (companion to the price block):
 *  - Long-term: Rent + Deposit (+ one-time Fees) = upfront total.
 *  - Vacation: Cleaning + Service + Taxes folded into an "Upfront total".
 * The breakdown is omitted when there is nothing beyond the rent to total.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Divider } from '@oxyhq/bloom/divider';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { Section } from '@/components/property/Section';
import { CurrencyFormatter } from '@/components/CurrencyFormatter';
import { colors } from '@/styles/colors';
import { hairline, radius, spacing } from '@/constants/styles';
import { RentMode, type PriceBreakdown } from '@homiio/shared-types';

interface PricingProperty {
  rent?: {
    amount?: number;
    currency?: string;
    deposit?: number;
    paymentFrequency?: string;
    utilities?: string;
  };
  priceUnit?: string;
  rentMode?: RentMode;
  priceBreakdown?: PriceBreakdown;
  petFee?: number;
}

interface Props {
  property: PricingProperty | null | undefined;
}

const PERCENT_DIVISOR = 100;

/** A money row: label + amount (formatted via CurrencyFormatter). */
interface MoneyRow {
  key: string;
  label: string;
  amount: number;
}

export const PricingDetails: React.FC<Props> = ({ property }) => {
  const { t } = useTranslation();
  const rentAmount = property?.rent?.amount;
  const rentFrequency = property?.priceUnit ?? property?.rent?.paymentFrequency;
  const deposit = property?.rent?.deposit;
  const currency = property?.rent?.currency ?? 'EUR';
  const utilitiesValue = property?.rent?.utilities;
  const utilitiesIncluded =
    utilitiesValue === undefined ? undefined : utilitiesValue === 'included';
  const isVacation = property?.rentMode === RentMode.VACATION;
  const breakdown = property?.priceBreakdown;

  if (
    rentAmount === undefined &&
    deposit === undefined &&
    utilitiesIncluded === undefined
  ) {
    return null;
  }

  // ----- Pricing & Costs rows -----
  const rows: MoneyRow[] = [];
  if (rentAmount !== undefined) {
    rows.push({ key: 'rent', label: t('Rent', 'Rent') || 'Rent', amount: rentAmount });
  }
  if (deposit !== undefined) {
    rows.push({
      key: 'deposit',
      label: t('Deposit', 'Deposit') || 'Deposit',
      amount: deposit,
    });
  }

  // ----- Move-in cost breakdown -----
  // Long-term move-in = rent + deposit + one-time fees (e.g. pet fee).
  // Vacation upfront = nightly + cleaning + service + taxes on the subtotal.
  const moveInRows: MoneyRow[] = [];
  let total = 0;

  if (rentAmount !== undefined) {
    moveInRows.push({
      key: 'rent',
      label: t('property.moveInCost.rent'),
      amount: rentAmount,
    });
    total += rentAmount;
  }

  if (isVacation) {
    if (breakdown?.cleaningFee) {
      moveInRows.push({
        key: 'cleaning',
        label: t('property.moveInCost.cleaningFee'),
        amount: breakdown.cleaningFee,
      });
      total += breakdown.cleaningFee;
    }
    if (breakdown?.serviceFee) {
      moveInRows.push({
        key: 'service',
        label: t('property.moveInCost.serviceFee'),
        amount: breakdown.serviceFee,
      });
      total += breakdown.serviceFee;
    }
    if (breakdown?.taxesPercent) {
      const taxes = Math.round((total * breakdown.taxesPercent) / PERCENT_DIVISOR);
      moveInRows.push({
        key: 'taxes',
        label: t('property.moveInCost.taxes'),
        amount: taxes,
      });
      total += taxes;
    }
  } else {
    if (deposit) {
      moveInRows.push({
        key: 'deposit',
        label: t('property.moveInCost.deposit'),
        amount: deposit,
      });
      total += deposit;
    }
    if (property?.petFee) {
      moveInRows.push({
        key: 'petFee',
        label: t('property.moveInCost.fees'),
        amount: property.petFee,
      });
      total += property.petFee;
    }
  }

  // Only worth a breakdown when there is more than the rent line to total.
  const showMoveIn = rentAmount !== undefined && moveInRows.length > 1;
  const totalLabel = isVacation
    ? t('property.moveInCost.totalUpfront')
    : t('property.moveInCost.total');

  return (
    <Section title={t('Pricing & Costs', 'Pricing & Costs')}>
      {rows.map((row, idx) => (
        <React.Fragment key={row.key}>
          <View style={styles.row}>
            <BloomText style={styles.label}>{row.label}</BloomText>
            <BloomText style={styles.value}>
              <CurrencyFormatter
                amount={row.amount}
                originalCurrency={currency}
                showConversion={false}
                style={styles.value}
              />
              {row.key === 'rent' && rentFrequency ? (
                <BloomText style={styles.unit}>{` /${rentFrequency}`}</BloomText>
              ) : null}
            </BloomText>
          </View>
          {idx !== rows.length - 1 ? <Divider /> : null}
        </React.Fragment>
      ))}

      {utilitiesIncluded !== undefined ? (
        <>
          <Divider />
          <View style={styles.row}>
            <BloomText style={styles.label}>
              {t('Utilities Included', 'Utilities Included') || 'Utilities Included'}
            </BloomText>
            <BloomText style={styles.value}>
              {utilitiesIncluded
                ? t('Yes', 'Yes') || 'Yes'
                : t('No', 'No') || 'No'}
            </BloomText>
          </View>
        </>
      ) : null}

      {showMoveIn ? (
        <View style={styles.moveIn}>
          <BloomText style={styles.moveInTitle}>
            {t('property.moveInCost.title')}
          </BloomText>
          <View style={styles.moveInRows}>
            {moveInRows.map((row) => (
              <View key={row.key} style={styles.moveInRow}>
                <BloomText style={styles.moveInLabel}>{row.label}</BloomText>
                <CurrencyFormatter
                  amount={row.amount}
                  originalCurrency={currency}
                  showConversion={false}
                  style={styles.moveInValue}
                />
              </View>
            ))}
          </View>
          <View style={styles.moveInTotalRow}>
            <BloomText style={styles.moveInTotalLabel}>{totalLabel}</BloomText>
            <CurrencyFormatter
              amount={total}
              originalCurrency={currency}
              showConversion={false}
              style={styles.moveInTotalValue}
            />
          </View>
          <BloomText style={styles.moveInNote}>
            {t('property.moveInCost.note')}
          </BloomText>
        </View>
      ) : null}
    </Section>
  );
};

const styles = StyleSheet.create({
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
  unit: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  moveIn: {
    marginTop: spacing.lg,
    paddingTop: spacing.lg,
    borderTopWidth: hairline.width,
    borderTopColor: hairline.color,
    gap: spacing.md,
  },
  moveInTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  moveInRows: {
    gap: spacing.xs,
  },
  moveInRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
  },
  moveInLabel: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  moveInValue: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  moveInTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    marginTop: spacing.xs,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.mutedSubtle,
  },
  moveInTotalLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  moveInTotalValue: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  moveInNote: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    lineHeight: 16,
  },
});

export default PricingDetails;
