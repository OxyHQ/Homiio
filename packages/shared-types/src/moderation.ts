/**
 * Homiio's local moderation-integration contract.
 *
 * CrowdSource owns cases, reviews and decisions; Oxy Trust owns reputation;
 * Homiio stays the source of truth for its own enforcement actions and nothing
 * else. Homiio never computes reputation and never calls Oxy Trust — it reports
 * and it enforces.
 *
 * Nothing here duplicates `@oxyhq/crowdsource-contracts`. A `Decision`, a
 * `TaxonomyCode` or a `RecommendedAction` has exactly one definition and it
 * lives in that package; what a decision produced *in Homiio* lives below. The
 * single field that crosses over is
 * {@link ModerationReportReceipt.decisionOutcome}, deliberately an open string:
 * CrowdSource may add an outcome, and a receipt shown to a reporter is the wrong
 * place for that to become a type error in a shipped app bundle.
 */

import { ISODate } from './common';

/**
 * The Homiio objects that can be sent for community review.
 *
 * Homiio files reports against more nouns than this — an eviction case
 * (`EvictionReport`) is the third — and that is deliberate rather than an
 * omission. Whether a report is DELIVERED is a property of the subject-provider
 * registry in the backend, not of this union: a noun with a provider is sent for
 * review, a noun without one is stored locally exactly as it was before
 * CrowdSource existed. Gating the report ROUTES on this union instead would make
 * adopting CrowdSource a breaking change for every report surface not yet wired
 * to it, which is the one property that has to hold for adoption to be
 * incremental at all.
 */
export enum ModerationReportedType {
  /** A property listing, internal or aggregated from a portal. */
  PROPERTY = 'property',
  /** A public address review. */
  REVIEW = 'review',
}

/**
 * Where a report is in Homiio's own delivery pipeline.
 *
 * This is the INTEGRATION axis and it says nothing about guilt. A report sitting
 * at `submitted` has been accepted by CrowdSource and is waiting for a jury; it
 * has not been judged, and no value in this union ever means "the listing was
 * bad".
 *
 * `received` means "stored, and not sent for review" — a report about a kind of
 * object Homiio has no subject provider for. It is deliberately NOT the same as
 * `closed` (a case that ended) or `delivery_failed` (a route that exists and did
 * not work). The distinction is load-bearing: reconciliation re-derives a missing
 * delivery event for `queued` and `delivery_failed` and must never do so for
 * `received`, because a report nothing can describe would be retried straight
 * into the dead-letter queue. It is counted instead, so a surface designed never
 * to drain is at least measured.
 */
export type ModerationLocalStatus =
  | 'received'
  | 'queued'
  | 'submitted'
  | 'delivery_failed'
  | 'closed';

/**
 * What Homiio did about a decision.
 *
 * A record of Homiio's own action, never a restatement of the jury's finding. An
 * application is allowed to refuse or adapt a recommendation provided it records
 * what it did — so a recommendation Homiio declined must never look like one it
 * never received.
 *
 * - `none` — the decision asked for nothing that applies here.
 * - `restrict` — the listing or review is withheld from every public read.
 *   Reversible by `restore`.
 * - `restore` — an earlier restriction was undone, normally by a correction.
 * - `flag_for_review` — the object is marked as contested without being taken
 *   down. Homiio has no content-warning or distribution dial, so this is the
 *   honest home for `label` / `age_gate` / `reduce_distribution`, and it only
 *   has an effect where Homiio actually has such a flag.
 * - `unflag` — that mark was lifted.
 * - `manual_review` — a recommendation Homiio will not execute automatically. A
 *   suspension is Oxy's to carry out, not Homiio's; a legal queue needs a human.
 */
export type ModerationEnforcementAction =
  | 'none'
  | 'restrict'
  | 'restore'
  | 'flag_for_review'
  | 'unflag'
  | 'manual_review';

/**
 * How much of a decision Homiio is allowed to act on.
 *
 * `observe` is the first deployment and removes nothing: decisions are received,
 * stored and planned, and every planned action is recorded as not applied. That
 * record is what makes the mode an audit rather than a silent no-op — you can
 * read exactly what would have happened.
 *
 * `manual` additionally applies only the give-something-back half (`restore`,
 * `unflag`): holding those behind a human means a wrongly-restricted listing
 * stays hidden while somebody reads a queue, and Homiio has no such queue.
 * Taking a listing down still waits for `automatic`.
 */
export type ModerationEnforcementMode = 'observe' | 'manual' | 'automatic';

/** The report state a reporter is allowed to see. */
export interface ModerationReportReceipt {
  id: string;
  reportedType: ModerationReportedType;
  reportedId: string;
  /** Universal allegation codes, as delivered. Never a verdict. */
  allegations: string[];
  /** @see ModerationLocalStatus */
  localStatus: ModerationLocalStatus;
  /**
   * CrowdSource's outcome, open-ended by design — see the module comment.
   * Absent until a decision arrives.
   */
  decisionOutcome?: string;
  /** What Homiio did. Absent until a decision has been applied. */
  enforcedAction?: ModerationEnforcementAction;
  enforcedAt?: ISODate;
  createdAt: ISODate;
  updatedAt: ISODate;
}
