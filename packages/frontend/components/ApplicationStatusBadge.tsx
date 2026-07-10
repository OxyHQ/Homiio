import { TenantApplicationStatus } from '@homiio/shared-types';
import { createStatusBadge, type StatusBadgeEntry } from '@/components/ui/createStatusBadge';

const STATUS_MAP: Record<TenantApplicationStatus, StatusBadgeEntry> = {
  [TenantApplicationStatus.SUBMITTED]: { i18nKey: 'status.application.submitted', label: 'Submitted', color: 'info' },
  [TenantApplicationStatus.REVIEWING]: { i18nKey: 'status.application.reviewing', label: 'Reviewing', color: 'warning' },
  [TenantApplicationStatus.APPROVED]: { i18nKey: 'status.application.approved', label: 'Approved', color: 'success' },
  [TenantApplicationStatus.REJECTED]: { i18nKey: 'status.application.rejected', label: 'Rejected', color: 'error' },
  [TenantApplicationStatus.WITHDRAWN]: { i18nKey: 'status.application.withdrawn', label: 'Withdrawn', color: 'default' },
};

export const ApplicationStatusBadge = createStatusBadge(STATUS_MAP);

export default ApplicationStatusBadge;
