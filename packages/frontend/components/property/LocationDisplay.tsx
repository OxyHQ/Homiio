/**
 * LocationDisplay — refined "Where you'll be" section for the property
 * detail. Embeds the shared Map at a fixed height with a rounded
 * surface, then a Bloom-typography neighborhood blurb below.
 *
 * Replaces the older LocationSection which mixed embedded map +
 * fragmented address strings + nearby amenities. This file owns the
 * Airbnb-2026 visual; the older NearbyAmenities can still be rendered
 * separately by the caller if needed.
 */
import React, { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { H2, Text as BloomText } from '@oxyhq/bloom/typography';

import Map from '@/components/Map';
import { colors } from '@/styles/colors';
import { cardShadow, radius, spacing } from '@/constants/styles';
import type { Property } from '@homiio/shared-types';

interface LocationDisplayProps {
  property: Property;
}

const isValidCoordinate = (
  coords: unknown,
): coords is [number, number] => {
  if (!Array.isArray(coords) || coords.length !== 2) return false;
  const [lng, lat] = coords;
  if (typeof lng !== 'number' || typeof lat !== 'number') return false;
  return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
};

export const LocationDisplay: React.FC<LocationDisplayProps> = ({ property }) => {
  const { t } = useTranslation();
  const address = property?.address;

  const coordinates = useMemo(() => {
    const raw =
      address?.coordinates?.type === 'Point'
        ? address.coordinates.coordinates
        : undefined;
    return isValidCoordinate(raw) ? raw : undefined;
  }, [address?.coordinates]);

  const neighborhoodSummary = useMemo(() => {
    if (!address) return null;
    const parts = [
      address.neighborhood,
      address.city,
      address.state,
      address.country,
    ].filter(Boolean);
    return parts.join(', ');
  }, [address]);

  if (!coordinates && !neighborhoodSummary) return null;

  return (
    <View style={styles.section}>
      <H2 style={styles.title}>
        {t('property.location.title', "Where you'll be")}
      </H2>
      {neighborhoodSummary ? (
        <BloomText style={styles.summary}>{neighborhoodSummary}</BloomText>
      ) : null}
      {coordinates ? (
        <View style={[styles.mapWrapper, cardShadow.sm]}>
          <Map
            style={styles.map}
            initialCoordinates={coordinates}
            initialZoom={15}
            startFromCurrentLocation={false}
            screenId={`property-location-${property?._id ?? property?.id ?? 'unknown'}`}
          />
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginTop: spacing['3xl'],
    marginBottom: spacing['3xl'],
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    marginBottom: spacing.md,
  },
  summary: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginBottom: spacing.xl,
  },
  mapWrapper: {
    borderRadius: radius.xl,
    overflow: 'hidden',
    backgroundColor: colors.surfaceElevated,
  },
  map: {
    height: Platform.OS === 'web' ? 360 : 260,
    width: '100%',
  },
});

export default LocationDisplay;
