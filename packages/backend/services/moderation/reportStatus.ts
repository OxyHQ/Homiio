/**
 * The one place a decided report's local status is chosen.
 *
 * Deliberately conservative about the difference between "a jury looked at this"
 * and "this ended". A `provisional` decision leaves the report at `submitted`: a
 * later revision may supersede it, and a report Homiio had already closed would
 * have to be reopened. `superseded` is not terminal either — a superseded
 * revision is not the current answer and must never be the one that closes the
 * report.
 *
 * There is no second, legacy status axis here, and that is a genuine difference
 * from Mention rather than an omission. `ModerationReport` is a new collection
 * with no clients reading a lifecycle field; the surfaces that DO have one
 * (`ListingReport.status`, `Review.moderationStatus`) keep their own semantics
 * and are not written from this pipeline. Two independently-maintained status
 * fields is how they drift, so this one keeps exactly the axis it owns.
 */

import type { ModerationLocalStatus } from '@homiio/shared-types';

/**
 * Decision statuses that end Homiio's side of the case.
 *
 * Matched as strings rather than as a `DecisionStatus`: this is reached from the
 * decision worker with a value that came off the wire, and an unrecognised
 * status must be handled rather than throw. Anything not listed leaves the
 * report open, which is the safe reading — a report still waiting is recoverable,
 * a report wrongly closed is not noticed.
 */
const TERMINAL_DECISION_STATUSES: ReadonlySet<string> = new Set(['final', 'corrected']);

/** Where a report sits once a decision for its case has been applied. */
export function localStatusForDecision(decisionStatus: string): ModerationLocalStatus {
  return TERMINAL_DECISION_STATUSES.has(decisionStatus) ? 'closed' : 'submitted';
}
