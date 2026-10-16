/**
 * What a person keeps: saved homes (with notes and folders), saved searches —
 * which are also WATCHES (#356) — the alerts those watches produced, and the
 * recently-viewed history.
 *
 * The use cases behind `routes/profiles.ts`'s `/me/saved-*`, `/me/alerts` and
 * `/me/recent-properties`, shared with the catalogue's saved-home tools. Every
 * one takes the account it acts for as its first argument and scopes its
 * repository statement by it, so another person's folder, search or alert is
 * indistinguishable from one that does not exist (404).
 *
 * Every refusal is an `AppError` carrying the status and code the routes have
 * always answered; `controllers/profile/savedErrors.ts` renders it in this
 * family's `errorResponse` body.
 *
 * ## Saved searches: `cadence` is the alerting authority
 *
 * `notificationsEnabled` mirrors it (`cadence !== 'off'`), so the two are
 * written TOGETHER by {@link watchSettingsFrom} and by nothing else — one
 * statement, no window in which they disagree.
 *
 * ## Every alerting field is validated HERE, before it reaches jsonb or a CHECK
 *
 * A value the schema refuses arrives from the driver as a `23514`, which is a
 * 500 for a caller who merely mistyped a constant. The rule vocabulary, the
 * channel set, the cadence and the push mode are all closed sets in
 * `@homiio/shared-types`, so the narrowing is a membership test.
 *
 * ## Duplicate names are the INDEX
 *
 * Folder and search names are unique per owner by index, never by a read
 * before the write; the 409 comes from the index's own `23505`.
 */

import { inArray } from 'drizzle-orm';
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

import { getDb } from '../db/postgres';
import { findProperties } from '../db/properties/propertyReads';
import { propertyAudienceFor, serializeProperty } from '../db/properties/propertySerializer';
import {
  clearRecentlyViewed,
  listRecentlyViewed,
  trackPropertyView,
  ViewedPropertyNotFoundError,
} from '../db/saved/recentlyViewedRepository';
import {
  createSavedFolder as insertSavedFolder,
  deleteSavedFolder as deleteSavedFolderRow,
  ensureDefaultFolder,
  findSavedFolder,
  listSavedFolders as listSavedFolderRows,
  SavedFolderNameTakenError,
  type SavedFolderRow,
  toSavedFolderDTO,
  updateSavedFolder as updateSavedFolderRow,
} from '../db/saved/savedFolderRepository';
import {
  countSavedPropertiesByFolder,
  listSavedProperties,
  saveProperty as savePropertyRow,
  SavedPropertyNotFoundError,
  toSavedPropertyFields,
  unsaveProperty as unsavePropertyRow,
  updateSavedPropertyNotes as updateSavedPropertyNotesRow,
} from '../db/saved/savedPropertyRepository';
import {
  createSavedSearch as insertSavedSearch,
  deleteSavedSearch as deleteSavedSearchRow,
  findSavedSearch,
  listSavedSearches as listSavedSearchRows,
  SavedSearchNameTakenError,
  type SavedSearchWithRules,
  toSavedSearchDTO,
  updateSavedSearch as updateSavedSearchRow,
  type WatchAlertSettings,
} from '../db/saved/savedSearchRepository';
import { properties } from '../db/schema';
import { findAlertForOwner, listAlerts, toHousingAlertDTO } from '../db/watches/alertRepository';
import { findDomainEvent } from '../db/watches/domainEventRepository';
import { AppError } from '../middlewares/errorHandler';

// ── Saved homes ─────────────────────────────────────────────────────────────

/**
 * The person's saved homes, most recently saved first, each serialized for
 * them (their own listing at owner precision, everyone else's at its published
 * one) with the save's own fields (notes, folder, when).
 *
 * `saved_items.target_id` is a real foreign key with `ON DELETE CASCADE`, so a
 * save never outlives its listing.
 */
export async function listSavedHomes(oxyUserId: string): Promise<Record<string, unknown>[]> {
  const saved = await listSavedProperties(getDb(), oxyUserId);
  if (saved.length === 0) return [];

  const hydrated = await findProperties({
    where: inArray(
      properties.id,
      saved.map((row) => row.targetId),
    ),
  });
  const byId = new Map(hydrated.map((entry) => [entry.property.id, entry]));

  // Ordered by `saved`, not by the catalogue read.
  return saved.flatMap((row) => {
    const listing = byId.get(row.targetId);
    // Only reachable if a listing is deleted BETWEEN the two statements above.
    if (!listing) return [];
    return [
      {
        ...serializeProperty(listing, propertyAudienceFor(listing, oxyUserId)),
        ...toSavedPropertyFields(row),
      },
    ];
  });
}

export interface SaveHomeInput {
  readonly propertyId: unknown;
  readonly notes?: unknown;
  readonly folderId?: unknown;
}

/**
 * Save a home, into a named folder of the person's own or their default one.
 *
 * The folder lookup is scoped by owner, so somebody else's folder id is
 * indistinguishable from one that does not exist.
 */
export async function saveHome(
  oxyUserId: string,
  input: SaveHomeInput,
): Promise<{ folderId: string }> {
  const { propertyId, notes, folderId } = input;
  if (typeof propertyId !== 'string' || !propertyId) {
    throw new AppError('Property ID is required', 400, 'PROPERTY_ID_REQUIRED');
  }

  const folder: SavedFolderRow | undefined = folderId
    ? await findSavedFolder(getDb(), String(folderId), oxyUserId)
    : await ensureDefaultFolder(getDb(), oxyUserId);
  if (!folder) throw new AppError('Folder not found', 404, 'FOLDER_NOT_FOUND');

  try {
    await savePropertyRow(getDb(), {
      oxyUserId,
      propertyId,
      notes: notes as string | undefined,
      folderId: folder.id,
    });
  } catch (error) {
    if (error instanceof SavedPropertyNotFoundError) {
      throw new AppError('Property not found', 404, 'PROPERTY_NOT_FOUND');
    }
    throw error;
  }
  return { folderId: folder.id };
}

export async function unsaveHome(oxyUserId: string, propertyId: string): Promise<void> {
  if (!propertyId) throw new AppError('Property ID is required', 400, 'PROPERTY_ID_REQUIRED');
  const deleted = await unsavePropertyRow(getDb(), oxyUserId, propertyId);
  if (!deleted) throw new AppError('Saved property not found', 404, 'SAVED_PROPERTY_NOT_FOUND');
}

/** Replace the note on one saved home. The note has exactly one representation. */
export async function updateSavedHomeNotes(
  oxyUserId: string,
  propertyId: string,
  notes: unknown,
): Promise<Record<string, unknown>> {
  if (!propertyId) throw new AppError('Property ID is required', 400, 'PROPERTY_ID_REQUIRED');
  const updated = await updateSavedPropertyNotesRow(
    getDb(),
    oxyUserId,
    propertyId,
    notes as string | undefined,
  );
  if (!updated) throw new AppError('Saved property not found', 404, 'SAVED_PROPERTY_NOT_FOUND');
  return { propertyId: updated.targetId, ...toSavedPropertyFields(updated) };
}

// ── Folders ─────────────────────────────────────────────────────────────────

export interface SavedFolderInput {
  readonly name?: unknown;
  readonly description?: unknown;
  readonly color?: unknown;
  readonly icon?: unknown;
}

/**
 * The person's folders with how many saves each holds — counted from
 * `saved_items`, which is where folder membership lives.
 */
export async function listSavedFolders(
  oxyUserId: string,
): Promise<{ folders: Record<string, unknown>[] }> {
  const folders = await listSavedFolderRows(getDb(), oxyUserId);
  const counts = await countSavedPropertiesByFolder(
    getDb(),
    oxyUserId,
    folders.map((folder) => folder.id),
  );
  return {
    folders: folders.map((folder) => toSavedFolderDTO(folder, counts.get(folder.id) ?? 0)),
  };
}

export async function createSavedFolder(
  oxyUserId: string,
  input: SavedFolderInput,
): Promise<Record<string, unknown>> {
  const { name, description, color, icon } = input;
  if (typeof name !== 'string' || !name.trim()) {
    throw new AppError('Folder name is required', 400, 'FOLDER_NAME_REQUIRED');
  }
  try {
    const folder = await insertSavedFolder(getDb(), {
      oxyUserId,
      // Trimmed HERE, because the unique index is on `lower(name)` over the
      // stored bytes — an untrimmed name would make `'Madrid '` a second folder.
      name: name.trim(),
      description: description as string | undefined,
      color: color === undefined ? undefined : String(color),
      icon: icon === undefined ? undefined : String(icon),
    });
    return toSavedFolderDTO(folder, 0);
  } catch (error) {
    if (error instanceof SavedFolderNameTakenError) {
      throw new AppError('Folder with this name already exists', 409, 'FOLDER_NAME_EXISTS');
    }
    throw error;
  }
}

/**
 * Rename or restyle one of the person's folders. Somebody else's folder is a
 * 404; the person's own DEFAULT folder is a 400 — refused before any write.
 */
export async function updateSavedFolder(
  oxyUserId: string,
  folderId: string,
  input: SavedFolderInput,
): Promise<Record<string, unknown>> {
  if (!folderId) throw new AppError('Folder ID is required', 400, 'FOLDER_ID_REQUIRED');
  const existing = await findSavedFolder(getDb(), folderId, oxyUserId);
  if (!existing) throw new AppError('Folder not found', 404, 'FOLDER_NOT_FOUND');
  if (existing.isDefault) {
    throw new AppError('Cannot update default folder', 400, 'CANNOT_UPDATE_DEFAULT_FOLDER');
  }

  const { name, description, color, icon } = input;
  let folder: SavedFolderRow | undefined;
  try {
    folder = await updateSavedFolderRow(getDb(), folderId, oxyUserId, {
      name: name === undefined ? undefined : String(name).trim(),
      description: description as string | undefined,
      color: color === undefined ? undefined : String(color),
      icon: icon === undefined ? undefined : String(icon),
    });
  } catch (error) {
    if (error instanceof SavedFolderNameTakenError) {
      throw new AppError('Folder with this name already exists', 409, 'FOLDER_NAME_EXISTS');
    }
    throw error;
  }
  if (!folder) throw new AppError('Folder not found', 404, 'FOLDER_NOT_FOUND');

  const counts = await countSavedPropertiesByFolder(getDb(), oxyUserId, [folder.id]);
  return toSavedFolderDTO(folder, counts.get(folder.id) ?? 0);
}

/**
 * Delete one of the person's folders. The saves filed in it survive:
 * `saved_items.folder_id` is `ON DELETE SET NULL`, so they return to "not in a
 * folder" in the same statement.
 */
export async function deleteSavedFolder(oxyUserId: string, folderId: string): Promise<void> {
  if (!folderId) throw new AppError('Folder ID is required', 400, 'FOLDER_ID_REQUIRED');
  const existing = await findSavedFolder(getDb(), folderId, oxyUserId);
  if (!existing) throw new AppError('Folder not found', 404, 'FOLDER_NOT_FOUND');
  if (existing.isDefault) {
    throw new AppError('Cannot delete default folder', 400, 'CANNOT_DELETE_DEFAULT_FOLDER');
  }
  const deleted = await deleteSavedFolderRow(getDb(), folderId, oxyUserId);
  if (!deleted) throw new AppError('Folder not found', 404, 'FOLDER_NOT_FOUND');
}

// ── Saved searches (watches) ────────────────────────────────────────────────

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

/** A rejected alerting setting: the 400 it earned, with the code the client shows. */
class InvalidWatchSettingError extends AppError {
  constructor(code: string, message: string) {
    super(message, 400, code);
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

export async function listSavedSearches(oxyUserId: string): Promise<Record<string, unknown>[]> {
  const rows = await listSavedSearchRows(getDb(), oxyUserId);
  return rows.map(toSavedSearchDTO);
}

/**
 * Save a search — a name, and SOMETHING to search: a location, free text, or
 * both — with its alerting settings.
 *
 * `query` is the free-text dimension and is normally EMPTY for a place search,
 * so a non-empty `query` is not required.
 */
export async function createSavedSearch(
  oxyUserId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { name, query, filters } = body;
  const location = readLocation(body.location);
  if (location === null) {
    throw new AppError('The location is not a recognised selection', 400, 'INVALID_LOCATION');
  }
  const text = typeof query === 'string' ? query.trim() : '';
  if (typeof name !== 'string' || !name.trim() || (!location && !text)) {
    throw new AppError(
      'A search name and either a location or search text are required',
      400,
      'SEARCH_DATA_REQUIRED',
    );
  }
  const settings = watchSettingsFrom(body);

  try {
    const savedSearch = await insertSavedSearch(getDb(), {
      oxyUserId,
      // Trimmed HERE, because the unique index is on the stored bytes.
      name: name.trim(),
      query: text,
      filters: (filters ?? {}) as Record<string, unknown>,
      location,
      ...settings,
    });
    return toSavedSearchDTO(savedSearch);
  } catch (error) {
    if (error instanceof SavedSearchNameTakenError) {
      throw new AppError('A search with this name already exists', 409, 'SEARCH_NAME_EXISTS');
    }
    throw error;
  }
}

export async function updateSavedSearch(
  oxyUserId: string,
  searchId: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!searchId) throw new AppError('Search ID is required', 400, 'SEARCH_ID_REQUIRED');
  const { name, query, filters } = body;
  const location = readLocation(body.location);
  if (body.location !== undefined && body.location !== null && location === null) {
    throw new AppError('The location is not a recognised selection', 400, 'INVALID_LOCATION');
  }
  const settings = watchSettingsFrom(body);

  let savedSearch: SavedSearchWithRules | undefined;
  try {
    savedSearch = await updateSavedSearchRow(getDb(), searchId, oxyUserId, {
      name: name === undefined ? undefined : String(name).trim(),
      query: query === undefined ? undefined : String(query).trim(),
      filters: filters as Record<string, unknown> | undefined,
      ...(body.location === undefined ? {} : { location }),
      ...settings,
    });
  } catch (error) {
    if (error instanceof SavedSearchNameTakenError) {
      throw new AppError('A search with this name already exists', 409, 'SEARCH_NAME_EXISTS');
    }
    throw error;
  }
  if (!savedSearch) throw new AppError('Saved search not found', 404, 'SAVED_SEARCH_NOT_FOUND');
  return toSavedSearchDTO(savedSearch);
}

export async function deleteSavedSearch(oxyUserId: string, searchId: string): Promise<void> {
  if (!searchId) throw new AppError('Search ID is required', 400, 'SEARCH_ID_REQUIRED');
  const deleted = await deleteSavedSearchRow(getDb(), searchId, oxyUserId);
  if (!deleted) throw new AppError('Saved search not found', 404, 'SAVED_SEARCH_NOT_FOUND');
}

/**
 * Switch a saved search's alerts on or off.
 *
 * The legacy switch. It moves `cadence` too, in one statement, and a cadence
 * the person already chose is not clobbered by a re-enable: only the
 * off↔instant transition is implied.
 */
export async function setSavedSearchNotifications(
  oxyUserId: string,
  searchId: string,
  notificationsEnabled: unknown,
): Promise<Record<string, unknown>> {
  if (!searchId) throw new AppError('Search ID is required', 400, 'SEARCH_ID_REQUIRED');
  const enabled = Boolean(notificationsEnabled);
  const existing = await findSavedSearch(getDb(), searchId, oxyUserId);
  if (!existing) throw new AppError('Saved search not found', 404, 'SAVED_SEARCH_NOT_FOUND');

  const savedSearch = await updateSavedSearchRow(getDb(), searchId, oxyUserId, {
    notificationsEnabled: enabled,
    cadence: enabled ? (existing.row.cadence === 'off' ? 'instant' : existing.row.cadence) : 'off',
  });
  if (!savedSearch) throw new AppError('Saved search not found', 404, 'SAVED_SEARCH_NOT_FOUND');
  return toSavedSearchDTO(savedSearch);
}

// ── Alerts ──────────────────────────────────────────────────────────────────

/** Alert-history page size, and its ceiling. */
const DEFAULT_ALERT_PAGE_SIZE = 20;
const MAX_ALERT_PAGE_SIZE = 100;

export interface HousingAlertPage {
  readonly alerts: Record<string, unknown>[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
}

/**
 * The alert history — in-app, and the visible source of truth. Scoped to the
 * person in the repository's own predicate, so `watchId` narrows the view and
 * can never widen it to somebody else's watch.
 */
export async function listHousingAlerts(
  oxyUserId: string,
  input: { readonly limit?: unknown; readonly offset?: unknown; readonly watchId?: unknown },
): Promise<HousingAlertPage> {
  const requested = Number.parseInt(String(input.limit ?? ''), 10);
  const limit =
    Number.isFinite(requested) && requested > 0
      ? Math.min(requested, MAX_ALERT_PAGE_SIZE)
      : DEFAULT_ALERT_PAGE_SIZE;
  const offsetRaw = Number.parseInt(String(input.offset ?? ''), 10);
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
  const watchId = typeof input.watchId === 'string' ? input.watchId : undefined;

  const { rows, total } = await listAlerts(getDb(), { oxyUserId, watchId }, { limit, offset });
  return {
    alerts: rows.map(toHousingAlertDTO),
    total,
    limit,
    offset,
    hasMore: offset + rows.length < total,
  };
}

/**
 * "Why did I get this?" — one alert, with the watch and the fact behind it.
 *
 * Answers from the STORED explanation and rule version, never by re-deriving
 * from today's rules. The event may have been swept (it has its own retention)
 * and the answer is still complete; `event: null` says the evidence expired.
 */
export async function getHousingAlert(
  oxyUserId: string,
  alertId: string,
): Promise<Record<string, unknown>> {
  if (!alertId) throw new AppError('Alert ID is required', 400, 'ALERT_ID_REQUIRED');
  const alert = await findAlertForOwner(getDb(), alertId, oxyUserId);
  if (!alert) throw new AppError('Alert not found', 404, 'ALERT_NOT_FOUND');

  const watch = await findSavedSearch(getDb(), alert.watchId, oxyUserId);
  const event = alert.eventId ? await findDomainEvent(getDb(), alert.eventId) : undefined;
  return {
    alert: toHousingAlertDTO(alert),
    watch: watch ? toSavedSearchDTO(watch) : null,
    event: event
      ? {
          id: event.id,
          type: event.type,
          subjectType: event.subjectType,
          subjectId: event.subjectId,
          occurredAt: event.occurredAt,
          // The transition, NOT the coordinates (ADR 0003 §3.3: precision is
          // applied on the way OUT, and "why did I get this" needs no point).
          transition: event.transition,
        }
      : null,
  };
}

// ── Recently viewed ─────────────────────────────────────────────────────────

/** What a recently-viewed read returns when the caller names no limit. */
const DEFAULT_RECENT_LIMIT = 10;

/**
 * The most rows one read may ask for: hydration is a catalogue read with four
 * joins and three batched child queries. The TABLE's bound is the 90-day
 * retention sweep.
 */
const MAX_RECENT_LIMIT = 100;

/** The person's recently opened homes, most recent first, with when. */
export async function listRecentlyViewedHomes(
  oxyUserId: string,
  requestedLimit: number | undefined,
): Promise<Record<string, unknown>[]> {
  const limit = Math.min(
    requestedLimit !== undefined && requestedLimit > 0 ? requestedLimit : DEFAULT_RECENT_LIMIT,
    MAX_RECENT_LIMIT,
  );
  const views = await listRecentlyViewed(getDb(), oxyUserId, limit);
  if (views.length === 0) return [];

  const hydrated = await findProperties({
    where: inArray(
      properties.id,
      views.map((view) => view.propertyId),
    ),
  });
  const byId = new Map(hydrated.map((entry) => [entry.property.id, entry]));
  return views.flatMap((view) => {
    const listing = byId.get(view.propertyId);
    if (!listing) return [];
    return [
      {
        ...serializeProperty(listing, propertyAudienceFor(listing, oxyUserId)),
        viewedAt: view.viewedAt,
      },
    ];
  });
}

/** Record that the person opened a home (the route only; see coverage). */
export async function recordRecentlyViewedHome(
  oxyUserId: string,
  propertyId: string,
): Promise<void> {
  if (!propertyId) throw new AppError('Property ID is required', 400, 'PROPERTY_ID_REQUIRED');
  try {
    await trackPropertyView(getDb(), oxyUserId, propertyId);
  } catch (error) {
    if (error instanceof ViewedPropertyNotFoundError) {
      throw new AppError('Property not found', 404, 'PROPERTY_NOT_FOUND');
    }
    throw error;
  }
}

export async function clearRecentlyViewedHomes(
  oxyUserId: string,
): Promise<{ deletedCount: number }> {
  const deletedCount = await clearRecentlyViewed(getDb(), oxyUserId);
  return { deletedCount };
}
