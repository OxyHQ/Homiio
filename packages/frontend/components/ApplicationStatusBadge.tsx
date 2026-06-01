import { TenantApplicationStatus } from '@homiio/shared-types';
import { createStatusBadge, type StatusBadgeEntry } from '@/components/ui/createStatusBadge';

const STATUS_MAP: Record<TenantApplicationStatus, StatusBadgeEntry> = {
  [TenantApplicationStatus.SUBMITTED]: { label: 'Submitted', color: 'info' },
  [TenantApplicationStatus.REVIEWING]: { label: 'Reviewing', color: 'warning' },
  [TenantApplicationStatus.APPROVED]: { label: 'Approved', color: 'success' },
  [TenantApplicationStatus.REJECTED]: { label: 'Rejected', color: 'error' },
  [TenantApplicationStatus.WITHDRAWN]: { label: 'Withdrawn', color: 'default' },
};

export const ApplicationStatusBadge = createStatusBadge(STATUS_MAP);

export default ApplicationStatusBadge;
