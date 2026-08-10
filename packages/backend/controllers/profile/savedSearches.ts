/**
 * Saved searches, which are also WATCHES (#356).
 *
 * ## Two things the Postgres port changed, both deliberately
 *
 * **The duplicate-name check is the INDEX now.** `saveSearch` used to read for
 * the name and then insert, which two concurrent requests both pass. The 409 is
 * unchanged; it is now raised from `saved_searches_owner_name_key`'s own
 * `23505`. See the repository header.
 *
 * **The `Profile.findByOxyUserId` guard on delete / update / toggle is GONE.**
 * It was not an authorisation check — every one of those statements is already
 * scoped by `oxyUserId`, which is resolved from the session and never from the
 * client — so its only effect was to answer 404 to somebody who owned the row
 * but happened to have no profile document yet.
 *
 * ## `cadence` is the alerting authority; `notificationsEnabled` mirrors it
 *
 * They say the same thing (`cadence !== 'off'`), so they are written TOGETHER by
 * {@link watchSettingsFrom} and by nothing else — one statement, no window in
 * which they disagree. The mirror exists because the column predates the
 * cadence and several readers still consume it; removing it is a `post`-phase
 * DROP, which cannot ride in this change's `pre` migration without breaking the
 * image that is still serving during the rollout. It is named in the PR as the
 * follow-up rather than left for somebody to discover.
 *
 * ## Every alerting field is validated HERE, before it reaches jsonb or a CHECK
 *
 * A value the schema refuses arrives from the driver as a `23514`, which is a
 * 500 for a caller who merely mistyped a constant. The rule vocabulary, the
 * channel set, the cadence and the push mode are all closed sets in
 * `@homiio/shared-types`, so the narrowing is a membership test rather than a
 * second opinion about what is valid.
 */

import type { NextFunction, Request, Response } from 'express';
import {
  isAlertChannel,
  isHousingAlertRuleType,
  isPushPrivacyMode,
  isRuleAvailable,
  isWatchCadence,
  MANDATORY_ALERT_CHANNEL,
  type AlertChannel,
  type HousingAlertRule,
  type PushPrivacyMode,
  type WatchCadence,
} from '@homiio/shared-types';

import { getDb } from '../../db/postgres';
import {
  createSavedSearch,
  deleteSavedSearch as deleteSavedSearchRow,
  findSavedSearch,
  listSavedSearches,
  SavedSearchNameTakenError,
  toSavedSearchDTO,
  updateSavedSearch as updateSavedSearchRow,
  type WatchAlertSettings,
} from '../../db/saved/savedSearchRepository';
import {
  findAlertForOwner,
  listAlerts,
  toHousingAlertDTO,
} from '../../db/watches/alertRepository';
import { findDomainEvent } from '../../db/watches/domainEventRepository';
import { errorResponse, successResponse } from './shared';

/**
 * The selection kinds a saved row may carry (ADR 0002 §3).
 *
 * An allowlist rather than "any object": `location` is `jsonb`, so without one
 * the column would accept whatever a client posted and every reader downstream
 * would have to defend itself. Membership is TOTAL — a kind that is in neither
 * this list nor the union is refused, not stored and ignored.
 *
 * `current_location` is absent, and that is the one substantive change #356
 * makes to this list. A watch evaluated by a server job has no device attached,
 * so persisting one means freezing a device fix into the row — the exact
 * coordinate ADR 0002 keeps out of every key, URL and log. Somebody watching
 * where they are picks the PLACE they are in, which stores fine.
 */
const LOCATION_KINDS: ReadonlySet<string> = new Set([
  'place',
  'address_candidate',
  'map_bounds',
  'polygon',
  'multi_area',
]);

/** A jsonb payload big enough for any real selection and small enough to bound. */
const MAX_LOCATION_BYTES = 8_192;

/** Alert-history page size, and its ceiling. */
const DEFAULT_ALERT_PAGE_SIZE = 20;
const MAX_ALERT_PAGE_SIZE = 100;

/**
 * Narrow a posted `location` to something storable.
 *
 * Returns `undefined` for absent (a legitimate text-only search) and `null` for
 * PRESENT BUT INVALID, so the caller can refuse the second without treating it
 * as the first — the same "absence is not failure" distinction the whole
 * contract turns on, applied to a request body.
 */
function readLocation(value: unknown): Record<string, unknown> | undefined | null {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const kind = (value as { kind?: unknown }).kind;
  if (typeof kind !== 'string' || !LOCATION_KINDS.has(kind)) return null;
  if (JSON.stringify(value).length > MAX_LOCATION_BYTES) return null;
  return value as Record<string, unknown>;
}

/** Resolve the owner from the session, in the shape the auth layer sets. */
function ownerOf(req: Request): string | undefined {
  return req.user?.id || req.user?._id || undefined;
}

/** A rejected alerting setting, with the code the client shows. */
class InvalidWatchSettingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'InvalidWatchSettingError';
  }
}

/**
 * The channel set, normalised.
 *
 * `in_app` is ADDED rather than demanded, because the schema requires it and a
 * client that simply did not think about it should get a working watch instead
 * of a 400 about a channel it never chose. Everything else is a membership test:
 * an unknown channel is refused, not dropped, because silently storing a
 * narrower set than the caller asked for is how somebody ends up believing they
 * enabled email.
 */
function readChannels(value: unknown): readonly AlertChannel[] {
  if (!Array.isArray(value)) {
    throw new InvalidWatchSettingError('INVALID_CHANNELS', 'channels must be an array');
  }
  const channels = new Set<AlertChannel>([MANDATORY_ALERT_CHANNEL]);
  for (const entry of value) {
    if (!isAlertChannel(entry)) {
      throw new InvalidWatchSettingError('INVALID_CHANNELS', 'Unknown delivery channel');
    }
    channels.add(entry);
  }
  return [...channels];
}

/**
 * The rule set, normalised.
 *
 * An UNAVAILABLE rule is refused with a reason rather than accepted and ignored.
 * The alternative — store it and never fire — would render as a working switch
 * in the UI for as long as nobody checked, which is the failure the whole
 * availability registry exists to prevent.
 */
function readRules(value: unknown): readonly HousingAlertRule[] {
  if (!Array.isArray(value)) {
    throw new InvalidWatchSettingError('INVALID_ALERT_RULES', 'alertRules must be an array');
  }
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new InvalidWatchSettingError('INVALID_ALERT_RULES', 'A rule must be an object');
    }
    const { type, enabled, threshold } = entry as Record<string, unknown>;
    if (!isHousingAlertRuleType(type)) {
      throw new InvalidWatchSettingError('INVALID_ALERT_RULES', 'Unknown alert rule type');
    }
    if (enabled === true && !isRuleAvailable(type)) {
      throw new InvalidWatchSettingError(
        'RULE_UNAVAILABLE',
        `The '${type}' alert cannot be enabled yet`,
      );
    }
    if (threshold !== undefined && threshold !== null) {
      if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0) {
        throw new InvalidWatchSettingError(
          'INVALID_ALERT_RULES',
          'A rule threshold must be a non-negative number',
        );
      }
    }
    return {
      type,
      enabled: Boolean(enabled),
      ...(typeof threshold === 'number' ? { threshold } : {}),
    };
  });
}

/** An ISO timestamp in the future, or `null` to clear. */
function readMutedUntil(value: unknown): Date | null {
  if (value === null) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new InvalidWatchSettingError('INVALID_MUTED_UNTIL', 'mutedUntil must be a timestamp');
  }
  return parsed;
}

/**
 * Read every alerting setting a request body may carry.
 *
 * ONE function for create and update, because the two must not drift about what
 * a valid watch is — and because `cadence` and `notificationsEnabled` are
 * written together here, which is the only place they can be kept in lockstep.
 */
function watchSettingsFrom(body: Record<string, unknown>): WatchAlertSettings & {
  readonly notificationsEnabled?: boolean;
} {
  const settings: {
    cadence?: WatchCadence;
    channels?: readonly AlertChannel[];
    mutedUntil?: Date | null;
    pushPrivacyMode?: PushPrivacyMode;
    rules?: readonly HousingAlertRule[];
    isPrimaryArea?: boolean;
    notificationsEnabled?: boolean;
  } = {};

  // `notificationsEnabled` is the LEGACY switch and is read first, so an
  // explicit `cadence` below always wins. A client sending both is telling us
  // the same thing twice; a client sending only the old one still works.
  if (body.notificationsEnabled !== undefined) {
    const enabled = Boolean(body.notificationsEnabled);
    settings.notificationsEnabled = enabled;
    settings.cadence = enabled ? 'instant' : 'off';
  }

  if (body.cadence !== undefined) {
    if (!isWatchCadence(body.cadence)) {
      throw new InvalidWatchSettingError('INVALID_CADENCE', 'Unknown alert cadence');
    }
    settings.cadence = body.cadence;
    settings.notificationsEnabled = body.cadence !== 'off';
  }

  if (body.channels !== undefined) settings.channels = readChannels(body.channels);
  if (body.alertRules !== undefined) settings.rules = readRules(body.alertRules);
  if (body.mutedUntil !== undefined) settings.mutedUntil = readMutedUntil(body.mutedUntil);
  if (body.pushPrivacyMode !== undefined) {
    if (!isPushPrivacyMode(body.pushPrivacyMode)) {
      throw new InvalidWatchSettingError('INVALID_PUSH_MODE', 'Unknown push privacy mode');
    }
    settings.pushPrivacyMode = body.pushPrivacyMode;
  }
  if (body.isPrimaryArea !== undefined) settings.isPrimaryArea = Boolean(body.isPrimaryArea);

  return settings;
}

/** Turn a rejected setting into the 400 it earned, or rethrow. */
function respondToSettingError(res: Response, error: unknown): boolean {
  if (error instanceof InvalidWatchSettingError) {
    res.status(400).json(errorResponse(error.message, error.code));
    return true;
  }
  return false;
}

/**
 * Get saved searches for the current user
 */
export async function getSavedSearches(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    const rows = await listSavedSearches(getDb(), oxyUserId);

    res.json(successResponse(rows.map(toSavedSearchDTO), "Saved searches retrieved successfully"));
  } catch (error) {
    next(error);
  }
}

/**
 * Save a search for the current user
 */
export async function saveSearch(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);
    const { name, query, filters } = req.body;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    const location = readLocation(req.body.location);
    if (location === null) {
      return res.status(400).json(
        errorResponse("The location is not a recognised selection", "INVALID_LOCATION")
      );
    }

    // A name, and SOMETHING to search — a location, free text, or both.
    //
    // This used to require a non-empty `query`, back when `query` held the
    // location's LABEL. Now that it is the free-text dimension and is normally
    // EMPTY for a place search, that check would have rejected every saved city
    // with a 400 the user could do nothing about.
    const text = typeof query === 'string' ? query.trim() : '';
    if (typeof name !== 'string' || !name.trim() || (!location && !text)) {
      return res.status(400).json(
        errorResponse("A search name and either a location or search text are required", "SEARCH_DATA_REQUIRED")
      );
    }

    let settings;
    try {
      settings = watchSettingsFrom(req.body as Record<string, unknown>);
    } catch (error) {
      if (respondToSettingError(res, error)) return;
      throw error;
    }

    let savedSearch;
    try {
      savedSearch = await createSavedSearch(getDb(), {
        oxyUserId,
        // Trimmed HERE: mongoose's `trim` has no Postgres counterpart, and the
        // unique index is on the stored bytes — an untrimmed name would make
        // `'Madrid '` a second row and quietly retire the duplicate-name rule.
        name: name.trim(),
        query: text,
        filters: filters ?? {},
        location,
        ...settings,
      });
    } catch (error) {
      if (error instanceof SavedSearchNameTakenError) {
        return res.status(409).json(
          errorResponse("A search with this name already exists", "SEARCH_NAME_EXISTS")
        );
      }
      throw error;
    }

    res.status(201).json(successResponse(toSavedSearchDTO(savedSearch), "Search saved successfully"));
  } catch (error) {
    next(error);
  }
}

/**
 * Delete a saved search for the current user
 */
export async function deleteSavedSearch(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);
    const { searchId } = req.params;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (!searchId) {
      return res.status(400).json(
        errorResponse("Search ID is required", "SEARCH_ID_REQUIRED")
      );
    }

    const deleted = await deleteSavedSearchRow(getDb(), searchId, oxyUserId);

    if (!deleted) {
      return res.status(404).json(
        errorResponse("Saved search not found", "SAVED_SEARCH_NOT_FOUND")
      );
    }

    res.json(successResponse(null, "Search deleted successfully"));
  } catch (error) {
    next(error);
  }
}

/**
 * Update a saved search for the current user
 */
export async function updateSavedSearch(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);
    const { searchId } = req.params;
    const { name, query, filters } = req.body;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (!searchId) {
      return res.status(400).json(
        errorResponse("Search ID is required", "SEARCH_ID_REQUIRED")
      );
    }

    const location = readLocation(req.body.location);
    if (req.body.location !== undefined && req.body.location !== null && location === null) {
      return res.status(400).json(
        errorResponse("The location is not a recognised selection", "INVALID_LOCATION")
      );
    }

    let settings;
    try {
      settings = watchSettingsFrom(req.body as Record<string, unknown>);
    } catch (error) {
      if (respondToSettingError(res, error)) return;
      throw error;
    }

    let savedSearch;
    try {
      savedSearch = await updateSavedSearchRow(getDb(), searchId, oxyUserId, {
        name: name === undefined ? undefined : String(name).trim(),
        query: query === undefined ? undefined : String(query).trim(),
        filters,
        ...(req.body.location === undefined ? {} : { location }),
        ...settings,
      });
    } catch (error) {
      if (error instanceof SavedSearchNameTakenError) {
        return res.status(409).json(
          errorResponse("A search with this name already exists", "SEARCH_NAME_EXISTS")
        );
      }
      throw error;
    }

    if (!savedSearch) {
      return res.status(404).json(
        errorResponse("Saved search not found", "SAVED_SEARCH_NOT_FOUND")
      );
    }

    res.json(successResponse(toSavedSearchDTO(savedSearch), "Search updated successfully"));
  } catch (error) {
    next(error);
  }
}

/**
 * Toggle notifications for a saved search.
 *
 * The legacy switch, kept because several clients call it. It moves `cadence`
 * too — see the module header on why the two are written together — so a client
 * that only knows the old field still produces a coherent watch.
 */
export async function toggleSearchNotifications(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);
    const { searchId } = req.params;
    const { notificationsEnabled } = req.body;

    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    if (!searchId) {
      return res.status(400).json(
        errorResponse("Search ID is required", "SEARCH_ID_REQUIRED")
      );
    }

    const enabled = Boolean(notificationsEnabled);
    const existing = await findSavedSearch(getDb(), searchId, oxyUserId);
    if (!existing) {
      return res.status(404).json(
        errorResponse("Saved search not found", "SAVED_SEARCH_NOT_FOUND")
      );
    }

    const savedSearch = await updateSavedSearchRow(getDb(), searchId, oxyUserId, {
      notificationsEnabled: enabled,
      // Kept in lockstep in ONE statement. A cadence the caller already chose is
      // not clobbered by a re-enable: only the off↔instant transition is implied.
      cadence: enabled ? (existing.row.cadence === 'off' ? 'instant' : existing.row.cadence) : 'off',
    });

    if (!savedSearch) {
      return res.status(404).json(
        errorResponse("Saved search not found", "SAVED_SEARCH_NOT_FOUND")
      );
    }

    res.json(
      successResponse(toSavedSearchDTO(savedSearch), "Search notifications updated successfully")
    );
  } catch (error) {
    next(error);
  }
}

/**
 * The alert history — in-app, and the visible source of truth.
 *
 * Scoped to the caller in the repository's own predicate, so `?watchId=` narrows
 * the view and can never widen it to somebody else's watch.
 */
export async function getHousingAlerts(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);
    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    const requested = Number.parseInt(String(req.query.limit ?? ''), 10);
    const limit =
      Number.isFinite(requested) && requested > 0
        ? Math.min(requested, MAX_ALERT_PAGE_SIZE)
        : DEFAULT_ALERT_PAGE_SIZE;
    const offsetRaw = Number.parseInt(String(req.query.offset ?? ''), 10);
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
    const watchId = typeof req.query.watchId === 'string' ? req.query.watchId : undefined;

    const { rows, total } = await listAlerts(getDb(), { oxyUserId, watchId }, { limit, offset });

    res.json(
      successResponse(
        rows.map(toHousingAlertDTO),
        "Alerts retrieved successfully",
        {
          total,
          limit,
          offset,
          // Flat aliases beside the nested object, the convention every list
          // endpoint feeding an infinite grid here follows.
          hasMore: offset + rows.length < total,
          pagination: { total, limit, offset },
        },
      ),
    );
  } catch (error) {
    next(error);
  }
}

/**
 * "Why did I get this?" — one alert, with the fact behind it.
 *
 * Answers from the STORED explanation and the stored rule version, never by
 * re-deriving from today's rules. An answer that changed when the rules changed
 * would be a different kind of lie from the one this endpoint exists to prevent,
 * but a lie all the same.
 */
export async function getHousingAlert(req: Request, res: Response, next: NextFunction) {
  try {
    const oxyUserId = ownerOf(req);
    if (!oxyUserId) {
      return res.status(401).json(
        errorResponse("Authentication required", "AUTHENTICATION_REQUIRED")
      );
    }

    const { alertId } = req.params;
    if (!alertId) {
      return res.status(400).json(errorResponse("Alert ID is required", "ALERT_ID_REQUIRED"));
    }

    const alert = await findAlertForOwner(getDb(), alertId, oxyUserId);
    if (!alert) {
      return res.status(404).json(errorResponse("Alert not found", "ALERT_NOT_FOUND"));
    }

    const watch = await findSavedSearch(getDb(), alert.watchId, oxyUserId);
    // The event may have been swept — it has its own retention — and the answer
    // is still complete, because the alert carries its own explanation. `null`
    // says "the evidence has expired", which is different from "there was none".
    const event = alert.eventId ? await findDomainEvent(getDb(), alert.eventId) : undefined;

    res.json(
      successResponse(
        {
          alert: toHousingAlertDTO(alert),
          watch: watch ? toSavedSearchDTO(watch) : null,
          event: event
            ? {
                id: event.id,
                type: event.type,
                subjectType: event.subjectType,
                subjectId: event.subjectId,
                occurredAt: event.occurredAt,
                // The transition, NOT the coordinates. The event stores a point
                // for matching; ADR 0003 §3.3 applies precision on the way OUT,
                // and nothing about "why did I get this" needs metre accuracy.
                transition: event.transition,
              }
            : null,
        },
        "Alert retrieved successfully",
      ),
    );
  } catch (error) {
    next(error);
  }
}
