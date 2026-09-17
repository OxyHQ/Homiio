/**
 * Eviction lifecycle status badge — a Bloom `Chip` in the status's data hue,
 * rendered identically to the applications/reservations/exchange badges.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Chip } from '@oxy.so/bloom/chip';
import type { EvictionCaseStatus } from '@homiio/shared-types';
import { EVICTION_STATUS_META } from './evictionUtils';

export function EvictionStatusBadge({ status }: { status: EvictionCaseStatus }) {
  const { t } = useTranslation();
  const meta = EVICTION_STATUS_META[status];
  return (
    <Chip size="small" hue={meta.hue}>
      {t(meta.i18nKey)}
    </Chip>
  );
}

export default EvictionStatusBadge;
