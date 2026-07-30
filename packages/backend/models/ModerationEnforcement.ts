/**
 * What Homiio did about a decision — one row per action, and the reason it is
 * impossible to do twice.
 *
 * The idempotency key is `decisionId + revision + action`, and the unique index
 * below IS that key. It is the whole mechanism: a redelivered webhook, a
 * reclaimed outbox lease and a manual replay all try to insert the same row and
 * only the first can. Checking "have I done this?" with a read before the write
 * would leave the window between them, which is precisely the window a
 * redelivery arrives in.
 *
 * `revision` is in the key for a reason of its own. A correction is a NEW
 * revision that supersedes the old one, so the restore it asks for is a
 * different action from the removal that came before and must be allowed to
 * happen — while still being impossible to apply twice itself. Drop `revision`
 * and an upheld appeal can never put a listing back.
 *
 * `previousState` is what makes reversibility real rather than aspirational. A
 * restore returns the object to what it WAS, so a listing an owner had already
 * archived is not published by a moderation correction that never archived it.
 */

import mongoose, { Document, Schema } from 'mongoose';
import type {
  ModerationEnforcementAction,
  ModerationEnforcementMode,
} from '@homiio/shared-types';
import { MODERATION_ENFORCEMENT_ACTIONS } from './ModerationReport';

export interface IModerationEnforcement extends Document {
  decisionId: string;
  decisionRevision: number;
  action: ModerationEnforcementAction;

  caseId: string;
  /** Homiio's own noun, e.g. `property`. Never a CrowdSource resource id. */
  subjectType: string;
  subjectId: string;

  /** The decision outcome this action answered. */
  outcome: string;
  /** The recommendation it came from, when it came from one. */
  recommendedAction?: string;
  /** Why this action, in words an operator can read. Never reported material. */
  reason: string;

  mode: ModerationEnforcementMode;
  /**
   * Whether the effect was actually carried out.
   *
   * `false` in `observe` mode for every action, which is the point of the mode:
   * the plan is recorded and auditable, and nothing is taken down.
   */
  applied: boolean;
  appliedAt?: Date;
  /** Why an action was recorded but not carried out. */
  skippedReason?: string;

  /** What to put back on a reversal. Only set for an action that changed state. */
  previousState?: {
    propertyModerationRestricted?: boolean;
    reviewModerationStatus?: string;
  };

  createdAt: Date;
  updatedAt: Date;
}

export const MODERATION_ENFORCEMENT_COLLECTION = 'moderation_enforcements';

const moderationEnforcementSchema = new Schema<IModerationEnforcement>(
  {
    decisionId: { type: String, required: true },
    decisionRevision: { type: Number, required: true, min: 1 },
    action: { type: String, required: true, enum: MODERATION_ENFORCEMENT_ACTIONS },

    caseId: { type: String, required: true, index: true },
    subjectType: { type: String, required: true },
    subjectId: { type: String, required: true },

    outcome: { type: String, required: true },
    recommendedAction: { type: String },
    reason: { type: String, required: true, maxlength: 500 },

    mode: { type: String, required: true, enum: ['observe', 'manual', 'automatic'] },
    applied: { type: Boolean, required: true, default: false },
    appliedAt: { type: Date },
    skippedReason: { type: String, maxlength: 300 },

    previousState: {
      propertyModerationRestricted: { type: Boolean },
      reviewModerationStatus: { type: String },
    },
  },
  { timestamps: true, collection: MODERATION_ENFORCEMENT_COLLECTION },
);

/**
 * The idempotency key. Unique, and load-bearing: without it a redelivered
 * decision restricts a listing twice, and a redelivered correction restores it
 * twice.
 */
moderationEnforcementSchema.index(
  { decisionId: 1, decisionRevision: 1, action: 1 },
  { unique: true },
);
// Operational: what has been done to this object, newest first.
moderationEnforcementSchema.index({ subjectType: 1, subjectId: 1, createdAt: -1 });

export const ModerationEnforcement = mongoose.model<IModerationEnforcement>(
  'ModerationEnforcement',
  moderationEnforcementSchema,
);

export default ModerationEnforcement;
