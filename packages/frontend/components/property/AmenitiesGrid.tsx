/**
 * AmenitiesGrid — Airbnb-2026 "What this place offers".
 *
 * In-page: Bloom's `AmenityList` — icon + label rows in one or two columns
 * (by its own width), capped at `maxVisible`, with its "Show all N amenities"
 * button when the listing has more.
 *
 * Show-all: a bottom sheet (via the app's `BottomSheetContext`, the same
 * mechanism `SortMenu` / `SearchFiltersDialog` use) listing every
 * amenity, grouped under category subheadings ("Kitchen & dining", "Internet
 * & office", …) in catalog order. Because the provider mounts content with
 * `scrollable={false}`, the sheet owns its own `ScrollView` so long lists
 * scroll inside a bounded height.
 *
 * Icons + labels come from the shared amenity catalog (`getAmenityById`,
 * `groupAmenitiesByCategory`) so the visual + textual language matches the
 * rest of the app. The sheet keeps the catalog's illustrated icons; the
 * in-page list draws the line glyphs, which is all `AmenityList` takes.
 */
import React, { useCallback, useContext, useMemo } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AmenityList, type Amenity as ListedAmenity } from '@oxy.so/bloom/listing-details';
import { RiCheckboxCircleLine } from '@oxy.so/bloom/icons';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { BottomSheetContext } from '@/context/BottomSheetContext';
import { Section, SectionHeader } from '@/components/property/Section';
import {
  DetailIcon,
  DetailIconRow,
  type DetailFallbackIcon,
} from '@/components/property/DetailIconGrid';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
import { getIconArt } from '@/constants/iconArt';
import {
  type Amenity,
  type AmenityGroup,
  type ResolvedAmenity,
  groupAmenitiesByCategory,
  UNCATEGORIZED_AMENITY_ID,
} from '@/constants/amenities';

/** Fraction of the viewport the sheet's scroll body may occupy at most. */
const SHEET_MAX_HEIGHT_RATIO = 0.62;
/** Fallback glyph when an amenity id has no catalog icon. */
const FALLBACK_ICON: DetailFallbackIcon = RiCheckboxCircleLine;

interface AmenitiesGridProps {
  property: { amenities?: string[] | null };
  /** Max amenities shown in the in-page preview grid before "Show all". */
  maxVisible?: number;
}

/** Title-case a snake_case slug so an unmapped id never renders as a raw slug. */
function humanizeAmenityId(id: string): string {
  return id
    .split('_')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Resolve the localized, human label for a resolved amenity. */
function useAmenityLabel(): (entry: ResolvedAmenity) => string {
  const { t } = useTranslation();
  return useCallback(
    ({ id, amenity }: ResolvedAmenity): string => {
      if (!amenity?.nameKey) return humanizeAmenityId(id);
      return t(amenity.nameKey);
    },
    [t],
  );
}

/** Map an amenity's catalog icon to a glyph, with a safe fallback. */
function resolveIcon(amenity?: Amenity): DetailFallbackIcon {
  return amenity?.icon ?? FALLBACK_ICON;
}

interface AmenityRowProps {
  entry: ResolvedAmenity;
  label: string;
  /** Hairline above the row (used inside the show-all sheet, not the preview). */
  divided?: boolean;
}

/**
 * One amenity line: icon + label. Flat by default; the sheet variant adds a
 * top hairline so items in a category read as a clean list. Delegates the
 * layout to the shared `DetailIconRow` so it can't drift from the nearby grid.
 */
const AmenityRow: React.FC<AmenityRowProps> = ({ entry, label, divided = false }) => (
  <DetailIconRow
    icon={<DetailIcon image={getIconArt(entry.id)} fallbackIcon={resolveIcon(entry.amenity)} />}
    label={label}
    divided={divided}
  />
);

interface AmenitiesSheetProps {
  ids: string[];
  maxScrollHeight: number;
}

/**
 * Full amenity list for the bottom sheet — grouped by category with Airbnb-
 * style subheadings. Owns its own scroll container (the provider mounts sheet
 * content non-scrollable) bounded to `maxScrollHeight`.
 */
const AmenitiesSheet: React.FC<AmenitiesSheetProps> = ({ ids, maxScrollHeight }) => {
  const { t } = useTranslation();
  const resolveLabel = useAmenityLabel();
  const groups = useMemo<AmenityGroup[]>(() => groupAmenitiesByCategory(ids), [ids]);

  const resolveGroupTitle = useCallback(
    (group: AmenityGroup): string => {
      if (group.categoryId === UNCATEGORIZED_AMENITY_ID || !group.category) {
        return t('amenities.categories.other');
      }
      const { nameKey } = group.category;
      return nameKey ? t(nameKey) : group.categoryId;
    },
    [t],
  );

  return (
    <View style={styles.sheet}>
      <View style={styles.sheetHeader}>
        <SectionHeader title={t('property.amenities.title')} />
      </View>
      <ScrollView
        style={[styles.sheetScroll, { maxHeight: maxScrollHeight }]}
        contentContainerStyle={styles.sheetScrollContent}
        showsVerticalScrollIndicator={false}
      >
        {groups.map((group) => (
          <View key={group.categoryId} style={styles.group}>
            <BloomText variant="title-3-semibold" style={styles.groupTitle}>{resolveGroupTitle(group)}</BloomText>
            <View>
              {group.amenities.map((entry, idx) => (
                <AmenityRow
                  key={`${entry.id}-${idx}`}
                  entry={entry}
                  label={resolveLabel(entry)}
                  divided={idx > 0}
                />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
};

export const AmenitiesGrid: React.FC<AmenitiesGridProps> = ({
  property,
  maxVisible = 10,
}) => {
  const { t } = useTranslation();
  const bottomSheet = useContext(BottomSheetContext);
  const resolveLabel = useAmenityLabel();
  const { height } = useWindowDimensions();

  const ids = useMemo(
    () => (property?.amenities ?? []).filter((id): id is string => Boolean(id)),
    [property?.amenities],
  );

  // Catalog order (grouped by category), so the preview leads with essentials.
  const items = useMemo<ListedAmenity[]>(
    () =>
      groupAmenitiesByCategory(ids)
        .flatMap((group) => group.amenities)
        .map((entry) => ({ label: resolveLabel(entry), icon: resolveIcon(entry.amenity) })),
    [ids, resolveLabel],
  );

  const maxScrollHeight = useMemo(
    () => Math.round(height * SHEET_MAX_HEIGHT_RATIO),
    [height],
  );

  const handleShowAll = useCallback(() => {
    bottomSheet.openBottomSheet(
      <AmenitiesSheet ids={ids} maxScrollHeight={maxScrollHeight} />,
    );
  }, [bottomSheet, ids, maxScrollHeight]);

  if (ids.length === 0) return null;

  return (
    <Section title={t('property.amenities.title')}>
      <AmenityList
        items={items}
        limit={maxVisible}
        onShowAll={handleShowAll}
        showAllLabel={(count) => t('property.amenities.showAll', { count })}
      />
    </Section>
  );
};

const styles = StyleSheet.create({
  sheet: {
    paddingBottom: spacing['2xl'],
  },
  sheetHeader: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
  },
  sheetScroll: {
    paddingHorizontal: spacing.xl,
  },
  sheetScrollContent: {
    paddingBottom: spacing.lg,
  },
  group: {
    marginBottom: spacing['2xl'],
  },
  groupTitle: {
    color: colors.COLOR_BLACK,
    marginBottom: spacing.xs,
    letterSpacing: -0.2,
  },
});

export default AmenitiesGrid;
