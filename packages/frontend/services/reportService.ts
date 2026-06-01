/**
 * Listing Report Service
 *
 * Wraps the trust & safety report endpoint
 * (`POST /api/properties/:propertyId/report`). A signed-in user files a report
 * against a listing; the backend attributes it to the reporter's active
 * profile and queues it for internal review.
 */
import { api, ApiError, ApiResponse } from '@/utils/api';
import { CreateListingReportInput, ListingReport } from '@homiio/shared-types';

export type { CreateListingReportInput, ListingReport } from '@homiio/shared-types';

export const reportService = {
  /**
   * File a report against a property listing. Returns the created (or, when an
   * open report by the same user already exists, the existing) report.
   */
  async reportListing(
    propertyId: string,
    input: CreateListingReportInput,
  ): Promise<ListingReport> {
    const response = await api.post<ApiResponse<ListingReport>>(
      `/api/properties/${propertyId}/report`,
      input,
    );
    const report = response.data?.data;
    if (!report) {
      throw new ApiError('Empty report response', 500, response.data);
    }
    return report;
  },
};

export default reportService;
