import React from 'react';
import { Badge, BadgeColor } from '@oxyhq/bloom/badge';
import { TenantApplicationStatus } from '@homiio/shared-types';

interface ApplicationStatusBadgeProps {
  status: TenantApplicationStatus;
}

const STATUS_MAP: Record<TenantApplicationStatus, { label: string; color: BadgeColor }> = {
  [TenantApplicationStatus.SUBMITTED]: { label: 'Submitted', color: 'info' },
  [TenantApplicationStatus.REVIEWING]: { label: 'Reviewing', color: 'warning' },
  [TenantApplicationStatus.APPROVED]: { label: 'Approved', color: 'success' },
  [TenantApplicationStatus.REJECTED]: { label: 'Rejected', color: 'error' },
  [TenantApplicationStatus.WITHDRAWN]: { label: 'Withdrawn', color: 'default' },
};

export const ApplicationStatusBadge: React.FC<ApplicationStatusBadgeProps> = ({
  status,
}) => {
  const entry = STATUS_MAP[status];
  return <Badge content={entry.label} variant="subtle" color={entry.color} size="small" />;
};

export default ApplicationStatusBadge;
