/**
 * A report Homiio has taken, and everything that happened to it afterwards.
 *
 * ## Why this is a new collection rather than a field on an existing one
 *
 * Homiio already files reports in three places and not one of them can carry a
 * delivery axis:
 *
 *   * `ListingReport` — its `propertyId` is required and it carries a partial
 *     unique index on `(propertyId, reporterOxyUserId, status)`. Generalising it
 *     means weakening an index that is currently doing real work.
 *   * `Review.reports[]` — an embedded array declared `{ _id: false }`. A review
 *     report has NO stable identifier, so it cannot be an `externalReportId` and
 *     cannot be looked up by a delivery worker. That alone settles the question.
 *   * `EvictionReport` — a third collection with a third shape.
 *
 * So this is the one durable record the delivery pipeline drains, and the three
 * existing shapes keep their schemas, their semantics and their clients exactly
 * as they were. Each of them gains one enqueue inside its own transaction and
 * nothing else. They answer "what did a user flag"; this answers "what happened
 * to that flag" — different questions with different lifecycles, since a
 * `ListingReport` was designed to be closed by a human and this one is closed by
 * a jury.
 *
 * ## What it is not
 *
 * Not a verdict, at any point. CrowdSource owns cases, reviews and decisions;
 * the decision fields below are a CACHE of a published revision, overwritten by
 * a later revision and never edited in place. Nothing in this collection is the
 * source of truth for whether a rule was broken.
 */

import mongoose, { Document, Schema, Types } from 'mongoose';
import {
  ModerationReportedType,
  type ModerationEnforcementAction,
  type ModerationLocalStatus,
} from '@homiio/shared-types';

/** The local integration states. The union itself lives in `@homiio/shared-types`. */
export const MODERATION_LOCAL_STATUSES: readonly ModerationLocalStatus[] = [
  'received',
  'queued',
  'submitted',
  'delivery_failed',
  'closed',
];

export const MODERATION_ENFORCEMENT_ACTIONS: readonly ModerationEnforcementAction[] = [
  'none',
  'restrict',
  'restore',
  'flag_for_review',
  'unflag',
  'manual_review',
];

/**
 * Details are stored at the source surface's limit (a listing report allows
 * 4000 characters) and truncated to the contract's limit at delivery. Storing
 * the reporter's full text and sending a shorter one is the right way round:
 * the reporter said what they said.
 */
const MAX_DETAILS_LENGTH = 4000;

/** A report's stored fields, without the Document machinery. */
export interface ModerationReportFields {
  reportedType: ModerationReportedType;
  reportedId: string;
  /** The reporter's Oxy user id. Resolved from the session, never from a body. */
  reporter: string;
  /**
   * The reason as the REPORTER picked it, in the vocabulary of the surface they
   * picked it on (`ListingReportReason` or `ReviewReportReason`).
   *
   * Stored raw and translated into a universal allegation code at delivery,
   * rather than translated once and stored. The reporter's claim is the durable
   * fact; the mapping is a versioned interpretation of it, and freezing an old
   * interpretation into the row would make the table impossible to correct.
   */
  reason: string;
  details?: string;

  /** @see ModerationLocalStatus */
  localStatus: ModerationLocalStatus;
  /** Why there is no durable route to CrowdSource, when `localStatus` says so. */
  localStatusReason?: string;

  crowdSourceReportId?: string;
  crowdSourceCaseId?: string;
  /** Set when CrowdSource merged this report into an existing case. */
  crowdSourceMerged?: boolean;
  submittedAt?: Date;

  decisionId?: string;
  decisionRevision?: number;
  decisionOutcome?: string;
  decisionStatus?: string;
  decidedAt?: Date;

  enforcedAction?: ModerationEnforcementAction;
  enforcedAt?: Date;

  /**
   * SHA-256 of the exact material that was sent for review. A later edit to the
   * listing changes it, which is how a decision about an older version stays
   * recognisable as being about an older version.
   */
  contentSnapshotHash?: string;
  /** Last delivery failure, truncated. Never carries reported material. */
  lastDeliveryError?: string;

  createdAt: Date;
  updatedAt: Date;
}

/** A lean report row, as every read path returns it. */
export interface LeanModerationReport extends ModerationReportFields {
  _id: Types.ObjectId;
}

export interface IModerationReport extends ModerationReportFields, Document {}

export const MODERATION_REPORT_COLLECTION = 'moderation_reports';

const moderationReportSchema = new Schema<IModerationReport>(
  {
    reportedType: {
      type: String,
      enum: Object.values(ModerationReportedType),
      required: true,
    },
    reportedId: { type: String, required: true, index: true },
    reporter: { type: String, required: true, index: true },
    reason: { type: String, required: true },
    details: { type: String, maxlength: MAX_DETAILS_LENGTH },

    localStatus: {
      type: String,
      enum: MODERATION_LOCAL_STATUSES,
      default: 'received',
      required: true,
      index: true,
    },
    localStatusReason: { type: String, maxlength: 300 },

    crowdSourceReportId: { type: String },
    crowdSourceCaseId: { type: String, index: true },
    crowdSourceMerged: { type: Boolean },
    submittedAt: { type: Date },

    decisionId: { type: String },
    decisionRevision: { type: Number, min: 1 },
    decisionOutcome: { type: String },
    decisionStatus: { type: String },
    decidedAt: { type: Date },

    enforcedAction: { type: String, enum: MODERATION_ENFORCEMENT_ACTIONS },
    enforcedAt: { type: Date },

    contentSnapshotHash: { type: String },
    lastDeliveryError: { type: String, maxlength: 2_000 },
  },
  { timestamps: true, collection: MODERATION_REPORT_COLLECTION },
);

/**
 * One report per reporter per object.
 *
 * The same rule both existing surfaces already enforce their own way — a
 * re-filed listing report returns the open one, a re-filed review report is a
 * no-op — expressed once, in the index, so intake cannot answer "you already
 * reported this" from a read that raced a concurrent insert.
 */
moderationReportSchema.index(
  { reporter: 1, reportedType: 1, reportedId: 1 },
  { unique: true },
);
/** The reconciliation sweep scans by delivery state, oldest first. */
moderationReportSchema.index({ localStatus: 1, createdAt: 1 });

export const ModerationReport = mongoose.model<IModerationReport>(
  'ModerationReport',
  moderationReportSchema,
);

export default ModerationReport;
