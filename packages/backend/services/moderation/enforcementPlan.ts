/**
 * Deciding what Homiio will do about a decision — and nothing else.
 *
 * Pure: no database, no clock, no configuration. A decision in, a plan out. That
 * is what makes the mapping testable as a table rather than as an integration
 * scenario, and it is why `observe` mode is a real audit rather than a comment —
 * the plan is computed identically in every mode and only its EXECUTION is
 * gated.
 *
 * ## Homiio maps recommendations, not findings
 *
 * The jury classified the material and the consensus engine turned that into a
 * recommendation under a versioned policy. An application that re-derived its
 * action from raw severity would be quietly re-deciding the case with a second,
 * unversioned policy of its own — and the two would diverge the first time
 * CrowdSource's policy was updated. Severity is a fallback only, for a
 * `violation` that arrives with no recommendation at all, because a violation
 * Homiio did nothing about would be worse than a mapped one.
 *
 * ## Homiio's primitives, and the two it does not have
 *
 * - `restrict` — the listing or review leaves every public read. Reversible by
 *   `restore`, which puts back the state that was actually there.
 * - `flag_for_review` — the object is marked contested without being taken down.
 *   Homiio has exactly one such flag, `Review.moderationStatus: 'under_review'`,
 *   and NOTHING equivalent for a listing.
 * - `manual_review` — recorded, never executed.
 *
 * There is no content warning and no distribution dial. Mention maps `label`,
 * `age_gate` and `reduce_distribution` onto a sensitivity flag because it has
 * one; Homiio does not, so those become `flag_for_review` and the executor
 * records honestly that a listing had no such effect available. Recording an
 * effect that did not happen would be worse than recording that it could not.
 *
 * `suspend_user` is Oxy's to carry out, not Homiio's — Oxy owns identity and an
 * application reaching into another product's user state is exactly what the
 * one-way reputation rule forbids. `legal_queue` needs a human. Both are
 * RECORDED as `manual_review` rather than dropped: a recommendation Homiio
 * declined must never look like one it never received.
 */

import type { Decision, RecommendedAction, Severity } from '@oxyhq/crowdsource-contracts';
import type { ModerationEnforcementAction } from '@homiio/shared-types';

export interface PlannedEnforcementAction {
  readonly action: ModerationEnforcementAction;
  /** Why, in words an operator reads. Never reported material. */
  readonly reason: string;
  /** The recommendation this came from, when it came from one. */
  readonly recommendedAction?: RecommendedAction;
}

/** What a recommended action becomes in Homiio. */
const RECOMMENDATION_TO_ACTION: Readonly<
  Record<RecommendedAction, ModerationEnforcementAction>
> = Object.freeze({
  remove: 'restrict',
  remove_or_restrict: 'restrict',
  hide: 'restrict',

  // Homiio has no content warning and no distribution dial. The closest honest
  // thing is marking the object contested where such a mark exists.
  label: 'flag_for_review',
  allow_with_label: 'flag_for_review',
  age_gate: 'flag_for_review',
  reduce_distribution: 'flag_for_review',

  allow: 'none',
  no_action: 'none',
  no_global_effect: 'none',
  restore: 'restore',

  // Homiio holds none of the levers these ask for. Recorded, queued for a human.
  suspend_user: 'manual_review',
  freeze_transaction: 'manual_review',
  request_changes: 'manual_review',
  request_more_context: 'manual_review',
  hold: 'manual_review',
  local_manual_review: 'manual_review',
  keep_restricted_temporarily: 'manual_review',
  escalate: 'manual_review',
  specialist_queue: 'manual_review',
  legal_queue: 'manual_review',
  safety_queue: 'manual_review',
});

/**
 * The action a violation gets when the decision recommended nothing.
 *
 * Severity only, and deliberately cautious at both ends. A `low`-severity
 * violation with no recommendation is not something to take a home listing down
 * over, so it goes to a human — and `critical` does too, rather than straight to
 * removal: the most serious material is the case where an automatic action
 * driven by a webhook is least appropriate, and where the difference between
 * "restrict" and "preserve and escalate" carries legal weight that a mapping
 * table is the wrong place to decide.
 */
const SEVERITY_FALLBACK: Readonly<Record<Severity, ModerationEnforcementAction>> =
  Object.freeze({
    critical: 'manual_review',
    high: 'restrict',
    medium: 'flag_for_review',
    low: 'manual_review',
  });

const SEVERITY_ORDER: readonly Severity[] = ['low', 'medium', 'high', 'critical'];

function highestSeverity(decision: Decision): Severity | undefined {
  let highest: Severity | undefined;
  for (const finding of decision.findings) {
    if (
      highest === undefined ||
      SEVERITY_ORDER.indexOf(finding.severity) > SEVERITY_ORDER.indexOf(highest)
    ) {
      highest = finding.severity;
    }
  }
  return highest;
}

/**
 * `no_violation` always carries a restore, whatever it recommended.
 *
 * This exists because of a failure that is very easy to ship and very hard to
 * see. A correction is a new revision whose outcome is `no_violation`, and its
 * recommendation is frequently `no_action` — which means "take no NEW action",
 * not "leave what you already did in place". Mapping that straight through plans
 * `none`, and the listing an earlier revision restricted stays hidden forever:
 * the appeal succeeded, the case says the listing was fine, and nothing in
 * Homiio ever puts it back. No error, no log line, no failing test anywhere
 * else.
 *
 * So the plan always includes the restore, and the executor records "there was
 * nothing restricted" when that is the case — which is evidence, rather than a
 * silent no-op.
 */
function withRestoreForNoViolation(
  decision: Decision,
  planned: readonly PlannedEnforcementAction[],
): readonly PlannedEnforcementAction[] {
  if (decision.outcome !== 'no_violation') return planned;
  if (planned.some((entry) => entry.action === 'restore')) return planned;
  return [
    ...planned,
    { action: 'restore', reason: 'No violation: undo any earlier restriction' },
  ];
}

/**
 * Collapse a plan to the actions that can coexist.
 *
 * A decision may recommend both removal and a label; a restricted listing does
 * not need to be marked contested as well, and recording both would claim two
 * effects where one happened. `restrict` therefore absorbs `flag_for_review`,
 * `none` and `restore`, and `none` never survives alongside anything else.
 * `manual_review` always survives — it is a note for a human, and dropping it
 * because something else was also done is how a `suspend_user` recommendation
 * gets lost.
 */
function collapse(
  actions: readonly PlannedEnforcementAction[],
): PlannedEnforcementAction[] {
  const byAction = new Map<ModerationEnforcementAction, PlannedEnforcementAction>();
  for (const planned of actions) {
    if (!byAction.has(planned.action)) byAction.set(planned.action, planned);
  }

  if (byAction.has('restrict')) {
    byAction.delete('flag_for_review');
    byAction.delete('none');
    byAction.delete('restore');
  }
  if (byAction.has('restore')) byAction.delete('flag_for_review');
  if (byAction.size > 1) byAction.delete('none');

  return Array.from(byAction.values());
}

/**
 * What Homiio will do about this decision.
 *
 * Never empty: a decision that produces no action produces an explicit `none`,
 * because a row saying "we decided to do nothing, and why" is evidence and an
 * absent row is a question.
 */
export function planEnforcement(decision: Decision): PlannedEnforcementAction[] {
  const fromRecommendations = decision.recommendedActions.map(
    (recommended): PlannedEnforcementAction => ({
      action: RECOMMENDATION_TO_ACTION[recommended.action] ?? 'manual_review',
      reason: `CrowdSource recommended ${recommended.action}`,
      recommendedAction: recommended.action,
    }),
  );

  if (fromRecommendations.length > 0) {
    const collapsed = collapse(withRestoreForNoViolation(decision, fromRecommendations));
    return collapsed.length > 0
      ? collapsed
      : [{ action: 'none', reason: 'No recommended action maps to a Homiio effect' }];
  }

  switch (decision.outcome) {
    case 'violation': {
      const severity = highestSeverity(decision);
      /**
       * A `violation` with no findings cannot happen — the contract refuses it —
       * so an absent severity here means a newer CrowdSource sent something this
       * code has not seen. A human looks at it rather than a default taking a
       * listing down.
       */
      if (severity === undefined) {
        return [
          {
            action: 'manual_review',
            reason: 'Violation carried no finding severity this version understands',
          },
        ];
      }
      return [
        {
          action: SEVERITY_FALLBACK[severity],
          reason: `Violation with no recommended action, highest severity ${severity}`,
        },
      ];
    }

    case 'no_violation':
      /**
       * A restore, always planned — even when nothing was restricted. The
       * executor records it as not applied with the reason, which is how "we
       * checked and there was nothing to undo" stays distinguishable from "we
       * never looked".
       */
      return [
        { action: 'restore', reason: 'No violation: undo any earlier restriction' },
      ];

    case 'insufficient_context':
    case 'inconclusive':
    case 'escalated':
      /**
       * None of these is "remove" and none is "it was fine": absence of
       * consensus is neither guilt nor innocence, so Homiio changes nothing on
       * its own and asks a human.
       */
      return [
        {
          action: 'manual_review',
          reason: `Outcome ${decision.outcome}: no automatic action, internal review`,
        },
      ];

    case 'content_unavailable':
    case 'duplicate':
      return [
        { action: 'none', reason: `Outcome ${decision.outcome}: nothing to enforce` },
      ];

    default:
      /**
       * An outcome this version does not define. A newer server must not break
       * an older client, and the safe reading of an unknown outcome is a human,
       * never a default effect.
       */
      return [
        {
          action: 'manual_review',
          reason: 'Decision outcome not recognised by this version of Homiio',
        },
      ];
  }
}
