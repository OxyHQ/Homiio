/**
 * Featured homes IN THE COMMITTED SCOPE (#353).
 *
 * ## What it was
 *
 * `useProperties()` plus `loadProperties({ limit: 5, status: 'published' })` in a
 * mount effect — a request with no geographic parameter of any kind, ranked
 * client-side and rendered in the rail beside a page whose whole premise is an
 * explicit, visible area. It was the global feed ADR 0002 principle 2 forbids,
 * still alive inside a widget: four homes from anywhere on earth, under a
 * heading that named no place, next to a scope bar that named one.
 *
 * ## Where its scope comes from
 *
 * `useLocationScope()` — the SAME hook Home and the eviction board read, not a
 * second location source. The widget commits nothing and derives nothing: it has
 * no picker, no "use my location" button and no fallback of its own, because
 * `LocationScopeBar` is the one surface allowed to commit a selection. A widget
 * that could commit one would be exactly the second authority the shared
 * contract exists to prevent.
 *
 * The rail is a sibling of the page rather than its child, so the scope cannot
 * arrive as a prop. Reading the shared hook is what makes the two agree anyway:
 * both resolve from one store and one React Query cache, so the rail and the
 * page cannot disagree about where the user is looking.
 *
 * ## With no scope it shows NOTHING, and says so
 *
 * `scope.canQuery` is the only gate, and it is true for exactly two states: a
 * committed selection, or an explicit "explore everywhere" somebody pressed.
 * There is no arm of this component that fetches listings otherwise — a failed
 * device fix, a permission denial and a fresh install all end at a sentence, not
 * at a worldwide list.
 *
 * A sentence rather than rendering nothing at all, deliberately. An empty rail
 * reads as "there are no homes here", which is the same false impression in a
 * quieter form; the issue's requirement is that a surface STATES its area, and
 * "no area chosen yet" is a statement about the area.
 */
import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Loading } from '@oxyhq/bloom/loading';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  formatDistance,
  type LocationResolution,
  type LocationSelection,
  type OfferingType,
  type Property,
} from '@homiio/shared-types';
import { colors } from '@/styles/colors';
import { BaseWidget } from './BaseWidget';
import { usePropertySearch } from '@/hooks/usePropertySearch';
import { useLocationScope } from '@/hooks/useLocationScope';
import { useRentalMode } from '@/context/RentalModeContext';
import { describeScope } from '@/components/location/LocationScopeBar';
import { DEFAULT_SEARCH_QUERY } from '@/store/searchQueryStore';
import type { SearchQuery } from '@/components/search/types';
import { exploreHref } from '@/utils/searchUrl';
import { useFormatting } from '@/utils/format';
import { PropertyCard } from '../PropertyCard';
import { ThemedText } from '../ThemedText';
import { Button } from '@oxyhq/bloom/button';

// The API decorates listings with an aggregate save count that is not part of
// the persisted Property model, so it is modelled as an optional extension.
export type FeaturedProperty = Property & { savesCount?: number };

/** How many homes the rail shows. */
const FEATURED_COUNT = 4;

/**
 * The search this widget runs.
 *
 * Exported because the one property that has to hold — the committed scope
 * reaches the request — is a fact about this object, and pinning it here means
 * the assertion does not depend on rendering anything.
 *
 * It is `DEFAULT_SEARCH_QUERY` plus two fields and nothing else. No free text,
 * no filters: this is "featured homes where you are looking", and every
 * dimension the widget does not set is a dimension it cannot silently disagree
 * with the rest of the app about.
 */
export function featuredSearchQuery(
  selection: LocationSelection | null,
  offering: OfferingType,
): SearchQuery {
  return { ...DEFAULT_SEARCH_QUERY, offering, location: selection };
}

/**
 * "Featured" — fairly priced first, then most saved.
 *
 * Unchanged from before the scope landed, and deliberately: this widget's defect
 * was WHERE it looked, not how it ranked what it found. Pure so the ordering can
 * be asserted directly.
 */
export function rankFeatured(properties: readonly FeaturedProperty[]): FeaturedProperty[] {
  return [...properties].sort((a, b) => {
    const aFair = a.priceEthics?.isFairPrice ? 1 : 0;
    const bFair = b.priceEthics?.isFairPrice ? 1 : 0;
    if (bFair !== aFair) return bFair - aFair;
    const aSaves = typeof a.savesCount === 'number' ? a.savesCount : 0;
    const bSaves = typeof b.savesCount === 'number' ? b.savesCount : 0;
    return bSaves - aSaves;
  });
}

export function FeaturedPropertiesWidget() {
  const { t } = useTranslation();
  const router = useRouter();
  const scope = useLocationScope();
  const { offering } = useRentalMode();
  const { locale } = useFormatting();

  const query = useMemo(
    () => featuredSearchQuery(scope.selection, offering),
    [scope.selection, offering],
  );
  // `enabled` is the whole guard. `canQuery` is false for every state that is
  // not a committed area or an explicit "everywhere", so an unresolved,
  // failed or never-asked scope issues no request at all.
  const search = usePropertySearch(query, { enabled: scope.canQuery });

  const featured = useMemo(
    () => rankFeatured(search.properties).slice(0, FEATURED_COUNT),
    [search.properties],
  );

  /**
   * The area, in the same words the scope bar uses.
   *
   * `describeScope` rather than a local formatter: two surfaces naming one area
   * differently is the confusion the shared bar was built to remove, and a
   * second describer here would drift the first time one of them learned about a
   * new selection kind.
   *
   * An explicit "everywhere" has `selection === null`, so it falls to the plain
   * title — "Featured in Everywhere" is not a sentence, and the user who pressed
   * that button already knows what they pressed.
   */
  const title = scope.selection
    ? t('home.featured.titleIn', {
        area: describeScope({
          selection: scope.selection,
          nearbyPlace: scope.nearbyPlace,
          t,
          formatDistanceValue: (metres) => formatDistance(metres, locale),
        }),
      })
    : t('home.featured.title');

  /**
   * "View all", carrying the scope.
   *
   * `null` when the selection cannot be written as a URL token, and the button
   * is then not rendered — a CTA that dropped the area would put the global feed
   * one tap from a widget that exists to keep it out of reach, which is the
   * whole bug arriving through a link instead of a request.
   */
  const seeAllHref = useMemo(() => exploreHref(query), [query]);

  if (!scope.canQuery) {
    return (
      <BaseWidget title={title}>
        <View style={styles.emptyContainer}>
          <ThemedText style={styles.emptyText}>{scopeNotice(scope.resolution, t)}</ThemedText>
        </View>
      </BaseWidget>
    );
  }

  if (search.isError) {
    return (
      <BaseWidget title={title}>
        <View style={styles.errorContainer}>
          <ThemedText style={styles.errorText}>{t('home.featured.loadFailed')}</ThemedText>
        </View>
      </BaseWidget>
    );
  }

  return (
    <BaseWidget title={title}>
      <View>
        {search.isLoading ? (
          <View style={styles.loadingContainer}>
            <Loading iconSize={16} showText={false} />
            <ThemedText style={styles.loadingText}>{t('state.loading')}</ThemedText>
          </View>
        ) : featured.length === 0 ? (
          <View style={styles.emptyContainer}>
            <ThemedText style={styles.emptyText}>{t('home.featured.empty')}</ThemedText>
          </View>
        ) : (
          <>
            {featured.map((property) => (
              <PropertyCard
                key={property.id}
                property={property}
                variant="compact"
                orientation="horizontal"
                showSaveButton={true}
                showVerifiedBadge={true}
                showTypeIcon={false}
                showFeatures={true}
                showPrice={true}
                showLocation={true}
                showRating={false}
                showSaveCount={true}
                saveCountDisplayMode="inline"
                style={styles.propertyCard}
                onPress={() => router.push(`/properties/${property.id}`)}
              />
            ))}
            {seeAllHref ? (
              <Button onPress={() => router.push(seeAllHref)}>{t('home.viewAll')}</Button>
            ) : null}
          </>
        )}
      </View>
    </BaseWidget>
  );
}

/**
 * What to say when there is nothing to query.
 *
 * The failure REASON when there is one — "location is off" and "we could not
 * reach Homiio" call for different actions, and a single generic sentence sends
 * half of the people who read it to the wrong setting. Same keys the scope bar
 * uses, so the rail and the bar cannot describe one failure two ways.
 */
export function scopeNotice(resolution: LocationResolution, t: TFunction): string {
  switch (resolution.status) {
    case 'resolving':
      return t('location.scope.resolving');
    case 'failed':
      return t(`location.scope.failure.${resolution.reason}`);
    // `resolved` cannot reach here — a resolved scope can be queried — but it is
    // spelled out rather than folded into a default so that adding a fifth
    // status is a compile error instead of a silently generic sentence.
    case 'idle':
    case 'resolved':
      return t('home.featured.chooseArea');
  }
}

const styles = StyleSheet.create({
  loadingContainer: {
    padding: 15,
    alignItems: 'center',
    borderRadius: 15,
    gap: 10,
  },
  loadingText: {
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  errorContainer: {
    padding: 15,
    alignItems: 'center',
    borderRadius: 15,
  },
  errorText: {
    color: colors.danger,
    fontWeight: '500',
  },
  emptyContainer: {
    padding: 20,
    alignItems: 'center',
    borderRadius: 15,
  },
  emptyText: {
    color: colors.COLOR_BLACK_LIGHT_4,
    fontSize: 14,
    textAlign: 'center',
  },
  propertyCard: {
    marginBottom: 12,
  },
});
