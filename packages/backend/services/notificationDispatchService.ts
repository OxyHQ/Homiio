/**
 * Notification Dispatch Service
 *
 * The single chokepoint for *producing* in-app notifications from domain
 * events (lease signed, viewing approved, roommate request received, …).
 * Controllers never call `Notification.create` directly for event-driven
 * notifications — they call `createForUser` / `createForProfile` here so that
 * recipient resolution, defaults and failure handling live in one place.
 *
 * Dispatch is best-effort: a notification failure must never break the domain
 * action that triggered it (signing a lease must succeed even if the mailbox
 * write fails), so both methods swallow-and-log errors and return `null`
 * instead of throwing.
 */

import { Notification, Profile } from '../models';
import type { INotification } from '../models';
import { logger } from '../middlewares/logging';

export type NotificationPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface DispatchPayload {
  /** Semantic category the frontend uses for grouping/icon/deep-link routing. */
  type: string;
  title: string;
  message: string;
  priority?: NotificationPriority;
  /** Structured deep-link payload (e.g. `{ screen: '/contracts', leaseId }`). */
  data?: Record<string, unknown>;
  /** Originating app within the Oxy ecosystem. Defaults to `homiio`. */
  app?: string;
}

class NotificationDispatchService {
  /**
   * Create a notification for a recipient identified by their Oxy user id.
   * Returns the created document, or `null` if the write failed or the
   * recipient id was empty.
   */
  async createForUser(
    recipientOxyUserId: string | undefined | null,
    payload: DispatchPayload,
  ): Promise<INotification | null> {
    if (!recipientOxyUserId) {
      return null;
    }
    try {
      const notification = await Notification.create({
        recipientOxyUserId: String(recipientOxyUserId),
        type: payload.type,
        title: payload.title,
        message: payload.message,
        priority: payload.priority,
        data: payload.data ?? {},
        app: payload.app,
      });

      logger.info('Notification dispatched', {
        notificationId: notification._id?.toString(),
        recipientOxyUserId: String(recipientOxyUserId),
        type: payload.type,
      });

      return notification;
    } catch (error) {
      logger.error('Notification dispatch failed', {
        recipientOxyUserId: String(recipientOxyUserId),
        type: payload.type,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Create a notification for the Oxy user who owns the given Homiio profile.
   * Resolves the profile's `oxyUserId` server-side; a profile without one (or a
   * missing profile) is skipped. Returns the created document or `null`.
   */
  async createForProfile(
    profileId: string | undefined | null,
    payload: DispatchPayload,
  ): Promise<INotification | null> {
    if (!profileId) {
      return null;
    }
    try {
      const profile = await Profile.findById(profileId)
        .select('oxyUserId')
        .lean<{ oxyUserId?: string } | null>();

      if (!profile?.oxyUserId) {
        logger.warn('Notification dispatch skipped: profile has no oxyUserId', {
          profileId: String(profileId),
          type: payload.type,
        });
        return null;
      }

      return this.createForUser(profile.oxyUserId, payload);
    } catch (error) {
      logger.error('Notification dispatch (profile) failed', {
        profileId: String(profileId),
        type: payload.type,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }
}

export const notificationDispatchService = new NotificationDispatchService();

export default notificationDispatchService;
