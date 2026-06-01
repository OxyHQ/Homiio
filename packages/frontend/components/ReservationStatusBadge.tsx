import { ReservationStatus } from '@homiio/shared-types';
import { createStatusBadge, type StatusBadgeEntry } from '@/components/ui/createStatusBadge';

const STATUS_MAP: Record<ReservationStatus, StatusBadgeEntry> = {
  [ReservationStatus.PENDING]: { label: 'Pending', color: 'warning' },
  [ReservationStatus.CONFIRMED]: { label: 'Confirmed', color: 'success' },
  [ReservationStatus.DECLINED]: { label: 'Declined', color: 'error' },
  [ReservationStatus.CANCELLED]: { label: 'Cancelled', color: 'default' },
  [ReservationStatus.COMPLETED]: { label: 'Completed', color: 'info' },
};

export const ReservationStatusBadge = createStatusBadge(STATUS_MAP);

export default ReservationStatusBadge;
