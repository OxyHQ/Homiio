/**
 * What Homiio shows when it does not know where you are (#518 §3.2, #519 §3.3).
 *
 * ## This is not a consolation prize, and it is not a global feed
 *
 * The state it renders used to be a barrier — "One step first / Where are you
 * looking for a home?" — and the temptation when removing a barrier is to put
 * the worldwide list behind it. Both epics forbid exactly that, in the same
 * words: "No activar silenciosamente `global=true` y titularlo «cerca de ti»."
 *
 * So this board offers REAL DESTINATIONS with inventory, each one an explicit
 * scope the user picks, and it says so. Nothing here is presented as near
 * anybody. The distinction is carried by the copy AND by the mechanism: every
 * card commits a city selection, so the search that follows is scoped to a
 * place the user chose, and there is no path from this component to an unscoped
 * query.
 *
 * ## Why it lists cities rather than listings
 *
 * A grid of homes with no area is a worldwide feed wearing a different heading,
 * and a person who cannot be placed has no reason to care about a flat in a
 * country they have never visited. A destination, on the other hand, is a
 * question they can answer in one tap — which is the whole point of removing
 * the step: the choice is still available, it has just stopped being a toll.
 *
 * `usePopularCities` is ordered by `propertiesCount`, so every card shown has
 * something behind it. An empty list renders nothing rather than an apology.
 */

import React, { useCallback } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { P } from '@oxy.so/bloom/typography';
import type { City, LocationSelection } from '@homiio/shared-types';

import { CityShowcaseSection } from '@/components/CityShowcaseSection';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { usePopularCities } from '@/hooks/useCityQueries';
import { cityCountry, cityRegionName } from '@/utils/cityDisplay';
import { PAGE_GUTTER_CLASS } from '@/constants/styles';

/** How many destinations the board offers. Enough to choose from, few enough to read. */
const DESTINATION_COUNT = 8;

/**
 * The selection a destination card commits.
 *
 * Structurally identical to `utils/resolveLocationRef.ts#citySelection`, which
 * builds the same thing from a `CityPlaceCandidate` — the lookup DTO — while
 * this builds it from a `City`, the geo entity the `/api/cities*` routes serve.
 * The two inputs carry the same facts in different shapes and neither is
 * convertible to the other without a request, so the assembly is written twice
 * and the INVARIANTS are what must not diverge:
 *
 *  - the identity is `homiio:city:<id>`, so the `loc` token, the query key and
 *    a hand-typed pick of the same city are indistinguishable downstream;
 *  - the geometry is assembled as a UNIT, because `PlaceGeometry` is a
 *    two-member union and copying `center` and `precision` across
 *    independently is what let the gateway emit `(0, 0)` for a place it had no
 *    coordinates for and put "Spain" over the Gulf of Guinea;
 *  - a city with no coordinates is `area` precision with NO centre. Honest, and
 *    still queryable, because the search scopes by id.
 */
export function destinationSelection(city: City): LocationSelection {
  const region = cityRegionName(city);
  const identity = {
    kind: 'place',
    source: { kind: 'homiio', entity: 'city', id: city.id },
    placeType: 'city',
    label: {
      primary: city.name,
      ...(region ? { secondary: region } : {}),
      kind: 'place',
    },
    admin: {
      // `countries.code` is NOT NULL, so a populated country always has one.
      // An unpopulated `countryId` leaves it empty rather than guessed — the
      // hierarchy is a fact, and an invented country code is worse than a
      // missing one.
      countryCode: (cityCountry(city)?.code ?? '').toUpperCase(),
      ...(region ? { regionName: region } : {}),
      cityName: city.name,
    },
  } as const;

  const coordinates = city.coordinates;
  return coordinates
    ? {
        ...identity,
        precision: 'centroid',
        center: { longitude: coordinates.lng, latitude: coordinates.lat },
      }
    : { ...identity, precision: 'area' };
}

export interface HomeDiscoveryBoardProps {
  /** Commit the chosen destination as the app-wide scope. */
  readonly onChoose: (selection: LocationSelection) => void;
}

export function HomeDiscoveryBoard({ onChoose }: HomeDiscoveryBoardProps) {
  const { t } = useTranslation();
  const { data: cities } = usePopularCities(DESTINATION_COUNT);

  const choose = useCallback(
    (city: City) => {
      onChoose(destinationSelection(city));
    },
    [onChoose],
  );

  if (!cities || cities.length === 0) return null;

  return (
    <View className="gap-3">
      <View className={`gap-1 ${PAGE_GUTTER_CLASS}`}>
        <SectionEyebrow>{t('home.discovery.eyebrow')}</SectionEyebrow>
        {/* The SCOPE of this collection, stated on the collection itself —
            "declarar su ámbito por colección y no aparentar cercanía". */}
        <P className="text-sm text-muted-foreground">{t('home.discovery.body')}</P>
      </View>
      <CityShowcaseSection
        title={t('home.discovery.title')}
        items={cities}
        onPressCity={choose}
      />
    </View>
  );
}
