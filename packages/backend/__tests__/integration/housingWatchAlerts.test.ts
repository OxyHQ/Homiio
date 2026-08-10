/**
 * Saved areas and explainable housing-change alerts (#356), end to end against a
 * REAL Postgres.
 *
 * ## Why this suite is not vacuous
 *
 * Every table it touches starts empty, so a suite that recorded one event and
 * asserted one alert would pass against almost any implementation. Each case
 * below is written against a rule that has a way to be WRONG, and the ones that
 * are easiest to fake are asserted in BOTH directions:
 *
 *  - the area match asserts a listing INSIDE fires and one OUTSIDE does not, so
 *    an implementation that matches everything fails as loudly as one that
 *    matches nothing;
 *  - the threshold asserts above AND below, so a threshold that is read but
 *    never compared fails;
 *  - the dedupe asserts one alert AND one notification after two deliveries,
 *    and `housingWatchAlerts.mutation.test.ts` drops the unique index to show
 *    the assertion is load-bearing rather than incidentally true;
 *  - the "no coordinates" case asserts the sweep REFUSES a payload carrying one,
 *    not merely that the payloads we happen to build are clean — the second
 *    would pass against a sweep that does nothing.
 *
 * ## Events, not properties, wherever a property is not the point
 *
 * `housing_domain_events.subject_id` is polymorphic text with no foreign key
 * (see `deferredForeignKeys.ts`), so most cases here record a fact directly
 * instead of building the five-row geo scaffold a listing needs. That is not a
 * shortcut around the real path — it is the same row the producer writes — and
 * it keeps each case about the rule under test. The producer's own path is
 * covered separately, at the bottom, where the property IS the point.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from '@oxyhq/db';
import {
  findUnsafeAlertFields,
  parseLocationToken,
  type LocationSelection,
} from '@homiio/shared-types';

import * as savedSearches from '../../controllers/profile/savedSearches';
import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import {
  housingAlerts,
  housingDomainEvents,
  housingWatchRules,
  notifications,
  savedSearches as savedSearchesTable,
} from '../../db/schema';
import { recordHousingDomainEvent } from '../../db/watches/domainEventRepository';
import { matchDomainEvent } from '../../services/watches/housingAlertMatcher';
import { deliverDueDigests, runHousingAlertSweep } from '../../services/watches/housingAlertSweep';
import { errorHandler } from '../../middlewares/errorHandler';

let db: Database;

beforeAll(async () => {
  db = await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
});

/**
 * A clean world per case, and it is not tidiness.
 *
 * Every watch in this file covers the same Barcelona box, so a watch left behind
 * by an earlier case matches a later case's event and inflates its counts —
 * which reads as "the matcher fanned out too far" rather than as leakage. A
 * unique owner per case is NOT enough on its own, precisely because the matcher
 * is inverted: it fans out from the AREA, so it finds every owner.
 */
beforeEach(async () => {
  // Watches first: `housing_alerts` and `housing_watch_rules` cascade from them.
  await db.delete(savedSearchesTable);
  await db.delete(housingDomainEvents);
  await db.delete(notifications);
});

/** A distinct Oxy id per case, so no two can collide with each other. */
const oxy = (): string => `oxy-${uuidv7()}`;

function buildApp(oxyUserId?: string): Express {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (oxyUserId) {
      (req as unknown as { user: { id: string } }).user = { id: oxyUserId };
    }
    next();
  });
  app.get('/saved-searches', (req, res, next) => savedSearches.getSavedSearches(req, res, next));
  app.post('/saved-searches', (req, res, next) => savedSearches.saveSearch(req, res, next));
  app.put('/saved-searches/:searchId', (req, res, next) =>
    savedSearches.updateSavedSearch(req, res, next),
  );
  app.delete('/saved-searches/:searchId', (req, res, next) =>
    savedSearches.deleteSavedSearch(req, res, next),
  );
  app.get('/alerts', (req, res, next) => savedSearches.getHousingAlerts(req, res, next));
  app.get('/alerts/:alertId', (req, res, next) => savedSearches.getHousingAlert(req, res, next));
  app.use(errorHandler);
  return app;
}

/**
 * Barcelona's Eixample, as a `map_bounds` selection.
 *
 * A bounded selection on purpose: a `place` with only a centroid has no
 * derivable area, which is a case this suite tests separately rather than
 * stumbling into.
 */
const EIXAMPLE: LocationSelection = {
  kind: 'map_bounds',
  bounds: { west: 2.15, south: 41.38, east: 2.19, north: 41.4 },
  center: { longitude: 2.17, latitude: 41.39 },
  label: { primary: 'Eixample', kind: 'generated' },
  precision: 'area',
};

/** Inside `EIXAMPLE`. */
const INSIDE = { longitude: 2.17, latitude: 41.39 };
/** Madrid — comfortably outside, and in another region entirely. */
const OUTSIDE = { longitude: -3.7038, latitude: 40.4168 };

/** A city Homiio knows by id with NO extent — the `no_area` case. */
const CITY_WITHOUT_BOUNDS: LocationSelection = {
  kind: 'place',
  source: { kind: 'homiio', entity: 'city', id: '01H8XQ7C2R9V6WQ2N4M0KJ3ZTA' },
  placeType: 'city',
  label: { primary: 'Barcelona', secondary: 'Catalonia, Spain', kind: 'place' },
  admin: { countryCode: 'ES', regionName: 'Catalonia', cityName: 'Barcelona' },
  center: { longitude: 2.1734, latitude: 41.3851 },
  precision: 'centroid',
};

interface WatchOptions {
  readonly location?: LocationSelection | null;
  readonly cadence?: string;
  readonly rules?: readonly { type: string; enabled: boolean; threshold?: number }[];
  readonly channels?: readonly string[];
  readonly isPrimaryArea?: boolean;
}

/** Create a watch through the REAL handler, so the API's own narrowing runs. */
async function createWatch(
  owner: string,
  name: string,
  options: WatchOptions = {},
): Promise<Record<string, unknown>> {
  const response = await request(buildApp(owner))
    .post('/saved-searches')
    .send({
      name,
      query: '',
      ...(options.location === undefined
        ? { location: EIXAMPLE }
        : options.location === null
          ? {}
          : { location: options.location }),
      cadence: options.cadence ?? 'instant',
      ...(options.rules ? { alertRules: options.rules } : {}),
      ...(options.channels ? { channels: options.channels } : {}),
      ...(options.isPrimaryArea === undefined ? {} : { isPrimaryArea: options.isPrimaryArea }),
    });
  expect(response.status).toBe(201);
  return response.body.data as Record<string, unknown>;
}

interface EventOptions {
  readonly type?: string;
  readonly at?: { longitude: number; latitude: number } | null;
  readonly transition?: Record<string, unknown>;
  readonly isBackfill?: boolean;
  readonly subjectId?: string;
  readonly occurredAt?: Date;
}

async function recordEvent(options: EventOptions = {}) {
  const at = options.at === undefined ? INSIDE : options.at;
  return recordHousingDomainEvent(db, {
    type: (options.type ?? 'new_listing') as 'new_listing',
    subjectType: 'property',
    subjectId: options.subjectId ?? `property-${uuidv7()}`,
    transition: options.transition ?? { title: 'Bright flat on Carrer de Mallorca' },
    longitude: at?.longitude ?? null,
    latitude: at?.latitude ?? null,
    isBackfill: options.isBackfill ?? false,
    ...(options.occurredAt ? { occurredAt: options.occurredAt } : {}),
  });
}

async function alertsFor(owner: string) {
  return db.select().from(housingAlerts).where(eq(housingAlerts.oxyUserId, owner));
}

async function notificationsFor(owner: string) {
  return db.select().from(notifications).where(eq(notifications.recipientOxyUserId, owner));
}

// ---------------------------------------------------------------------------
// Nueva propiedad dentro / fuera del área
// ---------------------------------------------------------------------------

describe('area matching', () => {
  it('alerts on a new listing INSIDE the watched area', async () => {
    const owner = oxy();
    const watch = await createWatch(owner, 'Eixample');

    const event = await recordEvent();
    const outcome = await matchDomainEvent(event, db);

    expect(outcome.created).toBe(1);
    expect(outcome.delivered).toBe(1);

    const [alert] = await alertsFor(owner);
    expect(alert.watchId).toBe(watch.id);
    expect(alert.deliveryState).toBe('delivered');
    expect(alert.deliveredChannels).toEqual(['in_app']);
  });

  it('does NOT alert on a listing OUTSIDE it', async () => {
    // The half that fails against an implementation matching everything — which
    // passes the case above and is the more likely mistake, because a spatial
    // predicate that silently degrades (a dropped `::geography` cast, an
    // envelope built the wrong way round) returns MORE rows, not fewer.
    const owner = oxy();
    await createWatch(owner, 'Eixample');

    const event = await recordEvent({ at: OUTSIDE });
    const outcome = await matchDomainEvent(event, db);

    expect(outcome.matched).toBe(0);
    expect(await alertsFor(owner)).toHaveLength(0);
  });

  it('does NOT alert on an event with no coordinates at all', async () => {
    // A placeless fact must match NOTHING rather than everything. Matching every
    // watch in the world would be ADR 0002 §4.3's "degraded to a global feed",
    // arriving through the alert path instead of the search path.
    const owner = oxy();
    await createWatch(owner, 'Eixample');

    const event = await recordEvent({ at: null });
    const outcome = await matchDomainEvent(event, db);

    expect(outcome.matched).toBe(0);
    expect(await alertsFor(owner)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Price decrease por encima / por debajo del threshold
// ---------------------------------------------------------------------------

describe('price thresholds', () => {
  const priceRules = [{ type: 'price_decrease', enabled: true, threshold: 5 }];

  it('alerts on a drop ABOVE the threshold, and explains it with both amounts', async () => {
    const owner = oxy();
    await createWatch(owner, 'Eixample', { rules: priceRules });

    // 1350 → 1250 is −7.4%, above the 5% this watch asked for.
    const event = await recordEvent({
      type: 'price_decrease',
      transition: { title: 'Flat', fromAmount: 1350, toAmount: 1250, currency: 'EUR' },
    });
    await matchDomainEvent(event, db);

    const [alert] = await alertsFor(owner);
    expect(alert).toBeDefined();
    const explanation = alert.explanation as {
      watchName: string;
      detail: { kind: string; fromAmount: number; toAmount: number; percent: number };
    };
    expect(explanation.detail.kind).toBe('price_change');
    expect(explanation.detail.fromAmount).toBe(1350);
    expect(explanation.detail.toAmount).toBe(1250);
    expect(explanation.detail.percent).toBe(-7.4);
    // The acceptance criterion is that an alert explains the change AND names
    // the watch that matched. Both, on one row.
    expect(explanation.watchName).toBe('Eixample');

    const [notification] = await notificationsFor(owner);
    expect(notification.message).toContain('1,350');
    expect(notification.message).toContain('Eixample');
  });

  it('stays silent on a drop BELOW the threshold', async () => {
    // The discriminating half: a threshold that is stored and never compared
    // passes the case above and fails here.
    const owner = oxy();
    await createWatch(owner, 'Eixample', { rules: priceRules });

    // 1350 → 1340 is −0.74%.
    const event = await recordEvent({
      type: 'price_decrease',
      transition: { title: 'Flat', fromAmount: 1350, toAmount: 1340, currency: 'EUR' },
    });
    const outcome = await matchDomainEvent(event, db);

    // MATCHED but not alerted: the watch is a candidate and the move is simply
    // smaller than it asked about. A zero here would mean the area stopped
    // matching, which is a different bug wearing the same result.
    expect(outcome.matched).toBe(1);
    expect(outcome.created).toBe(0);
    expect(await alertsFor(owner)).toHaveLength(0);
  });

  it('lets two watches disagree about the same move', async () => {
    // Thresholds are per WATCH, so the same fact is news to one person and not
    // to another. An implementation reading the rule SPEC's default instead of
    // the watch's own value passes every single-watch case above.
    const patient = oxy();
    const eager = oxy();
    await createWatch(patient, 'Eixample', {
      rules: [{ type: 'price_decrease', enabled: true, threshold: 20 }],
    });
    await createWatch(eager, 'Eixample', {
      rules: [{ type: 'price_decrease', enabled: true, threshold: 1 }],
    });

    const event = await recordEvent({
      type: 'price_decrease',
      transition: { title: 'Flat', fromAmount: 1000, toAmount: 900, currency: 'EUR' },
    });
    await matchDomainEvent(event, db);

    expect(await alertsFor(patient)).toHaveLength(0);
    expect(await alertsFor(eager)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Mismo evento entregado dos veces al dispatcher
// ---------------------------------------------------------------------------

describe('idempotency', () => {
  it('collapses a second delivery of the SAME event onto one alert', async () => {
    const owner = oxy();
    await createWatch(owner, 'Eixample');

    const event = await recordEvent();
    const first = await matchDomainEvent(event, db);
    const second = await matchDomainEvent(event, db);

    expect(first.created).toBe(1);
    expect(second.created).toBe(0);
    expect(second.duplicates).toBe(1);

    // BOTH sides asserted. An implementation that wrote one alert row and two
    // notifications would satisfy an alert-count assertion alone, and the thing
    // the user experiences is the notification.
    expect(await alertsFor(owner)).toHaveLength(1);
    expect(await notificationsFor(owner)).toHaveLength(1);
  });

  it('collapses two DIFFERENT events describing the same transition', async () => {
    // The case a per-event key would miss, and the reason the idempotency key is
    // built from the TRANSITION rather than from `event.id`: a re-ingest that
    // observes the same before/after pair records a new fact, and telling
    // somebody about it again would be telling them the same thing twice.
    //
    // `new_listing` and NOT a price rule, and that is a correction rather than a
    // preference. Written first with `price_decrease`, this case survived a
    // mutation run that removed the idempotency index — because `price_decrease`
    // carries a 24h COOLDOWN, and the cooldown index caught the duplicate on its
    // own. The test passed, and it was measuring the wrong constraint. A rule
    // with no cooldown leaves the idempotency key as the only thing that can
    // collapse these two, which is what the case claims to be about.
    const owner = oxy();
    await createWatch(owner, 'Eixample', {
      rules: [{ type: 'new_listing', enabled: true }],
    });

    const subjectId = `property-${uuidv7()}`;
    const transition = { title: 'Bright flat', offering: 'long_term_rent' };
    await matchDomainEvent(await recordEvent({ subjectId, transition }), db);
    await matchDomainEvent(await recordEvent({ subjectId, transition }), db);

    expect(await alertsFor(owner)).toHaveLength(1);
    expect(await notificationsFor(owner)).toHaveLength(1);
  });

  it('is INSENSITIVE to the key order a producer happened to use', async () => {
    // `JSON.stringify` preserves insertion order, so two producers building the
    // same transition in different orders would hash differently and the same
    // change would be announced twice. The fixture has to be in the shape that
    // makes the canonical and the naive readings DISAGREE — a tidy pair built
    // the same way twice cannot tell them apart.
    //
    // A no-cooldown rule for the same reason as the case above: under a rule
    // with a window, the cooldown index collapses these two whether or not the
    // hash is order-independent, so the assertion would hold against a
    // canonicaliser that does nothing.
    const owner = oxy();
    await createWatch(owner, 'Eixample', {
      rules: [{ type: 'new_listing', enabled: true }],
    });

    const subjectId = `property-${uuidv7()}`;
    await matchDomainEvent(
      await recordEvent({
        subjectId,
        transition: { title: 'Bright flat', offering: 'long_term_rent' },
      }),
      db,
    );
    await matchDomainEvent(
      await recordEvent({
        subjectId,
        transition: { offering: 'long_term_rent', title: 'Bright flat' },
      }),
      db,
    );

    expect(await alertsFor(owner)).toHaveLength(1);
  });

  it('re-ingest with NO semantic change produces no event and no alert', async () => {
    // The acceptance criterion "un reingest sin cambio semántico no genera
    // alerta", at the producer's own boundary: an unchanged price is not a
    // transition, so there is nothing to be idempotent about in the first place.
    const owner = oxy();
    await createWatch(owner, 'Eixample', {
      rules: [{ type: 'price_decrease', enabled: true, threshold: 1 }],
    });

    const before = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(housingDomainEvents);
    const { recordPropertyChangeEvents } = await import(
      '../../services/watches/propertyEventProducer'
    );
    const snapshot = {
      id: `property-${uuidv7()}`,
      title: 'Flat',
      offering: 'long_term_rent',
      rentAmount: 1250,
      rentCurrency: 'EUR',
      saleAmount: null,
      saleCurrency: null,
      deposit: 2500,
      utilities: null,
      longitude: INSIDE.longitude,
      latitude: INSIDE.latitude,
    };
    await recordPropertyChangeEvents(snapshot, { ...snapshot }, db);

    const after = await db.select({ value: sql<number>`count(*)::int` }).from(housingDomainEvents);
    expect(after[0].value).toBe(before[0].value);
    expect(await alertsFor(owner)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cooldown / oscilación
// ---------------------------------------------------------------------------

describe('cooldown', () => {
  it('suppresses a SECOND price change for the same listing inside the window', async () => {
    // Oscillation slips past the transition dedupe by construction: 1350 → 1250
    // → 1360 → 1250 is three genuinely distinct transitions, none a duplicate of
    // another. Only a time window catches it.
    const owner = oxy();
    await createWatch(owner, 'Eixample', {
      rules: [{ type: 'price_decrease', enabled: true, threshold: 1 }],
    });

    const subjectId = `property-${uuidv7()}`;
    await matchDomainEvent(
      await recordEvent({
        type: 'price_decrease',
        subjectId,
        transition: { title: 'Flat', fromAmount: 1350, toAmount: 1250, currency: 'EUR' },
      }),
      db,
    );
    await matchDomainEvent(
      await recordEvent({
        type: 'price_decrease',
        subjectId,
        transition: { title: 'Flat', fromAmount: 1360, toAmount: 1250, currency: 'EUR' },
      }),
      db,
    );

    expect(await alertsFor(owner)).toHaveLength(1);
  });

  it('does NOT apply a window to a rule whose cooldown is zero', async () => {
    // The explicit-NULL fixture the `NULLS DISTINCT` behaviour needs. Every rule
    // in this suite except `new_listing` has a window, so without this case the
    // schema is indistinguishable from one whose `cooldown_bucket` is NOT NULL —
    // and under that schema a no-cooldown rule would fire once per subject and
    // then never again.
    const owner = oxy();
    await createWatch(owner, 'Eixample', {
      rules: [{ type: 'new_listing', enabled: true }],
    });
    // `cost_terms_changed` carries a 24h window; `new_listing` carries none. Two
    // DIFFERENT transitions on one subject under the windowless rule must both
    // land, which is what a NULL bucket permits and a sentinel bucket would not.
    const subjectId = `property-${uuidv7()}`;
    await matchDomainEvent(
      await recordEvent({ subjectId, transition: { title: 'Flat A' } }),
      db,
    );
    await matchDomainEvent(
      await recordEvent({ subjectId, transition: { title: 'Flat B' } }),
      db,
    );

    const alerts = await alertsFor(owner);
    expect(alerts).toHaveLength(2);
    expect(alerts.every((alert) => alert.cooldownBucket === null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// La primera indexación del catálogo
// ---------------------------------------------------------------------------

describe('first indexing of the catalogue', () => {
  it('emits NOTHING for a bulk backfill run, however many listings it carries', async () => {
    const owner = oxy();
    await createWatch(owner, 'Eixample');

    for (let index = 0; index < 25; index += 1) {
      const event = await recordEvent({ isBackfill: true });
      await matchDomainEvent(event, db);
    }

    expect(await alertsFor(owner)).toHaveLength(0);
    expect(await notificationsFor(owner)).toHaveLength(0);
  });

  it('does not tell a NEW watch about a listing that appeared before it existed', async () => {
    // The half the backfill flag cannot cover, and vice versa: this protects a
    // new watch from an existing catalogue, the flag protects an old watch from
    // a bulk re-index. An implementation with only one of the two passes exactly
    // one of these cases.
    const owner = oxy();
    const yesterday = new Date(Date.now() - 86_400_000);
    const event = await recordEvent({ occurredAt: yesterday });

    await createWatch(owner, 'Eixample');
    const outcome = await matchDomainEvent(event, db);

    expect(outcome.matched).toBe(0);
    expect(await alertsFor(owner)).toHaveLength(0);
  });

  it('caps DELIVERIES per watch even when nothing was flagged as a backfill', async () => {
    // The backstop that makes forgetting the flag survivable. It needs no
    // foreknowledge at all, which is why it is a hard cap in the matcher rather
    // than a warning in a comment: an un-flagged flood delivers at most the
    // daily ceiling and records the rest as `rate_limited`.
    const owner = oxy();
    await createWatch(owner, 'Eixample');

    const { MAX_DELIVERIES_PER_WATCH_PER_DAY } = await import(
      '../../services/watches/housingAlertMatcher'
    );
    const flood = MAX_DELIVERIES_PER_WATCH_PER_DAY + 5;
    for (let index = 0; index < flood; index += 1) {
      await matchDomainEvent(await recordEvent(), db);
    }

    const alerts = await alertsFor(owner);
    expect(alerts).toHaveLength(flood);
    const delivered = alerts.filter((alert) => alert.deliveryState === 'delivered');
    const limited = alerts.filter((alert) => alert.suppressionReason === 'rate_limited');
    expect(delivered).toHaveLength(MAX_DELIVERIES_PER_WATCH_PER_DAY);
    expect(limited).toHaveLength(5);
    // Every one is still RECORDED — the cap is on attention, never on the audit
    // trail, so the history can say "we held five back" rather than nothing.
    expect(await notificationsFor(owner)).toHaveLength(MAX_DELIVERIES_PER_WATCH_PER_DAY);
  });
});

// ---------------------------------------------------------------------------
// Watch pausada / eliminada
// ---------------------------------------------------------------------------

describe('pausing and deleting a watch', () => {
  it('records but does not DELIVER while the watch is muted', async () => {
    const owner = oxy();
    const watch = await createWatch(owner, 'Eixample');
    const mutedUntil = new Date(Date.now() + 3_600_000).toISOString();
    const muted = await request(buildApp(owner))
      .put(`/saved-searches/${watch.id}`)
      .send({ mutedUntil });
    expect(muted.status).toBe(200);

    await matchDomainEvent(await recordEvent(), db);

    const [alert] = await alertsFor(owner);
    expect(alert.deliveryState).toBe('suppressed');
    expect(alert.suppressionReason).toBe('muted');
    // The transition is CLAIMED, so unmuting does not replay it as news.
    expect(await notificationsFor(owner)).toHaveLength(0);
  });

  it('delivers nothing at all once the watch is deleted', async () => {
    const owner = oxy();
    const watch = await createWatch(owner, 'Eixample');
    const deleted = await request(buildApp(owner)).delete(`/saved-searches/${watch.id}`);
    expect(deleted.status).toBe(200);

    const outcome = await matchDomainEvent(await recordEvent(), db);

    expect(outcome.matched).toBe(0);
    expect(await alertsFor(owner)).toHaveLength(0);
    expect(await notificationsFor(owner)).toHaveLength(0);
  });

  it('takes the alert history with the watch, so a delete is a real delete', async () => {
    const owner = oxy();
    const watch = await createWatch(owner, 'Eixample');
    await matchDomainEvent(await recordEvent(), db);
    expect(await alertsFor(owner)).toHaveLength(1);

    await request(buildApp(owner)).delete(`/saved-searches/${watch.id}`);
    expect(await alertsFor(owner)).toHaveLength(0);
  });

  it('stops delivering when the cadence is switched OFF', async () => {
    const owner = oxy();
    const watch = await createWatch(owner, 'Eixample');
    await request(buildApp(owner)).put(`/saved-searches/${watch.id}`).send({ cadence: 'off' });

    const outcome = await matchDomainEvent(await recordEvent(), db);
    expect(outcome.matched).toBe(0);
  });

  it('does not replay the silence when a watch is switched back on', async () => {
    // "Turn alerts on" means "from now". Without re-stamping
    // `alerts_active_from`, a month-old muted watch would wake up and recite the
    // month: every event since is still in the retention window, still inside
    // the area, and still after the ORIGINAL activation.
    const owner = oxy();
    const watch = await createWatch(owner, 'Eixample');
    await request(buildApp(owner)).put(`/saved-searches/${watch.id}`).send({ cadence: 'off' });

    const whileOff = await recordEvent();

    await request(buildApp(owner)).put(`/saved-searches/${watch.id}`).send({ cadence: 'instant' });
    const outcome = await matchDomainEvent(whileOff, db);

    expect(outcome.matched).toBe(0);
    expect(await alertsFor(owner)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Digest
// ---------------------------------------------------------------------------

describe('digest', () => {
  it('groups several changes to ONE listing into a single notification', async () => {
    const owner = oxy();
    await createWatch(owner, 'Eixample', {
      cadence: 'daily',
      rules: [
        { type: 'new_listing', enabled: true },
        { type: 'cost_terms_changed', enabled: true },
      ],
    });

    const subjectId = `property-${uuidv7()}`;
    await matchDomainEvent(await recordEvent({ subjectId }), db);
    await matchDomainEvent(
      await recordEvent({
        type: 'cost_terms_changed',
        subjectId,
        transition: { title: 'Flat', terms: ['deposit'] },
      }),
      db,
    );

    // Held, not delivered: a digest watch claims its alerts immediately and
    // sends them when the window closes. That ordering is what stops a digest
    // double-sending.
    const held = await alertsFor(owner);
    expect(held).toHaveLength(2);
    expect(held.every((alert) => alert.deliveryState === 'pending')).toBe(true);
    expect(await notificationsFor(owner)).toHaveLength(0);

    const result = await deliverDueDigests('daily', db);
    expect(result.delivered).toBe(2);

    const sent = await notificationsFor(owner);
    expect(sent).toHaveLength(1);
    // ONE home, TWO changes — reported separately, because saying "2 changes"
    // would overstate how much of the market moved.
    expect(sent[0].title).toContain('1 home');
    const data = sent[0].data as { alertCount: number; distinctSubjects: number };
    expect(data.alertCount).toBe(2);
    expect(data.distinctSubjects).toBe(1);

    // Every alert points at the digest that carried it — "enlace a todos".
    const after = await alertsFor(owner);
    expect(after.every((alert) => alert.notificationId === sent[0].id)).toBe(true);
    expect(after.every((alert) => alert.deliveryState === 'delivered')).toBe(true);
  });

  it('re-running the same digest window sends nothing further', async () => {
    const owner = oxy();
    await createWatch(owner, 'Eixample', { cadence: 'daily' });
    await matchDomainEvent(await recordEvent(), db);

    await deliverDueDigests('daily', db);
    const second = await deliverDueDigests('daily', db);

    expect(second.delivered).toBe(0);
    expect(await notificationsFor(owner)).toHaveLength(1);
  });

  it('leaves another cadence\'s pending alerts alone', async () => {
    // A pending alert whose watch is weekly must not arrive inside somebody's
    // daily digest. The bug this guards is a digest that reads every `pending`
    // row rather than every pending row FOR THIS CADENCE.
    const owner = oxy();
    await createWatch(owner, 'Weekly area', { cadence: 'weekly' });
    await matchDomainEvent(await recordEvent(), db);

    const daily = await deliverDueDigests('daily', db);
    expect(daily.delivered).toBe(0);

    const weekly = await deliverDueDigests('weekly', db);
    expect(weekly.delivered).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Privacidad
// ---------------------------------------------------------------------------

describe('privacy', () => {
  it('publishes no coordinates in a notification', async () => {
    const owner = oxy();
    await createWatch(owner, 'Eixample');
    await matchDomainEvent(await recordEvent(), db);

    const [notification] = await notificationsFor(owner);
    const serialized = JSON.stringify({
      title: notification.title,
      message: notification.message,
      data: notification.data,
    });
    expect(serialized).not.toContain(String(INSIDE.latitude));
    expect(serialized).not.toContain(String(INSIDE.longitude));
    expect(findUnsafeAlertFields(notification.data)).toEqual([]);
  });

  it('the safety sweep REFUSES a payload carrying a coordinate', async () => {
    // The discriminating half. Asserting only that the payloads we build are
    // clean would pass against a sweep that returns `[]` for everything, which
    // is precisely the "check that cannot distinguish success from failure"
    // shape. Both a field NAME and a coordinate-shaped VALUE, because they are
    // caught by different halves of the sweep.
    expect(findUnsafeAlertFields({ detail: { latitude: 41.3851 } })).toHaveLength(1);
    expect(findUnsafeAlertFields({ detail: { propertyLatitude: 1 } })).toHaveLength(1);
    expect(findUnsafeAlertFields({ detail: { listingTitle: '41.3851, 2.1734' } })).toHaveLength(1);
    // …and reports the PATH, never the value — a violation is itself logged.
    expect(findUnsafeAlertFields({ detail: { listingTitle: '41.3851, 2.1734' } })[0]).not.toContain(
      '41.3851',
    );
  });

  it('describes an eviction by a STATED radius, with no unit and no household', async () => {
    // ADR 0003 §7.1/§7.2. `eviction_nearby` cannot be enabled today (its
    // producer belongs to #358), so this asserts the EXPLANATION's shape at the
    // narrative boundary — which is the part that would leak if the rule were
    // switched on tomorrow with a producer wired to it.
    const { alertNarrative } = await import('../../services/watches/alertNarrative');
    const narrative = alertNarrative(
      {
        watchName: 'Eixample',
        watchId: 'watch-1',
        ruleType: 'eviction_nearby',
        ruleVersion: 1,
        detail: {
          kind: 'eviction_nearby',
          approximateRadiusMeters: 500,
          areaLabel: 'Eixample',
        },
      },
      'discreet',
    );

    expect(narrative.message).toContain('about 500 m');
    expect(narrative.message).toContain('Eixample');
    // The discreet lock-screen text names NOTHING — not the area, not the kind
    // of change. Somebody reading over a shoulder learns this person uses
    // Homiio, which the app icon already tells them.
    expect(narrative.push.body).not.toContain('Eixample');
    expect(narrative.push.body).not.toContain('eviction');
  });

  it('names the listing on the lock screen only when the watch asked for detail', async () => {
    const { alertNarrative } = await import('../../services/watches/alertNarrative');
    const explanation = {
      watchName: 'Eixample',
      watchId: 'watch-1',
      ruleType: 'new_listing' as const,
      ruleVersion: 1,
      detail: {
        kind: 'new_listing' as const,
        listingTitle: 'Bright flat on Carrer de Mallorca',
        offering: 'long_term_rent',
      },
    };
    expect(alertNarrative(explanation, 'discreet').push.body).not.toContain('Mallorca');
    expect(alertNarrative(explanation, 'detailed').push.body).toContain('Mallorca');
  });
});

// ---------------------------------------------------------------------------
// Canales
// ---------------------------------------------------------------------------

describe('channels', () => {
  it('delivers in-app and does NOT claim to have pushed', async () => {
    // "Push sin permiso": Homiio registers no device token anywhere, so nothing
    // server-side can reach a lock screen. The watch's stated preference is kept
    // and the delivery record is honest about what actually happened — which is
    // the difference between a missing notification and a pretended one.
    const owner = oxy();
    const watch = await createWatch(owner, 'Eixample', { channels: ['in_app', 'push'] });
    expect(watch.channels).toEqual(['in_app', 'push']);

    await matchDomainEvent(await recordEvent(), db);

    const [alert] = await alertsFor(owner);
    expect(alert.deliveryState).toBe('delivered');
    expect(alert.deliveredChannels).toEqual(['in_app']);
    // The push TEXT is still produced, so a client holding a permission grant
    // can present it locally — that is the only push path that exists today.
    const [notification] = await notificationsFor(owner);
    expect((notification.data as { push: { mode: string } }).push.mode).toBe('discreet');
  });

  it('always keeps the in-app channel, whatever the client sent', async () => {
    const owner = oxy();
    const watch = await createWatch(owner, 'Eixample', { channels: ['push'] });
    expect(watch.channels).toContain('in_app');
  });

  it('refuses an unknown channel rather than dropping it', async () => {
    // Silently storing a narrower set than the caller asked for is how somebody
    // ends up believing they enabled a channel that does not exist.
    const response = await request(buildApp(oxy()))
      .post('/saved-searches')
      .send({ name: 'x', query: '', location: EIXAMPLE, channels: ['in_app', 'carrier_pigeon'] });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('INVALID_CHANNELS');
  });
});

// ---------------------------------------------------------------------------
// Reglas no disponibles
// ---------------------------------------------------------------------------

describe('rule availability', () => {
  it('refuses to ENABLE a rule whose source is not reliable yet', async () => {
    // The issue forbids emitting rules that cannot be evaluated. Refusing at the
    // API is what stops a dead switch rendering as a live one — storing it and
    // never firing would look identical to a working subscription.
    const response = await request(buildApp(oxy()))
      .post('/saved-searches')
      .send({
        name: 'evictions',
        query: '',
        location: EIXAMPLE,
        alertRules: [{ type: 'eviction_nearby', enabled: true }],
      });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('RULE_UNAVAILABLE');
  });

  it('accepts the same rule DISABLED, so a stored preference survives', async () => {
    const response = await request(buildApp(oxy()))
      .post('/saved-searches')
      .send({
        name: 'evictions off',
        query: '',
        location: EIXAMPLE,
        alertRules: [{ type: 'eviction_nearby', enabled: false }],
      });
    expect(response.status).toBe(201);
  });

  it('tells the client which rules may be offered at all', async () => {
    const watch = await createWatch(oxy(), 'Eixample');
    expect(watch.availableRuleTypes).toEqual([
      'new_listing',
      'price_decrease',
      'price_increase',
      'cost_terms_changed',
      'listing_removed',
    ]);
  });

  it('never persists an unavailable rule, even disabled', async () => {
    // The repository filters them out entirely. A stored row for a rule nothing
    // evaluates is a promise the product does not keep, and it would read as a
    // subscription forever.
    const watch = await createWatch(oxy(), 'Eixample', {
      rules: [
        { type: 'new_listing', enabled: true },
        { type: 'listing_reappeared', enabled: false },
      ],
    });
    const stored = await db
      .select()
      .from(housingWatchRules)
      .where(eq(housingWatchRules.watchId, String(watch.id)));
    expect(stored.map((rule) => rule.type)).toEqual(['new_listing']);
  });
});

// ---------------------------------------------------------------------------
// alertStatus agrees with the matcher
// ---------------------------------------------------------------------------

describe('alertStatus and the matcher agree', () => {
  it('says `no_area` for a place with no extent — and matches nothing', async () => {
    // Two assertions on one condition, on purpose: the DTO and the matcher are
    // two expressions of one predicate, and a status reading "active" over a
    // watch that matches nothing is exactly what nothing else would catch.
    const owner = oxy();
    const watch = await createWatch(owner, 'Barcelona', { location: CITY_WITHOUT_BOUNDS });
    expect(watch.hasArea).toBe(false);
    expect(watch.alertStatus).toEqual({ status: 'inactive', reason: 'no_area' });

    const outcome = await matchDomainEvent(await recordEvent(), db);
    expect(outcome.matched).toBe(0);
  });

  it('says `location_needs_confirmation` for a legacy row — and matches nothing', async () => {
    // ADR 0002 §11.5: the preference is STORED and the watch stays silent. It is
    // not refused, because refusing would leave the prompt with nothing to
    // prompt about.
    const owner = oxy();
    const created = await request(buildApp(owner))
      .post('/saved-searches')
      .send({ name: 'legacy', query: 'Barcelona', notificationsEnabled: true });
    expect(created.status).toBe(201);
    expect(created.body.data.notificationsEnabled).toBe(true);
    expect(created.body.data.locationStatus).toBe('needs_confirmation');
    // `location_needs_confirmation`, NOT `legacy_query_version`, and the
    // distinction is the whole reason `query_version` exists as a column. A row
    // saved TODAY with no location is a deliberate text-only search on the
    // current contract; a row from before #352 holds a place LABEL in `query`
    // and cannot be read at all. Both have `location IS NULL`, so without the
    // version there would be no way to tell them apart — and the second is the
    // one that must never be re-geocoded on the user's behalf.
    expect(created.body.data.queryVersion).toBe(2);
    expect(created.body.data.alertStatus.reason).toBe('location_needs_confirmation');

    const outcome = await matchDomainEvent(await recordEvent(), db);
    expect(outcome.matched).toBe(0);
  });

  it('says `cadence_off` for a saved search that is not a watch', async () => {
    const watch = await createWatch(oxy(), 'Just saved', { cadence: 'off' });
    expect(watch.alertStatus).toEqual({ status: 'inactive', reason: 'cadence_off' });
  });

  it('says `no_rules_enabled` when every rule is switched off', async () => {
    const watch = await createWatch(oxy(), 'Nothing on', {
      rules: [{ type: 'new_listing', enabled: false }],
    });
    expect(watch.alertStatus).toEqual({ status: 'inactive', reason: 'no_rules_enabled' });
  });

  it('says `active` when everything lines up', async () => {
    const watch = await createWatch(oxy(), 'Working');
    expect(watch.alertStatus).toEqual({ status: 'active' });
  });
});

// ---------------------------------------------------------------------------
// Área principal, deep link, historial
// ---------------------------------------------------------------------------

describe('the watch surface #353 and the push deep link read', () => {
  it('keeps at most ONE primary area per person, and moves it on request', async () => {
    const owner = oxy();
    const first = await createWatch(owner, 'Gràcia', { isPrimaryArea: true });
    const second = await createWatch(owner, 'Sants', { isPrimaryArea: true });

    const listed = await request(buildApp(owner)).get('/saved-searches');
    const primary = (listed.body.data as { id: string; isPrimaryArea: boolean }[]).filter(
      (row) => row.isPrimaryArea,
    );
    expect(primary).toHaveLength(1);
    expect(primary[0].id).toBe(second.id);
    expect(primary[0].id).not.toBe(first.id);
  });

  it('round-trips its deep link through ADR 0002\'s own parser', async () => {
    const watch = await createWatch(oxy(), 'Eixample');
    const token = watch.locToken;
    expect(typeof token).toBe('string');

    const parsed = parseLocationToken(String(token));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('unreachable');
    expect(parsed.value.kind).toBe('bounds');
    if (parsed.value.kind !== 'bounds') throw new Error('unreachable');
    // The SAME box, not a wider one. A link that reopened a superset of the
    // watched area would be worse than no link.
    expect(parsed.value.bounds).toEqual({ west: 2.15, south: 41.38, east: 2.19, north: 41.4 });
  });

  it('emits no deep link for a selection the grammar cannot express', async () => {
    // A drawn polygon: ADR 0002 §2.1 reserves its wire format. Degrading it to
    // its bounding box would WIDEN the area the link reopens, so the honest
    // answer is no link.
    const watch = await createWatch(oxy(), 'Drawn', {
      location: {
        kind: 'polygon',
        polygon: {
          type: 'Polygon',
          coordinates: [
            [
              [2.15, 41.38],
              [2.19, 41.38],
              [2.19, 41.4],
              [2.15, 41.4],
              [2.15, 41.38],
            ],
          ],
        },
        bounds: { west: 2.15, south: 41.38, east: 2.19, north: 41.4 },
        label: { primary: 'Drawn area', kind: 'generated' },
        precision: 'area',
      },
    });
    expect(watch.locToken).toBeUndefined();
    // …and it still WATCHES, because a stored polygon needs no URL form.
    expect(watch.hasArea).toBe(true);
    expect(watch.alertStatus).toEqual({ status: 'active' });
  });

  it('serves an in-app history, scoped to its owner', async () => {
    const owner = oxy();
    const stranger = oxy();
    await createWatch(owner, 'Eixample');
    await matchDomainEvent(await recordEvent(), db);

    const mine = await request(buildApp(owner)).get('/alerts');
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);

    const theirs = await request(buildApp(stranger)).get('/alerts');
    expect(theirs.body.data).toHaveLength(0);
  });

  it('answers "why did I get this?" from the STORED explanation', async () => {
    const owner = oxy();
    const watch = await createWatch(owner, 'Eixample');
    await matchDomainEvent(await recordEvent(), db);
    const [alert] = await alertsFor(owner);

    const why = await request(buildApp(owner)).get(`/alerts/${alert.id}`);
    expect(why.status).toBe(200);
    expect(why.body.data.alert.explanation.watchName).toBe('Eixample');
    expect(why.body.data.alert.ruleVersion).toBe(1);
    expect(why.body.data.watch.id).toBe(watch.id);
    expect(why.body.data.event.type).toBe('new_listing');
  });

  it('refuses somebody else\'s alert with a 404', async () => {
    const owner = oxy();
    await createWatch(owner, 'Eixample');
    await matchDomainEvent(await recordEvent(), db);
    const [alert] = await alertsFor(owner);

    const theirs = await request(buildApp(oxy())).get(`/alerts/${alert.id}`);
    expect(theirs.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Listing duplicado entre portales
// ---------------------------------------------------------------------------

describe('the same dwelling advertised on two portals', () => {
  it('produces TWO alerts today, which is why `source_conflict` is unavailable', async () => {
    // The honest current behaviour, asserted rather than wished away. Homiio has
    // no cross-source dwelling identity (ADR 0001 names the housing graph as its
    // future home), so two portal ads for one flat are two `properties` rows and
    // therefore two subjects. The dedupe is per SUBJECT and correctly does not
    // collapse them.
    //
    // Two things stop this being a flood in practice, and neither closes the
    // gap: the ingest's own `LISTING_DEDUP_ENABLED` skip, which never creates
    // the second row and so never records a second event, and the per-watch
    // delivery cap. When cross-source identity lands, this test should start
    // failing — that is what makes it a marker rather than an endorsement.
    const owner = oxy();
    await createWatch(owner, 'Eixample');

    await matchDomainEvent(
      await recordEvent({ subjectId: 'idealista-1', transition: { title: 'Flat, 3rd floor' } }),
      db,
    );
    await matchDomainEvent(
      await recordEvent({ subjectId: 'fotocasa-9', transition: { title: 'Flat, 3rd floor' } }),
      db,
    );

    expect(await alertsFor(owner)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// El sweep está realmente conectado
// ---------------------------------------------------------------------------

describe('the sweep', () => {
  it('drains the queue and marks what it processed', async () => {
    const owner = oxy();
    await createWatch(owner, 'Eixample');
    await recordEvent();
    await recordEvent();

    const result = await runHousingAlertSweep(db);
    expect(result.claimed).toBeGreaterThanOrEqual(2);
    expect(result.delivered).toBeGreaterThanOrEqual(2);

    const unprocessed = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(housingDomainEvents)
      .where(sql`${housingDomainEvents.processedAt} is null`);
    expect(unprocessed[0].value).toBe(0);
  });

  it('is reachable from the cron wiring, with the REAL registry behind it', async () => {
    // The seam that connects "a job named housingAlerts is scheduled" to "the
    // sweep works". Without it both are true of a job wired to nothing.
    const owner = oxy();
    await createWatch(owner, 'Eixample');
    await recordEvent();

    const { runHousingAlertSweepNow } = await import('../../services/cron');
    await runHousingAlertSweepNow();

    expect(await alertsFor(owner)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// The producer's own path
// ---------------------------------------------------------------------------

describe('the producer', () => {
  it('records a price transition as a FACT, and the matcher turns it into an alert', async () => {
    const owner = oxy();
    await createWatch(owner, 'Eixample', {
      rules: [{ type: 'price_decrease', enabled: true, threshold: 1 }],
    });

    const { recordPropertyChangeEvents } = await import(
      '../../services/watches/propertyEventProducer'
    );
    const before = {
      id: `property-${uuidv7()}`,
      title: 'Bright flat',
      offering: 'long_term_rent',
      rentAmount: 1350,
      rentCurrency: 'EUR',
      saleAmount: null,
      saleCurrency: null,
      deposit: 2700,
      utilities: null,
      longitude: INSIDE.longitude,
      latitude: INSIDE.latitude,
    };
    await recordPropertyChangeEvents(before, { ...before, rentAmount: 1250, deposit: 2500 }, db);

    // TWO facts: a price move and a cost-terms move. They are different
    // questions people subscribe to separately, so collapsing them would force
    // somebody who only wants price drops to hear about deposits.
    const events = await db
      .select()
      .from(housingDomainEvents)
      .where(eq(housingDomainEvents.subjectId, before.id));
    expect(events.map((event) => event.type).sort()).toEqual([
      'cost_terms_changed',
      'price_decrease',
    ]);

    await runHousingAlertSweep(db);
    const alerts = await alertsFor(owner);
    // Only the price rule is enabled on this watch, so only one alert.
    expect(alerts).toHaveLength(1);
    expect(alerts[0].ruleType).toBe('price_decrease');
  });

  it('never publishes a deposit AMOUNT, only that it changed', async () => {
    // WHICH terms moved, never their values. A deposit is a number about a
    // specific negotiation and the alert's job is "go and look".
    const owner = oxy();
    await createWatch(owner, 'Eixample', {
      rules: [{ type: 'cost_terms_changed', enabled: true }],
    });

    const { recordPropertyChangeEvents } = await import(
      '../../services/watches/propertyEventProducer'
    );
    const before = {
      id: `property-${uuidv7()}`,
      title: 'Flat',
      offering: 'long_term_rent',
      rentAmount: 1200,
      rentCurrency: 'EUR',
      saleAmount: null,
      saleCurrency: null,
      deposit: 2400,
      utilities: null,
      longitude: INSIDE.longitude,
      latitude: INSIDE.latitude,
    };
    await recordPropertyChangeEvents(before, { ...before, deposit: 9999 }, db);
    await runHousingAlertSweep(db);

    const [notification] = await notificationsFor(owner);
    expect(notification.message).toContain('deposit');
    expect(JSON.stringify(notification)).not.toContain('9999');
  });
});

// ---------------------------------------------------------------------------
// Legacy migration
// ---------------------------------------------------------------------------

describe('legacy saved searches', () => {
  it('demotes a row with no canonical selection to query version 1', async () => {
    // What migration 0012's `UPDATE` does, asserted against the rule rather than
    // against the migration text: a row with no selection cannot be evaluated,
    // and this is the only evidence a stored row carries about which contract it
    // was written under.
    const owner = oxy();
    const [legacy] = await db
      .insert(savedSearchesTable)
      .values({ oxyUserId: owner, name: 'Barcelona', query: 'Barcelona', queryVersion: 1 })
      .returning();

    const listed = await request(buildApp(owner)).get('/saved-searches');
    const row = (listed.body.data as { id: string; alertStatus: { reason: string } }[]).find(
      (entry) => entry.id === legacy.id,
    );
    expect(row?.alertStatus.reason).toBe('cadence_off');

    // Even with alerting switched on, it stays silent and says why.
    await db
      .update(savedSearchesTable)
      .set({ cadence: 'instant', notificationsEnabled: true })
      .where(eq(savedSearchesTable.id, legacy.id));
    const again = await request(buildApp(owner)).get('/saved-searches');
    const row2 = (again.body.data as { id: string; alertStatus: { reason: string } }[]).find(
      (entry) => entry.id === legacy.id,
    );
    expect(row2?.alertStatus.reason).toBe('legacy_query_version');

    const outcome = await matchDomainEvent(await recordEvent(), db);
    expect(outcome.matched).toBe(0);
  });

  it('confirming a location promotes the row and it starts working', async () => {
    const owner = oxy();
    const [legacy] = await db
      .insert(savedSearchesTable)
      .values({ oxyUserId: owner, name: 'Barcelona', query: 'Barcelona', queryVersion: 1 })
      .returning();

    // The confirmation the UI performs: the user picks WHICH Barcelona, and the
    // row is written with the canonical selection and promoted to the current
    // contract. Nothing is geocoded on the row's behalf.
    await db
      .update(savedSearchesTable)
      .set({ queryVersion: 2 })
      .where(eq(savedSearchesTable.id, legacy.id));
    const confirmed = await request(buildApp(owner))
      .put(`/saved-searches/${legacy.id}`)
      .send({ location: EIXAMPLE, cadence: 'instant' });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.alertStatus).toEqual({ status: 'active' });

    await matchDomainEvent(await recordEvent(), db);
    expect(await alertsFor(owner)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

describe('ownership', () => {
  it('never delivers one person\'s alert to another', async () => {
    const owner = oxy();
    const stranger = oxy();
    await createWatch(owner, 'Eixample');
    await createWatch(stranger, 'Madrid', {
      location: {
        kind: 'map_bounds',
        bounds: { west: -3.75, south: 40.39, east: -3.65, north: 40.45 },
        center: { longitude: -3.7, latitude: 40.42 },
        label: { primary: 'Madrid centro', kind: 'generated' },
        precision: 'area',
      },
    });

    await matchDomainEvent(await recordEvent(), db);

    expect(await alertsFor(owner)).toHaveLength(1);
    expect(await alertsFor(stranger)).toHaveLength(0);
  });

  it('refuses to let a stranger mute somebody else\'s watch', async () => {
    const owner = oxy();
    const watch = await createWatch(owner, 'Eixample');

    const hijack = await request(buildApp(oxy()))
      .put(`/saved-searches/${watch.id}`)
      .send({ cadence: 'off' });
    expect(hijack.status).toBe(404);

    const [row] = await db
      .select()
      .from(savedSearchesTable)
      .where(and(eq(savedSearchesTable.id, String(watch.id)), eq(savedSearchesTable.oxyUserId, owner)));
    expect(row.cadence).toBe('instant');
  });
});
