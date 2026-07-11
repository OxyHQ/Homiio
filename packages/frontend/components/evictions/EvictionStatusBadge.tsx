/**
 * Eviction lifecycle status badge. Built from the shared `createStatusBadge`
 * factory so it renders identically to the applications/reservations/exchange
 * badges — each status maps to a Bloom color + an i18n label key.
 */
import { EvictionCaseStatus } from '@homiio/shared-types';
import { createStatusBadge, type StatusBadgeEntry } from '@/components/ui/createStatusBadge';
import { EVICTION_STATUS_META } from './evictionUtils';

const STATUS_MAP = Object.fromEntries(
  (Object.values(EvictionCaseStatus) as EvictionCaseStatus[]).map((status) => [
    status,
    {
      color: EVICTION_STATUS_META[status].color,
      label: status,
      i18nKey: EVICTION_STATUS_META[status].i18nKey,
    } satisfies StatusBadgeEntry,
  ]),
) as Record<EvictionCaseStatus, StatusBadgeEntry>;

export const EvictionStatusBadge = createStatusBadge<EvictionCaseStatus>(STATUS_MAP);

export default EvictionStatusBadge;
