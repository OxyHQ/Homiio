/**
 * Homiio's report reasons, translated into CrowdSource's universal taxonomy.
 *
 * The reasons on the left are what a reporter picked in Homiio's UI. The codes
 * on the right are ALLEGATIONS — what is claimed, never what is true. A jury
 * classifies the material itself and may confirm a different code entirely, and
 * nothing about these tables shortens that.
 *
 * ## Why this is versioned, and what a change costs
 *
 * Every decision records the policy version it was decided under, and this
 * mapping sits upstream of that: change what `inaccurate` means and two reports
 * filed a month apart are no longer the same allegation.
 * {@link REPORT_TAXONOMY_VERSION} is stamped into report metadata so a case can
 * always be read back against the mapping that produced it. Bump it in the same
 * change that alters a row.
 *
 * That version is part of the delivered envelope, and CrowdSource fingerprints
 * the whole envelope to detect an external id reused with a different body. So a
 * deploy that changes a row (or the version) while reports are still queued makes
 * those reports deliver a different payload than an earlier attempt did, and the
 * retry is answered 409 and dead-lettered. It is rare — an undelivered report is
 * normally seconds old — but it is real, so the operational rule is to let the
 * outbox drain before shipping a change to this file, and the reconciliation
 * sweep's dead-letter count is where it would show up.
 *
 * ## The rows worth arguing about
 *
 * **`inappropriate` is not forced into a family.** A reporter pressing
 * "inappropriate content" on a housing advert has said the listing breaks
 * Homiio's rules without saying which kind. Mapping it to `sexual_content.*` or
 * `hate.*` would tell a jury the reporter alleged something they did not, so it
 * becomes `other.policy_specific` — a real code meaning exactly "against the
 * reporting application's rules, and the universal taxonomy has no name for
 * it". `other` is different again and maps to `other.unclassifiable`: the
 * reporter did not even claim which rule.
 *
 * **`unavailable` is a commerce claim, not a housekeeping one.** "Already
 * rented" reads like stale data, but a listing advertising a home that cannot be
 * had is misleading whether or not anyone meant it to be — and bait listings
 * that stay up to farm enquiries are a real practice in this market.
 * `commerce.misleading_listing` is the honest reading; a jury that finds an
 * honest oversight will say so.
 *
 * **A review's `fake` is `integrity.fraud`, not
 * `integrity.coordinated_manipulation`.** A fabricated review of a landlord is
 * deception, but "coordinated" alleges an organised campaign — which one report
 * about one review is not claiming. Overstating the allegation could route it to
 * a heavier review than the reporter asked for.
 *
 * ## What is deliberately absent
 *
 * `commerce.prohibited_item` and `hate.protected_targeting` appear in neither
 * table, because no Homiio reporter can allege either one. There is no reason
 * for "this listing is illegal" (an unlicensed short-let, an illegal sublet) and
 * none for "this listing discriminates". The second gap is the sharper one:
 * ingest already detects restrictions like "no benefit claimants" or "women
 * only" in listing text and stores them on `Property.listingFlags`. Those flags
 * travel as report METADATA — context a jury needs to weigh a misleading-listing
 * claim — and never as an allegation, because they are a classifier's reading
 * rather than a person's claim, and an allegation nobody made is not evidence of
 * anything. Closing either gap means adding a reporter-facing reason, which is a
 * product decision rather than a mapping one.
 */

import type { TaxonomyCode } from '@oxyhq/crowdsource-contracts';
import {
  ListingReportReason,
  ModerationReportedType,
  ReviewReportReason,
} from '@homiio/shared-types';

export const REPORT_TAXONOMY_VERSION = '2026.07';

const LISTING_REASON_TO_ALLEGATION: Readonly<Record<ListingReportReason, TaxonomyCode>> =
  Object.freeze({
    [ListingReportReason.INACCURATE]: 'commerce.misleading_listing',
    [ListingReportReason.SCAM]: 'integrity.scam',
    [ListingReportReason.INAPPROPRIATE]: 'other.policy_specific',
    [ListingReportReason.UNAVAILABLE]: 'commerce.misleading_listing',
    [ListingReportReason.PRIVACY]: 'privacy.location_exposure',
    [ListingReportReason.UNSAFE]: 'commerce.unsafe_product',
    [ListingReportReason.OTHER]: 'other.unclassifiable',
  });

const REVIEW_REASON_TO_ALLEGATION: Readonly<Record<ReviewReportReason, TaxonomyCode>> =
  Object.freeze({
    [ReviewReportReason.FAKE]: 'integrity.fraud',
    [ReviewReportReason.OFFENSIVE]: 'harassment.insult',
    [ReviewReportReason.PERSONAL_DATA]: 'privacy.personal_information',
    [ReviewReportReason.SPAM]: 'integrity.spam',
    [ReviewReportReason.OTHER]: 'other.unclassifiable',
  });

/**
 * The allegation a report carries.
 *
 * Each Homiio surface offers ONE reason, so a report has exactly one allegation
 * — unlike Mention, whose reporter can tick several categories. The return type
 * is a single code rather than a list for that reason; if a surface ever offers
 * multiple, the list must be SORTED before delivery, because the envelope
 * fingerprint would otherwise make a legitimate retry a permanent 409.
 *
 * A reason no table covers cannot silently become nothing — a report with no
 * allegation is not a report — so it falls through to `other.unclassifiable`,
 * which is precisely what the universal taxonomy provides for this case. The
 * fallback is reachable in practice as well as in theory: a report row written
 * by an older deployment carries whatever reason that deployment offered.
 */
export function allegationForReport(input: {
  reportedType: ModerationReportedType;
  reason: string;
}): TaxonomyCode {
  const table =
    input.reportedType === ModerationReportedType.REVIEW
      ? (REVIEW_REASON_TO_ALLEGATION as Readonly<Record<string, TaxonomyCode | undefined>>)
      : (LISTING_REASON_TO_ALLEGATION as Readonly<Record<string, TaxonomyCode | undefined>>);
  return table[input.reason] ?? 'other.unclassifiable';
}
