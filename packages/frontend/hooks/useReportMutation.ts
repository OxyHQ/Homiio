/**
 * Listing report mutation hook. Drives the in-app "Report this listing" flow
 * (`app/properties/[id]/report.tsx`).
 */
import { useMutation } from '@tanstack/react-query';
import { CreateListingReportInput, ListingReport } from '@homiio/shared-types';

import { reportService } from '@/services/reportService';

interface ReportListingVariables {
  propertyId: string;
  input: CreateListingReportInput;
}

export function useReportListingMutation() {
  return useMutation<ListingReport, unknown, ReportListingVariables>({
    mutationFn: ({ propertyId, input }: ReportListingVariables) =>
      reportService.reportListing(propertyId, input),
  });
}
