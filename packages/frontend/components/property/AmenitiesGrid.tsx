/**
 * AmenitiesGrid — Airbnb-style "What this place offers" 2-column grid.
 *
 * Shows up to `maxVisible` amenities (default 10) with an icon and
 * name. If the property has more, a Bloom Button reveals the full list
 * in a Bloom-based bottom sheet.
 *
 * All chrome — typography, button, divider — comes from Bloom. The
 * icons map to `Ionicons` via the shared `getAmenityById` helper so
 * the visual language matches the rest of the app.
 */
import React, { useCallback, useContext, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';
import { Divider } from '@oxyhq/bloom/divider';
import { H2, Text as BloomText } from '@oxyhq/bloom/typography';

import { BottomSheetContext } from '@/context/BottomSheetContext';
import { Section } from '@/components/property/Section';
import { colors } from '@/styles/colors';
import { sectionSpacing, spacing } from '@/constants/styles';
import { getAmenityById } from '@/constants/amenities';

interface AmenitiesGridProps {
  property: { amenities?: string[] | null };
  maxVisible?: number;
}

interface AmenityRowProps {
  id: string;
  showDivider?: boolean;
}

const AmenityRow: React.FC<AmenityRowProps> = ({ id, showDivider = false }) => {
  const { t } = useTranslation();
  const config = getAmenityById(id);
  const label = config?.nameKey
    ? t(config.nameKey, config.name ?? id) || (config.name ?? id)
    : config?.name ?? id;
  const iconName = (config?.icon as React.ComponentProps<typeof Ionicons>['name']) ?? 'checkmark-circle-outline';

  return (
    <View style={styles.row}>
      <View style={styles.rowContent}>
        <Ionicons
          name={iconName}
          size={22}
          color={colors.COLOR_BLACK_LIGHT_3}
          style={styles.rowIcon}
        />
        <BloomText style={styles.rowLabel}>{label}</BloomText>
      </View>
      {showDivider ? <Divider style={styles.divider} /> : null}
    </View>
  );
};

const AmenitiesFullList: React.FC<{ amenities: string[]; onClose: () => void }> = ({
  amenities,
  onClose,
}) => {
  const { t } = useTranslation();
  return (
    <View style={styles.sheetContent}>
      <H2 style={styles.sheetTitle}>
        {t('property.amenities.allTitle', 'What this place offers')}
      </H2>
      <View style={styles.sheetList}>
        {amenities.map((id, idx) => (
          <AmenityRow
            key={`${id}-${idx}`}
            id={id}
            showDivider={idx !== amenities.length - 1}
          />
        ))}
      </View>
      <View style={styles.sheetActions}>
        <Button onPress={onClose} variant="primary" size="medium">
          {t('common.close', 'Close')}
        </Button>
      </View>
    </View>
  );
};

export const AmenitiesGrid: React.FC<AmenitiesGridProps> = ({
  property,
  maxVisible = 10,
}) => {
  const { t } = useTranslation();
  const bottomSheet = useContext(BottomSheetContext);

  const amenities = useMemo(
    () => (property?.amenities ?? []).filter(Boolean),
    [property?.amenities],
  );

  const handleShowAll = useCallback(() => {
    bottomSheet.openBottomSheet(
      <AmenitiesFullList
        amenities={amenities}
        onClose={() => bottomSheet.closeBottomSheet()}
      />,
    );
  }, [amenities, bottomSheet]);

  if (amenities.length === 0) return null;

  const visible = amenities.slice(0, maxVisible);
  const hasMore = amenities.length > maxVisible;

  return (
    <Section title={t('property.amenities.title', 'What this place offers')}>
      <View style={styles.grid}>
        {visible.map((id, idx) => (
          <View key={`${id}-${idx}`} style={styles.cell}>
            <AmenityRow id={id} />
          </View>
        ))}
      </View>
      {hasMore ? (
        <View style={styles.actionAnchor}>
          <Button
            onPress={handleShowAll}
            variant="secondary"
            size="medium"
            accessibilityLabel={t(
              'property.amenities.showAll',
              `Show all ${amenities.length} amenities`,
            )}
          >
            {t('property.amenities.showAll', `Show all ${amenities.length} amenities`)}
          </Button>
        </View>
      ) : null}
    </Section>
  );
};

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  cell: {
    width: '48%',
    minWidth: 200,
    flexGrow: 1,
  },
  row: {
    flexDirection: 'column',
  },
  rowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  rowIcon: {
    width: 24,
    textAlign: 'center',
  },
  rowLabel: {
    fontSize: 15,
    color: colors.COLOR_BLACK,
    flex: 1,
  },
  divider: {
    marginVertical: 0,
  },
  actionAnchor: {
    marginTop: spacing.xl,
    alignSelf: 'flex-start',
  },
  sheetContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing['2xl'],
  },
  sheetTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    marginBottom: spacing.lg,
  },
  sheetList: {
    marginBottom: spacing.xl,
  },
  sheetActions: {
    alignItems: 'stretch',
    marginTop: sectionSpacing.mobile / 4,
  },
});

export default AmenitiesGrid;
