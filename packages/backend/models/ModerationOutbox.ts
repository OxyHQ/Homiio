/**
 * The durable record of moderation work that has to happen but has not happened
 * yet.
 *
 * This collection is what makes a 201 from a report endpoint mean something
 * true. It means the report row and this row committed in ONE transaction — not
 * that a call to CrowdSource succeeded. Delivery is a separate, retried step and
 * no reporter is ever made to wait for a third party to be reachable.
 *
 * The same shape carries work in the other direction: a decision arriving over a
 * webhook is answered 2xx as soon as it is written down here, and applied
 * afterwards. Nothing is enqueued that is not already written down, so if the
 * dispatcher, the process or the whole ECS task disappears, every pending piece
 * of moderation work is re-derivable by reading this collection.
 */

import mongoose, { Document, Schema } from 'mongoose';

export type ModerationOutboxKind = 'report.submit' | 'decision.apply';

/**
 * `dead_letter` is the state that separates a blip from a defect.
 *
 * The SDK answers exactly one question about every failure: can re-delivering
 * this same payload ever succeed. A 409 (an external id reused with a different
 * body) or a rejected envelope cannot, so retrying forever would bury a defect
 * under an ever-growing attempt count nobody reads. Those events stop, keep
 * their error, and stay visible to the reconciliation sweep.
 */
export type ModerationOutboxStatus =
  | 'pending'
  | 'processing'
  | 'processed'
  | 'dead_letter';

export interface ModerationOutboxPayload {
  /** The local `ModerationReport._id`, for `report.submit`. */
  reportId?: string;
  /** The inbound webhook event id, for `decision.apply`. */
  eventId?: string;
  /** The CrowdSource case a decision belongs to. */
  caseId?: string;
  /**
   * The decision exactly as CrowdSource published it.
   *
   * Stored whole and opaque rather than projected into columns: the decision
   * document is deliberately loose so a newer server does not break an older
   * client, and a projection would silently drop whatever a newer CrowdSource
   * added — including a finding field the enforcement mapping may later need. It
   * is validated against the published contract when it is READ, not when it is
   * stored, so an event is never lost to a schema this deployment has not caught
   * up with yet.
   */
  decision?: unknown;
}

export interface IModerationOutbox extends Document<string> {
  _id: string;
  kind: ModerationOutboxKind;
  payload: ModerationOutboxPayload;
  status: ModerationOutboxStatus;
  attempts: number;
  availableAt: Date;
  leaseOwner?: string;
  leaseUntil?: Date;
  lastError?: string;
  processedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Retention ceiling, so a stalled dispatcher cannot turn the outbox into an
 * unbounded collection. Ninety days because a moderation case can legitimately
 * sit open for weeks and a `dead_letter` row is evidence somebody still has to
 * look at. Any operational alert must fire long before this deadline.
 */
export const MODERATION_OUTBOX_RETENTION_SECONDS = 90 * 24 * 60 * 60;
export const MODERATION_OUTBOX_COLLECTION = 'moderation_outbox';

const moderationOutboxSchema = new Schema<IModerationOutbox>(
  {
    _id: { type: String, required: true },
    kind: { type: String, required: true, enum: ['report.submit', 'decision.apply'] },
    payload: {
      reportId: { type: String },
      eventId: { type: String },
      caseId: { type: String },
      decision: { type: Schema.Types.Mixed },
    },
    status: {
      type: String,
      required: true,
      enum: ['pending', 'processing', 'processed', 'dead_letter'],
      default: 'pending',
    },
    attempts: { type: Number, required: true, default: 0 },
    availableAt: { type: Date, required: true, default: Date.now },
    leaseOwner: { type: String },
    leaseUntil: { type: Date },
    lastError: { type: String },
    processedAt: { type: Date },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: MODERATION_OUTBOX_COLLECTION },
);

// Due work and expired claims are separate bounded scans.
moderationOutboxSchema.index({ status: 1, availableAt: 1, createdAt: 1 });
moderationOutboxSchema.index({ status: 1, leaseUntil: 1, createdAt: 1 });
moderationOutboxSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const ModerationOutbox = mongoose.model<IModerationOutbox>(
  'ModerationOutbox',
  moderationOutboxSchema,
);

export default ModerationOutbox;
