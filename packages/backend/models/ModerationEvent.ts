/**
 * Every webhook event CrowdSource has delivered to this deployment.
 *
 * Two jobs, and they are the same document on purpose.
 *
 * **Deduplication.** A receiver has to record the event ids it has processed.
 * `_id` IS the event id, so the unique index on it is the dedupe: a redelivery
 * cannot insert a second row, so a claim cannot succeed twice. Doing this in
 * Mongo rather than in the middleware's default in-process store is not an
 * optimisation — Homiio runs behind an ALB with more than one task, and an
 * in-process store deduplicates only whichever task happened to receive both
 * copies of a redelivery.
 *
 * **Audit.** What arrived, when, and whether it was acted on. `payload` is the
 * event's data exactly as delivered, because those payloads are deliberately
 * loose and projecting them into columns would silently drop whatever a newer
 * CrowdSource added.
 *
 * What is stored is a DECISION — an outcome, findings, policy versions, a jury
 * summary. It is not the reported material and this collection must never become
 * a place where reported material is kept; nothing here is ever read into a log
 * line.
 */

import mongoose, { Document, Schema } from 'mongoose';

export type ModerationEventState = 'claimed' | 'queued' | 'ignored';

export interface IModerationEvent extends Document<string> {
  _id: string;
  /** The event type, kept open: an unknown type is recorded and ignored. */
  type?: string;
  caseId?: string;
  payload?: unknown;
  state: ModerationEventState;
  receivedAt: Date;
  queuedAt?: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Retention.
 *
 * A sender's retry schedule ends within a day, so a dedupe row only has to
 * outlive that. It is kept far longer because the row is also the audit trail of
 * what a third party told this deployment to do, and an enforcement question
 * asked weeks later is answered from here.
 */
export const MODERATION_EVENT_RETENTION_SECONDS = 90 * 24 * 60 * 60;
export const MODERATION_EVENT_COLLECTION = 'moderation_events';

const moderationEventSchema = new Schema<IModerationEvent>(
  {
    _id: { type: String, required: true },
    type: { type: String },
    caseId: { type: String, index: true },
    payload: { type: Schema.Types.Mixed },
    state: {
      type: String,
      required: true,
      enum: ['claimed', 'queued', 'ignored'],
      default: 'claimed',
    },
    receivedAt: { type: Date, required: true, default: Date.now },
    queuedAt: { type: Date },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, collection: MODERATION_EVENT_COLLECTION },
);

moderationEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Operational: what arrived recently, and what never got past `claimed`.
moderationEventSchema.index({ state: 1, receivedAt: 1 });

export const ModerationEvent = mongoose.model<IModerationEvent>(
  'ModerationEvent',
  moderationEventSchema,
);

export default ModerationEvent;
