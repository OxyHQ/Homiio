/**
 * DimensionBreakdown — the client-side aggregate distribution for one review
 * section (apartment / management / building / area), computed from the loaded
 * reviews. For each dimension present in the set it shows the count of each
 * enum value as a proportional bar. Renders nothing when the section has no data.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import type { ReviewDTO } from '@homiio/shared-types';

import {
  SECTION_DIMENSIONS,
  SERVICE_VALUES,
  type ReviewSection,
} from '@/components/reviews/dimensions';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

interface DistributionEntry {
  label: string;
  count: number;
}

interface DistributionBlock {
  title: string;
  entries: DistributionEntry[];
}

interface DimensionBreakdownProps {
  reviews: ReviewDTO[];
  section: ReviewSection;
}

const DistributionRow: React.FC<{ entry: DistributionEntry; max: number }> = ({ entry, max }) => {
  const ratio = max > 0 ? entry.count / max : 0;
  return (
    <View style={styles.row}>
      <BloomText style={styles.rowLabel} numberOfLines={1}>
        {entry.label}
      </BloomText>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%` }]} />
      </View>
      <BloomText style={styles.rowCount}>{entry.count}</BloomText>
    </View>
  );
};

export const DimensionBreakdown: React.FC<DimensionBreakdownProps> = ({ reviews, section }) => {
  const { t } = useTranslation();
  const blocks: DistributionBlock[] = [];

  for (const dimension of SECTION_DIMENSIONS[section]) {
    const counts = new Map<string, number>();
    for (const review of reviews) {
      const raw = review[dimension.field];
      if (typeof raw === 'string' && raw.length > 0) {
        counts.set(raw, (counts.get(raw) ?? 0) + 1);
      }
    }
    const entries: DistributionEntry[] = dimension.values
      .filter((value) => counts.has(value))
      .map((value) => ({ label: t(`${dimension.enumPrefix}.${value}`), count: counts.get(value) ?? 0 }));
    if (entries.length > 0) {
      blocks.push({ title: t(dimension.labelKey), entries });
    }
  }

  if (section === 'building') {
    let yes = 0;
    let no = 0;
    for (const review of reviews) {
      if (review.touristApartments === true) yes += 1;
      else if (review.touristApartments === false) no += 1;
    }
    if (yes + no > 0) {
      blocks.push({
        title: t('reviews.write.fields.touristApartments'),
        entries: [
          { label: t('common.yes'), count: yes },
          { label: t('common.no'), count: no },
        ].filter((entry) => entry.count > 0),
      });
    }

    const serviceCounts = new Map<string, number>();
    for (const review of reviews) {
      for (const service of review.services ?? []) {
        serviceCounts.set(service, (serviceCounts.get(service) ?? 0) + 1);
      }
    }
    const serviceEntries: DistributionEntry[] = SERVICE_VALUES.filter((value) => serviceCounts.has(value)).map(
      (value) => ({ label: t(`reviews.enums.services.${value}`), count: serviceCounts.get(value) ?? 0 }),
    );
    if (serviceEntries.length > 0) {
      blocks.push({ title: t('reviews.write.fields.services'), entries: serviceEntries });
    }
  }

  if (blocks.length === 0) return null;

  return (
    <View style={styles.container}>
      {blocks.map((block) => {
        const max = Math.max(...block.entries.map((entry) => entry.count), 1);
        return (
          <View key={block.title} style={styles.block}>
            <BloomText style={styles.blockTitle}>{block.title}</BloomText>
            {block.entries.map((entry) => (
              <DistributionRow key={entry.label} entry={entry} max={max} />
            ))}
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  block: {
    gap: spacing.xs,
  },
  blockTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rowLabel: {
    width: 120,
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  track: {
    flex: 1,
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radius.pill,
    backgroundColor: colors.primaryColor,
  },
  rowCount: {
    minWidth: 20,
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
    textAlign: 'right',
  },
});

export default DimensionBreakdown;
