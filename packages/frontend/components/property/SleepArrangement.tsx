/**
 * "Where you'll sleep" section for vacation listings — Airbnb pattern.
 *
 * Renders one card per bedroom with a bed icon and a label. The
 * Property schema only carries an integer `bedrooms` count today
 * (no per-room breakdown), so we synthesize the placeholder card
 * copy ("1 bed") for each bedroom. When the schema later adds a
 * per-room `rooms` array we can enrich this without changing the
 * call sites.
 *
 * Only renders when:
 *   - the property is vacation-capable (`rentMode` is VACATION or BOTH), AND
 *   - the user is currently browsing in vacation mode, AND
 *   - the listing reports at least one bedroom.
 *
 * The host-side caller is responsible for the rental-mode gate via
 * the property detail screen; this component bails on the bedroom
 * gate so it can also be dropped in elsewhere without footguns.
 */
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Text as BloomText, H2 } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { radius, spacing, withShadow } from '@/constants/styles';
import type { Property } from '@homiio/shared-types';

interface SleepArrangementProps {
  property: Property;
}

interface BedroomEntry {
  id: number;
  title: string;
  description: string;
}

export const SleepArrangement: React.FC<SleepArrangementProps> = ({ property }) => {
  const { t } = useTranslation();

  const bedrooms = useMemo<BedroomEntry[]>(() => {
    const count = property.bedrooms ?? 0;
    if (count <= 0) return [];
    return Array.from({ length: count }).map((_, idx) => ({
      id: idx + 1,
      title:
        idx === 0
          ? t('property.sleep.mainBedroom', 'Main bedroom') ?? 'Main bedroom'
          : (t('property.sleep.bedroomN', { n: idx + 1 }) as string) ||
            `Bedroom ${idx + 1}`,
      description:
        (t('property.sleep.oneBed', '1 bed') as string) || '1 bed',
    }));
  }, [property.bedrooms, t]);

  if (bedrooms.length === 0) return null;

  return (
    <View style={styles.section}>
      <H2 style={styles.title}>
        {t('property.sleep.title', "Where you'll sleep")}
      </H2>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {bedrooms.map((bedroom) => (
          <View
            key={bedroom.id}
            style={[styles.bedroomCard, withShadow('sm')]}
          >
            <Ionicons name="bed-outline" size={26} color={colors.COLOR_BLACK} />
            <BloomText style={styles.bedroomTitle}>{bedroom.title}</BloomText>
            <BloomText style={styles.bedroomDescription}>
              {bedroom.description}
            </BloomText>
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    paddingTop: spacing.md,
    paddingBottom: spacing['2xl'],
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  scrollContent: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  bedroomCard: {
    width: 200,
    height: 140,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.xl,
    justifyContent: 'space-between',
  },
  bedroomTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  bedroomDescription: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
});

export default SleepArrangement;
