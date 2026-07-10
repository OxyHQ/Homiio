import { TenantApplicationStatus } from '@homiio/shared-types';
import { createStatusBadge, type StatusBadgeEntry } from '@/components/ui/createStatusBadge';

const STATUS_MAP: Record<TenantApplicationStatus, StatusBadgeEntry> = {
  [TenantApplicationStatus.SUBMITTED]: { i18nKey: 'statusBadge.application.submitted', label: 'Submitted', color: 'info' },
  [TenantApplicationStatus.REVIEWING]: { i18nKey: 'statusBadge.application.reviewing', label: 'Reviewing', color: 'warning' },
  [TenantApplicationStatus.APPROVED]: { i18nKey: 'statusBadge.application.approved', label: 'Approved', color: 'success' },
  [TenantApplicationStatus.REJECTED]: { i18nKey: 'statusBadge.application.rejected', label: 'Rejected', color: 'error' },
  [TenantApplicationStatus.WITHDRAWN]: { i18nKey: 'statusBadge.application.withdrawn', label: 'Withdrawn', color: 'default' },
};

export const ApplicationStatusBadge = createStatusBadge(STATUS_MAP);

export default ApplicationStatusBadge;
