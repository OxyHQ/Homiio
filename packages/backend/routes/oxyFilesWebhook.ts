/**
 * `POST /webhooks/oxy/files` — Oxy's file events (ADR 0043 D9).
 *
 * Mounted in `server.ts` BEFORE every body parser, beside the CrowdSource
 * webhook and for the same reason: the HMAC covers the bytes that arrived, and
 * a JSON parser destroys them. This router reads the raw body itself
 * (`express.raw`), so a late mount would hand it an already-parsed object and
 * every delivery would fail verification — loudly, never by trusting a
 * re-serialisation. Outside `/api` and ahead of the API's limiter: the
 * signature IS the authentication, and that limiter's per-IP budget would push
 * a burst of takedowns onto Oxy's retry schedule. Its own ceiling
 * (`webhookLimiter`) is far above any delivery rate Oxy produces.
 *
 * Answers:
 * - the endpoint challenge (`webhook.challenge`) → `{ challenge }`, the one
 *   request verified by echo rather than by signature — it is how the console
 *   proves the endpoint before showing the secret;
 * - a verified event → 204 once applied (or recognised as a redelivery);
 * - a bad signature → 400, which Oxy retries and then dead-letters;
 * - no secret configured → 503: an endpoint registered before the secret was
 *   deployed stays retried by Oxy rather than silently accepting events
 *   nobody verified.
 */

import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { FileEventVerificationError, verifyFileEventSignature } from '@oxy.so/core/server';

import config from '../config';
import { describeErrorForLog } from '../middlewares/errorHandler';
import { logger } from '../middlewares/logging';
import { rateLimitKeyFor } from '../middlewares/rateLimitKey';
import { applyFileEvent } from '../services/files/fileEvents';

/** Oxy's events are small JSON documents; anything bigger is not one. */
const MAX_BODY = '256kb';

/**
 * A ceiling, not the API's limiter: generous enough that Oxy's own deliveries
 * (one per file event, retried with back-off) never meet it, and low enough
 * that an unauthenticated caller cannot make this route spend an HMAC and a
 * body read without bound. A 429 is a retry for Oxy, never a lost event.
 */
const webhookLimiter = rateLimit({
  windowMs: 60_000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => rateLimitKeyFor(req, 'oxy-files-webhook'),
});

export function createOxyFilesWebhookRoutes(): Router {
  const router = Router();
  router.post(
    '/oxy/files',
    webhookLimiter,
    express.raw({ type: '*/*', limit: MAX_BODY }),
    async (req, res) => {
      const body: unknown = req.body;
      if (!Buffer.isBuffer(body)) {
        // A parser upstream consumed the bytes: the mount order is broken.
        logger.error('Oxy file event arrived without its raw body');
        res.status(500).json({ error: 'raw_body_unavailable' });
        return;
      }
      const secret = config.oxyFiles.webhookSecret ?? '';
      let event: ReturnType<typeof verifyFileEventSignature>;
      try {
        event = verifyFileEventSignature(body, req.headers, secret);
      } catch (error) {
        if (error instanceof FileEventVerificationError) {
          if (!secret) {
            res.status(503).json({ error: 'not_configured' });
            return;
          }
          logger.warn('Refused an Oxy file event', { reason: error.message });
          res.status(400).json({ error: 'invalid_signature' });
          return;
        }
        throw error;
      }

      if (event.type === 'webhook.challenge') {
        res.status(200).json({ challenge: event.challenge });
        return;
      }

      try {
        const outcome = await applyFileEvent(event);
        logger.info('Oxy file event', {
          eventId: event.id,
          type: event.type,
          fileId: event.file.id,
          outcome: outcome.outcome,
          rows: outcome.rows,
        });
        res.status(204).end();
      } catch (error) {
        // 500: Oxy backs off and redelivers; the dedupe row rolled back with
        // the failed transaction, so the retry is applied for real.
        logger.error('Applying an Oxy file event failed', {
          eventId: event.id,
          reason: describeErrorForLog(error),
        });
        res.status(500).json({ error: 'apply_failed' });
      }
    },
  );
  return router;
}
