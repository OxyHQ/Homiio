/**
 * The producer: turning a catalogue write into a domain FACT.
 *
 * Everything that changes a listing calls in here and knows nothing about
 * watches, areas, cooldowns or notifications — `recordHousingDomainEvent` is the
 * whole surface, and the matcher picks the facts up on its own schedule. That
 * separation is what keeps a slow or failing matcher from being a slow or
 * failing INGEST.
 *
 * ## Best effort, always
 *
 * Every function here swallows and logs, for the same reason
 * `notificationDispatchService` does: the domain write has already happened, and
 * failing to record that it happened must not roll back the listing. A lost
 * event costs a notification nobody was promised; a rethrow costs the listing.
 *
 * ## What a transition may contain
 *
 * Before/after values and nothing observation-dependent — no timestamps, no job
 * ids, no run counters. The transition is hashed into the alert's idempotency
 * key, so anything that varies between two observations of the SAME change would
 * make every re-ingest a fresh transition and retire the dedupe silently. See
 * `db/watches/domainEventRepository.ts`.
 */

import { and, eq } from 'drizzle-orm';
import { getDb, type Database, type DatabaseOrTransaction } from '../../db/postgres';
import { addresses, properties } from '../../db/schema';
import { recordHousingDomainEvent } from '../../db/watches/domainEventRepository';
import { logger } from '../../middlewares/logging';

/**
 * Whether this process is doing a BULK import rather than serving real changes.
 *
 * Read per call rather than cached at module load, so an operator can flip it
 * for a one-shot task without a rebuild — and because a cached read would make
 * the flag a property of when the process started rather than of what it is
 * doing.
 *
 * It is the first of THREE mechanisms that stop the first indexing of a
 * catalogue arriving as thousands of "new listing" alerts, and the only one that
 * needs somebody to remember:
 *
 *  1. this flag, for a deliberate bulk run;
 *  2. `saved_searches.alerts_active_from`, which is automatic and protects a NEW
 *     watch from an EXISTING catalogue;
 *  3. `MAX_DELIVERIES_PER_WATCH_PER_DAY`, which is automatic, needs no
 *     foreknowledge at all, and bounds even a flood nobody flagged — the
 *     remaining alerts are recorded as `rate_limited` rather than delivered.
 *
 * The third is the backstop that makes forgetting the first survivable, which is
 * why it is a hard cap in the matcher and not a warning in a comment.
 */
function backfillMode(): boolean {
  return process.env.HOUSING_ALERT_BACKFILL_MODE === 'true';
}

/**
 * What a listing's cost terms looked like at a moment.
 *
 * Read as a snapshot BEFORE a write and compared with the one after, because a
 * transition is a pair and neither half is recoverable from the other. The
 * coordinates ride along so the event can carry a place without a second join —
 * an event outlives its subject, so it cannot resolve one later.
 */
export interface PropertySnapshot {
  readonly id: string;
  readonly title: string;
  readonly offering: string;
  readonly rentAmount: number | null;
  readonly rentCurrency: string | null;
  readonly saleAmount: number | null;
  readonly saleCurrency: string | null;
  readonly deposit: number | null;
  readonly utilities: string | null;
  readonly longitude: number | null;
  readonly latitude: number | null;
}

/** The price a listing is advertised at, whichever offering it carries. */
function priceOf(snapshot: PropertySnapshot): { amount: number; currency: string } | null {
  if (snapshot.rentAmount !== null) {
    return { amount: snapshot.rentAmount, currency: snapshot.rentCurrency ?? 'EUR' };
  }
  if (snapshot.saleAmount !== null) {
    return { amount: snapshot.saleAmount, currency: snapshot.saleCurrency ?? 'EUR' };
  }
  return null;
}

/**
 * Read a listing's alert-relevant state, with the coordinates of its address.
 *
 * An INNER join on `addresses`: the reference is `NOT NULL` with an
 * `ON DELETE RESTRICT` foreign key, so the join can drop no row and multiply
 * none — the same property `db/properties/propertyGeo.ts` relies on.
 */
export async function readPropertySnapshot(
  db: DatabaseOrTransaction,
  propertyId: string,
): Promise<PropertySnapshot | null> {
  const [row] = await db
    .select({
      id: properties.id,
      title: properties.title,
      offerings: properties.offerings,
      rentAmount: properties.longTermRentMonthlyAmount,
      rentCurrency: properties.longTermRentCurrency,
      saleAmount: properties.salePrice,
      saleCurrency: properties.saleCurrency,
      deposit: properties.longTermRentDeposit,
      utilities: properties.longTermRentUtilities,
      longitude: addresses.longitude,
      latitude: addresses.latitude,
    })
    .from(properties)
    .innerJoin(addresses, eq(properties.addressId, addresses.id))
    .where(eq(properties.id, propertyId))
    .limit(1);

  if (!row) return null;
  return {
    id: row.id,
    // `properties.title` is NULLABLE — an ingested listing whose portal supplied
    // none is real. Resolved to a neutral noun HERE rather than at the
    // explanation, so every downstream sentence has something to say and none of
    // them reaches for the id, which is both meaningless to a reader and a thing
    // that should not be published.
    title: row.title ?? 'A home',
    offering: row.offerings[0] ?? 'long_term_rent',
    rentAmount: row.rentAmount,
    rentCurrency: row.rentCurrency,
    saleAmount: row.saleAmount,
    saleCurrency: row.saleCurrency,
    deposit: row.deposit,
    utilities: row.utilities,
    longitude: row.longitude,
    latitude: row.latitude,
  };
}

/**
 * Record that a listing appeared.
 *
 * Only for a PUBLISHED listing: a draft is not something anybody can go and see,
 * and announcing one would tell a stranger about a home its owner has not
 * finished describing. Checked against the row rather than trusted from the
 * caller, because the caller is several controllers and an ingest worker.
 */
export async function recordPropertyCreatedEvent(
  propertyId: string,
  db: Database = getDb(),
): Promise<void> {
  try {
    const [status] = await db
      .select({ status: properties.status })
      .from(properties)
      .where(and(eq(properties.id, propertyId)))
      .limit(1);
    if (status?.status !== 'published') return;

    const snapshot = await readPropertySnapshot(db, propertyId);
    if (!snapshot) return;

    await recordHousingDomainEvent(db, {
      type: 'new_listing',
      subjectType: 'property',
      subjectId: propertyId,
      transition: { title: snapshot.title, offering: snapshot.offering },
      longitude: snapshot.longitude,
      latitude: snapshot.latitude,
      isBackfill: backfillMode(),
    });
  } catch (error) {
    logger.error('Failed to record new-listing event', {
      propertyId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Record whatever changed between two snapshots of one listing.
 *
 * Produces at most TWO events — one price event and one cost-terms event —
 * because they are different questions people subscribe to separately. A price
 * move that also changed the deposit is genuinely two facts, and collapsing them
 * would force somebody who only wants price drops to hear about deposits.
 */
export async function recordPropertyChangeEvents(
  before: PropertySnapshot,
  after: PropertySnapshot,
  db: Database = getDb(),
): Promise<void> {
  try {
    const isBackfill = backfillMode();
    const previous = priceOf(before);
    const current = priceOf(after);

    if (previous && current && previous.amount !== current.amount && previous.amount !== 0) {
      await recordHousingDomainEvent(db, {
        type: current.amount < previous.amount ? 'price_decrease' : 'price_increase',
        subjectType: 'property',
        subjectId: after.id,
        // The PAIR is the transition, and the title rides along so the
        // explanation can be written without re-reading a listing that may be
        // gone by the time the matcher runs. No timestamp: see the header.
        transition: {
          title: after.title,
          fromAmount: previous.amount,
          toAmount: current.amount,
          currency: current.currency,
        },
        longitude: after.longitude,
        latitude: after.latitude,
        isBackfill,
      });
    }

    const terms: string[] = [];
    if (before.deposit !== after.deposit) terms.push('deposit');
    if (before.utilities !== after.utilities) terms.push('utilities');
    if (terms.length > 0) {
      await recordHousingDomainEvent(db, {
        type: 'cost_terms_changed',
        subjectType: 'property',
        subjectId: after.id,
        // WHICH terms moved, never their values. A deposit is a number about a
        // specific tenancy negotiation, and the alert's job is to say "go and
        // look", not to publish the figure into a lock screen.
        transition: { title: after.title, terms },
        longitude: after.longitude,
        latitude: after.latitude,
        isBackfill,
      });
    }
  } catch (error) {
    logger.error('Failed to record listing-change events', {
      propertyId: after.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Record that a listing is gone.
 *
 * Called BEFORE the delete, because the snapshot it needs — the title and the
 * coordinates — is only readable while the row exists. That ordering is the
 * whole reason this is a separate function rather than a branch of the change
 * recorder.
 */
export async function recordPropertyRemovedEvent(
  snapshot: PropertySnapshot,
  db: Database = getDb(),
): Promise<void> {
  try {
    await recordHousingDomainEvent(db, {
      type: 'listing_removed',
      subjectType: 'property',
      subjectId: snapshot.id,
      transition: { title: snapshot.title },
      longitude: snapshot.longitude,
      latitude: snapshot.latitude,
      isBackfill: backfillMode(),
    });
  } catch (error) {
    logger.error('Failed to record listing-removed event', {
      propertyId: snapshot.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
