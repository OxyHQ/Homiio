/**
 * `POST /webhooks/crowdsource` — where decisions come back.
 *
 * ## The mount is part of the correctness
 *
 * This router MUST be mounted before every body parser in `server.ts`. The
 * signature covers the bytes that arrived, and once a JSON parser has consumed
 * the stream those bytes are gone. `@oxyhq/crowdsource-express` reads the raw
 * body itself and REFUSES rather than verifying a signature over a
 * re-serialisation, so mounting it late does not silently verify the wrong bytes
 * — it fails every delivery, loudly. That refusal is the correct behaviour and
 * it is also why the mount order cannot be got wrong quietly. `appFactory`-style
 * tests assert `typeof req.body === 'undefined'` inside this route so the order
 * stays asserted rather than remembered.
 *
 * It is also mounted ahead of the rate limiter and outside `/api`, deliberately.
 * The HMAC IS the authentication; a 429 to CrowdSource would put a real decision
 * back on a retry schedule for no reason, and Homiio's limiter keys on an
 * authenticated Oxy user that a webhook will never have.
 *
 * ## What this handler does and does not do
 *
 * It records and returns. Applying a decision means reading listings, planning
 * enforcement and writing several collections, and a receiver that did all that
 * inline would time out under a burst and be retried while the first attempt was
 * still running. So the event and a durable `decision.apply` outbox row commit in
 * ONE transaction, and the dispatcher does the work.
 *
 * Nothing here is authenticated by Oxy. An Oxy session must never satisfy this
 * route — it is not a user endpoint.
 */

import { Router } from 'express';
import { crowdsourceWebhooks } from '@oxyhq/crowdsource-express';
import config from '../config';
import {
  recordDecisionEvent,
  recordIgnoredEvent,
} from '../services/moderation/ModerationInboundService';
import { mongoProcessedEventStore } from '../services/moderation/moderationEventStore';
import { logger } from '../middlewares/logging';

/**
 * One string field out of an event payload this version does not know.
 *
 * A webhook envelope's `data` is deliberately OPAQUE in the contract: an
 * unrecognised event's payload is whatever a newer CrowdSource decided to send,
 * and the exported type says so — property access on it does not compile. That
 * is the contract being honest rather than an obstacle, so this reads the key
 * defensively instead of asserting a shape nobody has verified. Anything that is
 * not a string is treated as absent, which is the only safe reading of a field
 * this deployment has never seen.
 */
function stringField(source: unknown, key: string): string | undefined {
  if (typeof source !== 'object' || source === null) return undefined;
  const value: unknown = Reflect.get(source, key);
  return typeof value === 'string' ? value : undefined;
}

export function createCrowdSourceWebhookRoutes(): Router {
  const router = Router();

  const secret = config.crowdSource.webhookSecret;
  if (!secret) {
    /**
     * Not mounted, rather than mounted and permissive.
     *
     * A route that answers anything at all without a secret is a route that will
     * one day be reasoned about as if it verified something. An unconfigured
     * deployment 404s here, which is indistinguishable from not having the
     * feature — which is exactly what it is.
     */
    logger.info('[CrowdSource] webhook route not mounted', {
      reason: 'no CROWDSOURCE_WEBHOOK_SECRET',
    });
    return router;
  }

  router.post(
    '/crowdsource',
    crowdsourceWebhooks({
      secret,
      ...(config.crowdSource.webhookPreviousSecret === undefined
        ? {}
        : { previousSecret: config.crowdSource.webhookPreviousSecret }),
      // Shared across tasks: the in-process default would deduplicate only the
      // instance that happened to receive both copies of a redelivery, and
      // Homiio runs an API task and a worker task against one database.
      store: mongoProcessedEventStore(),
      on: {
        /**
         * A decision, provisional or final. Both are queued: a provisional
         * decision is real and Homiio records it; what it may ACT on is decided
         * by the enforcement mode, not by discarding the event here.
         */
        'case.decided': async (event) => {
          await recordDecisionEvent({
            eventId: event.id,
            type: event.type,
            caseId: event.data.caseId,
            decision: event.data.decision,
          });
        },
        /**
         * A later revision replacing an earlier one. The SAME path: the decision
         * worker compares revisions and the enforcement service reverses what the
         * superseded revision did. A correction is not a special case with its own
         * code — it is an ordinary decision that supersedes another, and giving it
         * a separate path is how a restore ends up not being idempotent.
         */
        'decision.corrected': async (event) => {
          await recordDecisionEvent({
            eventId: event.id,
            type: event.type,
            caseId: event.data.caseId,
            decision: event.data.decision,
          });
        },
        /**
         * An appeal's outcome carries a decision too, and it is the current
         * answer for the case, so it takes the same path.
         */
        'appeal.decided': async (event) => {
          await recordDecisionEvent({
            eventId: event.id,
            type: event.type,
            caseId: event.data.caseId,
            decision: event.data.decision,
          });
        },
      },
      /**
       * Every other event type — including one this version of the contracts
       * package has never heard of.
       *
       * Recorded rather than dropped. `case.created`, `case.escalated` and
       * `case.closed` carry no decision and nothing to enforce, but "did
       * CrowdSource tell us about this case, and when" is the first question
       * asked when a report appears stuck, and the answer has to exist
       * somewhere.
       */
      onUnhandled: async (event) => {
        await recordIgnoredEvent({
          eventId: event.id,
          type: event.type,
          caseId: stringField(event.data, 'caseId'),
        });
      },
      /**
       * A refusal reason and nothing else — never a body, a header or a
       * signature.
       */
      onRejected: (rejection) => {
        logger.warn('[CrowdSource] webhook delivery refused', { rejection });
      },
    }),
  );

  return router;
}
