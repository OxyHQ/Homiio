/**
 * "Where you'll sleep" section for vacation listings — Airbnb pattern.
 *
 * Renders one Bloom `Card` per bedroom with a bed icon and a label. The
 * Property schema only carries an integer `bedrooms` count today
 * (no per-room breakdown), so we synthesize the placeholder card
 * copy ("1 bed") for each bedroom. When the schema later adds a
 * per-room `rooms` array we can enrich this without changing the
 * call sites.
 *
 * Only renders when:
 *   - the property is vacation-capable (carries the SHORT_TERM_RENT offering), AND
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

import { Card } from '@oxy.so/bloom/card';
import { RiHotelBedLine } from '@oxy.so/bloom/icons';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { SectionHeader, SECTION_GUTTER } from '@/components/property/Section';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
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
          ? t('property.sleep.mainBedroom') ?? 'Main bedroom'
          : (t('property.sleep.bedroomN', { n: idx + 1 }) as string) ||
            `Bedroom ${idx + 1}`,
      description:
        (t('property.sleep.oneBed') as string) || '1 bed',
    }));
  }, [property.bedrooms, t]);

  if (bedrooms.length === 0) return null;

  return (
    <View>
      <SectionHeader title={t('property.sleep.title')} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {bedrooms.map((bedroom) => (
          <Card
            key={bedroom.id}
            variant="outlined"
            radius="radius-16"
            style={styles.bedroomCard}
          >
            <RiHotelBedLine width={26} height={26} fill={colors.COLOR_BLACK} />
            <View>
              <BloomText variant="headline-semibold" style={styles.bedroomTitle}>
                {bedroom.title}
              </BloomText>
              <BloomText variant="body-2-regular" style={styles.bedroomDescription}>
                {bedroom.description}
              </BloomText>
            </View>
          </Card>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  scrollContent: {
    gap: spacing.md,
    paddingTop: spacing.md,
    paddingHorizontal: SECTION_GUTTER,
  },
  bedroomCard: {
    width: 200,
    height: 140,
    padding: spacing.xl,
    justifyContent: 'space-between',
  },
  bedroomTitle: {
    color: colors.COLOR_BLACK,
  },
  bedroomDescription: {
    color: colors.COLOR_BLACK_LIGHT_3,
  },
});

export default SleepArrangement;
