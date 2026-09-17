import React from 'react';
import { useTranslation } from 'react-i18next';
import { Chip, type ChipHue } from '@oxy.so/bloom/chip';
import { TenantApplicationStatus } from '@homiio/shared-types';

/** Application status → Bloom Chip data hue + i18n label key. */
const STATUS_MAP: Record<TenantApplicationStatus, { hue: ChipHue; i18nKey: string }> = {
  [TenantApplicationStatus.SUBMITTED]: { hue: 'cyan', i18nKey: 'statusBadge.application.submitted' },
  [TenantApplicationStatus.REVIEWING]: { hue: 'yellow', i18nKey: 'statusBadge.application.reviewing' },
  [TenantApplicationStatus.APPROVED]: { hue: 'lime', i18nKey: 'statusBadge.application.approved' },
  [TenantApplicationStatus.REJECTED]: { hue: 'rose', i18nKey: 'statusBadge.application.rejected' },
  [TenantApplicationStatus.WITHDRAWN]: { hue: 'neutral', i18nKey: 'statusBadge.application.withdrawn' },
};

export function ApplicationStatusBadge({ status }: { status: TenantApplicationStatus }) {
  const { t } = useTranslation();
  const entry = STATUS_MAP[status];
  return (
    <Chip size="small" hue={entry.hue}>
      {t(entry.i18nKey)}
    </Chip>
  );
}

export default ApplicationStatusBadge;
