import {
  listOrganizationsByIds,
  resolveSupportOrganization,
} from '../../services/organizations/supportOrganizations';
/**
 * Eviction-case writes (create / update / delete) — the use cases behind the
 * eviction write routes and the catalogue's eviction write tools.
 *
 * Ownership + mass-assignment rules mirror property/lease writes:
 *   - the owner is the session `oxyUserId` (never from the client),
 *   - only `CREATABLE_EVICTION_FIELDS` / `EDITABLE_EVICTION_FIELDS` are picked,
 *   - nested objects are re-whitelisted key-by-key (never deep-spread),
 *   - updates require current team membership; deletion requires the creator.
 *
 * ## The true coordinate arrives, is used, and is dropped
 *
 * A reporter sends the point they know. This file hands it to
 * `derivePublicDisc`, writes the DISC, and never writes the point — unless
 * `householdAuthorizedExact` is set, which is the single authorisation event ADR
 * 0003 §7.3 accepts for storing an exact eviction location at all. That is §3.3's
 * store-nothing-you-do-not-need rule, and this table is the ADR's own example of
 * it: *"Reporting an eviction is a third party describing somebody else's home;
 * nothing downstream needs metre accuracy."*
 *
 * The offset is drawn once. An UPDATE that resubmits a point still inside the
 * published disc keeps the existing centre, because every redraw is an
 * independent sample around the true point and a public observer collecting
 * several of them can average towards it. See `shouldRedrawPublicLocation`.
 *
 * ## Free text is sanitised on the way in, and the reporter is told what went
 *
 * The label and the description are where "Carrer de X 42, 3r 2a" gets typed, and
 * they were published verbatim (ADR 0003, finding F9). They go through
 * `sanitizePublicText` now, and the response carries the CATEGORIES that were
 * removed — never the removed values, because this deployment logs response
 * bodies on error and echoing the number back would reintroduce the disclosure
 * into the log.
 *
 * ## Every column this file writes is named, one assignment at a time
 *
 * `Object.assign` type-checks whatever it is handed, so a key that stopped
 * belonging on the patch would reach the `UPDATE` silently — in the one file
 * whose entire job is keeping a request body away from server-owned columns.
 */

import { EvictionTimelineEventType } from '@homiio/shared-types';
import { pickFields } from '../../utils/pickFields';
import { CREATABLE_EVICTION_FIELDS, EDITABLE_EVICTION_FIELDS } from './editableFields';
import {
  appendTimelineEntry,
  countEvictionAttendees,
  deleteOwnedEvictionCase,
  findEditableEvictionCase,
  insertEvictionCase,
  listEvictionTimeline,
  listHelpNeedsForCases,
  readCaseContact,
  replaceHelpNeeds,
  updateOwnedEvictionCase,
  type EvictionCaseInsert,
  type EvictionCasePatch,
  type EvictionTimelineEntryInput,
} from '../../db/evictions/evictionRepository';
import {
  derivePublicDisc,
  shouldRedrawPublicLocation,
} from '../../db/evictions/locationApproximation';
import { toEvictionDTO } from './toEvictionDTO';
import {
  notifyTimelineEvent,
  parseDate,
  parseEvictionStatus,
  resolveAgencyId,
  sanitizeContactInfo,
  sanitizeCoverImage,
  sanitizeDescription,
  sanitizeHelpNeeds,
  sanitizeLocation,
  type EvictionStatusValue,
} from './shared';
import type { RemovedTextClass } from './sanitizePublicText';
import { AppError } from '../../middlewares/errorHandler';

/** The status a timeline entry announces → the event type that names it. */
const EVENT_TYPE_BY_STATUS: Readonly<Record<EvictionStatusValue, EvictionTimelineEventType>> = {
  upcoming: EvictionTimelineEventType.DATE_CHANGED,
  postponed: EvictionTimelineEventType.POSTPONED,
  stopped: EvictionTimelineEventType.STOPPED,
  executed: EvictionTimelineEventType.EXECUTED,
  cancelled: EvictionTimelineEventType.CANCELLED,
};

/** The columns a resolved location writes, public disc and all. */
interface ResolvedLocationColumns {
  readonly locationLabel: string;
  readonly locationLongitude: number;
  readonly locationLatitude: number;
  readonly locationRadiusMeters: number;
  readonly locationPrecision: EvictionCaseInsert['locationPrecision'];
  readonly locationCity: string | null;
  readonly locationCountryCode: string | null;
  readonly removed: readonly RemovedTextClass[];
}

/** Open a case as `oxyUserId`. The body is whitelisted by `CREATABLE_EVICTION_FIELDS`. */
export async function reportEvictionCase(oxyUserId: string, body: unknown) {
  const picked = pickFields<Record<string, unknown>>(body, CREATABLE_EVICTION_FIELDS);

  const title = typeof picked.title === 'string' ? picked.title.trim() : '';
  if (!title) throw new AppError('Title is required', 400, 'INVALID_TITLE');

  const rawDescription = typeof picked.description === 'string' ? picked.description.trim() : '';
  if (!rawDescription) {
    throw new AppError('Description is required', 400, 'INVALID_DESCRIPTION');
  }
  const description = sanitizeDescription(rawDescription);
  if (!description.text) {
    throw new AppError(
      'The description was left empty once addresses and contacts were removed.',
      400,
      'INVALID_DESCRIPTION',
    );
  }

  const location = sanitizeLocation(picked.location);
  if (!location?.label || location.longitude === undefined || location.latitude === undefined) {
    throw new AppError(
      'A location with a label and coordinates is required',
      400,
      'INVALID_LOCATION',
    );
  }

  const scheduledAt = parseDate(picked.scheduledAt);
  if (!scheduledAt) {
    throw new AppError('A valid scheduled date is required', 400, 'INVALID_SCHEDULED_AT');
  }

  // The point is used HERE and is not written below unless the household
  // authorised it. Everything after this line deals in the disc.
  const disc = await derivePublicDisc({
    longitude: location.longitude,
    latitude: location.latitude,
  });

  const householdAuthorized = picked.householdAuthorizedExact === true;
  const exactAddress =
    householdAuthorized && typeof picked.exactAddress === 'string' && picked.exactAddress.trim()
      ? picked.exactAddress.trim()
      : null;

  const agencyId =
    typeof picked.agencyOxyAccountId === 'string' && picked.agencyOxyAccountId.trim()
      ? await resolveAgencyId(picked.agencyOxyAccountId)
      : undefined;

  const organization =
    typeof picked.organizationOxyAccountId === 'string' && picked.organizationOxyAccountId.trim()
      ? await resolveSupportOrganization(picked.organizationOxyAccountId)
      : undefined;

  const contact = sanitizeContactInfo(picked.contactInfo);
  const coverImage = sanitizeCoverImage(picked.coverImage);
  const helpNeeds = sanitizeHelpNeeds(picked.helpNeeds);

  const created = await insertEvictionCase({
    oxyUserId,
    title,
    description: description.text,
    locationLabel: location.label,
    locationLongitude: disc.longitude,
    locationLatitude: disc.latitude,
    locationRadiusMeters: disc.radiusMeters,
    locationPrecision: location.precision ?? 'approximate_radius',
    locationCity: location.city ?? null,
    locationCountryCode: location.countryCode ?? null,
    // Written ONLY under the household's own authorisation, and the CHECK
    // `eviction_cases_exact_location_authorized_check` refuses the row
    // otherwise — so a future caller that forgets this branch gets a failed
    // insert rather than a silent disclosure.
    locationHouseholdAuthorizedAt: householdAuthorized ? new Date() : null,
    locationExactLongitude: householdAuthorized ? location.longitude : null,
    locationExactLatitude: householdAuthorized ? location.latitude : null,
    locationExactAddress: exactAddress,
    scheduledAt,
    // Status is ALWAYS server-set to `upcoming` at creation — never from the body.
    status: 'upcoming',
    agencyId: agencyId ?? null,
    organizationId: organization?.id ?? null,
    contactPhone: contact.contactPhone,
    contactEmail: contact.contactEmail,
    contactTelegram: contact.contactTelegram,
    contactWhatsapp: contact.contactWhatsapp,
    contactInstructions: contact.contactInstructions,
    coverImageId: coverImage.coverImageId,
    coverImageUrl: coverImage.coverImageUrl,
  });

  if (helpNeeds.length) await replaceHelpNeeds(created.id, helpNeeds);

  // The timeline opens with the case, so "when was this published" is a fact on
  // the same audit as every later change rather than something a reader has to
  // infer from `created_at`.
  await appendTimelineEntry(created.id, {
    eventType: EvictionTimelineEventType.CASE_CREATED,
    actorOxyUserId: oxyUserId,
    message: 'Case published.',
  });

  const [timeline, helpNeedsByCase] = await Promise.all([
    listEvictionTimeline(created.id),
    listHelpNeedsForCases([created.id]),
  ]);

  return {
    eviction: toEvictionDTO(
      {
        evictionCase: created,
        timeline,
        attendeeCount: 0,
        helpNeeds: helpNeedsByCase.get(created.id) ?? [],
        organization,
      },
      {
        viewerOxyUserId: oxyUserId,
        isAttending: false,
        isFollowing: false,
        contact,
      },
    ),
    // Categories only. The removed VALUES never travel.
    removedForPrivacy: [...new Set([...location.removedFromLabel, ...description.removed])],
  };
}

/** Edit a case the person created or collaborates on. The body is whitelisted by `EDITABLE_EVICTION_FIELDS`. */
export async function updateEvictionCase(oxyUserId: string, id: string, body: unknown) {
  // Read first, for the 404 AND for the previous date/status/disc the change
  // detection below compares against. The write re-checks ownership AND the
  // transition in its own `WHERE`, so this read is never the authorization.
  const existing = await findEditableEvictionCase(id, oxyUserId);
  if (!existing) throw new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND');

  const picked = pickFields<Record<string, unknown>>(body, EDITABLE_EVICTION_FIELDS);
  const patch: EvictionCasePatch = {};
  const timelineEntries: EvictionTimelineEntryInput[] = [];
  const removedForPrivacy = new Set<RemovedTextClass>();

  if (picked.title !== undefined) {
    const title = typeof picked.title === 'string' ? picked.title.trim() : '';
    if (!title) throw new AppError('Title cannot be empty', 400, 'INVALID_TITLE');
    patch.title = title;
  }

  if (picked.description !== undefined) {
    const raw = typeof picked.description === 'string' ? picked.description.trim() : '';
    if (!raw) {
      throw new AppError('Description cannot be empty', 400, 'INVALID_DESCRIPTION');
    }
    const sanitized = sanitizeDescription(raw);
    if (!sanitized.text) {
      throw new AppError(
        'The description was left empty once addresses and contacts were removed.',
        400,
        'INVALID_DESCRIPTION',
      );
    }
    patch.description = sanitized.text;
    for (const kind of sanitized.removed) removedForPrivacy.add(kind);
  }

  if (picked.location !== undefined) {
    const location = sanitizeLocation(picked.location);
    if (!location?.label || location.longitude === undefined || location.latitude === undefined) {
      throw new AppError(
        'A location with a label and coordinates is required',
        400,
        'INVALID_LOCATION',
      );
    }
    for (const kind of location.removedFromLabel) removedForPrivacy.add(kind);

    const resolved = await resolveUpdatedLocation(existing, location);
    patch.locationLabel = resolved.locationLabel;
    patch.locationLongitude = resolved.locationLongitude;
    patch.locationLatitude = resolved.locationLatitude;
    patch.locationRadiusMeters = resolved.locationRadiusMeters;
    patch.locationPrecision = resolved.locationPrecision;
    // A location payload replaces the whole location, so a city the new
    // payload does not name is cleared rather than inherited.
    patch.locationCity = resolved.locationCity;
    patch.locationCountryCode = resolved.locationCountryCode;

    // The exact pair only ever moves under a household authorisation that
    // already exists on the row; this endpoint cannot create one, because
    // "the household asked for it" is not something a PUT body can assert.
    if (
      existing.locationHouseholdAuthorizedAt !== null &&
      (location.longitude !== existing.locationLongitude ||
        location.latitude !== existing.locationLatitude)
    ) {
      patch.locationExactLongitude = location.longitude;
      patch.locationExactLatitude = location.latitude;
    }

    if (
      resolved.locationLongitude !== existing.locationLongitude ||
      resolved.locationLatitude !== existing.locationLatitude ||
      resolved.locationPrecision !== existing.locationPrecision
    ) {
      timelineEntries.push({
        eventType: EvictionTimelineEventType.LOCATION_PRECISION_CHANGED,
        actorOxyUserId: oxyUserId,
        message: `Location updated. Published to within ${resolved.locationRadiusMeters} m.`,
      });
    }
  }

  if (picked.exactAddress !== undefined) {
    if (existing.locationHouseholdAuthorizedAt === null) {
      throw new AppError(
        'The household must authorize exact location storage first',
        409,
        'HOUSEHOLD_NOT_AUTHORIZED',
      );
    }
    if (typeof picked.exactAddress !== 'string' || picked.exactAddress.length > 2000) {
      throw new AppError('Invalid exact address', 400, 'INVALID_EXACT_ADDRESS');
    }
    patch.locationExactAddress = picked.exactAddress.trim() || null;
  }

  if ('contactInfo' in picked) {
    // Clearing the block and replacing it are the same five writes, and
    // `sanitizeContactInfo` already answers an absent handle with `null`.
    const contact = sanitizeContactInfo(picked.contactInfo);
    patch.contactPhone = contact.contactPhone;
    patch.contactEmail = contact.contactEmail;
    patch.contactTelegram = contact.contactTelegram;
    patch.contactWhatsapp = contact.contactWhatsapp;
    patch.contactInstructions = contact.contactInstructions;
    timelineEntries.push({
      eventType: EvictionTimelineEventType.INSTRUCTIONS_UPDATED,
      actorOxyUserId: oxyUserId,
      message: 'Organiser contact details updated.',
    });
  }

  if ('coverImage' in picked) {
    const coverImage = sanitizeCoverImage(picked.coverImage);
    patch.coverImageId = coverImage.coverImageId;
    patch.coverImageUrl = coverImage.coverImageUrl;
  }

  if (picked.organizationOxyAccountId !== undefined) {
    const name =
      typeof picked.organizationOxyAccountId === 'string' ? picked.organizationOxyAccountId : '';
    const organization = name.trim() ? await resolveSupportOrganization(name) : undefined;
    patch.organizationId = organization?.id ?? null;
  }

  let nextScheduledAt: Date | undefined;
  let nextStatus: EvictionStatusValue | undefined;

  if (picked.scheduledAt !== undefined) {
    const parsed = parseDate(picked.scheduledAt);
    if (!parsed) {
      throw new AppError('A valid scheduled date is required', 400, 'INVALID_SCHEDULED_AT');
    }
    if (parsed.getTime() !== existing.scheduledAt.getTime()) {
      nextScheduledAt = parsed;
      patch.scheduledAt = parsed;
    }
  }

  if (picked.status !== undefined) {
    const status = parseEvictionStatus(picked.status);
    if (!status) throw new AppError('Invalid status', 400, 'INVALID_STATUS');
    if (status !== existing.status) {
      nextStatus = status;
      patch.status = status;
    }
  }

  if (nextScheduledAt || nextStatus) {
    const parts: string[] = [];
    if (nextScheduledAt) parts.push(`Rescheduled to ${nextScheduledAt.toISOString()}`);
    if (nextStatus) parts.push(`Status changed to ${nextStatus}`);
    timelineEntries.push({
      eventType: nextStatus
        ? EVENT_TYPE_BY_STATUS[nextStatus]
        : EvictionTimelineEventType.DATE_CHANGED,
      actorOxyUserId: oxyUserId,
      message: parts.join('. '),
      newScheduledAt: nextScheduledAt,
      newStatus: nextStatus,
    });
  }

  // One call, one transaction: the patch and the timeline entries it explains
  // commit together or not at all.
  const outcome = await updateOwnedEvictionCase({
    caseId: id,
    oxyUserId,
    patch,
    allowCollaborator: true,
    timelineEntries,
    helpNeeds: picked.helpNeeds !== undefined ? sanitizeHelpNeeds(picked.helpNeeds) : undefined,
  });

  if (outcome.outcome === 'not_found') {
    throw new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND');
  }
  if (outcome.outcome === 'invalid_transition') {
    throw new AppError(
      `A ${outcome.from} case cannot become ${outcome.to}.`,
      409,
      'INVALID_STATUS_TRANSITION',
    );
  }

  // One notification per timeline entry, claimed against the entry's own id
  // before it is sent, so a retry cannot repeat it. #358: "update de fecha
  // notificado una sola vez".
  for (const entry of outcome.timelineEntries) {
    await notifyTimelineEvent({
      caseId: id,
      updateId: entry.id,
      excludeOxyUserId: oxyUserId,
      payload: {
        type: 'eviction_update',
        title: 'Eviction case updated',
        message: entry.message,
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

  return {
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
    removedForPrivacy: [...removedForPrivacy],
  };
}

/**
 * The published disc after an update, redrawing only when the point really moved.
 *
 * A resubmitted point still inside the published disc keeps the existing centre.
 * That is a privacy decision rather than an optimisation: each redraw is an
 * independent sample around the true point, so an organiser re-saving a case
 * repeatedly would publish a sequence a watcher could average. Keeping the disc
 * is also the honest answer — it still contains the point, so it is still true.
 */
async function resolveUpdatedLocation(
  existing: {
    readonly locationLongitude: number;
    readonly locationLatitude: number;
    readonly locationRadiusMeters: number;
    readonly locationPrecision: EvictionCaseInsert['locationPrecision'];
  },
  location: {
    readonly label?: string;
    readonly longitude?: number;
    readonly latitude?: number;
    readonly precision?: EvictionCaseInsert['locationPrecision'];
    readonly city?: string;
    readonly countryCode?: string;
  },
): Promise<ResolvedLocationColumns> {
  const point = { longitude: location.longitude ?? 0, latitude: location.latitude ?? 0 };
  const published = {
    longitude: existing.locationLongitude,
    latitude: existing.locationLatitude,
    radiusMeters: existing.locationRadiusMeters,
  };

  const disc = shouldRedrawPublicLocation(published, point)
    ? await derivePublicDisc(point)
    : published;

  return {
    locationLabel: location.label ?? '',
    locationLongitude: disc.longitude,
    locationLatitude: disc.latitude,
    locationRadiusMeters: disc.radiusMeters,
    locationPrecision: location.precision ?? existing.locationPrecision,
    locationCity: location.city ?? null,
    locationCountryCode: location.countryCode ?? null,
    removed: [],
  };
}

/** Delete a case. Only its creator may. */
export async function deleteEvictionCase(oxyUserId: string, id: string): Promise<void> {
  // One statement, and it is both the ownership check and the delete. The
  // comment thread, the timeline, the roster, the followers, the help needs,
  // the grants and the audit go with the case by `ON DELETE CASCADE`.
  const deleted = await deleteOwnedEvictionCase(id, oxyUserId);
  if (!deleted) throw new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND');
}
