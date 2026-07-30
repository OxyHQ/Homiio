/**
 * Eviction case trust & safety report.
 *
 * Mirrors `reportController.createListingReport` but scoped to `caseId`: a
 * signed-in user flags a case (suspected fake notice, inappropriate content,
 * …). Re-filing while an earlier report is still open is a no-op so a user
 * can't spam the queue.
 *
 * ## This report is stored and NOT sent for community review
 *
 * An eviction case has no subject provider, so `createModerationReport` writes
 * its delivery record at `received` with the reason on the row and creates no
 * outbox event at all — never one a worker skips later, which would dead-letter
 * a report that is not defective.
 *
 * That is the deliberate answer, not a gap waiting to be closed by accident. An
 * eviction notice on the solidarity board is a claim about a legal process
 * affecting a named household, published by somebody who is usually not its
 * subject; what a randomly drawn jury should be shown in that case is a policy
 * question with real consequences for that household, and it has not been
 * answered. Refusing the report instead would break a live button, so the report
 * is taken, stored, and counted by the reconciliation sweep — which is the only
 * thing that makes "reports nobody will review" a visible number rather than a
 * quiet one.
 */

import { EvictionCase, EvictionReport } from '../../models';
import { logger } from '../../middlewares/logging';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import {
  ListingReportReason,
  ListingReportStatus,
  ModerationReportedType,
} from '@homiio/shared-types';
import {
  createModerationReport,
  DuplicateModerationReportError,
  withReportIntakeSession,
} from '../../services/moderation/ReportIntakeService';
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

    let report;
    try {
      report = await withReportIntakeSession(async (session) => {
        const [created] = await EvictionReport.create(
          [
            {
              caseId: id,
              reporterOxyUserId: oxyUserId,
              reason,
              details: trimmedDetails || undefined,
              contactEmail:
                typeof contactEmail === 'string' && contactEmail.trim()
                  ? contactEmail.trim()
                  : undefined,
              status: ListingReportStatus.OPEN,
            },
          ],
          { session },
        );

        await createModerationReport(
          {
            reportedType: ModerationReportedType.EVICTION_CASE,
            reportedId: String(id),
            reporter: oxyUserId,
            reason,
            details: trimmedDetails || undefined,
          },
          session,
        );

        return created;
      });
    } catch (error) {
      // Already on record from an earlier report of the same case by the same
      // reporter, even though no OPEN EvictionReport remained. Same answer as
      // the branch above — from the reporter's side it is the same fact.
      if (error instanceof DuplicateModerationReportError) {
        return res
          .status(200)
          .json(successResponse({ id: String(error.existing._id) }, 'Report already submitted'));
      }
      throw error;
    }

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
