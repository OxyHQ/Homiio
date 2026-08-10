/**
 * Eviction timeline entries.
 *
 * Owner-only: append an entry to a case's timeline (a reschedule, a status
 * change, a correction, or a plain note). When the entry carries a new schedule
 * or status the case row is updated in the same transaction — a status change
 * visible on the case but missing from the timeline is a change nobody can
 * account for, and a timeline entry announcing a change that did not commit is
 * worse.
 *
 * ## The timeline is APPEND-ONLY, in the database
 *
 * There is no edit or delete handler here, and there is no route to one. That is
 * a property of today's controllers, so the table carries the rule as well: a
 * `BEFORE UPDATE` trigger (`eviction_case_updates_immutable`, migration 0013)
 * refuses any modification. #358's "no reescribir silenciosamente el estado
 * original sin conservar historial" is therefore enforced one layer below
 * whoever writes the next controller.
 *
 * ## An invalid transition is a 409, and it is refused by the WRITE
 *
 * `updateOwnedEvictionCase` puts the permitted predecessors into the `UPDATE`'s
 * own `WHERE`, so a `cancelled → upcoming` matches no row. The follow-up read
 * only decides which error to render. A cancelled case therefore cannot come
 * back as `upcoming`, which is half of #358's "caso cancelado no aparece como
 * upcoming" — the board's status filter is the other half.
 */

import { EvictionTimelineEventType } from '@homiio/shared-types';
import { pickFields } from '../../utils/pickFields';
import {
  countEvictionAttendees,
  findOwnedEvictionCase,
  listEvictionTimeline,
  listHelpNeedsForCases,
  listOrganizationsByIds,
  readCaseContact,
  updateOwnedEvictionCase,
  type EvictionCasePatch,
  type EvictionTimelineEntryInput,
} from '../../db/evictions/evictionRepository';
import { toEvictionDTO } from './toEvictionDTO';
import {
  notifyTimelineEvent,
  parseDate,
  parseEvictionStatus,
  sanitizeDescription,
  type EvictionStatusValue,
} from './shared';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

const MAX_UPDATE_LENGTH = 2000;

const CREATABLE_UPDATE_FIELDS: readonly string[] = [
  'message',
  'eventType',
  'newScheduledAt',
  'newStatus',
];

/**
 * The event types an ORGANISER may write.
 *
 * `precautionary_hold_applied` and `organization_verified` are absent: the first
 * is written by the report threshold and the second by curation, and an organiser
 * able to post either could stage a verification they do not have or clear a hold
 * by narrating one.
 */
const ORGANISER_EVENT_TYPES: readonly EvictionTimelineEventType[] = [
  EvictionTimelineEventType.NOTE,
  EvictionTimelineEventType.CORRECTION_PUBLISHED,
  EvictionTimelineEventType.LEGAL_RESOURCE_ADDED,
  EvictionTimelineEventType.INSTRUCTIONS_UPDATED,
];

/** The status a timeline entry announces → the event type that names it. */
const EVENT_TYPE_BY_STATUS: Readonly<
  Record<EvictionStatusValue, EvictionTimelineEventType>
> = {
  upcoming: EvictionTimelineEventType.DATE_CHANGED,
  postponed: EvictionTimelineEventType.POSTPONED,
  stopped: EvictionTimelineEventType.STOPPED,
  executed: EvictionTimelineEventType.EXECUTED,
  cancelled: EvictionTimelineEventType.CANCELLED,
};

export async function createUpdate(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const { id } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);

    const owned = await findOwnedEvictionCase(id, oxyUserId);
    if (!owned) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));

    const picked = pickFields<Record<string, unknown>>(req.body, CREATABLE_UPDATE_FIELDS);

    const raw = typeof picked.message === 'string' ? picked.message.trim() : '';
    if (!raw) return next(new AppError('An update message is required', 400, 'INVALID_MESSAGE'));
    if (raw.length > MAX_UPDATE_LENGTH) {
      return next(new AppError('Update message is too long', 400, 'MESSAGE_TOO_LONG'));
    }
    // A timeline entry is published prose on the same board as the description,
    // so it goes through the same sanitiser. Skipping it here would leave the
    // easiest route to publishing an address wide open — the field somebody
    // types into once the case is already live.
    const sanitized = sanitizeDescription(raw);
    if (!sanitized.text) {
      return next(
        new AppError(
          'The update was left empty once addresses and contacts were removed.',
          400,
          'INVALID_MESSAGE',
        ),
      );
    }

    const patch: EvictionCasePatch = {};
    let newScheduledAt: Date | undefined;
    let newStatus: EvictionStatusValue | undefined;

    if (picked.newScheduledAt !== undefined) {
      const parsed = parseDate(picked.newScheduledAt);
      if (!parsed) {
        return next(new AppError('A valid scheduled date is required', 400, 'INVALID_SCHEDULED_AT'));
      }
      newScheduledAt = parsed;
      patch.scheduledAt = parsed;
    }
    if (picked.newStatus !== undefined) {
      const status = parseEvictionStatus(picked.newStatus);
      if (!status) return next(new AppError('Invalid status', 400, 'INVALID_STATUS'));
      newStatus = status;
      patch.status = status;
    }

    const requestedType =
      typeof picked.eventType === 'string'
        ? ORGANISER_EVENT_TYPES.find((type) => type === picked.eventType)
        : undefined;
    if (picked.eventType !== undefined && !requestedType) {
      return next(new AppError('Invalid timeline event type', 400, 'INVALID_EVENT_TYPE'));
    }

    const entry: EvictionTimelineEntryInput = {
      // A lifecycle change names itself, whatever the client asked for: a
      // `cancelled` transition filed under `note` would be a status change
      // hidden in the audit that exists to surface it.
      eventType: newStatus
        ? EVENT_TYPE_BY_STATUS[newStatus]
        : newScheduledAt
          ? EvictionTimelineEventType.DATE_CHANGED
          : (requestedType ?? EvictionTimelineEventType.NOTE),
      actorOxyUserId: oxyUserId,
      message: sanitized.text,
      newScheduledAt,
      newStatus,
    };

    const outcome = await updateOwnedEvictionCase({
      caseId: id,
      oxyUserId,
      patch,
      timelineEntries: [entry],
    });

    if (outcome.outcome === 'not_found') {
      return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));
    }
    if (outcome.outcome === 'invalid_transition') {
      return next(
        new AppError(
          `A ${outcome.from} case cannot become ${outcome.to}.`,
          409,
          'INVALID_STATUS_TRANSITION',
        ),
      );
    }

    for (const written of outcome.timelineEntries) {
      await notifyTimelineEvent({
        caseId: id,
        updateId: written.id,
        excludeOxyUserId: oxyUserId,
        payload: {
          type: 'eviction_update',
          title: 'Eviction case update',
          message: written.message,
          data: { evictionId: id },
        },
      });
    }

    const [timeline, attendeeCount, helpNeedsByCase, organizations, contact] = await Promise.all([
      listEvictionTimeline(id),
      countEvictionAttendees(id),
      listHelpNeedsForCases([id]),
      outcome.row.organizationId
        ? listOrganizationsByIds([outcome.row.organizationId])
        : Promise.resolve(undefined),
      readCaseContact(id),
    ]);

    res.status(201).json(
      successResponse(
        {
          eviction: toEvictionDTO(
            {
              evictionCase: outcome.row,
              timeline,
              attendeeCount,
              helpNeeds: helpNeedsByCase.get(id) ?? [],
              organization: outcome.row.organizationId
                ? organizations?.get(outcome.row.organizationId)
                : undefined,
            },
            { viewerOxyUserId: oxyUserId, contact },
          ),
          removedForPrivacy: sanitized.removed,
        },
        'Update posted',
      ),
    );
  } catch (error) {
    next(error);
  }
}
