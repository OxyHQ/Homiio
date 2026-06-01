/**
 * Listing Report Controller
 *
 * Handles trust & safety reports filed against a property listing. A signed-in
 * user flags a problem (inaccurate info, suspected scam, inappropriate content,
 * an already-rented listing, …); the report lands in the internal review queue
 * with `status: 'open'`.
 *
 * Distinct from `Review` (public address rating).
 */

const { Property, ListingReport, Profile } = require('../models');
const { logger } = require('../middlewares/logging');
const { AppError, successResponse } = require('../middlewares/errorHandler');
const { ListingReportReason, ListingReportStatus } = require('@homiio/shared-types');

const ALLOWED_REASONS = new Set(Object.values(ListingReportReason));
const MAX_DETAILS_LENGTH = 4000;

class ReportController {
  /**
   * POST /api/properties/:propertyId/report
   *
   * Body: { reason, details?, contactEmail? }
   * Records the report against the property, attributed to the reporter's
   * active profile. Re-filing while an earlier report is still open is a no-op
   * (the existing open report is returned) so a user can't spam the queue.
   */
  async createListingReport(req: any, res: any, next: any) {
    try {
      const { propertyId } = req.params;
      const { reason, details, contactEmail } = req.body || {};

      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      if (!reason || !ALLOWED_REASONS.has(reason)) {
        return next(new AppError('A valid report reason is required', 400, 'INVALID_REASON'));
      }

      const trimmedDetails = typeof details === 'string' ? details.trim() : '';
      if (trimmedDetails.length > MAX_DETAILS_LENGTH) {
        return next(new AppError('Details are too long', 400, 'DETAILS_TOO_LONG'));
      }
      // Free-text context is mandatory when the reason is "other" — otherwise
      // the report carries no actionable information.
      if (reason === ListingReportReason.OTHER && !trimmedDetails) {
        return next(new AppError('Details are required when the reason is "other"', 400, 'DETAILS_REQUIRED'));
      }

      const property = await Property.findById(propertyId).lean();
      if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));

      const reporterProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!reporterProfile) return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));

      // Idempotent while open: return the existing open report instead of
      // creating a duplicate (also enforced by a partial unique index).
      const existingOpen = await ListingReport.findOne({
        propertyId,
        reporterProfileId: reporterProfile._id,
        status: ListingReportStatus.OPEN
      });
      if (existingOpen) {
        return res.status(200).json(successResponse(existingOpen.toJSON(), 'Report already submitted'));
      }

      const report = await ListingReport.create({
        propertyId,
        reporterProfileId: reporterProfile._id,
        reason,
        details: trimmedDetails || undefined,
        contactEmail: typeof contactEmail === 'string' && contactEmail.trim() ? contactEmail.trim() : undefined,
        status: ListingReportStatus.OPEN
      });

      logger.info('Listing report created', {
        reportId: String(report._id),
        propertyId: String(propertyId),
        reporterProfileId: String(reporterProfile._id),
        reason
      });

      res.status(201).json(successResponse(report.toJSON(), 'Report submitted'));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ReportController();
