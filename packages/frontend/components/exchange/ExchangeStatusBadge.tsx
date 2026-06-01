import { ExchangeRequestStatus } from '@homiio/shared-types';
import { createStatusBadge, type StatusBadgeEntry } from '@/components/ui/createStatusBadge';

/** Exchange status → Bloom badge color + i18n key (mirrors ReservationStatusBadge). */
const STATUS_MAP: Record<ExchangeRequestStatus, StatusBadgeEntry> = {
  [ExchangeRequestStatus.PENDING]: {
    i18nKey: 'listing.exchange.status.pending',
    label: 'Pending',
    color: 'warning',
  },
  [ExchangeRequestStatus.CONFIRMED]: {
    i18nKey: 'listing.exchange.status.confirmed',
    label: 'Confirmed',
    color: 'success',
  },
  [ExchangeRequestStatus.DECLINED]: {
    i18nKey: 'listing.exchange.status.declined',
    label: 'Declined',
    color: 'error',
  },
  [ExchangeRequestStatus.CANCELLED]: {
    i18nKey: 'listing.exchange.status.cancelled',
    label: 'Cancelled',
    color: 'default',
  },
  [ExchangeRequestStatus.COMPLETED]: {
    i18nKey: 'listing.exchange.status.completed',
    label: 'Completed',
    color: 'info',
  },
};

export const ExchangeStatusBadge = createStatusBadge(STATUS_MAP);

export default ExchangeStatusBadge;
