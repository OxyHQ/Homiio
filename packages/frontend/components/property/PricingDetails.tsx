/**
 * PricingDetails — "Pricing & Costs" block on the property detail.
 *
 * Migrated to Bloom Typography + Divider so the values inherit the
 * canonical type scale and the row separators are the canonical
 * hairline.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Divider } from '@oxyhq/bloom/divider';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { Section } from '@/components/property/Section';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

interface Property {
  rent?: { amount?: number; paymentFrequency?: string };
  priceUnit?: string;
}

interface Props {
  property: Property | null | undefined;
}

interface Row {
  label: string;
  value: string;
}

export const PricingDetails: React.FC<Props> = ({ property }) => {
  const { t } = useTranslation();
  const rentAmount = property?.rent?.amount;
  const rentFrequency = property?.priceUnit ?? property?.rent?.paymentFrequency;
  const deposit = (property as { rent?: { deposit?: number } })?.rent?.deposit;
  const utilitiesIncluded =
    (property as { rent?: { utilities?: string } })?.rent?.utilities === 'included';

  if (
    rentAmount === undefined &&
    deposit === undefined &&
    utilitiesIncluded === undefined
  ) {
    return null;
  }

  const rows: Row[] = [];
  if (rentAmount !== undefined) {
    rows.push({
      label: t('Rent', 'Rent') || 'Rent',
      value: `$${rentAmount}${rentFrequency ? `/${rentFrequency}` : ''}`,
    });
  }
  if (deposit !== undefined) {
    rows.push({
      label: t('Deposit', 'Deposit') || 'Deposit',
      value: `$${deposit}`,
    });
  }
  if (utilitiesIncluded !== undefined) {
    rows.push({
      label: t('Utilities Included', 'Utilities Included') || 'Utilities Included',
      value: utilitiesIncluded ? (t('Yes', 'Yes') || 'Yes') : (t('No', 'No') || 'No'),
    });
  }

  return (
    <Section title={t('Pricing & Costs', 'Pricing & Costs')}>
      {rows.map((row, idx) => (
        <React.Fragment key={row.label}>
          <View style={styles.row}>
            <BloomText style={styles.label}>{row.label}</BloomText>
            <BloomText style={styles.value}>{row.value}</BloomText>
          </View>
          {idx !== rows.length - 1 ? <Divider /> : null}
        </React.Fragment>
      ))}
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
});

export default PricingDetails;
