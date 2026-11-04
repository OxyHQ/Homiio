import 'express';
import type { OxyRequestUser } from '@oxy.so/core/server';

declare global {
  namespace Express {
    interface Request {
      /**
       * The person the Oxy auth middleware resolved, in the SDK's own shape.
       * Read the caller's id with `getOxyUserId` / `requireSessionOxyUserId`,
       * never from this object directly.
       */
      user?: OxyRequestUser | null;
      userId?: string | null;
      accessToken?: string;
      sessionId?: string | null;
      id?: string;
      /** Raw request body captured for Stripe webhook signature verification. */
      rawBody?: Buffer;
    }
  }
}
