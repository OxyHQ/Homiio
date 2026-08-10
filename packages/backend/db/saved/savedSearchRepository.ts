/**
 * `saved_searches` — a person's stored search, which is also their WATCH.
 *
 * Empty in production, so this port had no backfill and no consistency window.
 *
 * ## The saved search and the watch are ONE ROW (#356)
 *
 * A watch is a saved search that has been given a job. It could have been a
 * second table pointing at the first, and it is not, because a copy needs an
 * authority: two rows for one stored intent drift the moment somebody renames
 * one, and the read shape the Home feed consumes (`isPrimaryArea`) would then
 * have to name which copy it trusts. Everything the watch adds is additive, so a
 * row written before alerting existed is a valid watch with `cadence: 'off'` —
 * which is what it already meant.
 *
 * This module is therefore the ONE WRITER of `saved_searches` and of its
 * `housing_watch_rules` children. `db/watches/` owns the two tables with
 * different lifetimes (events and alerts) and reads this one for matching.
 *
 * ## The duplicate-name check MOVED INTO THE INDEX, and is not re-implemented
 *
 * `saveSearch` read for an existing name and then inserted, which is a
 * read-then-write with a window between the two: two requests from the same
 * person with the same name both find nothing and both insert.
 * `saved_searches_owner_name_key` is a real UNIQUE, so the correct port INSERTS
 * and handles `23505` — `db/MIGRATION-CONTRACT.md` lists this class of change
 * explicitly, and re-implementing the read would keep the race in a new costume
 * while the index quietly made it impossible.
 *
 * {@link SavedSearchNameTakenError} is what the controller turns into the 409
 * the Mongo handler returned, so the wire behaviour is unchanged and only the
 * race is gone.
 *
 * ## `name` and `query` are trimmed at the CALL SITE
 *
 * `CONVENTIONS.md` says a mongoose `trim` becomes nothing in Postgres and is
 * re-applied where the value enters. Both are trimmed by the controller before
 * they reach here, which matters for more than tidiness: the unique index is on
 * the stored bytes, so `'Madrid'` and `'Madrid '` would be two rows and the
 * duplicate-name rule would silently stop holding.
 */

import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  AVAILABLE_HOUSING_ALERT_RULE_TYPES,
  defaultAlertRules,
  HOUSING_ALERT_RULE_SPECS,
  isRuleAvailable,
  serializeLocationToken,
  type AlertChannel,
  type HousingAlertRule,
  type HousingAlertRuleType,
  type LocationSelection,
  type PushPrivacyMode,
  type WatchAlertStatus,
  type WatchCadence,
} from '@homiio/shared-types';
import type { DatabaseOrTransaction } from '../postgres';
import { housingWatchRules, savedSearches } from '../schema';
import { isUniqueViolation } from '../uniqueViolation';
import { watchAreaFromSelection } from '../watches/watchArea';

export type SavedSearchRow = typeof savedSearches.$inferSelect;
export type WatchRuleRow = typeof housingWatchRules.$inferSelect;

/** A watch and the rules it subscribes to, which are always read together. */
export interface SavedSearchWithRules {
  readonly row: SavedSearchRow;
  readonly rules: readonly WatchRuleRow[];
}

/** This person already has a saved search under that name. */
export class SavedSearchNameTakenError extends Error {
  constructor(readonly name: string) {
    super(`A saved search named '${name}' already exists for this owner.`);
    this.name = 'SavedSearchNameTakenError';
  }
}

/**
 * The alerting settings a create or an update may carry.
 *
 * Every field is optional, and `undefined` means "leave it alone" on an update
 * rather than "clear it" — the same convention the rest of this module uses. The
 * one field that takes `null` meaningfully is `mutedUntil`, where clearing a
 * mute is a real operation and has to be expressible.
 */
export interface WatchAlertSettings {
  readonly cadence?: WatchCadence;
  readonly channels?: readonly AlertChannel[];
  readonly mutedUntil?: Date | null;
  readonly pushPrivacyMode?: PushPrivacyMode;
  readonly rules?: readonly HousingAlertRule[];
  readonly isPrimaryArea?: boolean;
}

export interface CreateSavedSearchInput extends WatchAlertSettings {
  readonly oxyUserId: string;
  readonly name: string;
  readonly query: string;
  readonly filters?: Record<string, unknown>;
  /**
   * The serialised `LocationSelection`, or absent for a text-only search.
   *
   * Absent is NOT the same as "no location was wanted" once a row is old
   * enough: a row written before this column existed also has NULL here, and
   * the read path resolves it lazily and asks for confirmation rather than
   * guessing. That is why nothing writes a placeholder into it.
   */
  readonly location?: Record<string, unknown>;
  readonly notificationsEnabled?: boolean;
}

/**
 * The stored area for a selection, as the column expects it.
 *
 * `undefined` when there is no location at all (leave the column alone on an
 * update), `null` when there is one and no area could be derived from it — the
 * two are different and only the second must clear a previously stored polygon.
 */
function areaFor(location: Record<string, unknown> | null | undefined): unknown {
  if (location === undefined) return undefined;
  if (location === null) return null;
  return watchAreaFromSelection(location as unknown as LocationSelection);
}

/**
 * Insert a saved search, with its rule set.
 *
 * One transaction: a watch whose rules failed to write would be a watch that
 * silently subscribes to nothing, which reads exactly like a quiet market.
 *
 * @throws {SavedSearchNameTakenError} When the owner already has one by that
 *   name — raised from the index's own `23505` rather than from a preceding
 *   read, so two concurrent requests cannot both succeed.
 */
export async function createSavedSearch(
  db: DatabaseOrTransaction,
  input: CreateSavedSearchInput,
): Promise<SavedSearchWithRules> {
  try {
    return await db.transaction(async (tx) => {
      // `is_primary_area` is claimed BEFORE the insert rather than after, because
      // the partial unique index would otherwise reject the insert itself and
      // there would be no row to fall back to.
      if (input.isPrimaryArea) await clearPrimaryArea(tx, input.oxyUserId);

      const [row] = await tx
        .insert(savedSearches)
        .values({
          oxyUserId: input.oxyUserId,
          name: input.name,
          query: input.query,
          filters: input.filters ?? {},
          location: input.location ?? null,
          area: areaFor(input.location ?? null),
          notificationsEnabled: input.notificationsEnabled ?? false,
          cadence: input.cadence ?? 'off',
          channels: [...(input.channels ?? ['in_app'])],
          mutedUntil: input.mutedUntil ?? null,
          pushPrivacyMode: input.pushPrivacyMode ?? 'discreet',
          isPrimaryArea: input.isPrimaryArea ?? false,
        })
        .returning();

      const rules = await writeRules(tx, row.id, input.rules ?? defaultAlertRules());
      return { row, rules };
    });
  } catch (error) {
    if (isUniqueViolation(error, 'saved_searches_owner_name_key')) {
      throw new SavedSearchNameTakenError(input.name);
    }
    throw error;
  }
}

/**
 * Write a watch's rule set, replacing whatever it had.
 *
 * An UPSERT per rule rather than delete-then-insert, so a rule's identity (and
 * therefore its `created_at`) survives an unrelated edit. Rules whose type is
 * not in the incoming set are deleted, which is what makes this a REPLACE — a
 * caller sending a partial set is saying the rest are gone.
 *
 * UNAVAILABLE RULES ARE REFUSED HERE, not merely ignored. A stored `enabled:
 * true` on a rule nothing can evaluate is a promise the product does not keep,
 * and it would read as a working subscription in the UI forever.
 */
async function writeRules(
  db: DatabaseOrTransaction,
  watchId: string,
  rules: readonly HousingAlertRule[],
): Promise<readonly WatchRuleRow[]> {
  const wanted = rules.filter((rule) => isRuleAvailable(rule.type));
  const seen = new Set<HousingAlertRuleType>();
  const values = wanted
    // Last one wins on a duplicated type. The unique index would refuse the
    // second row of a pair inside one statement with `ON CONFLICT ... DO UPDATE`
    // (`21000 cannot affect row a second time`), which is a 500 for a caller who
    // merely sent a sloppy array.
    .reverse()
    .filter((rule) => {
      if (seen.has(rule.type)) return false;
      seen.add(rule.type);
      return true;
    })
    .map((rule) => ({
      watchId,
      type: rule.type,
      enabled: rule.enabled,
      threshold:
        HOUSING_ALERT_RULE_SPECS[rule.type].supportsThreshold && rule.threshold !== undefined
          ? rule.threshold
          : // A threshold on a rule that ignores one is DROPPED rather than
            // stored: a number nobody reads is a setting the user believes in.
            null,
    }));

  if (values.length > 0) {
    await db
      .insert(housingWatchRules)
      .values(values)
      .onConflictDoUpdate({
        target: [housingWatchRules.watchId, housingWatchRules.type],
        set: {
          enabled: sql`excluded.enabled`,
          // `excluded.<col>` must be spelled out. Interpolating the drizzle
          // column object emits the JavaScript PROPERTY name, so this would
          // become `excluded.threshold`… which happens to match here, and
          // would NOT for a camelCase column — `42703` at runtime, clean under
          // tsc. Spelled literally so the two can never disagree.
          threshold: sql`excluded.threshold`,
          updatedAt: new Date(),
        },
      });
  }

  const keptTypes = [...seen];
  await db
    .delete(housingWatchRules)
    .where(
      keptTypes.length > 0
        ? and(
            eq(housingWatchRules.watchId, watchId),
            sql`${housingWatchRules.type} <> all(${sql.param(keptTypes)}::text[])`,
          )
        : eq(housingWatchRules.watchId, watchId),
    );

  return db
    .select()
    .from(housingWatchRules)
    .where(eq(housingWatchRules.watchId, watchId))
    .orderBy(housingWatchRules.type);
}

/** Clear whichever watch currently holds the primary-area flag for this person. */
async function clearPrimaryArea(db: DatabaseOrTransaction, oxyUserId: string): Promise<void> {
  await db
    .update(savedSearches)
    .set({ isPrimaryArea: false })
    .where(and(eq(savedSearches.oxyUserId, oxyUserId), eq(savedSearches.isPrimaryArea, true)));
}

/** Every saved search this person owns, newest first, with its rules. */
export async function listSavedSearches(
  db: DatabaseOrTransaction,
  oxyUserId: string,
): Promise<readonly SavedSearchWithRules[]> {
  const rows = await db
    .select()
    .from(savedSearches)
    .where(eq(savedSearches.oxyUserId, oxyUserId))
    .orderBy(desc(savedSearches.createdAt));
  return attachRules(db, rows);
}

/**
 * Load the rules for a set of watches in ONE query.
 *
 * Not an optimisation for its own sake: the alternative is a query per watch on
 * a list endpoint, which is the N+1 the property read path was rewritten to
 * remove and which grows with the very thing this feature encourages people to
 * do more of.
 */
async function attachRules(
  db: DatabaseOrTransaction,
  rows: readonly SavedSearchRow[],
): Promise<readonly SavedSearchWithRules[]> {
  if (rows.length === 0) return [];
  const ruleRows = await db
    .select()
    .from(housingWatchRules)
    .where(
      inArray(
        housingWatchRules.watchId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(housingWatchRules.type);
  const byWatch = new Map<string, WatchRuleRow[]>();
  for (const rule of ruleRows) {
    const bucket = byWatch.get(rule.watchId);
    if (bucket) bucket.push(rule);
    else byWatch.set(rule.watchId, [rule]);
  }
  return rows.map((row) => ({ row, rules: byWatch.get(row.id) ?? [] }));
}

export interface UpdateSavedSearchInput extends WatchAlertSettings {
  readonly name?: string;
  readonly query?: string;
  readonly filters?: Record<string, unknown>;
  /** Set the stored selection. `null` clears it back to "not yet resolved". */
  readonly location?: Record<string, unknown> | null;
  readonly notificationsEnabled?: boolean;
}

/**
 * Apply a partial update, scoped to the owner. `undefined` when the row does not
 * exist or is somebody else's.
 *
 * The ownership predicate is part of the `UPDATE` rather than a check before it,
 * for the reason `notificationRepository` states: an authorisation performed in
 * a second statement is an IDOR the first time somebody forgets it.
 *
 * @throws {SavedSearchNameTakenError} When a rename collides with another of the
 *   owner's searches.
 */
export async function updateSavedSearch(
  db: DatabaseOrTransaction,
  id: string,
  oxyUserId: string,
  input: UpdateSavedSearchInput,
): Promise<SavedSearchWithRules | undefined> {
  try {
    return await db.transaction(async (tx) => {
      const existing = await findSavedSearchRow(tx, id, oxyUserId);
      if (!existing) return undefined;

      const values: Partial<typeof savedSearches.$inferInsert> = {};
      if (input.name !== undefined) values.name = input.name;
      if (input.query !== undefined) values.query = input.query;
      if (input.filters !== undefined) values.filters = input.filters;
      if (input.location !== undefined) {
        values.location = input.location;
        // The area is DERIVED, so it moves in the same statement as the thing it
        // derives from. A second write would leave a window in which the stored
        // polygon describes the previous city.
        values.area = areaFor(input.location);
      }
      if (input.notificationsEnabled !== undefined) {
        values.notificationsEnabled = input.notificationsEnabled;
      }
      if (input.cadence !== undefined) values.cadence = input.cadence;
      if (input.channels !== undefined) values.channels = [...input.channels];
      if (input.mutedUntil !== undefined) values.mutedUntil = input.mutedUntil;
      if (input.pushPrivacyMode !== undefined) values.pushPrivacyMode = input.pushPrivacyMode;
      if (input.isPrimaryArea !== undefined) values.isPrimaryArea = input.isPrimaryArea;

      /**
       * Waking a silent watch re-stamps when it started watching.
       *
       * Without this, switching a month-old muted watch back on would replay the
       * month: every event since it went quiet is still inside the retention
       * window, still inside the area, and still after the ORIGINAL
       * `alerts_active_from`. "Turn alerts on" must mean "from now".
       */
      if (
        input.cadence !== undefined &&
        input.cadence !== 'off' &&
        existing.cadence === 'off'
      ) {
        values.alertsActiveFrom = new Date();
      }

      if (input.isPrimaryArea === true) await clearPrimaryArea(tx, oxyUserId);

      let row = existing;
      if (Object.keys(values).length > 0) {
        const [updated] = await tx
          .update(savedSearches)
          .set(values)
          .where(and(eq(savedSearches.id, id), eq(savedSearches.oxyUserId, oxyUserId)))
          .returning();
        // `undefined` here would mean the row vanished between the read above
        // and this statement — possible, and correctly reported as "not found"
        // rather than crashed over.
        if (!updated) return undefined;
        row = updated;
      }

      let rules =
        input.rules === undefined
          ? await tx
              .select()
              .from(housingWatchRules)
              .where(eq(housingWatchRules.watchId, id))
              .orderBy(housingWatchRules.type)
          : await writeRules(tx, id, input.rules);

      /**
       * A watch with NO rules at all that is being switched on gets the
       * conservative defaults.
       *
       * That state is reachable exactly one way, and it is the one that matters:
       * a saved search created before #356 has no `housing_watch_rules` children
       * — migration 0012 deliberately writes none, because seeding a rule set
       * for every existing row would be deciding on somebody's behalf what they
       * want to be told about. Without this, switching alerts on would report
       * `no_rules_enabled` and do nothing, which is indistinguishable from a
       * broken feature.
       *
       * Only when the set is genuinely EMPTY: a watch whose rules are all
       * switched off is a person who turned them off, and re-seeding those would
       * be overriding a decision rather than making one.
       */
      if (rules.length === 0 && values.cadence !== undefined && values.cadence !== 'off') {
        rules = await writeRules(tx, id, defaultAlertRules());
      }

      return { row, rules };
    });
  } catch (error) {
    if (isUniqueViolation(error, 'saved_searches_owner_name_key')) {
      throw new SavedSearchNameTakenError(input.name ?? '');
    }
    throw error;
  }
}

/** One saved search row, scoped to its owner. */
async function findSavedSearchRow(
  db: DatabaseOrTransaction,
  id: string,
  oxyUserId: string,
): Promise<SavedSearchRow | undefined> {
  const [row] = await db
    .select()
    .from(savedSearches)
    .where(and(eq(savedSearches.id, id), eq(savedSearches.oxyUserId, oxyUserId)))
    .limit(1);
  return row;
}

/** One saved search with its rules, scoped to its owner. */
export async function findSavedSearch(
  db: DatabaseOrTransaction,
  id: string,
  oxyUserId: string,
): Promise<SavedSearchWithRules | undefined> {
  const row = await findSavedSearchRow(db, id, oxyUserId);
  if (!row) return undefined;
  const [withRules] = await attachRules(db, [row]);
  return withRules;
}

/**
 * Delete one saved search, scoped to its owner.
 *
 * Its rules and its alert history go with it (`ON DELETE CASCADE`), which is the
 * acceptance criterion "eliminar una watch detiene entregas" made structural:
 * there is no row left for the matcher to find, so nothing can be delivered
 * afterwards by a job that was already in flight.
 */
export async function deleteSavedSearch(
  db: DatabaseOrTransaction,
  id: string,
  oxyUserId: string,
): Promise<boolean> {
  const rows = await db
    .delete(savedSearches)
    .where(and(eq(savedSearches.id, id), eq(savedSearches.oxyUserId, oxyUserId)))
    .returning({ id: savedSearches.id });
  return rows.length > 0;
}

/**
 * Whether this watch can produce anything right now, and why not when it cannot.
 *
 * DERIVED rather than stored, because every input is already a column and a
 * stored copy is a second authority that goes stale. The order of the checks is
 * the order a person would want to be told about them: what they switched off
 * first, then what is misconfigured, then what is merely empty.
 *
 * It must agree with `db/watches/watchMatching.ts`'s SQL predicate, and
 * `__tests__/integration/housingWatchAlerts.test.ts` binds the two by asserting
 * BOTH for every reason — that the matcher delivers nothing AND that the DTO
 * names this reason. Two expressions of one rule that nothing compares is how
 * a status that reads "active" over a watch matching nothing gets shipped.
 */
export function watchAlertStatus(
  row: SavedSearchRow,
  rules: readonly WatchRuleRow[],
  now: Date = new Date(),
): WatchAlertStatus {
  if (row.cadence === 'off') return { status: 'inactive', reason: 'cadence_off' };
  if (row.mutedUntil && row.mutedUntil > now) return { status: 'inactive', reason: 'muted' };
  if (row.queryVersion !== 2) return { status: 'inactive', reason: 'legacy_query_version' };
  if (!row.location) return { status: 'inactive', reason: 'location_needs_confirmation' };
  if (!row.area) return { status: 'inactive', reason: 'no_area' };
  if (!rules.some((rule) => rule.enabled && isRuleAvailable(rule.type))) {
    return { status: 'inactive', reason: 'no_rules_enabled' };
  }
  return { status: 'active' };
}

/**
 * The `loc` token that reopens this watch's query, or `undefined`.
 *
 * ADR 0002's own serialiser, never a URL format invented here — that is what
 * makes the deep link round-trip through the same parser the app already uses.
 * `undefined` for a selection the grammar cannot express (a drawn polygon, whose
 * wire format §2.1 reserves): degrading it to its bounding box would WIDEN the
 * area the link reopens, which is the one failure mode worse than no link.
 */
function locTokenOf(location: unknown): string | undefined {
  if (!location || typeof location !== 'object') return undefined;
  const result = serializeLocationToken(location as LocationSelection);
  return result.ok ? result.value : undefined;
}

/**
 * The wire shape the profile screen and the watch screens read.
 *
 * `id`, never `_id` — the wire contract is the clean cut PR #287 made.
 */
export function toSavedSearchDTO(watch: SavedSearchWithRules): Record<string, unknown> {
  const { row, rules } = watch;
  return {
    id: row.id,
    oxyUserId: row.oxyUserId,
    name: row.name,
    query: row.query,
    queryVersion: row.queryVersion,
    filters: row.filters,
    location: row.location,
    /**
     * How the stored location should be READ (ADR 0002 §11).
     *
     * `resolved` — the row carries a selection; use it, resolving a `homiio`
     * source by id so a rename does not move the search.
     * `needs_confirmation` — the row predates the column, so all we have is a
     * label in `query`. The UI asks which place was meant. It is deliberately
     * NOT geocoded here: taking the first hit for a stored label is the homonym
     * bug, and doing it on read is the same mistake as doing it in a migration,
     * one row at a time. An unconfirmed search does not run and its alert does
     * not fire.
     */
    locationStatus: row.location ? 'resolved' : 'needs_confirmation',
    /** The deep link back to this exact query. Absent when the grammar cannot express it. */
    locToken: locTokenOf(row.location),
    notificationsEnabled: row.notificationsEnabled,

    // ── The watch half (#356) ──
    isPrimaryArea: row.isPrimaryArea,
    cadence: row.cadence,
    channels: row.channels,
    mutedUntil: row.mutedUntil,
    pushPrivacyMode: row.pushPrivacyMode,
    alertsActiveFrom: row.alertsActiveFrom,
    /**
     * Whether an AREA could be derived from the stored selection.
     *
     * Exposed as its own field rather than left implicit in `alertStatus`,
     * because a watch may be `cadence: 'off'` AND have no derivable area, and
     * the settings screen has to be able to warn about the second before the
     * user turns the first on and finds out nothing happens.
     */
    hasArea: row.area !== null,
    alertRules: rules.map((rule) => ({
      type: rule.type,
      enabled: rule.enabled,
      threshold: rule.threshold ?? HOUSING_ALERT_RULE_SPECS[rule.type].defaultThreshold,
    })),
    /** Which rules may be offered at all, so the UI never renders a dead switch. */
    availableRuleTypes: AVAILABLE_HOUSING_ALERT_RULE_TYPES,
    alertStatus: watchAlertStatus(row, rules),

    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
