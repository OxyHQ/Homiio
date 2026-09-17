/**
 * Saved searches as Bloom `SavedSearchCard`s: what each one looks for, how it
 * alerts, and a press that runs it again. Shared by the Saved page and the
 * right-rail widget, so a saved search behaves the same wherever it is drawn.
 *
 * Everything on a card is the row's own data — the criteria come from the
 * stored filters and location, the footer from the watch's cadence and status.
 * There is no "12 new" badge: nothing records which alerts somebody has seen, so
 * a count would be invented.
 *
 * Pressing a card opens `/explore` through {@link savedSearchTarget}, which
 * refuses to run a search that cannot state its place (ADR 0002). "Edit" opens
 * the watch's settings (name, cadence, rules); delete asks first.
 */
import React, { useCallback } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { SavedSearchCard, type SavedSearchIcon } from '@oxy.so/bloom/home-search';
import { RiBuilding2Line, RiHome4Line, RiHomeHeartLine, RiSuitcaseLine } from '@oxy.so/bloom/icons';
import { alert, confirm } from '@oxy.so/bloom/surfaces';
import { OfferingType } from '@homiio/shared-types';

import { useSavedSearches } from '@/hooks/useSavedSearches';
import type { SavedSearch } from '@/store/savedSearchesStore';
import { useFormatting } from '@/utils/format';
import {
  savedSearchCriteria,
  savedSearchFiltersToQuery,
  savedSearchTarget,
} from '@/utils/savedSearchQuery';

const OFFERING_ICONS: Record<OfferingType, SavedSearchIcon> = {
  [OfferingType.LONG_TERM_RENT]: RiBuilding2Line,
  [OfferingType.SHORT_TERM_RENT]: RiSuitcaseLine,
  [OfferingType.SALE]: RiHome4Line,
  [OfferingType.EXCHANGE]: RiHomeHeartLine,
};

/** The alert footer: `frequency` draws a bell, `offLabel` a struck one. */
function alertLine(search: SavedSearch, t: TFunction): { frequency?: string; offLabel: string } {
  const status = search.alertStatus;
  if (status?.status === 'inactive') {
    if (status.reason === 'muted') return { offLabel: t('saved.search.alertsPaused') };
    if (status.reason === 'cadence_off') return { offLabel: t('saved.search.alertsOff') };
    // Switched on but unable to fire (no area, no rules, a legacy place): say
    // so rather than draw a bell that will never ring.
    return { offLabel: t('saved.search.alertsInactive') };
  }
  // The server folds an active mute into `alertStatus`; this covers a payload
  // from an older backend that sends `mutedUntil` alone.
  if (search.mutedUntil && new Date(search.mutedUntil) > new Date()) {
    return { offLabel: t('saved.search.alertsPaused') };
  }
  if (!search.cadence || search.cadence === 'off') return { offLabel: t('saved.search.alertsOff') };
  return {
    frequency: t('saved.search.alertsCadence', { cadence: t(`alerts.cadence.${search.cadence}`) }),
    offLabel: t('saved.search.alertsOff'),
  };
}

export function SavedSearchCards({ searches }: { searches: readonly SavedSearch[] }) {
  const { t } = useTranslation();
  const { locale } = useFormatting();
  const { deleteSavedSearch } = useSavedSearches();

  const openSearch = useCallback(
    (search: SavedSearch) => {
      const target = savedSearchTarget(search);
      if (target.kind === 'href') {
        router.push(target.href);
      } else if (target.kind === 'needs_place') {
        alert(t('saved.search.needsPlaceTitle'), t('saved.search.needsPlaceDescription', { name: search.name }), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('saved.search.choosePlace'), onPress: () => router.push('/explore') },
        ]);
      } else {
        alert(t('saved.search.unshareableTitle'), t('saved.search.unshareableDescription', { name: search.name }));
      }
    },
    [t],
  );

  const removeSearch = useCallback(
    async (search: SavedSearch) => {
      const ok = await confirm({
        title: t('search.deleteSearch'),
        description: t('search.deleteSearchConfirm', { name: search.name }),
        confirmLabel: t('common.delete'),
        cancelLabel: t('common.cancel'),
        destructive: true,
      });
      // The hook toasts the outcome.
      if (ok) void deleteSavedSearch(search.id, search.name);
    },
    [deleteSavedSearch, t],
  );

  return (
    <View style={{ gap: 12 }}>
      {searches.map((search) => {
        const { frequency, offLabel } = alertLine(search, t);
        return (
          <SavedSearchCard
            key={search.id}
            title={search.name}
            criteria={savedSearchCriteria(search, t, locale)}
            icon={OFFERING_ICONS[savedSearchFiltersToQuery(search).offering]}
            alertFrequency={frequency}
            alertsOffLabel={offLabel}
            onPress={() => openSearch(search)}
            onEdit={() => router.push(`/saved/watches/${search.id}`)}
            onDelete={() => void removeSearch(search)}
            editLabel={t('common.edit')}
            deleteLabel={t('common.delete')}
            testID={`saved-search-${search.id}`}
          />
        );
      })}
    </View>
  );
}
