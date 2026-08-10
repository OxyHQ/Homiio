/**
 * The rules behind Home's sections (#353) — one predicate and one ordering per
 * section, and the reason string that explains it.
 *
 * ## Why the rules live apart from the query that runs them
 *
 * Every section is "these listings, inside this scope, because of THIS". The
 * scope is shared and applied once by `homeSectionsRepository`; the rule is what
 * distinguishes one section from the next. Keeping them in a table makes two
 * things checkable that prose could not:
 *
 *  - a rule cannot ship without a `source`, so a section claiming a criterion
 *    the database has no column for cannot be added by accident;
 *  - the table is enumerable, which is what lets one test assert that every
 *    rule's `reason` key exists in `en.json` rather than trusting each author.
 *
 * ## What is NOT here, and why that is the point
 *
 * The issue proposes fourteen sections. Six are absent because their data does
 * not exist in this database — accessibility, energy efficiency, cooperative and
 * community housing, saved-search changes, new reviews in followed areas, and
 * nearby eviction alerts. The temptation with each is a plausible proxy:
 * `has_elevator` for accessibility, `is_eco_friendly` for energy efficiency.
 * Both would be a section whose heading makes a claim its data cannot support,
 * which is the invented content the issue forbids — and a wrong accessibility
 * claim is one somebody could act on and be hurt by.
 *
 * `price_ethics_is_fair_price` is absent for a different and equally deliberate
 * reason: it is the universal ethical-price score ADR 0004 (#348) REPLACED with
 * a local, explainable methodology, and the issue names it — "no usar una
 * puntuación de precio no soportada por #348". The column is still populated, so
 * building a section on it would have worked; that is exactly why it is worth
 * writing down that it must not be.
 */

import { sql, type SQL } from 'drizzle-orm';
import {
  OfferingType,
  PropertyStatus,
  type HomeSectionId,
  type HomeSectionSource,
} from '@homiio/shared-types';

import { properties, reviews } from '../schema';
import { isAvailable, statusIs } from '../properties/propertyFilters';
import { nullsLast } from '../properties/propertyReads';

/**
 * One section's rule.
 *
 * `predicate` and `orderBy` are FUNCTIONS returning fresh `SQL`, matching the
 * convention `propertyFilters.ts` states in its own header: a `SQL` fragment
 * carries its own state and must not be handed to two statements. A module-level
 * constant fragment would be shared across concurrent requests.
 */
export interface HomeSectionRule {
  readonly id: HomeSectionId;
  /** i18n key. Asserted to exist in `en.json` by the frontend contract test. */
  readonly reason: string;
  readonly source: HomeSectionSource;
  /**
   * The offerings this rule can honestly answer for.
   *
   * `price_reduced` reads a SALE-only column, and `transparent_total_cost` reads
   * a different set of columns per offering — so "which offering is this for" is
   * part of the rule rather than a caller's concern. A rule that does not apply
   * to the requested offering produces no section at all.
   */
  readonly offerings: readonly OfferingType[];
  /** The rule's own predicate, ANDed with the shared scope and visibility. */
  readonly predicate: (offering: OfferingType) => SQL;
  /** Ordering WITHIN the section. `propertyOrderBy` prepends the image rule. */
  readonly orderBy: () => SQL[];
}

const ALL_OFFERINGS: readonly OfferingType[] = [
  OfferingType.LONG_TERM_RENT,
  OfferingType.SHORT_TERM_RENT,
  OfferingType.SALE,
  OfferingType.EXCHANGE,
];

/**
 * Every recurring or up-front cost is STATED, per offering.
 *
 * The criterion is different for each because the costs are: a long-term let is
 * rent + bills + deposit, a short stay is the nightly rate + cleaning + service,
 * and a sale has no recurring cost to be transparent about — so `sale` is not in
 * this rule's `offerings` and `exchange` is not either.
 *
 * `utilities_included = true` is the honest half that people miss: a listing
 * saying "plus bills" has an unknown total, and one saying bills are included
 * has a knowable one. It is NOT a claim that the home is cheap.
 */
function transparentCostPredicate(offering: OfferingType): SQL {
  if (offering === OfferingType.SHORT_TERM_RENT) {
    return sql`${properties.shortTermRentNightlyRate} is not null
      and ${properties.shortTermRentCleaningFee} is not null
      and ${properties.shortTermRentServiceFee} is not null`;
  }
  return sql`${properties.longTermRentMonthlyAmount} is not null
    and ${properties.longTermRentDeposit} is not null
    and ${properties.utilitiesIncluded} = true`;
}

/**
 * Somebody who LIVED at this address wrote a review.
 *
 * An `EXISTS` on `reviews.address_id`, not a column on `properties`.
 * `properties.rating_count` looks like the obvious source and is a trap: it has
 * no writer anywhere in this repository — every row still holds its `0` default
 * — so a section built on it would be permanently empty and would read as "no
 * reviewed homes near you", which is a claim about the neighbourhood rather than
 * about a dead column.
 *
 * The correlated subquery is bounded by the address index and stops at the first
 * row, so it costs one index probe per candidate rather than an aggregate.
 */
function hasResidentReviewPredicate(): SQL {
  return sql`exists (
    select 1 from ${reviews}
    where ${reviews.addressId} = ${properties.addressId}
      and ${reviews.moderationStatus} <> 'removed'
  )`;
}

/**
 * The rules, in the order Home renders them.
 *
 * Order is a product decision and it is deliberate: what is NEW comes first
 * because it is the only section that changes daily; what has LEFT the market
 * comes next because it is the fact a searcher is least likely to find anywhere
 * else; and the trust and cost sections follow, because they are stable and
 * reward a slower read.
 */
export const HOME_SECTION_RULES: readonly HomeSectionRule[] = [
  {
    id: 'new_in_area',
    reason: 'home.sections.new_in_area.reason',
    source: 'listing_created_at',
    offerings: ALL_OFFERINGS,
    predicate: () => sql`${statusIs(PropertyStatus.PUBLISHED)} and ${isAvailable(true)}`,
    orderBy: () => [sql`${properties.createdAt} desc`],
  },
  {
    id: 'price_reduced',
    reason: 'home.sections.price_reduced.reason',
    source: 'listing_sale_price_reduced_flag',
    // SALE only, and the gap is worth naming rather than papering over: Homiio
    // stores no price HISTORY for a rental, so a rent reduction is not
    // observable at all. `sale_is_price_reduced` is a flag the portal itself
    // publishes, which is why the sale half is expressible and the rent half is
    // not. Inferring one from `updated_at` moving would be a guess presented as
    // a fact.
    offerings: [OfferingType.SALE],
    predicate: () =>
      sql`${properties.saleIsPriceReduced} = true
        and ${statusIs(PropertyStatus.PUBLISHED)}
        and ${isAvailable(true)}`,
    orderBy: () => [sql`${properties.updatedAt} desc`],
  },
  {
    id: 'no_longer_available',
    reason: 'home.sections.no_longer_available.reason',
    source: 'listing_status',
    offerings: ALL_OFFERINGS,
    // `rented` and `sold` are terminal states a listing reaches through
    // `mark-transacted`, so this is the one section that deliberately shows
    // homes the user cannot apply for. It is the issue's "viviendas que ya no
    // están disponibles": knowing what LEFT the market at what price is how a
    // person calibrates what is realistic, and no portal shows it.
    predicate: () =>
      sql`${properties.status} = any(${sql.param([PropertyStatus.RENTED, PropertyStatus.SOLD])}::text[])`,
    orderBy: () => [nullsLast(properties.updatedAt, 'desc')],
  },
  {
    id: 'no_agency_fee',
    reason: 'home.sections.no_agency_fee.reason',
    source: 'listing_agency_fee_flag',
    offerings: ALL_OFFERINGS,
    // STRICTLY `= false`. The column is nullable and null means "the listing did
    // not say", which is not the same claim — `is not true` would sweep every
    // silent listing into a section headed "no agency fee" and turn an unknown
    // into a promise. In Postgres `null = false` is null and a WHERE keeps only
    // true, so the strict form already excludes them; writing it as equality
    // rather than as a negation is what keeps that visible to the next reader.
    predicate: () =>
      sql`${properties.listingFlagsAgencyFeePayable} = false
        and ${statusIs(PropertyStatus.PUBLISHED)}
        and ${isAvailable(true)}`,
    orderBy: () => [sql`${properties.createdAt} desc`],
  },
  {
    id: 'transparent_total_cost',
    reason: 'home.sections.transparent_total_cost.reason',
    source: 'listing_cost_fields',
    offerings: [OfferingType.LONG_TERM_RENT, OfferingType.SHORT_TERM_RENT],
    predicate: (offering) =>
      sql`${transparentCostPredicate(offering)}
        and ${statusIs(PropertyStatus.PUBLISHED)}
        and ${isAvailable(true)}`,
    orderBy: () => [sql`${properties.createdAt} desc`],
  },
  {
    id: 'with_resident_reviews',
    reason: 'home.sections.with_resident_reviews.reason',
    source: 'resident_reviews',
    offerings: ALL_OFFERINGS,
    predicate: () =>
      sql`${hasResidentReviewPredicate()}
        and ${statusIs(PropertyStatus.PUBLISHED)}
        and ${isAvailable(true)}`,
    orderBy: () => [sql`${properties.createdAt} desc`],
  },
  {
    id: 'verified',
    reason: 'home.sections.verified.reason',
    source: 'listing_verification',
    offerings: ALL_OFFERINGS,
    predicate: () =>
      sql`${properties.isVerified} = true
        and ${statusIs(PropertyStatus.PUBLISHED)}
        and ${isAvailable(true)}`,
    orderBy: () => [sql`${properties.createdAt} desc`],
  },
  {
    id: 'public_housing',
    reason: 'home.sections.public_housing.reason',
    source: 'listing_housing_type',
    offerings: ALL_OFFERINGS,
    // `housing_type` is a two-value enum, `private | public`. The issue asks for
    // "vivienda pública, cooperativa o comunitaria"; only the first is
    // representable, so only the first is claimed, and the heading says
    // "public housing" rather than the broader phrase.
    predicate: () =>
      sql`${properties.housingType} = 'public'
        and ${statusIs(PropertyStatus.PUBLISHED)}
        and ${isAvailable(true)}`,
    orderBy: () => [sql`${properties.createdAt} desc`],
  },
];

/** The rules that can answer for an offering, in render order. */
export function rulesForOffering(offering: OfferingType): readonly HomeSectionRule[] {
  return HOME_SECTION_RULES.filter((rule) => rule.offerings.includes(offering));
}
