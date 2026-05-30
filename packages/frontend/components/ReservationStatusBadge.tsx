import React from 'react';
import { Badge, BadgeColor } from '@oxyhq/bloom/badge';
import { ReservationStatus } from '@homiio/shared-types';

interface ReservationStatusBadgeProps {
  status: ReservationStatus;
}

const STATUS_MAP: Record<ReservationStatus, { label: string; color: BadgeColor }> = {
  [ReservationStatus.PENDING]: { label: 'Pending', color: 'warning' },
  [ReservationStatus.CONFIRMED]: { label: 'Confirmed', color: 'success' },
  [ReservationStatus.DECLINED]: { label: 'Declined', color: 'error' },
  [ReservationStatus.CANCELLED]: { label: 'Cancelled', color: 'default' },
  [ReservationStatus.COMPLETED]: { label: 'Completed', color: 'info' },
};

export const ReservationStatusBadge: React.FC<ReservationStatusBadgeProps> = ({
  status,
}) => {
  const entry = STATUS_MAP[status];
  return <Badge content={entry.label} variant="subtle" color={entry.color} size="small" />;
};

export default ReservationStatusBadge;
