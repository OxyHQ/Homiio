/**
 * The persistent "where am I looking?" bar (#353).
 *
 * ## It is a GENERAL surface, not a Home component
 *
 * Home is its first consumer; the eviction board and anything else that answers
 * a geographic question is meant to mount the same bar with the same props, so
 * two surfaces cannot state the user's area differently. That is why it takes a
 * `selection` and an `onChange` rather than reading `useLocationScope` itself: a
 * screen may show a scope it does not own (a shared link's area, a saved
 * search's) and a component that reached for the global hook could not.
 *
 * ## Everything it renders is a fact it was given
 *
 * There is no branch here that invents a place name. A `current_location` scope
 * shows "Near {place} · 25 km" only when a reverse geocode supplied `{place}`,
 * and falls back to "Near you · 25 km" otherwise — the radius is real either
 * way, and the label degrading is the geocoder's failure and not the scope's.
 *
 * ## The four states it must tell apart
 *
 *  - **resolved** — the area, its radius when it has one, and a way to change it.
 *  - **resolving** — a skeleton-shaped placeholder that PRESERVES THE LAYOUT, so
 *    the page does not jump when the answer lands.
 *  - **failed** — the reason, named. `permission_denied` and `network` get
 *    different sentences, because "turn on location" is useless advice to
 *    somebody whose connection dropped.
 *  - **nothing chosen** — the mandatory picker prompt, "¿Dónde estás buscando
 *    vivienda?", and the explicit "Explore everywhere" beside it. Never a
 *    silently global list.
 *
 * ## NativeWind
 *
 * Every control is a Bloom `Button`, so there is no hand-rolled pressed state
 * here at all. Should one come back: static style arrays plus
 * `onPressIn`/`onPressOut`, never `style={({ pressed }) => …}` — the css-interop
 * swallows the function form and the element renders unstyled.
 * `components/search/SearchSummaryBar.tsx` is the canonical template.
 */

import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { Dialog } from '@oxy.so/bloom/dialog';
import { RiFocus3Line, RiEarthLine, RiMapPinLine } from '@oxy.so/bloom/icons';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import type {
  GeoPlace,
  LocationResolution,
  LocationSelection,
} from '@homiio/shared-types';
import { formatDistance, formatRelativeDate } from '@homiio/shared-types';

import { WhereStep } from '@/components/search/steps/WhereStep';
import { locationDisplayLabel } from '@/components/search/types';
import { useFormatting } from '@/utils/format';
import { useColors } from '@/hooks/useThemeColor';
import { spacing } from '@/constants/styles';

export interface LocationScopeBarProps {
  selection: LocationSelection | null;
  resolution: LocationResolution;
  onChange: (selection: LocationSelection | null) => void;
  onExploreGlobal?: () => void;
  /** ISO timestamp of the cached data being shown, when it is not live. */
  staleAt?: string;
  /**
   * The nearest named place for a device scope, when one was resolved.
   *
   * Optional and display-only: its absence turns "Near Bucharest" into
   * "Near you" and changes nothing about what is queried.
   */
  nearbyPlace?: GeoPlace | null;
  /** Offered when the device rung has not been tried yet. */
  onUseCurrentLocation?: () => void;
  /**
   * The user EXPLICITLY chose to search everywhere.
   *
   * Not derivable from `selection === null`, and the difference is the whole
   * point of the bar: "everywhere" is a decision somebody made, while "nothing
   * chosen yet" is the state that must never look like one. Rendering the first
   * label for the second state tells a reader the app is showing them the world
   * when it is showing them nothing — which is the impression this issue exists
   * to remove, arriving through a string instead of through a query.
   */
  isGlobal?: boolean;
  /**
   * The device position stopped being available (revoked, or a failed fix)
   * while another scope is in use.
   *
   * Rendered as a separate line rather than replacing the label, because the
   * scope is still valid — the issue's "mantener la última selección válida" and
   * "mostrar que la ubicación actual ya no está disponible" are both required at
   * once.
   */
  deviceUnavailable?: boolean;
}

/** The dialog width the place picker opens at on a wide screen. */
const PICKER_MAX_WIDTH = 520;

export function LocationScopeBar({
  selection,
  resolution,
  onChange,
  onExploreGlobal,
  staleAt,
  nearbyPlace,
  onUseCurrentLocation,
  isGlobal = false,
  deviceUnavailable = false,
}: LocationScopeBarProps): React.ReactElement {
  const { t } = useTranslation();
  const formatting = useFormatting();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerText, setPickerText] = useState('');
  const colors = useColors();

  const commit = useCallback(
    (next: LocationSelection) => {
      setPickerOpen(false);
      setPickerText('');
      onChange(next);
    },
    [onChange],
  );

  const label = describeScope({
    selection,
    isGlobal,
    nearbyPlace,
    t,
    formatDistanceValue: (metres) => formatDistance(metres, formatting.locale),
  });

  const openPicker = useCallback(() => setPickerOpen(true), []);

  const notice = (text: string) => (
    <View style={styles.notice}>
      <BloomText style={[styles.noticeText, { color: colors.textSecondary }]}>{text}</BloomText>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <RiMapPinLine width={18} height={18} fill={colors.text} />

        <View style={styles.labelColumn}>
          <BloomText style={[styles.eyebrow, { color: colors.textSecondary }]}>
            {t('location.scope.eyebrow')}
          </BloomText>
          <BloomText
            style={[styles.label, { color: colors.text }]}
            numberOfLines={1}
            // Announced as one phrase: a screen reader reading the eyebrow and
            // the label as two unrelated strings loses the relationship between
            // them, which is the entire meaning of the bar.
            accessibilityLabel={t('location.scope.announce', { scope: label })}
          >
            {label}
          </BloomText>
        </View>

        <Button
          variant="outline"
          size="small"
          onPress={openPicker}
          accessibilityLabel={t('location.scope.changeAccessible')}
        >
          {t('location.scope.change')}
        </Button>
      </View>

      {/* A fixed-height placeholder rather than a collapsed row: the layout must
          not move when the answer arrives. */}
      {resolution.status === 'resolving' ? notice(t('location.scope.resolving')) : null}

      {resolution.status === 'failed'
        ? notice(t(`location.scope.failure.${resolution.reason}`))
        : null}

      {deviceUnavailable && resolution.status === 'resolved'
        ? notice(t('location.scope.deviceUnavailable'))
        : null}

      {staleAt
        ? notice(
            t('location.scope.showingCached', {
              when: formatRelativeDate(staleAt, formatting.locale),
            }),
          )
        : null}

      {onUseCurrentLocation || onExploreGlobal ? (
        <View style={styles.secondaryRow}>
          {onUseCurrentLocation ? (
            <Button
              variant="ghost"
              size="small"
              leadingIcon={RiFocus3Line}
              onPress={onUseCurrentLocation}
              accessibilityLabel={t('location.scope.useCurrentAccessible')}
            >
              {t('location.scope.useCurrent')}
            </Button>
          ) : null}

          {onExploreGlobal ? (
            <Button
              variant="ghost"
              size="small"
              leadingIcon={RiEarthLine}
              onPress={onExploreGlobal}
              accessibilityLabel={t('location.scope.exploreGlobalAccessible')}
            >
              {t('location.scope.exploreGlobal')}
            </Button>
          ) : null}
        </View>
      ) : null}

      <Dialog
        placement={{ base: 'bottom', md: 'center' }}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={t('location.scope.pickerTitle')}
        label={t('location.scope.pickerTitle')}
        maxWidth={PICKER_MAX_WIDTH}
      >
        <WhereStep
          compact
          value={pickerText}
          onChangeText={setPickerText}
          onSelectLocation={commit}
          onSelectRecent={(recent) => {
            // A recent entry stores a KEY, not a selection — resolving it is the
            // search screen's job and re-implementing it here would be a second
            // resolver with its own homonym behaviour. Re-typing the place is
            // the honest fallback until the recents rung is shared.
            setPickerText(recent.label);
          }}
        />
      </Dialog>
    </View>
  );
}

/**
 * The one sentence the bar shows for a scope.
 *
 * Exported for the test: "a device scope with no reverse-geocoded place says
 * 'Near you', never a borrowed city name" is the assertion that keeps this
 * surface from inventing a place, and it is worth pinning directly rather than
 * through a render.
 */
export function describeScope(input: {
  selection: LocationSelection | null;
  /** The user chose "everywhere". Without it, "nothing chosen" reads as a choice. */
  isGlobal?: boolean;
  nearbyPlace?: GeoPlace | null;
  t: (key: string, options?: Record<string, unknown>) => string;
  formatDistanceValue: (metres: number) => string;
}): string {
  const { selection, isGlobal = false, nearbyPlace, t, formatDistanceValue } = input;
  if (!selection) return t(isGlobal ? 'location.scope.everywhere' : 'location.scope.notChosen');

  if (selection.kind === 'current_location') {
    const distance = formatDistanceValue(selection.radiusMeters);
    // `nearbyPlace.label.primary` is the geocoder's own string, used verbatim.
    // No re-casing, no comma splitting — ADR 0002 §9.4.
    return nearbyPlace
      ? t('location.scope.nearPlace', { place: nearbyPlace.label.primary, distance })
      : t('location.scope.nearYou', { distance });
  }

  return locationDisplayLabel(selection, t);
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  labelColumn: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
  },
  notice: {
    paddingVertical: spacing.xs,
  },
  noticeText: {
    fontSize: 13,
  },
  secondaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    // Ghost buttons carry their own inset; pull the row back to the text edge.
    marginLeft: -spacing.sm,
  },
});
