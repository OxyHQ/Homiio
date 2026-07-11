/**
 * Eviction case trust & safety report.
 *
 * Mirrors `reportController.createListingReport` but scoped to `caseId`: a
 * signed-in user flags a case (suspected fake notice, inappropriate content,
 * …). Re-filing while an earlier report is still open is a no-op so a user
 * can't spam the queue.
 */

import { EvictionCase, EvictionReport } from '../../models';
import { logger } from '../../middlewares/logging';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import { ListingReportReason, ListingReportStatus } from '@homiio/shared-types';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

const ALLOWED_REASONS: ReadonlySet<string> = new Set(Object.values(ListingReportReason));
const MAX_DETAILS_LENGTH = 4000;

export async function createEvictionReport(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { id } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);
    const { reason, details, contactEmail } = req.body || {};

    if (!reason || !ALLOWED_REASONS.has(reason)) {
      return next(new AppError('A valid report reason is required', 400, 'INVALID_REASON'));
    }

    const trimmedDetails = typeof details === 'string' ? details.trim() : '';
    if (trimmedDetails.length > MAX_DETAILS_LENGTH) {
      return next(new AppError('Details are too long', 400, 'DETAILS_TOO_LONG'));
    }
    if (reason === ListingReportReason.OTHER && !trimmedDetails) {
      return next(new AppError('Details are required when the reason is "other"', 400, 'DETAILS_REQUIRED'));
    }

    const evictionCase = await EvictionCase.findById(id).select('_id').lean();
    if (!evictionCase) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));

    const existingOpen = await EvictionReport.findOne({
      caseId: id,
      reporterOxyUserId: oxyUserId,
      status: ListingReportStatus.OPEN,
    });
    if (existingOpen) {
      return res.status(200).json(successResponse(existingOpen.toJSON(), 'Report already submitted'));
    }

    const report = await EvictionReport.create({
      caseId: id,
      reporterOxyUserId: oxyUserId,
      reason,
      details: trimmedDetails || undefined,
      contactEmail:
        typeof contactEmail === 'string' && contactEmail.trim() ? contactEmail.trim() : undefined,
      status: ListingReportStatus.OPEN,
    });

    logger.info('Eviction report created', {
      reportId: String(report._id),
      caseId: String(id),
      reporterOxyUserId: oxyUserId,
      reason,
    });

    res.status(201).json(successResponse(report.toJSON(), 'Report submitted'));
  } catch (error) {
    next(error);
  }
}
