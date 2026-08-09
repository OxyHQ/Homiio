/**
 * `profiles` and its five child tables — the tenant profile Oxy does not own, on
 * Postgres.
 *
 * ## The row counts, measured on BOTH stores rather than assumed
 *
 * Run 2026-08-09 from a one-shot on the live task definition, against
 * `homiio-production` and the `homiio` Postgres database:
 *
 * | store | rows |
 * |---|--:|
 * | Mongo `profiles` | **5** |
 * | Postgres `profiles` | **5** — the SAME five `oxy_user_id`s, all 24-char hex ids |
 * | all five child collections / tables, both stores | **0** |
 *
 * So the copy is COMPLETE for this collection, and the apparent gap between
 * "five rows in Postgres" and "a much larger Mongo collection" is an artefact of
 * the comparison rather than of the backfill: the Mongo collection is five rows
 * too. It is recorded here because the opposite conclusion — a partial copy —
 * would make every read below a consistency hazard, and nothing in the code
 * could tell you which it was.
 *
 * The population being this small has a cause worth stating, because it is the
 * thing that would otherwise make five look wrong: production holds 17,644
 * properties and **not one** carries an `oxy_user_id` (they are all external
 * aggregator listings, and the ingest hook strips the owner). There is no larger
 * set of "profiles reachable from properties" a backfill could have missed — the
 * join that would find them is empty on the other side.
 *
 * ## One profile per Oxy account, and the INDEX is what enforces it
 *
 * Mongoose declared `unique: true` on `oxyUserId` and the controller wrapped a
 * read-then-create around it, which is a window two concurrent first requests
 * both pass. {@link ensureProfile} INSERTs `ON CONFLICT DO NOTHING` against
 * `profiles_oxy_user_id_key` instead — `db/MIGRATION-CONTRACT.md`'s rule that
 * idempotency which moved into an index must not be re-implemented as a read.
 * Why `ON CONFLICT` rather than a caught `23505` is the load-bearing part, and
 * it is explained on the function.
 *
 * ## Nothing here takes a profile id from a caller
 *
 * Every entry point is keyed by `oxyUserId`, which the caller resolves from the
 * session. A profile is a sidecar to an Oxy account, so the account id IS the
 * key — and a lookup by row id authorised in a second statement is an IDOR the
 * moment somebody forgets the second statement.
 */

import { asc, eq, sql } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../postgres';
import {
  profileChatMessages,
  profilePreferredLocations,
  profileReferences,
  profileRentalHistory,
  profileRoommateHistory,
  profiles,
} from '../schema';
import { type HydratedProfile, type ProfileRow, profileSelection } from './profileSerializer';

/**
 * How many transcript turns the profile keeps.
 *
 * Mongo's `POST /api/ai/history` trimmed with `slice(-100)` on every append. The
 * cap is preserved because it is the only thing bounding an array that grows
 * with every turn — see {@link appendProfileChatTurn}.
 */
export const PROFILE_CHAT_HISTORY_LIMIT = 100;

/** Columns a write may set. Derived from the table, so it cannot name a phantom. */
export type ProfileWriteColumns = Partial<typeof profiles.$inferInsert>;

/** A child row a write may replace, as the caller supplies it (no `profileId` yet). */
export type ProfileReferenceInput = Omit<typeof profileReferences.$inferInsert, 'profileId' | 'id'>;
export type ProfileRentalHistoryInput = Omit<
  typeof profileRentalHistory.$inferInsert,
  'profileId' | 'id'
>;
export type ProfilePreferredLocationInput = Omit<
  typeof profilePreferredLocations.$inferInsert,
  'profileId' | 'id'
>;
export type ProfileRoommateHistoryInput = Omit<
  typeof profileRoommateHistory.$inferInsert,
  'profileId' | 'id'
>;

/**
 * A whole update: the scalar columns, plus any child collection being REPLACED.
 *
 * A child key left `undefined` is untouched; a key present as an array replaces
 * that collection wholesale, and an EMPTY array clears it. Those are the same
 * semantics Mongoose had — assigning `personalProfile.references` replaced the
 * array — and they are why `undefined` and `[]` must stay distinguishable.
 */
export interface ProfileUpdate {
  readonly columns: ProfileWriteColumns;
  readonly references?: readonly ProfileReferenceInput[];
  readonly rentalHistory?: readonly ProfileRentalHistoryInput[];
  readonly preferredLocations?: readonly ProfilePreferredLocationInput[];
  readonly roommateHistory?: readonly ProfileRoommateHistoryInput[];
}

/** A freshly created profile has no child rows. Stated once rather than five times. */
function emptyChildren(): Omit<HydratedProfile, 'profile'> {
  return {
    references: [],
    rentalHistory: [],
    preferredLocations: [],
    roommateHistory: [],
    chatHistory: [],
  };
}

/** The profile row for an Oxy account, or `undefined`. Children NOT loaded. */
export async function findProfileByOxyUserId(
  db: DatabaseOrTransaction,
  oxyUserId: string,
): Promise<ProfileRow | undefined> {
  const [row] = await db
    .select(profileSelection())
    .from(profiles)
    .where(eq(profiles.oxyUserId, oxyUserId))
    .limit(1);
  return row;
}

/**
 * Every child collection for one profile.
 *
 * Five statements in parallel rather than one join: the collections are
 * independent of each other, so a join would multiply their rows together and
 * the reader would have to undo five cartesian products to recover what five
 * plain reads already return.
 *
 * **Every ordering here names a real sort column and uses the id only to break a
 * tie.** A `text` primary key holds a 24-char ObjectId hex for a pre-cutover row
 * and a uuid v7 for a new one, and those two shapes do NOT interleave in
 * creation order — a uuid v7 minted today begins `0…` and every ObjectId minted
 * this year begins `6…`, so a lexicographic sort puts every new row FIRST. See
 * `db/conversations/conversationRepository.ts`, which carries the measurement.
 */
async function loadChildren(
  db: DatabaseOrTransaction,
  profileId: string,
): Promise<Omit<HydratedProfile, 'profile'>> {
  const [references, rentalHistory, preferredLocations, roommateHistory, chatHistory] =
    await Promise.all([
      db.select().from(profileReferences).where(eq(profileReferences.profileId, profileId)),
      db
        .select()
        .from(profileRentalHistory)
        .where(eq(profileRentalHistory.profileId, profileId))
        .orderBy(asc(profileRentalHistory.startDate), asc(profileRentalHistory.id)),
      db
        .select()
        .from(profilePreferredLocations)
        .where(eq(profilePreferredLocations.profileId, profileId)),
      db
        .select()
        .from(profileRoommateHistory)
        .where(eq(profileRoommateHistory.profileId, profileId))
        .orderBy(asc(profileRoommateHistory.startDate), asc(profileRoommateHistory.id)),
      db
        .select()
        .from(profileChatMessages)
        .where(eq(profileChatMessages.profileId, profileId))
        .orderBy(asc(profileChatMessages.position), asc(profileChatMessages.timestamp)),
    ]);
  return { references, rentalHistory, preferredLocations, roommateHistory, chatHistory };
}

/**
 * One profile with every child collection loaded, or `undefined`.
 *
 * `scope: 'owner'` additionally reads the PROTECTED `personal_info_annual_income`
 * column, in a statement that names it explicitly — the escape hatch
 * `db/schema/protectedColumns.ts` sanctions, and the only use of it in this
 * package. Without it the owner's own edit form round-trips a block it cannot
 * see and writes NULL over their income on the next save; see
 * {@link OwnerOnlyProfileFields}. The default is `'public'`, so a caller who
 * does not think about it gets the protected view.
 */
export async function findHydratedProfile(
  db: DatabaseOrTransaction,
  oxyUserId: string,
  scope: 'owner' | 'public' = 'public',
): Promise<HydratedProfile | undefined> {
  const profile = await findProfileByOxyUserId(db, oxyUserId);
  if (!profile) return undefined;
  const children = await loadChildren(db, profile.id);
  if (scope !== 'owner') return { profile, ...children };

  const [income] = await db
    .select({ annualIncome: profiles.personalInfoAnnualIncome })
    .from(profiles)
    .where(eq(profiles.id, profile.id))
    .limit(1);
  return { profile, ...children, ownerOnly: { annualIncome: income?.annualIncome ?? null } };
}

/**
 * The profile for an Oxy account, created empty if it is not there.
 *
 * **Every column stays NULL on creation**, which is a change from Mongo's
 * `_createDefaultProfile` and a deliberate one. That helper wrote a
 * `personalProfile` block seeded with the schema's defaults — `language: 'en'`,
 * `timezone: 'UTC'`, `profileVisibility: 'public'`, `showContactInfo: true` — so
 * a stored row could not distinguish "the user chose UTC" from "nobody ever
 * asked". `db/schema/profiles.ts` declares every column nullable precisely to
 * keep that distinction, and mongoose never materialized the sub-document
 * either: `personalProfile` is declared with no `default`, so for the five rows
 * that exist NONE of those defaults was ever written. Seeding them here would
 * manufacture five people's answers and then present them as given.
 *
 * The one place that costs something is the public serializer, which reads
 * `showContactInfo === true` — so a profile that has never been edited discloses
 * nothing, which is the safe direction and matches what the five production rows
 * actually contain.
 *
 * Idempotent by the unique index rather than by a preceding read.
 *
 * ## Convergence is `ON CONFLICT DO NOTHING`, NOT a caught `23505`
 *
 * The obvious spelling — insert, catch the unique violation, re-read — is wrong
 * HERE even though it is right in `db/roommates/roommateRepository.ts`, and the
 * difference is the caller. Every call site of this function runs inside a
 * transaction the CALLER opened (`updateMyProfile`, and the three `/ai/history`
 * handlers). In Postgres a failed statement aborts the enclosing transaction, so
 * the recovery `SELECT` would answer `25P02 current transaction is aborted`
 * rather than the row — turning the race the unique index exists to absorb into
 * a 500, and only under concurrency, which is where it would never be noticed.
 *
 * `ON CONFLICT DO NOTHING` never fails, so no statement can abort anything: an
 * empty `RETURNING` set IS the "somebody else got there first" answer, and the
 * read that follows runs in a healthy transaction. Same mechanism, and the same
 * reasoning, as `enqueueModerationOutboxEvent`'s claim.
 *
 * `appendMessages` in the conversation repository solves the same hazard the
 * other way — by opening its own transaction per attempt — because it genuinely
 * needs to RETRY with a recomputed value. Nothing here needs recomputing.
 */
export async function ensureProfile(
  db: DatabaseOrTransaction,
  oxyUserId: string,
  scope: 'owner' | 'public' = 'public',
): Promise<HydratedProfile> {
  const existing = await findHydratedProfile(db, oxyUserId, scope);
  if (existing) return existing;

  const [created] = await db
    .insert(profiles)
    .values({ oxyUserId })
    // Targeted rather than bare: this is the one conflict we are prepared to
    // treat as an idempotent repeat. A future second unique index on this table
    // must not be silently absorbed by the same clause.
    .onConflictDoNothing({ target: profiles.oxyUserId })
    .returning(profileSelection());
  if (created) {
    // A row this statement just created holds NULL in every column, income
    // included, so the owner view needs no second read here.
    return {
      profile: created,
      ...emptyChildren(),
      ...(scope === 'owner' ? { ownerOnly: { annualIncome: null } } : {}),
    };
  }

  const raced = await findHydratedProfile(db, oxyUserId, scope);
  if (!raced) {
    // The index refused the insert, so a row satisfying it existed at that
    // instant. Not finding it now means it was deleted in between — a real
    // state, and one the caller must not be handed a fabricated row for.
    throw new Error(`Profile for ${oxyUserId} was created and removed concurrently.`);
  }
  return raced;
}

/**
 * Apply an update to the profile for an Oxy account, creating it first if it is
 * not there, and return the whole thing.
 *
 * Takes `DatabaseOrTransaction` and issues several statements, so the CALLER
 * wraps it: a child collection replaced against a profile whose scalar write
 * then failed would leave the person's references belonging to a state that was
 * never saved.
 *
 * `columns` is produced by `controllers/profile/profileWriteColumns.ts` from an
 * explicit allow-list. This function never sees a request body and never
 * spreads one.
 */
export async function updateProfile(
  db: DatabaseOrTransaction,
  oxyUserId: string,
  update: ProfileUpdate,
  scope: 'owner' | 'public' = 'public',
): Promise<HydratedProfile> {
  const existing = await ensureProfile(db, oxyUserId, scope);
  const profileId = existing.profile.id;

  if (Object.keys(update.columns).length > 0) {
    await db.update(profiles).set(update.columns).where(eq(profiles.id, profileId));
  }

  // Four delete-then-insert blocks, written out rather than routed through one
  // generic helper: drizzle's insert/delete builders are typed per TABLE, so a
  // helper generic enough to take any of them loses the row type — and losing it
  // is precisely how a key that is not a column reaches `.values()`, where
  // drizzle IGNORES it instead of refusing it. The same reasoning
  // `controllers/lease/leaseWriteColumns.ts` gives for naming every field.
  if (update.references) {
    await db.delete(profileReferences).where(eq(profileReferences.profileId, profileId));
    if (update.references.length > 0) {
      await db
        .insert(profileReferences)
        .values(update.references.map((row) => ({ ...row, profileId })));
    }
  }
  if (update.rentalHistory) {
    await db.delete(profileRentalHistory).where(eq(profileRentalHistory.profileId, profileId));
    if (update.rentalHistory.length > 0) {
      await db
        .insert(profileRentalHistory)
        .values(update.rentalHistory.map((row) => ({ ...row, profileId })));
    }
  }
  if (update.preferredLocations) {
    await db
      .delete(profilePreferredLocations)
      .where(eq(profilePreferredLocations.profileId, profileId));
    if (update.preferredLocations.length > 0) {
      await db
        .insert(profilePreferredLocations)
        .values(update.preferredLocations.map((row) => ({ ...row, profileId })));
    }
  }
  if (update.roommateHistory) {
    await db.delete(profileRoommateHistory).where(eq(profileRoommateHistory.profileId, profileId));
    if (update.roommateHistory.length > 0) {
      await db
        .insert(profileRoommateHistory)
        .values(update.roommateHistory.map((row) => ({ ...row, profileId })));
    }
  }

  const updated = await findHydratedProfile(db, oxyUserId, scope);
  if (!updated) {
    // Unreachable through this function, which created the row above inside the
    // caller's transaction. Thrown rather than returned as `undefined` so no
    // caller has to handle a case this function cannot produce.
    throw new Error(`Profile for ${oxyUserId} vanished during its own update.`);
  }
  return updated;
}

/** The profile's Sindi transcript, oldest first. */
export async function listProfileChatHistory(
  db: DatabaseOrTransaction,
  profileId: string,
): Promise<readonly (typeof profileChatMessages.$inferSelect)[]> {
  return db
    .select()
    .from(profileChatMessages)
    .where(eq(profileChatMessages.profileId, profileId))
    .orderBy(asc(profileChatMessages.position), asc(profileChatMessages.timestamp));
}

/**
 * Append one user turn and its assistant reply, then trim to
 * {@link PROFILE_CHAT_HISTORY_LIMIT}.
 *
 * The profile row is locked FOR UPDATE first, which serialises concurrent
 * appends for one person. That matters because `position` is `max + 1` and
 * `profile_chat_messages` carries no `UNIQUE(profile_id, position)` — unlike
 * `conversation_messages`, which does, and where the index is what catches the
 * race. Here the lock is the mechanism, and without it two turns posted at once
 * would both take the same position and the transcript would have no defined
 * order at that point.
 *
 * Both messages get the SAME timestamp, matching the Mongo handler, which took
 * one `new Date()` for the pair. `position` is what tells them apart.
 *
 * Runs several statements, so the caller supplies the transaction.
 */
export async function appendProfileChatTurn(
  db: DatabaseOrTransaction,
  profileId: string,
  turn: { readonly userMessage: string; readonly assistantMessage: string },
): Promise<void> {
  await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, profileId)).for('update');

  // `::double precision` for the same reason `conversation_messages` casts to
  // `::int`: an aggregate's driver representation is not the column's, and a
  // string coming back here would make `+ 1` string concatenation — silently,
  // past `tsc`, and only visible once a transcript is out of order.
  const [highest] = await db
    .select({
      position: sql<number>`coalesce(max(${profileChatMessages.position}), -1)::double precision`,
    })
    .from(profileChatMessages)
    .where(eq(profileChatMessages.profileId, profileId));
  const next = highest.position + 1;
  const timestamp = new Date();

  await db.insert(profileChatMessages).values([
    { profileId, role: 'user', content: turn.userMessage, timestamp, position: next },
    { profileId, role: 'assistant', content: turn.assistantMessage, timestamp, position: next + 1 },
  ]);

  // Keep the newest N. Expressed as "delete everything at or below the cutoff
  // position" rather than "keep the last N ids", because the cutoff is computed
  // from `position` — the column that defines the order — and an id-based
  // version would depend on the id shape, which is exactly what this migration
  // makes unreliable.
  const cutoff = next + 1 - PROFILE_CHAT_HISTORY_LIMIT;
  if (cutoff >= 0) {
    await db
      .delete(profileChatMessages)
      .where(
        sql`${profileChatMessages.profileId} = ${profileId} and ${profileChatMessages.position} <= ${cutoff}`,
      );
  }
}

/** Clear the profile's Sindi transcript. Returns how many turns went. */
export async function clearProfileChatHistory(
  db: DatabaseOrTransaction,
  profileId: string,
): Promise<number> {
  const rows = await db
    .delete(profileChatMessages)
    .where(eq(profileChatMessages.profileId, profileId))
    .returning({ id: profileChatMessages.id });
  return rows.length;
}
