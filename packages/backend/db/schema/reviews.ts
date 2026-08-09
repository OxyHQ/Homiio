/**
 * `reviews` and its two child tables — the public address rating (reviucasa
 * parity).
 *
 * Ported from `models/Review.ts` (872 lines, 13 Mongo indexes). Empty in
 * production, which is what makes the constraints below expressible: every one
 * of them is a rule the source declared as a VALIDATOR, and a Mongoose validator
 * does not run on an update in this package.
 *
 * ## The four-level address hierarchy is the shape of this table
 *
 * A review is attached at BUILDING or UNIT level and carries a denormalized
 * reference to each level above it (`street_level_id`, `building_level_id`,
 * `unit_level_id`) so an aggregation can roll up without walking the tree. Those
 * are NOT a Mongo workaround that stops travelling — they are the group keys of
 * every explore aggregation, and re-deriving them per row would put a recursive
 * join inside a `GROUP BY`.
 *
 * `addresses.address_level` is a GENERATED column, so the level a review claims
 * and the level its address actually is can be checked against each other. Doing
 * that check in the database would need a subquery, which a CHECK may not
 * contain; what IS expressible — and what Mongo's validator was actually about —
 * is the relationship between `address_level` and `unit_level_id`, below.
 *
 * ## Two embedded arrays become tables, and both gain a constraint Mongo lacked
 *
 * `helpfulVoters[]` is a `[String]` set maintained with `$addToSet`/`$pull`, and
 * its LENGTH is the helpful count the DTO publishes. `reports[]` is a
 * `{ _id: false }` array whose length crossing three flips the review into
 * `under_review`. Both are read-modify-write sets whose "have they already?"
 * check races its own write; as tables with a unique key, the second attempt
 * fails on the insert instead.
 *
 * ## What is deliberately NOT ported
 *
 * Mongo's `{ rating: -1 }`, `{ recommendation: 1 }` and `{ verified: 1 }` —
 * three single-field indexes on columns with two, two and five distinct values,
 * and no query in this package filters or sorts by any of them alone. Every read
 * is scoped by an address, a city, a neighborhood or an agency first. A btree
 * nothing chooses is a write cost with no read.
 */

import { bigint, boolean, check, doublePrecision, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, textArrayLiteral, timestamptz, updatedAt } from '@oxyhq/db';
import { PAYMENT_CURRENCIES } from '@homiio/shared-types';
import type {
  CleaningRating,
  ConditionRating,
  DepositReturn,
  LandlordTreatment,
  LightLevel,
  NeighborRating,
  NeighborRelations,
  NoiseLevel,
  ResponseRating,
  ReviewModerationStatus,
  ReviewReportReason,
  SecurityLevel,
  ServiceType,
  TemperatureRating,
  TouristLevel,
} from '@homiio/shared-types';
import { addresses } from './addresses';
import { agencies } from './agencies';
import { cities, neighborhoods } from './geo';

/**
 * The levels a review may be attached at.
 *
 * A SUBSET of `addresses.ADDRESS_LEVELS`, which also has `STREET`: a street is
 * something reviews roll UP to, never something a tenant lived in. Declared
 * separately rather than reused so the narrowing is visible at the constraint.
 */
export const REVIEW_ADDRESS_LEVELS = ['BUILDING', 'UNIT'] as const;

export const TEMPERATURE_RATINGS = [
  'very_cold',
  'cold',
  'moderate',
  'warm',
  'very_warm',
] as const satisfies readonly `${TemperatureRating}`[];

export const NOISE_LEVELS = [
  'very_quiet',
  'quiet',
  'moderate',
  'noisy',
  'very_noisy',
] as const satisfies readonly `${NoiseLevel}`[];

export const LIGHT_LEVELS = [
  'very_dark',
  'dark',
  'moderate',
  'bright',
  'very_bright',
] as const satisfies readonly `${LightLevel}`[];

export const CONDITION_RATINGS = [
  'poor',
  'fair',
  'good',
  'very_good',
  'excellent',
] as const satisfies readonly `${ConditionRating}`[];

export const LANDLORD_TREATMENTS = [
  'very_poor',
  'poor',
  'fair',
  'good',
  'excellent',
] as const satisfies readonly `${LandlordTreatment}`[];

export const RESPONSE_RATINGS = [
  'never_responded',
  'very_slow',
  'slow',
  'reasonable',
  'fast',
  'very_fast',
] as const satisfies readonly `${ResponseRating}`[];

export const NEIGHBOR_RATINGS = [
  'very_unfriendly',
  'unfriendly',
  'neutral',
  'friendly',
  'very_friendly',
] as const satisfies readonly `${NeighborRating}`[];

export const NEIGHBOR_RELATIONS = [
  'very_poor',
  'poor',
  'fair',
  'good',
  'excellent',
] as const satisfies readonly `${NeighborRelations}`[];

export const CLEANING_RATINGS = [
  'very_dirty',
  'dirty',
  'acceptable',
  'clean',
  'very_clean',
] as const satisfies readonly `${CleaningRating}`[];

export const TOURIST_LEVELS = [
  'none',
  'few',
  'moderate',
  'many',
  'overwhelming',
] as const satisfies readonly `${TouristLevel}`[];

export const SECURITY_LEVELS = [
  'very_unsafe',
  'unsafe',
  'neutral',
  'safe',
  'very_safe',
] as const satisfies readonly `${SecurityLevel}`[];

export const SERVICE_TYPES = [
  'internet',
  'cable_tv',
  'parking',
  'laundry',
  'gym',
  'pool',
  'concierge',
  'security',
  'maintenance',
  'cleaning',
] as const satisfies readonly `${ServiceType}`[];

export const DEPOSIT_RETURNS = [
  'full',
  'partial',
  'no',
] as const satisfies readonly `${DepositReturn}`[];

export const REVIEW_MODERATION_STATUSES = [
  'active',
  'under_review',
  'removed',
] as const satisfies readonly `${ReviewModerationStatus}`[];

export const REVIEW_REPORT_REASONS = [
  'fake',
  'offensive',
  'personal_data',
  'spam',
  'other',
] as const satisfies readonly `${ReviewReportReason}`[];

export const reviews = pgTable(
  'reviews',
  {
    id: generatedId(),

    // ── The address hierarchy ──
    //
    // RESTRICT on all five geo references, matching every other reference into
    // the geo chain: an address, city or neighborhood that vanished under a
    // review does not leave a review with a missing place, it leaves a review
    // nobody can find and an aggregate that silently stops counting it. Nothing
    // deletes an address today.
    addressId: text()
      .notNull()
      .references(() => addresses.id, { onDelete: 'restrict' }),
    addressLevel: text({ enum: REVIEW_ADDRESS_LEVELS }).notNull(),
    streetLevelId: text()
      .notNull()
      .references(() => addresses.id, { onDelete: 'restrict' }),
    buildingLevelId: text()
      .notNull()
      .references(() => addresses.id, { onDelete: 'restrict' }),
    /** Set for a UNIT review and NULL for a BUILDING one — see the CHECK below. */
    unitLevelId: text().references(() => addresses.id, { onDelete: 'restrict' }),

    /** Denormalized geo group keys, set server-side from the resolved address. */
    cityId: text().references(() => cities.id, { onDelete: 'restrict' }),
    neighborhoodId: text().references(() => neighborhoods.id, { onDelete: 'restrict' }),

    /**
     * The managing agency, resolved from the submitted name by
     * `Agency.findOrCreateByName`. Never set from a request body.
     *
     * SET NULL, matching `properties.agency_id`: deleting an agency must not
     * delete the reviews about it, and NULL already means "no agency named".
     */
    agencyId: text().references(() => agencies.id, { onDelete: 'set null' }),

    // ── The review ──
    title: text(),
    /** Free text about the building's green space. Optional in the schema. */
    greenHouse: text(),
    price: doublePrecision().notNull(),
    currency: text({ enum: PAYMENT_CURRENCIES }).notNull().default('EUR'),

    livedFrom: timestamptz().notNull(),
    livedTo: timestamptz().notNull(),
    /**
     * Tenancy length in whole months.
     *
     * `bigint`, not `double precision`, and this is one of the few Mongo
     * `Number`s that earns it: the value is never user-supplied — `pre('validate')`
     * computes `Math.ceil(days / 30.44)` on every save, so it is always a whole
     * number generated inside this package. Same exception as
     * `properties.rating_count`.
     */
    livedForMonths: bigint({ mode: 'number' }).notNull(),

    recommendation: boolean().notNull(),
    opinion: text().notNull(),
    /** Structured pros/cons. Scalar arrays, read whole, capped at ten by the controller. */
    prosItems: text().array().notNull().default(sql`'{}'::text[]`),
    consItems: text().array().notNull().default(sql`'{}'::text[]`),
    adviceToAgency: text(),
    adviceToLandlord: text(),
    /** Legacy free-text pros/cons, superseded by the two arrays above. Read-only. */
    positiveComment: text(),
    negativeComment: text(),
    /**
     * Photo URLs.
     *
     * A native `text[]`, NOT the `property_images` treatment: these are bare
     * URLs a reviewer pasted, with no `images` row behind them, no primary flag
     * and no order. There is no per-element fact to record, so a child table
     * would be the over-normalization `CONVENTIONS.md` forbids.
     */
    images: text().array().notNull().default(sql`'{}'::text[]`),
    /** 1-5 stars. `bigint` because Mongo validated `Number.isInteger`. */
    rating: bigint({ mode: 'number' }).notNull(),

    // ── Environmental conditions. Every one optional; NULL means unanswered. ──
    summerTemperature: text({ enum: TEMPERATURE_RATINGS }),
    winterTemperature: text({ enum: TEMPERATURE_RATINGS }),
    noise: text({ enum: NOISE_LEVELS }),
    light: text({ enum: LIGHT_LEVELS }),
    conditionAndMaintenance: text({ enum: CONDITION_RATINGS }),
    services: text().array().notNull().default(sql`'{}'::text[]`),

    // ── Management ──
    landlordTreatment: text({ enum: LANDLORD_TREATMENTS }),
    problemResponse: text({ enum: RESPONSE_RATINGS }),
    depositReturned: text({ enum: DEPOSIT_RETURNS }),

    // ── Neighbours and community ──
    staircaseNeighbors: text({ enum: NEIGHBOR_RATINGS }),
    touristApartments: boolean(),
    neighborRelations: text({ enum: NEIGHBOR_RELATIONS }),
    cleaning: text({ enum: CLEANING_RATINGS }),

    // ── The area, within 300 m ──
    areaTourists: text({ enum: TOURIST_LEVELS }),
    areaSecurity: text({ enum: SECURITY_LEVELS }),
    areaNoise: text({ enum: NOISE_LEVELS }),
    areaCleanliness: text({ enum: CLEANING_RATINGS }),

    /** `removed` hides the review from every public read; `under_review` does not. */
    moderationStatus: text({ enum: REVIEW_MODERATION_STATUSES }).notNull().default('active'),

    oxyUserId: text().notNull(),
    verified: boolean().notNull().default(false),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /**
     * Every public read and every aggregation applies the SAME filter —
     * `moderationStatus: { $ne: 'removed' }`, spelled `VISIBLE_MODERATION` in
     * the model — and Mongo carried none of it in any of its thirteen indexes.
     * Making the scoped indexes PARTIAL on that predicate is the "add the index
     * Mongo needed and lacked" case: it is derived from the six aggregation
     * pipelines and three finders that all begin with it, not from speculation.
     */
    index('reviews_address_created_idx')
      .on(table.addressId, sql`${table.createdAt} desc`)
      .where(sql`${table.moderationStatus} <> 'removed'`),
    index('reviews_street_level_idx')
      .on(table.streetLevelId, table.addressLevel, sql`${table.createdAt} desc`)
      .where(sql`${table.moderationStatus} <> 'removed'`),
    index('reviews_building_level_idx')
      .on(table.buildingLevelId, table.addressLevel, sql`${table.createdAt} desc`)
      .where(sql`${table.moderationStatus} <> 'removed'`),
    index('reviews_unit_level_idx')
      .on(table.unitLevelId, table.addressLevel, sql`${table.createdAt} desc`)
      .where(sql`${table.moderationStatus} <> 'removed'`),
    index('reviews_agency_created_idx')
      .on(table.agencyId, sql`${table.createdAt} desc`)
      .where(sql`${table.moderationStatus} <> 'removed'`),
    index('reviews_city_created_idx')
      .on(table.cityId, sql`${table.createdAt} desc`)
      .where(sql`${table.moderationStatus} <> 'removed'`),
    index('reviews_neighborhood_created_idx')
      .on(table.neighborhoodId, sql`${table.createdAt} desc`)
      .where(sql`${table.moderationStatus} <> 'removed'`),
    /**
     * "My reviews" — the ONE listing that must show a removed review, because it
     * is the author's own and hiding it from them would make a removal
     * indistinguishable from a lost submission. So this index is NOT partial.
     */
    index('reviews_oxy_user_created_idx').on(table.oxyUserId, sql`${table.createdAt} desc`),
    /**
     * The moderation queue. Partial and INVERTED relative to the indexes above:
     * `active` is the overwhelming majority, so the queue is everything else and
     * the index is the size of the work rather than the size of the table. Mongo
     * had a plain `index: true` on this column, which is the same index with
     * ~99% of its entries unread.
     */
    index('reviews_moderation_queue_idx')
      .on(table.moderationStatus, sql`${table.createdAt} desc`)
      .where(sql`${table.moderationStatus} <> 'active'`),

    /**
     * One review per person per address.
     *
     * `reviewController.createReview` stated this rule as
     * `Review.findOne({ oxyUserId, addressId })` followed by an insert — a
     * read-then-write with a window two concurrent submissions both pass, which
     * is the shape `db/MIGRATION-CONTRACT.md` says becomes a unique KEY. It is
     * added on an EMPTY table, so it rejects nothing that exists.
     *
     * It is NOT partial. Every one of the seven scoped indexes above excludes
     * `removed`, and this one deliberately does not: a review a jury removed
     * still occupies its author's one slot at that address, so making the key
     * partial would let a removal be undone by re-submitting. Nothing in this
     * package deletes a review except its own author, which is the ONE way that
     * slot is meant to be freed.
     *
     * The preceding read survives in the controller as an ANSWER path — it
     * produces the friendly 400 without a write — exactly as `hasReportedReview`
     * does beside `review_reports_review_user_key`.
     */
    uniqueIndex('reviews_author_address_key').on(table.oxyUserId, table.addressId),

    check(
      'reviews_address_level_check',
      sql`${table.addressLevel} in (${sql.raw(inList(REVIEW_ADDRESS_LEVELS))})`,
    ),
    /**
     * A UNIT review names a unit; a BUILDING review does not.
     *
     * Mongo declared exactly this as a `validate` on `unitLevelId` — and, like
     * every validator in this package, it did not run on an update. It is the
     * rule the whole street → building → unit rollup depends on: a BUILDING
     * review carrying a `unit_level_id` is counted twice by
     * `getBuildingViewData`, once as a building review and once through the unit
     * it should not name.
     */
    check(
      'reviews_unit_level_check',
      sql`(${table.addressLevel} = 'UNIT') = (${table.unitLevelId} is not null)`,
    ),
    check(
      'reviews_moderation_status_check',
      sql`${table.moderationStatus} in (${sql.raw(inList(REVIEW_MODERATION_STATUSES))})`,
    ),
    check(
      'reviews_currency_check',
      sql`${table.currency} in (${sql.raw(inList(PAYMENT_CURRENCIES))})`,
    ),
    check(
      'reviews_summer_temperature_check',
      sql`${table.summerTemperature} in (${sql.raw(inList(TEMPERATURE_RATINGS))})`,
    ),
    check(
      'reviews_winter_temperature_check',
      sql`${table.winterTemperature} in (${sql.raw(inList(TEMPERATURE_RATINGS))})`,
    ),
    check('reviews_noise_check', sql`${table.noise} in (${sql.raw(inList(NOISE_LEVELS))})`),
    check('reviews_light_check', sql`${table.light} in (${sql.raw(inList(LIGHT_LEVELS))})`),
    check(
      'reviews_condition_check',
      sql`${table.conditionAndMaintenance} in (${sql.raw(inList(CONDITION_RATINGS))})`,
    ),
    check(
      'reviews_services_check',
      sql`${table.services} <@ ${sql.raw(textArrayLiteral(SERVICE_TYPES))}`,
    ),
    check(
      'reviews_landlord_treatment_check',
      sql`${table.landlordTreatment} in (${sql.raw(inList(LANDLORD_TREATMENTS))})`,
    ),
    check(
      'reviews_problem_response_check',
      sql`${table.problemResponse} in (${sql.raw(inList(RESPONSE_RATINGS))})`,
    ),
    check(
      'reviews_deposit_returned_check',
      sql`${table.depositReturned} in (${sql.raw(inList(DEPOSIT_RETURNS))})`,
    ),
    check(
      'reviews_staircase_neighbors_check',
      sql`${table.staircaseNeighbors} in (${sql.raw(inList(NEIGHBOR_RATINGS))})`,
    ),
    check(
      'reviews_neighbor_relations_check',
      sql`${table.neighborRelations} in (${sql.raw(inList(NEIGHBOR_RELATIONS))})`,
    ),
    check('reviews_cleaning_check', sql`${table.cleaning} in (${sql.raw(inList(CLEANING_RATINGS))})`),
    check(
      'reviews_area_tourists_check',
      sql`${table.areaTourists} in (${sql.raw(inList(TOURIST_LEVELS))})`,
    ),
    check(
      'reviews_area_security_check',
      sql`${table.areaSecurity} in (${sql.raw(inList(SECURITY_LEVELS))})`,
    ),
    check('reviews_area_noise_check', sql`${table.areaNoise} in (${sql.raw(inList(NOISE_LEVELS))})`),
    check(
      'reviews_area_cleanliness_check',
      sql`${table.areaCleanliness} in (${sql.raw(inList(CLEANING_RATINGS))})`,
    ),
    /**
     * `min: 1, max: 5` from the schema. A range constraint on an EMPTY table, so
     * there is nothing to reject — and every explore aggregate in the model is
     * an `$avg` of this column, which one out-of-range star silently skews for
     * a whole neighbourhood.
     */
    check('reviews_rating_check', sql`${table.rating} between 1 and 5`),
    /** Mongo's `validate` on `livedTo` (`value > this.livedFrom`). */
    check('reviews_lived_order_check', sql`${table.livedTo} > ${table.livedFrom}`),
  ],
);

/**
 * `helpfulVoters[]` — who marked this review helpful.
 *
 * `count(*)` over this table is the `helpfulCount` the DTO publishes, and
 * membership is `viewerHasVotedHelpful`. The unique key is what makes both
 * honest: `$addToSet` gave set semantics inside one document, and the
 * controller's `alreadyVoted` read-then-write reintroduced the race that
 * `$addToSet` had closed.
 */
export const reviewHelpfulVotes = pgTable(
  'review_helpful_votes',
  {
    id: generatedId(),
    reviewId: text()
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    oxyUserId: text().notNull(),
    votedAt: createdAt(),
  },
  (table) => [uniqueIndex('review_helpful_votes_review_user_key').on(table.reviewId, table.oxyUserId)],
);

/**
 * `reports[]` — trust & safety reports filed against a review.
 *
 * Declared `{ _id: false }` in Mongo, so these subdocuments have NO id to
 * preserve and the backfill mints a uuid v7 per row. That is the case
 * `db/MIGRATION-CONTRACT.md` calls out by name.
 *
 * Stripped from every public DTO in Mongo by `toReviewDTO` deleting the key.
 * Here they are simply not in the table anyone selects from, which is the same
 * strengthening `eviction_case_attendees` gets.
 */
export const reviewReports = pgTable(
  'review_reports',
  {
    id: generatedId(),
    reviewId: text()
      .notNull()
      .references(() => reviews.id, { onDelete: 'cascade' }),
    oxyUserId: text().notNull(),
    reason: text({ enum: REVIEW_REPORT_REASONS }).notNull(),
    details: text(),
    createdAt: createdAt(),
  },
  (table) => [
    /**
     * One report per reporter per review — the `alreadyReported` guard in
     * `reviewController`, moved to where it cannot be raced. It matters more
     * here than it looks: the count of these rows crossing three is what flips
     * a review into `under_review`, so a duplicate is a vote for removal cast
     * twice by one person.
     */
    uniqueIndex('review_reports_review_user_key').on(table.reviewId, table.oxyUserId),
    check(
      'review_reports_reason_check',
      sql`${table.reason} in (${sql.raw(inList(REVIEW_REPORT_REASONS))})`,
    ),
  ],
);
