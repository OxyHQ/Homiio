/**
 * "Neighbours who need support" — the next eviction-watch gatherings in the
 * area the person is looking at, soonest first, each one tap away from
 * showing up.
 *
 * Scoped exactly like the eviction board (ADR 0002): the committed area, or
 * an explicit "everywhere"; with neither there is no request and no widget.
 * Renders nothing when there is nothing upcoming.
 */
import { useMemo } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button } from '@oxy.so/bloom/button';
import { EvictionCaseStatus } from '@homiio/shared-types/eviction';
import type { EvictionBoardScope } from '@homiio/shared-types';

import { EvictionCard } from '@/components/evictions/EvictionCard';
import { selectionToBoardScope } from '@/components/evictions/evictionScope';
import { useEvictions } from '@/hooks/useEvictionQueries';
import { useLocationScope } from '@/hooks/useLocationScope';
import { useFormatting } from '@/utils/format';
import { BaseWidget } from './BaseWidget';

/** How many gatherings the rail lists. */
const GATHERING_COUNT = 3;

export function NeighbourSupportWidget() {
  const { t } = useTranslation();
  const router = useRouter();
  const scope = useLocationScope();
  const { locale } = useFormatting();

  const boardScope: EvictionBoardScope | undefined = scope.isGlobal
    ? { kind: 'global' }
    : selectionToBoardScope(scope.selection);

  const { cases } = useEvictions(
    // The placeholder scope is never sent: the query is disabled without one.
    {
      scope: boardScope ?? { kind: 'global' },
      status: EvictionCaseStatus.UPCOMING,
      sort: 'soonest',
    },
    { enabled: scope.canQuery && boardScope !== undefined },
  );
  const gatherings = useMemo(() => cases.slice(0, GATHERING_COUNT), [cases]);

  if (gatherings.length === 0) return null;

  return (
    <BaseWidget title={t('home.neighbourSupport.title')}>
      {gatherings.map((eviction) => (
        <EvictionCard
          key={eviction.id}
          eviction={eviction}
          locale={locale}
          onPress={() => router.push(`/evictions/${eviction.id}`)}
        />
      ))}
      <Button tone="neutral" appearance="outline" onPress={() => router.push('/evictions')}>
        {t('home.neighbourSupport.viewAll')}
      </Button>
    </BaseWidget>
  );
}
