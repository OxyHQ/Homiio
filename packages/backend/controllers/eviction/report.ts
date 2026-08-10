/**
 * Eviction case community report — and the precautionary hold it can trigger.
 *
 * A signed-in user flags a case. Re-filing while an earlier report is still open
 * converges on the existing one so nobody can spam.
 *
 * ## Two reasons carry a CONSEQUENCE, not just a counter
 *
 * `personal_data_exposed` and `location_too_precise` apply a PRECAUTIONARY HOLD
 * on the FIRST report: the published precision drops to `neighborhood`, the
 * coordinate stops being published at all, and the description is withheld until
 * the organiser answers. The case's existence, date, status and timeline stay
 * public, and nothing is deleted.
 *
 * One report is a deliberately low bar and the asymmetry is the reason: a
 * wrongly-held case costs supporters some navigation, and a wrongly-published one
 * costs a household its safety. #358 says a data-exposure report *"debe permitir
 * ocultación precautoria de campos sensibles sin borrar automáticamente todo el
 * caso"*, and this is that, at the most protective reading of "un reporte".
 *
 * Every other reason follows the community threshold the rest of Homiio uses:
 * three distinct reporters mark the case `disputed`, which ADR 0003 §7.6 pairs
 * with the same precision reduction. Marking it disputed does NOT delete it —
 * *"an eviction notice reported by the evicting agency is the EXPECTED case."*
 *
 * ## This is not a moderator queue, and the difference is structural
 *
 * Nothing here routes to a human with privileges. A threshold fires, a column is
 * stamped, a system timeline entry is written, and the organiser — the only
 * person who can act — is notified. There is no reviewer, no queue, and no
 * decision anybody makes about somebody else's content. That is the standing
 * veto in this repository's `AGENTS.md`, and it is what keeps the correction
 * mechanism from becoming the deletion mechanism.
 *
 * ## The report is stored and NOT sent for community review
 *
 * An eviction case has no subject provider, so `createModerationReport` writes
 * its delivery record at `received` with the reason on the row and creates no
 * outbox event — never one a worker skips later, which would dead-letter a
 * report that is not defective. What a randomly drawn jury should be shown about
 * a legal process affecting a named household is a policy question with real
 * consequences for that household, and it has not been answered. Refusing the
 * report instead would break a live button, so it is taken, stored, and counted
 * by the reconciliation sweep.
 */

import {
  EvictionReportReason,
  EvictionTimelineEventType,
  EVICTION_DISPUTED_REPORT_THRESHOLD,
  EVICTION_PRECAUTIONARY_HOLD_REASONS,
  ModerationReportedType,
} from '@homiio/shared-types';
import {
  appendTimelineEntry,
  applyPrecautionaryHold,
  countOpenReporters,
  DuplicateEvictionReportError,
  findEvictionCase,
  findOpenEvictionReport,
  insertEvictionReport,
  markCaseDisputed,
} from '../../db/evictions/evictionRepository';
import { DuplicateModerationReportError } from '../../db/moderation/moderationReportRepository';
import { logger } from '../../middlewares/logging';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import { notificationDispatchService } from '../../services/notificationDispatchService';
import {
  createModerationReport,
  withReportIntakeTransaction,
} from '../../services/moderation/ReportIntakeService';
import { parseEvictionReportReason, sanitizeDescription } from './shared';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

const MAX_DETAILS_LENGTH = 4000;

/**
 * Reasons that require the reporter to say more.
 *
 * `false_information` and `personal_data_exposed` both carry a consequence and
 * both are unfalsifiable without a sentence explaining what is false or what is
 * exposed — and the organiser is told the reason so they can answer it.
 */
const REASONS_REQUIRING_DETAILS: readonly EvictionReportReason[] = [
  EvictionReportReason.FALSE_INFORMATION,
  EvictionReportReason.PERSONAL_DATA_EXPOSED,
];

export async function createEvictionReport(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const { id } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);
    const { reason: rawReason, details, contactEmail } = req.body || {};

    const reason = parseEvictionReportReason(rawReason);
    if (!reason) {
      return next(new AppError('A valid report reason is required', 400, 'INVALID_REASON'));
    }

    const rawDetails = typeof details === 'string' ? details.trim() : '';
    if (rawDetails.length > MAX_DETAILS_LENGTH) {
      return next(new AppError('Details are too long', 400, 'DETAILS_TOO_LONG'));
    }
    if (REASONS_REQUIRING_DETAILS.includes(reason) && !rawDetails) {
      return next(
        new AppError('Details are required for this reason', 400, 'DETAILS_REQUIRED'),
      );
    }
    // The reporter's own prose is sanitised too. A report saying "they published
    // 600 123 456 and the flat is 3r 2a" would otherwise store, and later
    // display, exactly the values it is complaining about.
    const trimmedDetails = rawDetails ? sanitizeDescription(rawDetails).text : '';

    const evictionCase = await findEvictionCase(id);
    if (!evictionCase) {
      return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));
    }

    const existingOpen = await findOpenEvictionReport(id, oxyUserId);
    if (existingOpen) {
      return res.status(200).json(successResponse(existingOpen, 'Report already submitted'));
    }

    let report;
    try {
      report = await withReportIntakeTransaction(async (tx) => {
        const created = await insertEvictionReport(tx, {
          caseId: id,
          reporterOxyUserId: oxyUserId,
          reason,
          details: trimmedDetails || undefined,
          contactEmail:
            typeof contactEmail === 'string' && contactEmail.trim()
              ? contactEmail.trim()
              : undefined,
          status: 'open',
        });

        await createModerationReport(
          {
            reportedType: ModerationReportedType.EVICTION_CASE,
            reportedId: id,
            reporter: oxyUserId,
            reason,
            details: trimmedDetails || undefined,
          },
          tx,
        );

        return created;
      });
    } catch (error) {
      // Two ways to already be on record, and the reporter is told the same
      // thing by both because from their side it is the same fact.
      if (error instanceof DuplicateEvictionReportError) {
        return res.status(200).json(successResponse(error.existing, 'Report already submitted'));
      }
      if (error instanceof DuplicateModerationReportError) {
        return res
          .status(200)
          .json(successResponse({ id: error.existing.id }, 'Report already submitted'));
      }
      throw error;
    }

    const held = await applyThresholds(id, reason, evictionCase.oxyUserId);

    logger.info('Eviction report created', {
      reportId: report.id,
      caseId: id,
      reporterOxyUserId: oxyUserId,
      reason,
      precautionaryHold: held.precautionaryHold,
      disputed: held.disputed,
    });

    res.status(201).json(successResponse({ ...report, ...held }, 'Report submitted'));
  } catch (error) {
    next(error);
  }
}

/**
 * Apply whichever consequences this report just earned, exactly once each.
 *
 * Both stamps are compare-and-sets in their own `UPDATE`, so a burst of reports
 * cannot apply a hold twice or write two "held" entries onto the timeline. The
 * boolean each returns is what gates the timeline entry and the notification —
 * which is why the repository returns one rather than just succeeding.
 */
async function applyThresholds(
  caseId: string,
  reason: EvictionReportReason,
  ownerOxyUserId: string,
): Promise<{ precautionaryHold: boolean; disputed: boolean }> {
  let precautionaryHold = false;
  let disputed = false;

  if (EVICTION_PRECAUTIONARY_HOLD_REASONS.includes(reason)) {
    precautionaryHold = await applyPrecautionaryHold(caseId);
    if (precautionaryHold) {
      // A SYSTEM entry — `actorOxyUserId: null`. Naming the reporter here would
      // turn the timeline into a retaliation channel, which ADR 0003 §5.8
      // forbids outright: reporter identity is tier R and stays that way.
      await appendTimelineEntry(caseId, {
        eventType: EvictionTimelineEventType.PRECAUTIONARY_HOLD_APPLIED,
        actorOxyUserId: null,
        message:
          'This case was reported as exposing personal data or being too precise. ' +
          'The location and description are withheld until the organiser responds.',
      });
      await notificationDispatchService.createForUser(ownerOxyUserId, {
        type: 'eviction_precautionary_hold',
        title: 'Your eviction notice is on hold',
        message:
          'Somebody reported this notice as too precise or as exposing personal data. ' +
          'Review the location and description to publish it again.',
        data: { evictionId: caseId },
      });
    }
  }

  if ((await countOpenReporters(caseId)) >= EVICTION_DISPUTED_REPORT_THRESHOLD) {
    disputed = await markCaseDisputed(caseId);
  }

  return { precautionaryHold, disputed };
}
