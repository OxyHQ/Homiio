/**
 * LocationDisplay — refined "Where you'll be" section for the property
 * detail. Embeds the shared Map at a fixed height with a rounded
 * surface, then a Bloom-typography neighborhood blurb below. Owns the
 * Airbnb-2026 visual for the property location block.
 */
import React, { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import Map from '@/components/Map';
import { SectionHeader, SECTION_GUTTER } from '@/components/property/Section';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
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
    // Geo is relational: use the server-resolved display NAMES
    // (neighborhood/city/region/country), not the geo `*Id` references.
    const parts = [
      address.neighborhoodName,
      address.cityName,
      address.regionName,
      address.countryName,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  }, [address]);

  if (!coordinates && !neighborhoodSummary) return null;

  return (
    <View>
      <SectionHeader title={t('property.location.title')} />
      <View style={styles.body}>
        {neighborhoodSummary ? (
          <BloomText style={styles.summary}>{neighborhoodSummary}</BloomText>
        ) : null}
        {coordinates ? (
          <View style={styles.mapWrapper}>
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
    </View>
  );
};

const styles = StyleSheet.create({
  body: {
    marginTop: spacing.md,
    gap: spacing.md,
    paddingHorizontal: SECTION_GUTTER,
  },
  summary: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  mapWrapper: {
    borderRadius: radius.xl,
    overflow: 'hidden',
  },
  map: {
    height: Platform.OS === 'web' ? 360 : 260,
    width: '100%',
  },
});

export default LocationDisplay;
