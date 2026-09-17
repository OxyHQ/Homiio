import React from 'react';
import { useTranslation } from 'react-i18next';
import { Chip, type ChipHue } from '@oxy.so/bloom/chip';
import { ExchangeRequestStatus } from '@homiio/shared-types';

/** Exchange status → Bloom Chip data hue + i18n label key (mirrors ReservationStatusBadge). */
const STATUS_MAP: Record<ExchangeRequestStatus, { hue: ChipHue; i18nKey: string }> = {
  [ExchangeRequestStatus.PENDING]: { hue: 'yellow', i18nKey: 'listing.exchange.status.pending' },
  [ExchangeRequestStatus.CONFIRMED]: { hue: 'lime', i18nKey: 'listing.exchange.status.confirmed' },
  [ExchangeRequestStatus.DECLINED]: { hue: 'rose', i18nKey: 'listing.exchange.status.declined' },
  [ExchangeRequestStatus.CANCELLED]: { hue: 'neutral', i18nKey: 'listing.exchange.status.cancelled' },
  [ExchangeRequestStatus.COMPLETED]: { hue: 'cyan', i18nKey: 'listing.exchange.status.completed' },
};

export function ExchangeStatusBadge({ status }: { status: ExchangeRequestStatus }) {
  const { t } = useTranslation();
  const entry = STATUS_MAP[status];
  return (
    <Chip size="small" hue={entry.hue}>
      {t(entry.i18nKey)}
    </Chip>
  );
}

export default ExchangeStatusBadge;
