import 'express';

/**
 * Authenticated user shape attached to Express requests by the Oxy auth
 * middleware (`oxy.auth()`). The Oxy SDK declares its own `User` type with an
 * `id` field, but throughout this backend handlers also read `_id`,
 * `oxyUserId`, and `profileId` from the same object, so we augment the request
 * with a permissive superset here.
 */
export interface HomiioRequestUser {
  id?: string;
  _id?: string;
  oxyUserId?: string;
  profileId?: string;
  username?: string;
  email?: string;
  [key: string]: unknown;
}

declare global {
  namespace Express {
    interface Request {
      user?: HomiioRequestUser | null;
      userId?: string | null;
      accessToken?: string;
      sessionId?: string | null;
      id?: string;
      /** Raw request body captured for Stripe webhook signature verification. */
      rawBody?: Buffer;
    }
  }
}
