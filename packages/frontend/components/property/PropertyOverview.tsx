/**
 * PropertyOverview — small key/value summary of bedrooms, bathrooms,
 * size, and (when present) floor.
 *
 * Uses Bloom Typography and Bloom Divider. The original implementation
 * concatenated `label: value` inside a single <Text>, which read like a
 * data dump; this version mirrors the Pricing section's row pattern so
 * the visual rhythm matches the rest of the detail page.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Divider } from '@oxyhq/bloom/divider';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { Section } from '@/components/property/Section';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

interface OverviewProperty {
  bedrooms?: number;
  bathrooms?: number;
  size?: number;
  squareFootage?: number;
  floor?: number;
}

interface Props {
  property: OverviewProperty | null | undefined;
}

interface Row {
  label: string;
  value: string;
}

export const PropertyOverview: React.FC<Props> = ({ property }) => {
  const { t } = useTranslation();
  const size = property?.size ?? property?.squareFootage;

  const rows: Row[] = [
    {
      label: t('property.sections.bedrooms'),
      value: property?.bedrooms !== undefined ? String(property.bedrooms) : '-',
    },
    {
      label: t('property.sections.bathrooms'),
      value: property?.bathrooms !== undefined ? String(property.bathrooms) : '-',
    },
    {
      label: t('property.sections.size'),
      value: size !== undefined ? `${size}m²` : '-',
    },
    ...(property?.floor !== undefined
      ? [
          {
            label: t('property.sections.floor'),
            value: String(property.floor),
          },
        ]
      : []),
  ];

  return (
    <Section title={t('property.sections.overview')}>
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

export default PropertyOverview;
