/**
 * The Home surface's data contract — issue #353, built on ADR 0002's
 * {@link LocationSelection}.
 *
 * WHY THIS EXISTS. Home used to be a merchandising stack: a hero, a category
 * strip, three carousels and an endless feed. The feed's own filter set was
 * `getCategoryFilters(null)`, which is `{}` — no geographic constraint at all —
 * so opening the app ran a worldwide search under a heading naming a nearby
 * region. Nothing in the UI said the location had been dropped, because nothing
 * knew it had one. This module is the shape that makes that unrepresentable:
 * every section states the area it was computed for, the rule that selected its
 * items, and the data those items came from.
 *
 * THREE PROPERTIES ARE LOAD-BEARING, and each closes a specific failure:
 *
 * 1. **`reason` and `source` are REQUIRED.** A section that cannot say why its
 *    items are in it is a ranking nobody can audit, which is what the issue's
 *    "personalización ética" section forbids. They are separate fields because
 *    they answer different questions: `reason` is the RULE ("listed in the last
 *    30 days, newest first"), `source` is the COLUMN or table the rule reads.
 *    A rule with no source is a claim about data that may not exist.
 *
 * 2. **`location` is a summary, not a selection.** It carries the
 *    {@link locationKey} of the scope the server actually applied — ADR 0002
 *    decision 7 — so a client can compare it against the scope it believes it
 *    asked for and refuse to render a mismatch. It carries no coordinate for a
 *    device fix, because `locationKey` has no branch that can emit one.
 *
 * 3. **`generatedAt` is the SERVER's clock.** It is what lets the UI tell live
 *    data from cached data from stale data, which is an acceptance criterion in
 *    its own right. A client-side timestamp cannot do it: a payload restored
 *    from disk would be stamped with the moment it was READ.
 *
 * AN EMPTY SECTION IS ABSENT, NOT EMPTY. There is no "zero items" section in a
 * response. The issue's rule is that a section needs a source and a criterion
 * and must never be filled with invented content; the cheapest way to honour it
 * is to let a rule that matched nothing produce nothing, so a client cannot
 * render a heading over an empty band and then be tempted to fill it.
 */

import type { GeoBounds, PlaceLabel } from './location';

/**
 * The sections Homiio can build TODAY, from data that exists TODAY.
 *
 * The issue proposes fourteen. This union names the ones whose source is a real
 * column or table in this database; the rest are deliberately absent rather
 * than stubbed, because a stub is the invented content the issue forbids and it
 * is indistinguishable from a section that is merely empty right now.
 *
 * Deferred, with the reason each is not here:
 *  - accessibility — no accessibility data exists on `properties`;
 *    `has_elevator` is a building feature, not an accessibility claim.
 *  - energy efficiency — there is no energy-rating column at all.
 *  - cooperative / community housing — `housing_type` has exactly two values,
 *    `private` and `public`, so only the public half is expressible.
 *  - saved-search changes and new reviews in followed areas — both need the
 *    watched-area model that is #356's, not merged.
 *  - nearby eviction alerts — #358's surface, and the privacy classification
 *    of a nearby-eviction feed is ADR 0003's to decide first.
 */
export type HomeSectionId =
  /** Listed recently inside the scope. `properties.created_at`. */
  | 'new_in_area'
  /** The portal marked the asking price reduced. `properties.sale_is_price_reduced`. */
  | 'price_reduced'
  /** Left the market: rented or sold. `properties.status`. */
  | 'no_longer_available'
  /** The lister states no agency fee is payable. `listing_flags_agency_fee_payable`. */
  | 'no_agency_fee'
  /** Every recurring cost is stated, not "plus bills". Per-offering, see the repository. */
  | 'transparent_total_cost'
  /** Somebody who lived at this address wrote a review. `reviews`. */
  | 'with_resident_reviews'
  /** Address or lister verified. `properties.is_verified`. */
  | 'verified'
  /** Public housing. `properties.housing_type = 'public'`. */
  | 'public_housing';

/**
 * Where a section's items come from — the DATA, not the rule.
 *
 * A closed union rather than free text so a section cannot claim a source that
 * does not exist, and so a reader can tell at a glance which sections would
 * break if a column were dropped.
 */
export type HomeSectionSource =
  | 'listing_created_at'
  | 'listing_sale_price_reduced_flag'
  | 'listing_status'
  | 'listing_agency_fee_flag'
  | 'listing_cost_fields'
  | 'resident_reviews'
  | 'listing_verification'
  | 'listing_housing_type';

/**
 * The scope a section was computed for, as the SERVER applied it.
 *
 * `status` distinguishes the three answers a client has to render differently,
 * and conflating any two of them is a bug this contract exists to prevent:
 *  - `resolved` — a place was asked for and applied.
 *  - `none` — no place was asked for. A legitimate query (ADR 0002 §4.3), and
 *    the client only reaches it after an explicit "Explore everywhere".
 *  - `unresolved` — a place WAS asked for and could not be found. The sections
 *    are empty because we did not understand where, not because nothing is
 *    there, and those are different sentences.
 */
export type HomeLocationSummary =
  | {
      readonly status: 'resolved';
      /** {@link locationKey} of the applied scope. Never carries a coordinate. */
      readonly key: string;
      readonly label?: PlaceLabel;
      readonly bounds?: GeoBounds;
      /** Present only for a centre+radius scope, so the UI can say "· 25 km". */
      readonly radiusMeters?: number;
    }
  | { readonly status: 'none' }
  | {
      readonly status: 'unresolved';
      /** Which parameter named a place we could not resolve, and its value. */
      readonly requested: { readonly param: 'city' | 'state' | 'neighborhood'; readonly value: string };
    };

/**
 * What a section offers beyond its own items.
 *
 * `explore` carries a serialised `loc` token plus the filters that reproduce
 * the section as a full search — so "see all" opens a search the user can read,
 * share and go Back from, rather than a differently-filtered list that happens
 * to look similar.
 */
export interface HomeSectionAction {
  readonly kind: 'explore';
  /** The `loc` token for the scope, or absent when the scope is "everywhere". */
  readonly loc?: string;
  /** Extra query params the search screen applies verbatim. */
  readonly params?: Readonly<Record<string, string>>;
}

/**
 * One finite, explainable band of the Home surface.
 *
 * `T` is the item type — `Property` for every section shipped today. It is a
 * parameter rather than a fixed type because the issue's remaining sections
 * (saved-search changes, new reviews, eviction alerts) are not properties, and
 * a contract that assumed they were would have to be broken to add them.
 */
export interface HomeSection<T> {
  readonly id: HomeSectionId;
  /**
   * The i18n KEY naming the rule that selected these items.
   *
   * A key rather than a sentence, and the difference matters: the server has no
   * business deciding what language a user reads, and a translated sentence
   * baked into a response is also uncacheable across locales. The client
   * renders `t(section.reason)`. Every value is asserted to exist in `en.json`
   * by `__tests__/homeSectionContract.test.ts`, so a rule cannot ship pointing
   * at a string nobody wrote.
   */
  readonly reason: string;
  readonly source: HomeSectionSource;
  /** The scope this section was computed for. Identical across one response. */
  readonly location: HomeLocationSummary;
  /** ISO-8601, the SERVER's clock. See the module header. */
  readonly generatedAt: string;
  /** Never empty — a rule that matched nothing produces no section at all. */
  readonly items: readonly T[];
  readonly nextAction?: HomeSectionAction;
}

/**
 * `GET /api/home/sections`.
 *
 * ONE request for the whole surface, and that is a decision rather than an
 * optimisation. The issue asks that components stop issuing independent queries
 * with slightly different parameters; the failure that guards against is a
 * Madrid section rendering beside a Barcelona one, which is possible whenever
 * two requests can carry two scopes. Here there is one scope, applied once, and
 * echoed once — so the sections cannot disagree about where they are.
 */
export interface HomeSectionsResponse<T> {
  /** The scope the server applied. Every section repeats it; this is the copy to trust. */
  readonly location: HomeLocationSummary;
  readonly generatedAt: string;
  readonly sections: readonly HomeSection<T>[];
}
