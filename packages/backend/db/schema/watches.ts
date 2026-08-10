/**
 * The alerting half of a saved housing watch — issue #356.
 *
 * `saved_searches` (in `./saved`) is the watch itself: this module adds the
 * three tables that turn one into something that speaks, and it is deliberately
 * a SEPARATE file from `saved.ts` because the lifetimes differ. A watch is a
 * person's stored intent and lives until they delete it; an event is a fact
 * about the catalogue and expires; an alert is a delivery record and is
 * retained on its own schedule.
 *
 * ## The four stages the issue asks to be kept apart, as four things
 *
 * | Stage | Where it lives |
 * |---|---|
 * | Domain fact | {@link housingDomainEvents} — "this listing's rent moved" |
 * | Match | the matcher's query, joining a watch's AREA to an event's point |
 * | Delivery | {@link housingAlerts}, plus `notifications` via the one chokepoint |
 * | Dedupe | {@link housingAlerts}'s two unique indexes, below |
 *
 * Keeping the fact separate from the delivery is what makes "el mismo evento
 * entregado dos veces al dispatcher" answerable at all: with one row per
 * (watch, transition) the second delivery has nowhere to land, and with a
 * per-user diff of full search responses — the shape the issue rules out — there
 * is no transition to be idempotent about.
 *
 * ## Dedupe is TWO indexes because it is two different questions
 *
 * **`housing_alerts_idempotency_key`** answers "have I already told this person
 * about THIS EXACT transition?". The key is a hash of the watch, the rule and
 * the transition (see `alertIdempotencyKey`), so re-delivering the same event —
 * a retried job, a re-ingest that produces an identical before/after pair, two
 * workers racing — collapses onto one row. It is a UNIQUE INDEX and not a read
 * before the insert, because a read-then-write has a window that two concurrent
 * matchers both pass. This is the constraint the issue's last mandatory test
 * demands be mutation-tested.
 *
 * **`housing_alerts_cooldown_key`** answers the different question "have I told
 * this person about this SUBJECT under this rule recently?". Oscillation slips
 * past the first index by construction: a portal republishing 1350 → 1250 → 1360
 * → 1250 produces three genuinely distinct transitions, all real, none a
 * duplicate of another. Only a time window catches that, so the window is part
 * of a unique key rather than a query — same reasoning as above, one level up.
 *
 * `cooldown_bucket` is NULLABLE and that is load-bearing rather than lax:
 * Postgres unique indexes are `NULLS DISTINCT` by default, so any number of rows
 * may hold NULL, which is exactly the behaviour a rule with no cooldown needs
 * (`HOUSING_ALERT_RULE_SPECS[type].cooldownHours === 0`). The alternative — a
 * sentinel bucket value — would make every no-cooldown rule fire once per
 * subject FOREVER, which is the opposite of what it means. `__tests__/db` carries
 * the explicit-NULL fixture, because a suite whose rules all have windows cannot
 * tell this schema from one where the column is `NOT NULL`.
 */

import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, geography, inList, timestamptz, updatedAt } from '@oxyhq/db';
import {
  ALERT_DELIVERY_STATES,
  ALERT_SUPPRESSION_REASONS,
  HOUSING_ALERT_RULE_TYPES,
} from '@homiio/shared-types';
import { notifications } from './notifications';
import { savedSearches } from './saved';

/**
 * What an event is ABOUT.
 *
 * Polymorphic with no foreign key, following `images.entity_id`'s precedent and
 * for the same stated reason: the discriminator spans several nouns, so there is
 * no single parent to name. `saved_items.target_id` went the other way because
 * its discriminator has exactly one value — the boundary `saved.ts` draws is the
 * one applied here.
 *
 * The consequence is deliberate: an event OUTLIVES its subject. A listing that
 * is reaped by the expiry sweep leaves its `listing_removed` event behind, which
 * is the whole point of that event, and a cascade would delete the record of the
 * thing having happened at the moment it happened.
 */
export const HOUSING_EVENT_SUBJECT_TYPES = ['property', 'address', 'eviction', 'review'] as const;

export const housingDomainEvents = pgTable(
  'housing_domain_events',
  {
    id: generatedId(),

    /** Which change this is. Same vocabulary the rules subscribe to. */
    type: text({ enum: HOUSING_ALERT_RULE_TYPES }).notNull(),
    subjectType: text({ enum: HOUSING_EVENT_SUBJECT_TYPES }).notNull(),
    subjectId: text().notNull(),

    /**
     * The transition, as the producer saw it.
     *
     * A hash of this is what makes an alert idempotent, so it must contain
     * everything that distinguishes one transition from another and NOTHING
     * that varies between two observations of the same transition. A timestamp
     * in here would make every re-delivery a new transition and retire the
     * dedupe silently; the producers therefore build it from before/after
     * values only. `db/watches/domainEvents.ts` is the one place that decides.
     */
    transition: jsonb().notNull().default({}),

    /**
     * WHERE the fact happened, at the precision the matcher needs and no finer.
     *
     * A separate pair of columns rather than a join to `addresses`, because the
     * subject may not be a property at all (an eviction is a point with no
     * listing) and because an event must stay interpretable after its subject is
     * gone. It is written from the subject's own stored coordinates and is
     * INTERNAL: ADR 0003 §3.3 applies precision on the way OUT, and nothing here
     * reaches a notification — the explanation union has no coordinate field.
     */
    longitude: doublePrecision(),
    latitude: doublePrecision(),
    geo: geography().generatedAlwaysAs(
      sql`case when longitude is null or latitude is null then null
          else ST_MakePoint(longitude, latitude)::geography end`,
    ),

    /**
     * Whether this event came from a BULK indexing run rather than from a real
     * change somebody would want to hear about.
     *
     * The matcher refuses a backfill event outright. It is the mechanism behind
     * "no notificar la primera indexación de todo el catálogo como miles de
     * nuevos", and it protects the case a per-watch `alerts_active_from` cannot:
     * an OLD watch, created months ago, when a provider is enabled and 40,000
     * listings arrive in an afternoon. Every one is genuinely new to Homiio and
     * genuinely inside the watch's area, so nothing but the producer's own
     * knowledge that this was a bulk run can tell them apart.
     */
    isBackfill: boolean().notNull().default(false),

    /**
     * When the change actually happened, which is not when the row was written.
     *
     * A sweep that discovers a change hours later must compare the CHANGE's time
     * against a watch's `alerts_active_from`, or every backlogged event would
     * look like it happened at catch-up time and a watch created in between
     * would be told about changes that predate it.
     */
    occurredAt: timestamptz().notNull().defaultNow(),

    /**
     * When the matcher finished with this event, or NULL while it is queued.
     *
     * The matcher CLAIMS a batch by stamping this, so two workers running the
     * sweep concurrently do not both fan out over the same events. It is not the
     * dedupe — that is `housing_alerts`' unique index, and it holds whatever
     * happens here — it is a cost control, which is why a claim that is lost to a
     * crash is harmless: the event is picked up again and every alert it would
     * have produced converges on the row that already exists.
     */
    processedAt: timestamptz(),

    /**
     * When this row may be swept.
     *
     * Registered in `db/expiry.ts`. An event is evidence for an alert that has
     * already been delivered and for the "why did I get this?" answer, so it
     * outlives the delivery by a retention window rather than being deleted with
     * it — and `housing_alerts.event_id` is `SET NULL` so the alert survives the
     * sweep with its own stored explanation intact.
     */
    expiresAt: timestamptz(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /**
     * The matcher's entry point: unprocessed events, oldest first.
     *
     * PARTIAL on `processed_at is null`, so it holds the QUEUE rather than the
     * history — the set it indexes shrinks as work is done instead of growing
     * with the catalogue.
     */
    index('housing_domain_events_unprocessed_idx')
      .on(table.occurredAt)
      .where(sql`${table.processedAt} is null`),
    /** The spatial half of the match, from the event's side. */
    index('housing_domain_events_geo_gist')
      .using('gist', table.geo)
      .where(sql`${table.geo} is not null`),
    /** "What has happened to this listing?", for the digest's grouping. */
    index('housing_domain_events_subject_idx').on(
      table.subjectType,
      table.subjectId,
      sql`${table.occurredAt} desc`,
    ),
    index('housing_domain_events_expires_at_idx')
      .on(table.expiresAt)
      .where(sql`${table.expiresAt} is not null`),
    check(
      'housing_domain_events_type_check',
      sql`${table.type} in (${sql.raw(inList(HOUSING_ALERT_RULE_TYPES))})`,
    ),
    check(
      'housing_domain_events_subject_type_check',
      sql`${table.subjectType} in (${sql.raw(inList(HOUSING_EVENT_SUBJECT_TYPES))})`,
    ),
    /**
     * A coordinate is a PAIR or it is absent. Half of one is a point in the
     * Atlantic waiting to happen — the same `(0, 0)` failure `PlaceGeometry`
     * removed from the location contract, arriving through a different door.
     */
    check(
      'housing_domain_events_coordinate_pair_check',
      sql`(${table.longitude} is null) = (${table.latitude} is null)`,
    ),
    check(
      'housing_domain_events_coordinate_range_check',
      sql`${table.longitude} is null or (
        ${table.longitude} between -180 and 180 and ${table.latitude} between -90 and 90
      )`,
    ),
  ],
);

/**
 * One rule subscription per watch.
 *
 * A CHILD TABLE rather than a `jsonb` array on the watch, and the test
 * `CONVENTIONS.md` sets decides it: `jsonb` is for shapes that are genuinely
 * open (`filters`, whose contents are whatever the search UI supported that
 * day). A rule is the opposite — a closed vocabulary with a CHECK, a boolean and
 * a number — and the matcher's central query is "which watches have rule X
 * enabled", which is an indexed join here and a `@>` containment probe there.
 *
 * The unique on `(watch_id, type)` is what makes a rule set a SET: without it,
 * `price_decrease` could be present twice with different thresholds and the
 * matcher would fire twice for one move, differing only in the threshold it
 * happened to read first.
 */
export const housingWatchRules = pgTable(
  'housing_watch_rules',
  {
    id: generatedId(),
    watchId: text()
      .notNull()
      .references(() => savedSearches.id, { onDelete: 'cascade' }),
    type: text({ enum: HOUSING_ALERT_RULE_TYPES }).notNull(),
    enabled: boolean().notNull().default(false),
    /**
     * Minimum percent move, for the two price rules.
     *
     * NULL means "use the rule's default" rather than "no threshold" — the two
     * are different and only one of them is expressible if zero were the
     * absent value, since a zero threshold legitimately means "any move at all".
     */
    threshold: doublePrecision(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('housing_watch_rules_watch_type_key').on(table.watchId, table.type),
    /**
     * The matcher's fan-out, from the RULE side: "every watch subscribing to
     * this rule". PARTIAL on `enabled`, because a disabled rule is a stored
     * preference and never a candidate — and because a watch carries a row for
     * every available rule, so the disabled ones are the majority.
     */
    index('housing_watch_rules_type_enabled_idx')
      .on(table.type)
      .where(sql`${table.enabled}`),
    check(
      'housing_watch_rules_type_check',
      sql`${table.type} in (${sql.raw(inList(HOUSING_ALERT_RULE_TYPES))})`,
    ),
    /**
     * A percent, not a ratio and not a fraction.
     *
     * `sql.raw` on the constant side deliberately: a value interpolated into a
     * `check()` template is written into the generated migration as the literal
     * bound-parameter placeholder `$1`, and DDL cannot carry a parameter — the
     * migration then fails at APPLY time, long after `drizzle-kit generate`
     * reported success.
     */
    check(
      'housing_watch_rules_threshold_check',
      sql.raw('threshold is null or (threshold >= 0 and threshold <= 1000)'),
    ),
  ],
);

/**
 * One alert: a matched event, its explanation, and what happened to it.
 *
 * Carries everything the issue's list requires — source event, matching watch,
 * rule version, timestamp, idempotency key, delivery state and a safe
 * explanation — and it carries the EXPLANATION rather than a pointer to
 * something that could later re-render it differently. That is what makes "por
 * qué recibí esto" answerable months later, after the listing has been reaped
 * and the rules have moved on.
 */
export const housingAlerts = pgTable(
  'housing_alerts',
  {
    id: generatedId(),

    watchId: text()
      .notNull()
      .references(() => savedSearches.id, { onDelete: 'cascade' }),
    /**
     * Denormalized from the watch.
     *
     * Not redundancy for its own sake: the mailbox is per PERSON, so "my alert
     * history" must be answerable without joining through a watch that the
     * cascade above may already have removed — and it is the column the
     * per-user rate limit counts.
     */
    oxyUserId: text().notNull(),

    /**
     * SET NULL, not CASCADE. An alert outlives the event that caused it: the
     * event expires on the retention schedule and the alert keeps its own stored
     * explanation, so a history entry never becomes a dangling "something
     * changed".
     */
    eventId: text().references(() => housingDomainEvents.id, { onDelete: 'set null' }),

    ruleType: text({ enum: HOUSING_ALERT_RULE_TYPES }).notNull(),
    ruleVersion: integer().notNull(),

    /**
     * The transition dedupe key — see the module header.
     *
     * `NOT NULL` deliberately. A nullable column under a plain unique index is
     * `NULLS DISTINCT`, so every NULL row would be accepted and the dedupe would
     * hold for every alert except the ones whose key somebody forgot to compute.
     * The cooldown key below relies on exactly that behaviour and says so; this
     * one must not.
     */
    idempotencyKey: text().notNull(),

    /** What the alert is about, for the cooldown and for the digest's grouping. */
    subjectType: text({ enum: HOUSING_EVENT_SUBJECT_TYPES }).notNull(),
    subjectId: text().notNull(),
    /**
     * The start of the cooldown window this alert claimed, or NULL for a rule
     * with no cooldown. NULLABLE on purpose — see the module header.
     */
    cooldownBucket: timestamptz(),

    /**
     * The `AlertExplanation` as published.
     *
     * `jsonb` and one of the small set that earns it: it is a discriminated
     * union whose arms carry different fields, so flattening it into columns
     * would make every new explanation variant a migration. Written ONLY through
     * `db/watches/alertRepository.ts`, which runs `findUnsafeAlertFields` over
     * it first — the schema cannot express "carries no coordinate", so the
     * single writer does.
     */
    explanation: jsonb().notNull(),

    deliveryState: text({ enum: ALERT_DELIVERY_STATES }).notNull().default('pending'),
    /** Why it was suppressed, when it was. NULL for every other state. */
    suppressionReason: text({ enum: ALERT_SUPPRESSION_REASONS }),
    /** Which channels actually delivered. Empty until delivery is attempted. */
    deliveredChannels: text().array().notNull().default(sql`'{}'::text[]`),
    deliveredAt: timestamptz(),
    /**
     * The mailbox row, when one was written.
     *
     * SET NULL: a person clearing their notifications must not delete their
     * alert history, and the history is what "why did I get this?" reads.
     */
    notificationId: text().references(() => notifications.id, { onDelete: 'set null' }),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /** THE dedupe. Dropping this index must turn the suite red — see the header. */
    uniqueIndex('housing_alerts_idempotency_key').on(table.idempotencyKey),
    /** The oscillation guard. NULL buckets are distinct, which is the point. */
    uniqueIndex('housing_alerts_cooldown_key').on(
      table.watchId,
      table.ruleType,
      table.subjectType,
      table.subjectId,
      table.cooldownBucket,
    ),
    /** The user's alert history, newest first. */
    index('housing_alerts_owner_created_idx').on(
      table.oxyUserId,
      sql`${table.createdAt} desc`,
    ),
    /** One watch's history, for the grouped view the UX asks for. */
    index('housing_alerts_watch_created_idx').on(
      table.watchId,
      sql`${table.createdAt} desc`,
    ),
    /**
     * The digest's work list: what is still waiting to be sent.
     *
     * PARTIAL on `pending`, so it is the size of the outstanding queue rather
     * than of the whole history.
     */
    index('housing_alerts_pending_idx')
      .on(table.oxyUserId, table.createdAt)
      .where(sql`${table.deliveryState} = 'pending'`),
    check(
      'housing_alerts_rule_type_check',
      sql`${table.ruleType} in (${sql.raw(inList(HOUSING_ALERT_RULE_TYPES))})`,
    ),
    check(
      'housing_alerts_subject_type_check',
      sql`${table.subjectType} in (${sql.raw(inList(HOUSING_EVENT_SUBJECT_TYPES))})`,
    ),
    check(
      'housing_alerts_delivery_state_check',
      sql`${table.deliveryState} in (${sql.raw(inList(ALERT_DELIVERY_STATES))})`,
    ),
    check(
      'housing_alerts_suppression_reason_check',
      sql`${table.suppressionReason} is null or ${table.suppressionReason} in (${sql.raw(
        inList(ALERT_SUPPRESSION_REASONS),
      )})`,
    ),
    /**
     * A suppression names its reason, and nothing else carries one.
     *
     * A biconditional here rather than a one-way implication, and it is safe in
     * a way the eviction-schedule constraint was not: `suppressed` has exactly
     * one meaning and every writer of it is in one repository function, so
     * unlike a variant set that later grew a second member, there is no second
     * shape this can be wrong about.
     */
    check(
      'housing_alerts_suppression_coherence_check',
      sql`(${table.deliveryState} = 'suppressed') = (${table.suppressionReason} is not null)`,
    ),
    /**
     * A delivered alert names at least one channel it reached.
     *
     * `cardinality`, NOT `array_length`: `array_length(col, 1)` returns NULL for
     * an empty array, `NULL >= 1` is NULL, and a CHECK rejects only FALSE — so
     * the obvious spelling ACCEPTS the empty array it was written to forbid.
     * `cardinality` returns 0 and behaves.
     */
    check(
      'housing_alerts_delivered_channels_check',
      sql`${table.deliveryState} <> 'delivered' or cardinality(${table.deliveredChannels}) >= 1`,
    ),
  ],
);
