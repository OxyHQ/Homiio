/**
 * The REDUCTIONS a review's facts go through on the way out — ADR 0003 §5.6.
 *
 * ## The rule, and why each of the three is needed
 *
 * §5.6 names the combination that identifies a household: **unit + tenancy dates
 * + rent**. Individually every one of them is harmless, which is exactly why F2
 * shipped — nobody publishing any one of them was publishing a person. Together
 * they narrow a building to one flat and one tenancy, and an owner holding their
 * own records inverts the join immediately.
 *
 * #506 closed the first leg: a public review is published against the BUILDING,
 * so the unit never leaves. This module closes the other two:
 *
 *  - **Tenancy dates are published as month and year, never as a day.** A
 *    truncated timestamp is deliberately NOT how that is done. `2024-03-01T00:00Z`
 *    reads as a day to every consumer — the same "looks precise while being
 *    wrong" objection §7.1 makes to a rounded coordinate — so the wire carries a
 *    `YYYY-MM` STRING and the exact instants are absent.
 *  - **Rent is published banded.** The exact figure stays in the column and
 *    still feeds §4.4-compliant aggregates; a reader is served the band.
 *
 * Storage is untouched. §3.3: blur on the way OUT, because the fine value is
 * what dedup, search and correction need, and a value blurred on the way in
 * cannot be un-blurred.
 *
 * ## The band width is a decision this ADR does not make
 *
 * §5.6 says "banded" and does not say how wide. {@link REVIEW_PRICE_BAND_WIDTH}
 * is 250 in the review's OWN currency, up to a ceiling of 3000, then one open
 * band. Fixed-width rather than proportional, and that is the part worth
 * arguing: a 10%-wide band is €40 at €400, which is narrower than the spread
 * between two neighbours in one block and therefore not a reduction at all,
 * while at €4,000 it would be €400 and reduce more than the privacy rule asks
 * for. A fixed step reduces least where rents are dense and most where they are
 * sparse, which is the direction that matches where re-identification is easy.
 *
 * The band is NOT converted between currencies: a band is read next to the
 * currency it is in, and converting would make the published figure depend on a
 * rate that moves.
 */

import type { ReviewPriceBand } from '@homiio/shared-types';

/** The width of one published rent band, in the review's own currency. */
export const REVIEW_PRICE_BAND_WIDTH = 250;

/**
 * Above this, one open band.
 *
 * A ceiling rather than bands all the way up, because the tail is thin: a single
 * €7,000 tenancy in a band of its own is as identifying as the exact figure, and
 * "3000 or more" is the honest statement about it. It is also why the open
 * band's `max` is ABSENT rather than a large number — a fabricated ceiling reads
 * as a measurement.
 */
export const REVIEW_PRICE_BAND_CEILING = 3000;

/**
 * The band a rent is published in.
 *
 * Half-open, `[min, max)`, so a rent of exactly 1000 lands in `1000–1250` and
 * never in two bands. A non-finite or negative figure — which the column's own
 * shape does not forbid — floors to the bottom band rather than producing a
 * `NaN` band, because a malformed band is worse on the wire than a wrong one.
 */
export function reviewPriceBand(price: number, currency: string): ReviewPriceBand {
  if (!Number.isFinite(price) || price <= 0) return { min: 0, max: REVIEW_PRICE_BAND_WIDTH, currency };
  if (price >= REVIEW_PRICE_BAND_CEILING) return { min: REVIEW_PRICE_BAND_CEILING, currency };
  const min = Math.floor(price / REVIEW_PRICE_BAND_WIDTH) * REVIEW_PRICE_BAND_WIDTH;
  return { min, max: min + REVIEW_PRICE_BAND_WIDTH, currency };
}

/**
 * A tenancy date as `YYYY-MM` — ADR 0003 §5.6's month grain.
 *
 * Read in **UTC**, never in the server's local zone. `timestamptz` carries an
 * instant, and `getMonth()` would answer a different month for a tenancy that
 * started at midnight on the first depending on which region the API task
 * happens to run in — a published fact that changes with a deployment is not a
 * fact. The same reasoning `CONVENTIONS.md` gives for refusing `timestamp`
 * without a zone, applied to the read side.
 */
export function reviewTenancyMonth(date: Date): string {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  return `${year}-${month}`;
}
