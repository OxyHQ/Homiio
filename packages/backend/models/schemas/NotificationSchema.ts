const mongoose = require('mongoose');

/**
 * Notification Schema
 *
 * Stores in-app notifications for a recipient. Notifications target an Oxy user
 * (identified by their Oxy user id) rather than a Homiio profile, because a
 * single user may own multiple profiles and the mailbox is per-user. The shape
 * mirrors the frontend `Notification` interface
 * (packages/frontend/services/notificationService.ts).
 */
const notificationSchema = new mongoose.Schema(
  {
    // Oxy user id of the recipient (req.user.id / req.userId)
    recipientOxyUserId: {
      type: String,
      required: true,
      index: true,
    },
    // Semantic category used by the frontend for grouping/filtering and routing
    // (e.g. property, message, contract, payment, reminder, system, marketing).
    type: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: [2000, 'Message cannot exceed 2000 characters'],
    },
    // Originating app within the Oxy ecosystem. Defaults to Homiio.
    app: {
      type: String,
      trim: true,
      default: 'homiio',
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
      index: true,
    },
    read: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
    },
    // Arbitrary structured payload used by the client to deep-link
    // (e.g. { propertyId, screen, amount, dueDate }).
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc: unknown, ret: Record<string, unknown>) {
        ret.id = ret._id;
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  }
);

// Primary mailbox query: a user's notifications, newest first.
notificationSchema.index({ recipientOxyUserId: 1, createdAt: -1 });
// Unread badge / unread-only listing.
notificationSchema.index({ recipientOxyUserId: 1, read: 1, createdAt: -1 });
// Type-filtered listing (mailbox filter chips).
notificationSchema.index({ recipientOxyUserId: 1, type: 1, createdAt: -1 });

module.exports =
  mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
