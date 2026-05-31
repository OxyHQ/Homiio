import React from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, BadgeColor } from '@oxyhq/bloom/badge';
import { ExchangeRequestStatus } from '@homiio/shared-types';

interface ExchangeStatusBadgeProps {
  status: ExchangeRequestStatus;
}

/** Exchange status → Bloom badge color + i18n key (mirrors ReservationStatusBadge). */
const STATUS_MAP: Record<
  ExchangeRequestStatus,
  { i18nKey: string; fallback: string; color: BadgeColor }
> = {
  [ExchangeRequestStatus.PENDING]: {
    i18nKey: 'listing.exchange.status.pending',
    fallback: 'Pending',
    color: 'warning',
  },
  [ExchangeRequestStatus.CONFIRMED]: {
    i18nKey: 'listing.exchange.status.confirmed',
    fallback: 'Confirmed',
    color: 'success',
  },
  [ExchangeRequestStatus.DECLINED]: {
    i18nKey: 'listing.exchange.status.declined',
    fallback: 'Declined',
    color: 'error',
  },
  [ExchangeRequestStatus.CANCELLED]: {
    i18nKey: 'listing.exchange.status.cancelled',
    fallback: 'Cancelled',
    color: 'default',
  },
  [ExchangeRequestStatus.COMPLETED]: {
    i18nKey: 'listing.exchange.status.completed',
    fallback: 'Completed',
    color: 'info',
  },
};

export const ExchangeStatusBadge: React.FC<ExchangeStatusBadgeProps> = ({ status }) => {
  const { t } = useTranslation();
  const entry = STATUS_MAP[status];
  return (
    <Badge
      content={t(entry.i18nKey, entry.fallback)}
      variant="subtle"
      color={entry.color}
      size="small"
    />
  );
};

export default ExchangeStatusBadge;
