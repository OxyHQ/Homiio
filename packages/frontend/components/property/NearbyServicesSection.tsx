/**
 * NearbyServicesSection — the "What's nearby" block on the property detail
 * screen.
 *
 * Powered by `GET /api/properties/:id/nearby-services` (via `useNearbyServices`),
 * which reports, for a fixed set of everyday services (pharmacy, school,
 * transit, …), whether each exists near the listing's coordinates — presence,
 * count and the distance to the nearest one (sourced from OpenStreetMap).
 *
 * We render EVERY category so the user can see what IS and ISN'T nearby (the
 * whole point is to answer "is there a school nearby?"). Present categories
 * come first — brand-tinted icon + label + nearest distance ("Pharmacy ·
 * 153 m"). Absent categories follow, muted (greyed icon + label + em-dash).
 *
 * Fails soft: hides itself on error. A `partial` payload (upstream timeout or
 * the property has no coordinates) is treated as "unknown" — we still show what
 * IS present, but if EVERYTHING is absent under `partial` we hide the section
 * rather than imply "nothing nearby". A subtle note caveats partial data.
 *
 * Flat Airbnb-2026 aesthetic via the shared `Section` primitive and the same
 * 2-column responsive grid as `AmenitiesGrid` — no cards, no shadows.
 */
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import * as Skeleton from '@oxyhq/bloom/skeleton';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { Section } from '@/components/property/Section';
import { useNearbyServices } from '@/hooks';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import type { NearbyServiceCategory, NearbyServiceKey } from '@homiio/shared-types';

interface NearbyServicesSectionProps {
  propertyId: string;
}

/** Icon + i18n label for each service category. Keyed by `NearbyServiceKey`
 *  so every key is covered exhaustively (a missing entry is a type error). */
const SERVICE_META: Record<
  NearbyServiceKey,
  { icon: React.ComponentProps<typeof Ionicons>['name']; labelKey: string }
> = {
  pharmacy: { icon: 'medkit-outline', labelKey: 'property.nearbyServices.labels.pharmacy' },
  school: { icon: 'school-outline', labelKey: 'property.nearbyServices.labels.school' },
  hospital: { icon: 'medical-outline', labelKey: 'property.nearbyServices.labels.hospital' },
  police: { icon: 'shield-outline', labelKey: 'property.nearbyServices.labels.police' },
  fire_station: { icon: 'flame-outline', labelKey: 'property.nearbyServices.labels.fire_station' },
  supermarket: { icon: 'cart-outline', labelKey: 'property.nearbyServices.labels.supermarket' },
  transit: { icon: 'bus-outline', labelKey: 'property.nearbyServices.labels.transit' },
  park: { icon: 'leaf-outline', labelKey: 'property.nearbyServices.labels.park' },
  bank: { icon: 'card-outline', labelKey: 'property.nearbyServices.labels.bank' },
  restaurant: { icon: 'restaurant-outline', labelKey: 'property.nearbyServices.labels.restaurant' },
  gym: { icon: 'barbell-outline', labelKey: 'property.nearbyServices.labels.gym' },
};

/** Icon size for service rows — matches the amenity grid (line weight). */
const SERVICE_ICON_SIZE = 24;
/** Metres in one kilometre — distances at/above this switch to a km label. */
const METRES_PER_KM = 1000;
/** Em-dash shown for absent categories (no distance). */
const ABSENT_DISTANCE = '—';

/**
 * Format a straight-line distance in metres for display: `< 1 km` reads in
 * whole metres ("153 m"), otherwise one decimal of kilometres ("1.2 km").
 * `null` (absent category) renders the em-dash placeholder.
 */
const formatDistance = (metres: number | null): string => {
  if (metres === null) return ABSENT_DISTANCE;
  if (metres < METRES_PER_KM) return `${Math.round(metres)} m`;
  return `${(metres / METRES_PER_KM).toFixed(1)} km`;
};

interface ServiceRowProps {
  category: NearbyServiceCategory;
  label: string;
  distanceLabel: string;
}

/**
 * One service row: icon + label + nearest distance. Present categories render
 * in full strength (brand icon, dark label, dark distance); absent categories
 * are muted (greyed icon/label + em-dash) so the absence is legible but quiet.
 */
const ServiceRow: React.FC<ServiceRowProps> = ({ category, label, distanceLabel }) => {
  const { present } = category;
  return (
    <View style={styles.row}>
      <Ionicons
        name={SERVICE_META[category.key].icon}
        size={SERVICE_ICON_SIZE}
        color={present ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_5}
        style={styles.rowIcon}
      />
      <View style={styles.rowText}>
        <BloomText style={present ? styles.rowLabel : styles.rowLabelMuted}>
          {label}
        </BloomText>
        <BloomText style={present ? styles.rowDistance : styles.rowDistanceMuted}>
          {distanceLabel}
        </BloomText>
      </View>
    </View>
  );
};

export const NearbyServicesSection: React.FC<NearbyServicesSectionProps> = ({
  propertyId,
}) => {
  const { t } = useTranslation();
  const { nearbyServices, loading, error } = useNearbyServices(propertyId);

  // Fail soft: an errored call hides the section rather than crashing the page.
  if (error) return null;

  if (loading) {
    return (
      <Section title={t('property.nearbyServices.title')}>
        <View style={styles.skeletonGrid}>
          {SKELETON_ROWS.map((key) => (
            <View key={key} style={styles.cell}>
              <Skeleton.Box width="80%" height={20} borderRadius={radius.md} />
            </View>
          ))}
        </View>
      </Section>
    );
  }

  if (!nearbyServices) return null;

  return (
    <NearbyServicesContent t={t} data={nearbyServices} />
  );
};

interface NearbyServicesContentProps {
  t: ReturnType<typeof useTranslation>['t'];
  data: NonNullable<ReturnType<typeof useNearbyServices>['nearbyServices']>;
}

const NearbyServicesContent: React.FC<NearbyServicesContentProps> = ({ t, data }) => {
  const { categories, partial, radiusM } = data;

  // Present first (nearest → farthest), then absent. Sorting buys a tidy "what's
  // here" cluster up top and pushes the em-dash rows below.
  const ordered = useMemo(() => {
    return [...categories].sort((a, b) => {
      if (a.present !== b.present) return a.present ? -1 : 1;
      if (a.present && b.present) {
        return (a.nearestM ?? Infinity) - (b.nearestM ?? Infinity);
      }
      return 0;
    });
  }, [categories]);

  const presentCount = useMemo(
    () => categories.filter((category) => category.present).length,
    [categories],
  );

  // Degraded + nothing present → "unknown", not "nothing nearby": hide the
  // section instead of rendering an all-em-dash grid that would mislead.
  if (partial && presentCount === 0) return null;

  const radiusKm = radiusM / METRES_PER_KM;
  const subtitle = t('property.nearbyServices.within', {
    km: Number.isInteger(radiusKm) ? radiusKm : radiusKm.toFixed(1),
  });

  return (
    <Section title={t('property.nearbyServices.title')} subtitle={subtitle}>
      <View style={styles.grid}>
        {ordered.map((category) => (
          <View key={category.key} style={styles.cell}>
            <ServiceRow
              category={category}
              label={t(SERVICE_META[category.key].labelKey)}
              distanceLabel={formatDistance(category.nearestM)}
            />
          </View>
        ))}
      </View>
      {partial ? (
        <BloomText style={styles.partialNote}>
          {t('property.nearbyServices.partialNote')}
        </BloomText>
      ) : null}
    </Section>
  );
};

/** Stable keys for the loading skeleton (8 placeholder rows). */
const SKELETON_ROWS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'] as const;

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing['2xl'],
    rowGap: spacing.lg,
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: spacing['2xl'],
    rowGap: spacing.lg,
  },
  cell: {
    width: '46%',
    minWidth: 220,
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.lg,
  },
  rowIcon: {
    width: SERVICE_ICON_SIZE,
    textAlign: 'center',
  },
  rowText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rowLabel: {
    flexShrink: 1,
    fontSize: 16,
    lineHeight: 22,
    color: colors.COLOR_BLACK,
  },
  rowLabelMuted: {
    flexShrink: 1,
    fontSize: 16,
    lineHeight: 22,
    color: colors.COLOR_BLACK_LIGHT_5,
  },
  rowDistance: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  rowDistanceMuted: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_5,
  },
  partialNote: {
    marginTop: spacing.lg,
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    fontStyle: 'italic',
    lineHeight: 16,
  },
});

export default NearbyServicesSection;
