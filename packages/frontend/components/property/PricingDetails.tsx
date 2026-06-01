/**
 * PricingDetails — "Pricing & Costs" block on the property detail.
 *
 * Reads the ACTIVE browse mode's priced block (the unit is fixed per block):
 *  - Long-term (`longTermRent`): Rent + Deposit + Utilities, and a "Cost to move
 *    in" breakdown of Rent + Deposit (+ one-time fees) = upfront total.
 *  - Vacation (`shortTermRent`): Nightly rate + Deposit, and an upfront total of
 *    nightly + Cleaning + Service + Taxes on the subtotal.
 * The breakdown is omitted when there is nothing beyond the rent to total. Sale
 * / exchange listings have their own dedicated sections, so this block self-hides
 * when the active mode's rent block is absent.
 *
 * Prices render through `CurrencyFormatter` (converts to the user's display
 * currency); row separators use the canonical Bloom `Divider`.
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
import { type Property } from '@homiio/shared-types';
import type { RentalMode } from '@/utils/propertyUtils';

interface Props {
  property: Property | null | undefined;
  /** The active rent experience — selects which priced block is shown. */
  mode: RentalMode;
}

const PERCENT_DIVISOR = 100;

/** A money row: label + amount (formatted via CurrencyFormatter). */
interface MoneyRow {
  key: string;
  label: string;
  amount: number;
}

export const PricingDetails: React.FC<Props> = ({ property, mode }) => {
  const { t } = useTranslation();

  const isVacation = mode === 'vacation';
  const longTerm = property?.longTermRent;
  const shortTerm = property?.shortTermRent;

  // The headline rent amount + its currency + per-unit suffix come from the
  // active mode's block. The unit is fixed per block (month vs night).
  const rentAmount = isVacation ? shortTerm?.nightlyRate : longTerm?.monthlyAmount;
  const currency = (isVacation ? shortTerm?.currency : longTerm?.currency) ?? 'EUR';
  const rentUnit = isVacation
    ? t('listing.offering.perNightUnit', 'night')
    : t('listing.offering.perMonthUnit', 'month');
  const deposit = isVacation ? shortTerm?.deposit : longTerm?.deposit;
  const utilitiesValue = isVacation ? undefined : longTerm?.utilities;
  const utilitiesIncluded =
    utilitiesValue === undefined ? undefined : utilitiesValue === 'included';

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
  // Long-term move-in = rent + deposit (+ one-time application/late fees).
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
    if (shortTerm?.cleaningFee) {
      moveInRows.push({
        key: 'cleaning',
        label: t('property.moveInCost.cleaningFee'),
        amount: shortTerm.cleaningFee,
      });
      total += shortTerm.cleaningFee;
    }
    if (shortTerm?.serviceFee) {
      moveInRows.push({
        key: 'service',
        label: t('property.moveInCost.serviceFee'),
        amount: shortTerm.serviceFee,
      });
      total += shortTerm.serviceFee;
    }
    if (shortTerm?.taxesPercent) {
      const taxes = Math.round((total * shortTerm.taxesPercent) / PERCENT_DIVISOR);
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
    if (longTerm?.applicationFee) {
      moveInRows.push({
        key: 'applicationFee',
        label: t('property.moveInCost.fees'),
        amount: longTerm.applicationFee,
      });
      total += longTerm.applicationFee;
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
              {row.key === 'rent' ? (
                <BloomText style={styles.unit}>{` /${rentUnit}`}</BloomText>
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
