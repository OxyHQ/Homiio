import React from 'react';
import { useTranslation } from 'react-i18next';
import { Chip, type ChipHue } from '@oxy.so/bloom/chip';
import { ReservationStatus } from '@homiio/shared-types';

/** Reservation status → Bloom Chip data hue + i18n label key. */
const STATUS_MAP: Record<ReservationStatus, { hue: ChipHue; i18nKey: string }> = {
  [ReservationStatus.PENDING]: { hue: 'yellow', i18nKey: 'statusBadge.reservation.pending' },
  [ReservationStatus.CONFIRMED]: { hue: 'lime', i18nKey: 'statusBadge.reservation.confirmed' },
  [ReservationStatus.DECLINED]: { hue: 'rose', i18nKey: 'statusBadge.reservation.declined' },
  [ReservationStatus.CANCELLED]: { hue: 'neutral', i18nKey: 'statusBadge.reservation.cancelled' },
  [ReservationStatus.COMPLETED]: { hue: 'cyan', i18nKey: 'statusBadge.reservation.completed' },
};

export function ReservationStatusBadge({ status }: { status: ReservationStatus }) {
  const { t } = useTranslation();
  const entry = STATUS_MAP[status];
  return (
    <Chip size="small" hue={entry.hue}>
      {t(entry.i18nKey)}
    </Chip>
  );
}

export default ReservationStatusBadge;
