import React from 'react';
import { useTranslation } from 'react-i18next';
import { Chip, type ChipHue } from '@oxy.so/bloom/chip';
import type { LeaseStatus } from '@homiio/shared-types';

interface StatusEntry {
  hue: ChipHue;
  i18nKey: string;
}

/** Lease status → Bloom Chip data hue + i18n label key. */
const LEASE_STATUS_MAP: Record<`${LeaseStatus}` | 'pending', StatusEntry> = {
  draft: { hue: 'soft', i18nKey: 'statusBadge.draft' },
  pending: { hue: 'yellow', i18nKey: 'statusBadge.pending' },
  pending_signatures: { hue: 'yellow', i18nKey: 'statusBadge.pendingSignatures' },
  active: { hue: 'lime', i18nKey: 'statusBadge.active' },
  expired: { hue: 'neutral', i18nKey: 'statusBadge.expired' },
  terminated: { hue: 'rose', i18nKey: 'statusBadge.terminated' },
  cancelled: { hue: 'neutral', i18nKey: 'statusBadge.cancelled' },
};

const UNKNOWN: StatusEntry = { hue: 'soft', i18nKey: 'statusBadge.unknown' };

export function ContractStatusBadge({ status }: { status: LeaseStatus | `${LeaseStatus}` | string }) {
  const { t } = useTranslation();
  const entry = LEASE_STATUS_MAP[status as keyof typeof LEASE_STATUS_MAP] ?? UNKNOWN;
  return (
    <Chip size="small" hue={entry.hue}>
      {t(entry.i18nKey)}
    </Chip>
  );
}

export default ContractStatusBadge;
