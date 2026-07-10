import { ReservationStatus } from '@homiio/shared-types';
import { createStatusBadge, type StatusBadgeEntry } from '@/components/ui/createStatusBadge';

const STATUS_MAP: Record<ReservationStatus, StatusBadgeEntry> = {
  [ReservationStatus.PENDING]: { i18nKey: 'status.reservation.pending', label: 'Pending', color: 'warning' },
  [ReservationStatus.CONFIRMED]: { i18nKey: 'status.reservation.confirmed', label: 'Confirmed', color: 'success' },
  [ReservationStatus.DECLINED]: { i18nKey: 'status.reservation.declined', label: 'Declined', color: 'error' },
  [ReservationStatus.CANCELLED]: { i18nKey: 'status.reservation.cancelled', label: 'Cancelled', color: 'default' },
  [ReservationStatus.COMPLETED]: { i18nKey: 'status.reservation.completed', label: 'Completed', color: 'info' },
};

export const ReservationStatusBadge = createStatusBadge(STATUS_MAP);

export default ReservationStatusBadge;
