/**
 * "Bucharest · approximate area", and how to change it.
 *
 * ## Why an inferred area has to announce itself
 *
 * Homiio now places people without asking them anything. That is the point of
 * #518 and #519 — and it is also the risk both of them spend a section on: an
 * area nobody chose, presented the way a chosen one would be, is a claim about
 * somebody's life that Homiio has no basis for. The rules are explicit:
 *
 *  - say it is approximate ("Barcelona · zona aproximada");
 *  - say where it came from, when asked ("Aproximada por tu conexión");
 *  - never say "your home", "your address", or draw a dot on a map;
 *  - make changing it one tap away, in the same breath;
 *  - and do NOT nag — "No mostrar banners repetidos explicando que falta
 *    permiso." This renders once, above the sections it describes, and says
 *    nothing at all when the area was chosen.
 *
 * ## The upgrade offer lives here too
 *
 * When the network placed somebody and their device later produces a real fix,
 * the ladder offers it rather than applying it (`scope.upgrade`), because
 * jumping cities under a reader is the failure #518 §3.3 names. The offer is a
 * button in this row: it is the only place in the app where that transition can
 * happen, and it happens because somebody pressed it.
 *
 * ## Attribution
 *
 * The inference is served by a local DB-IP City Lite database, which is
 * published under CC BY 4.0 and therefore requires credit where the data is
 * used. The provenance line carries it. That is a licence obligation, not
 * decoration: removing the credit while keeping the database is a licence
 * breach, so the two belong in one component.
 */

import React, { useState } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { RiMapPinLine } from '@oxy.so/bloom/icons';
import { P } from '@oxy.so/bloom/typography';

import type { LocationScope } from '@/hooks/useLocationScope';
import { PAGE_GUTTER_CLASS } from '@/constants/styles';

export interface ApproximateAreaNoticeProps {
  readonly scope: LocationScope;
  /** Open the "where?" step of the search bar. */
  readonly onChangeArea: () => void;
}

/**
 * Which sentence names the provenance, by how coarse the answer was.
 *
 * Separate keys rather than one with a `{{granularity}}` placeholder, because
 * the three sentences are not the same sentence with a word swapped in every
 * language, and because a region-level answer must not be described as though
 * a city had been identified.
 */
function provenanceKey(scope: LocationScope): string | null {
  if (scope.source === 'device') return 'location.scope.provenance.device';
  if (scope.source !== 'ip') return null;
  switch (scope.granularity) {
    case 'city':
      return 'location.scope.provenance.ipCity';
    case 'region':
      return 'location.scope.provenance.ipRegion';
    case 'country':
      return 'location.scope.provenance.ipCountry';
    default:
      return 'location.scope.provenance.ipCity';
  }
}

export function ApproximateAreaNotice({ scope, onChangeArea }: ApproximateAreaNoticeProps) {
  const { t } = useTranslation();
  /**
   * Whether the provenance detail is showing.
   *
   * Collapsed by default: the disclosure that MATTERS ("approximate") is
   * already in the search bar's own statement, and repeating the full
   * explanation on every visit is the banner both epics forbid. This is the
   * "explicación breve … al consultar el origen del área" they do allow.
   */
  const [showDetail, setShowDetail] = useState(false);

  if (!scope.isApproximate) return null;
  const key = provenanceKey(scope);
  if (!key) return null;

  return (
    <View className={`gap-2 ${PAGE_GUTTER_CLASS}`}>
      <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
        <P className="text-[13px] text-muted-foreground">{t('location.scope.approximateLead')}</P>
        <Button
          variant="ghost"
          size="small"
          onPress={() => setShowDetail((shown) => !shown)}
          accessibilityLabel={t('location.scope.provenance.toggleAccessible')}
        >
          {t('location.scope.provenance.toggle')}
        </Button>
        <Button
          variant="secondary"
          size="small"
          leadingIcon={RiMapPinLine}
          onPress={onChangeArea}
          accessibilityLabel={t('location.scope.changeAccessible')}
        >
          {t('location.scope.chooseArea')}
        </Button>
      </View>

      {showDetail ? (
        <P className="text-[13px] text-muted-foreground">
          {t(key)}
          {scope.source === 'ip' ? ` ${t('location.scope.provenance.attribution')}` : ''}
        </P>
      ) : null}

      {/* A better automatic answer exists. OFFERED, never applied: see the
          header, and `locationScopeLadder.ts`'s commit rule. */}
      {scope.upgrade ? (
        <View className="flex-row">
          <Button
            variant="secondary"
            size="small"
            onPress={scope.applyUpgrade}
            accessibilityLabel={t('location.scope.upgradeAccessible')}
          >
            {t('location.scope.upgrade')}
          </Button>
        </View>
      ) : null}
    </View>
  );
}
