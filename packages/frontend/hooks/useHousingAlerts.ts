/**
 * The in-app alert history (#356) — the visible source of truth.
 *
 * The issue makes in-app delivery mandatory and calls it exactly that, which is
 * a stronger requirement than "there is a notification": a notification can be
 * dismissed, cleared or never seen, and the question "why did I get this?" has
 * to stay answerable afterwards. So the history is its own list with its own
 * endpoint, and every entry carries the explanation AS PUBLISHED rather than a
 * pointer to something that could re-render differently later.
 *
 * ## Refetch on focus, no socket
 *
 * The same shape the mailbox uses (`packages/frontend/docs/NOTIFICATIONS.md`).
 * Homiio has no realtime client, and this list is written by a sweep running on
 * a two-minute cadence, so a focus refetch is both sufficient and honest about
 * the latency.
 */

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';
import type { AlertExplanation, AlertSuppressionReason } from '@homiio/shared-types';
import { api } from '@/utils/api';

/** How many history entries one page carries. */
const PAGE_SIZE = 20;

export interface HousingAlert {
  id: string;
  watchId: string;
  eventId: string | null;
  ruleType: string;
  /** Which revision of the matching rules produced this. */
  ruleVersion: number;
  subjectType: string;
  subjectId: string;
  explanation: AlertExplanation;
  deliveryState: 'pending' | 'delivered' | 'suppressed' | 'failed';
  /** Why it was held back. `null` for every state but `suppressed`. */
  suppressionReason: AlertSuppressionReason | null;
  deliveredChannels: string[];
  deliveredAt: string | null;
  notificationId: string | null;
  createdAt: string;
}

interface AlertListEnvelope {
  data?: HousingAlert[];
  meta?: { total?: number; hasMore?: boolean; offset?: number; limit?: number };
}

const ALERTS_KEY = ['housingAlerts'] as const;

/**
 * A page of the caller's alert history, newest first.
 *
 * `watchId` narrows it. It can never WIDEN it: the endpoint scopes every read to
 * the session's own account in the SQL predicate, so a watch id belonging to
 * somebody else returns nothing rather than their history.
 */
export function useHousingAlerts(watchId?: string) {
  const { isAuthenticated } = useOxy();

  return useInfiniteQuery({
    queryKey: [...ALERTS_KEY, watchId ?? 'all'],
    enabled: isAuthenticated,
    initialPageParam: 0,
    // Refetched when the screen regains focus by the screen itself; a short
    // stale time keeps a tab-switch from re-fetching a list a sweep touches
    // every two minutes at most.
    staleTime: 1000 * 30,
    queryFn: async ({ pageParam }) => {
      const response = await api.get<AlertListEnvelope>('/api/profiles/me/alerts', {
        params: {
          limit: PAGE_SIZE,
          offset: pageParam,
          ...(watchId ? { watchId } : {}),
        },
      });
      const payload = response.data;
      return {
        alerts: payload?.data ?? [],
        offset: payload?.meta?.offset ?? pageParam,
        hasMore: payload?.meta?.hasMore ?? false,
      };
    },
    getNextPageParam: (last) => (last.hasMore ? last.offset + PAGE_SIZE : undefined),
  });
}

export interface AlertReason {
  alert: HousingAlert;
  watch: { id: string; name: string; locToken?: string } | null;
  /**
   * The fact behind the alert, or `null` when it has aged out.
   *
   * `null` is a real answer and not an error: an event is EVIDENCE and expires
   * on a 90-day retention, while the alert keeps its own explanation forever. So
   * "the evidence has expired" and "there was none" are different, and only the
   * first is expected.
   */
  event: {
    id: string;
    type: string;
    occurredAt: string;
    transition: Record<string, unknown>;
  } | null;
}

/** "Why did I get this?" — answered from the stored explanation, never re-derived. */
export function useAlertReason(alertId: string | undefined) {
  const { isAuthenticated } = useOxy();

  return useQuery({
    queryKey: [...ALERTS_KEY, 'reason', alertId],
    enabled: isAuthenticated && Boolean(alertId),
    queryFn: async (): Promise<AlertReason> => {
      const response = await api.get<{ data: AlertReason }>(
        `/api/profiles/me/alerts/${alertId}`,
      );
      return response.data.data;
    },
  });
}
