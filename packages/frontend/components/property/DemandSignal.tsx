/**
 * DemandSignal — understated "freshness + interest" line near the property
 * title (companion to the price-transparency block).
 *
 * Shows how long ago the listing was posted ("Listed today" / "Listed N days
 * ago", from `createdAt`) and, when there is interest, "· {n} saved" (from
 * `usePropertyStats().savesCount`). Deliberately secondary text — not a loud
 * badge. Renders nothing if we can't derive a sensible "listed" label.
 */
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { differenceInCalendarDays } from 'date-fns';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { usePropertyStats } from '@/hooks';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

interface DemandSignalProps {
  propertyId: string;
  /** Listing creation timestamp (ISO-8601). */
  createdAt: string | undefined;
}

/** Safely read `savesCount` off the (loosely-typed) stats payload. */
const readSavesCount = (stats: unknown): number => {
  if (
    stats &&
    typeof stats === 'object' &&
    'savesCount' in stats &&
    typeof (stats as { savesCount?: unknown }).savesCount === 'number'
  ) {
    return (stats as { savesCount: number }).savesCount;
  }
  return 0;
};

/** Calendar days between `createdAt` and today, or null if the date is unusable. */
const daysSince = (createdAt: string | undefined): number | null => {
  if (!createdAt) return null;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return null;
  const diff = differenceInCalendarDays(new Date(), created);
  return diff < 0 ? 0 : diff;
};

export const DemandSignal: React.FC<DemandSignalProps> = ({
  propertyId,
  createdAt,
}) => {
  const { t } = useTranslation();
  const { stats } = usePropertyStats(propertyId);

  const listedLabel = useMemo(() => {
    const days = daysSince(createdAt);
    if (days === null) return null;
    if (days === 0) return t('property.demand.listedToday');
    if (days === 1) return t('property.demand.listedYesterday');
    return t('property.demand.listedDaysAgo', { count: days });
  }, [createdAt, t]);

  const savesCount = readSavesCount(stats);

  if (!listedLabel) return null;

  const savedLabel =
    savesCount > 0 ? t('property.demand.saved', { count: savesCount }) : null;

  return (
    <View style={styles.row}>
      <Ionicons
        name="time-outline"
        size={13}
        color={colors.COLOR_BLACK_LIGHT_4}
      />
      <BloomText style={styles.text}>
        {listedLabel}
        {savedLabel ? (
          <>
            <BloomText style={styles.separator}>{'  ·  '}</BloomText>
            <BloomText style={styles.text}>{savedLabel}</BloomText>
          </>
        ) : null}
      </BloomText>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  text: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  separator: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_5,
  },
});

export default DemandSignal;
