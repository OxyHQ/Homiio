// Load environment variables first
import 'dotenv/config';

import express from 'express';
import type { Request, Response } from 'express';
import { publicCaseCors } from './middlewares/publicCaseCors';
import bodyParser from 'body-parser';
import { version } from './package.json';

import config from './config';
import routes from './routes';
import { logger, requestLogger } from './middlewares/logging';
import { notFound, errorHandler } from './middlewares/errorHandler';
import { rejectOversizedRequest } from './middlewares/uploadBudget';
import { connectPostgres } from './db/postgres';
import publicRoutes from './routes/public';
import { publicApiBodyErrorHandler } from './routes/publicApi';
import {
  createOxyAuthMiddleware,
  createOxyCors,
  createOxyRateLimit,
  createOxySecurityHeaders,
  oxyTrustProxy,
  startEcosystemTraffic,
  type OxyAuthRefusal,
} from '@oxy.so/core/server';
import { stripeWebhook, confirmCheckoutSession } from './controllers/billingController';
import { initCronJobs } from './services/cron';
import { HealthService } from './services/healthService';
import { createCrowdSourceWebhookRoutes } from './routes/crowdSourceWebhook';
import { moderationOutboxDispatcher } from './services/moderation/ModerationOutboxDispatcher';
import { createOxyFilesWebhookRoutes } from './routes/oxyFilesWebhook';
import { fileReferenceSyncLoop } from './services/files/referenceSync';
import { startLegacyReadCounter, stopLegacyReadCounter } from './services/files/legacyReadCounter';
import { getErrorMessage } from './utils/errors';
import { createCapabilityLanes, mountCapabilityLanes } from './capabilities/mount';

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

import { oxyService as oxy, workloadCredentials } from './services/oxy';

const healthService = new HealthService();

/**
 * Options of every Oxy auth mount (the limiter's optional resolver and the
 * authenticated router). The service-token audience is the server's own
 * (`services/oxy.ts`), so no mount names it.
 */
const oxyAuthOptions = {
  auth: {
    /**
     * Why a credential was refused, in Homiio's own log.
     *
     * The middleware answers a fixed body and tells the client nothing, which
     * is right; the cost is that a refusal on the OPTIONAL path leaves no trace
     * at all — the request simply arrives unauthenticated and whatever answers
     * next (usually a generic 401) is all anyone sees. Oxy served an empty JWKS
     * (`{"keys":[]}`, no Ed25519 signing key bound) and that was the whole
     * symptom on this side: 401, no reason, hours to find. `code` is stable and
     * greppable; nothing from here reaches a response.
     */
    onRefusal: ({ code, stage, reason, status, optional }: OxyAuthRefusal) => {
      logger.warn('Oxy refused a credential', { code, stage, reason, status, optional });
    },
  },
} as const;

/**
 * Browser origins beside the Oxy apex family `createOxyCors` always admits.
 * `CORS_ALLOWED_ORIGINS` (comma-separated) adds a deployment's extra web origin,
 * such as a preview; an entry that is not an origin is dropped and logged by
 * the SDK. A native app sends no `Origin` and is not a CORS request.
 */
const appOrigins = [
  'https://homiio.com',
  'https://allo.you',
  'http://localhost:4130',
  'http://localhost:8130',
  'http://localhost:19006',
  'http://127.0.0.1:4130',
  'http://127.0.0.1:8130',
  'http://127.0.0.1:19006',
  ...(process.env.CORS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
];

/**
 * Open the store before serving traffic.
 *
 * Postgres is the only one, and it is not optional: every request path reads
 * it, and `getDb()` throws when no pool has been published. A process that
 * boots without it would answer its first request with a 500 instead of failing
 * at startup, so this exits non-zero.
 */
async function initializeDatabase() {
  try {
    await connectPostgres();
  } catch (error) {
    logger.error('Database initialization failed', { error: getErrorMessage(error) });
    process.exit(1);
  }
}

// Express setup
let activityReady = false;
const activity = startEcosystemTraffic({
  service: 'homiio',
  ready: () => activityReady,
  workloadCredentials,
});
const app = express();

// Which forwarding hops to believe, before anything reads `req.ip`: the socket
// peer only when it is private (the ALB), the hop before it only when it is a
// published Cloudflare edge, nothing further out. So `req.ip` is the person
// whether `api.homiio.com` is DNS-only (`client → ALB`) or proxied
// (`client → Cloudflare → ALB`), and a forged X-Forwarded-For is never
// believed. Every limiter key (`createOxyRateLimit`) and the GeoIP
// lookup (`services/geoip/clientIp.ts`) read `req.ip` and nothing else.
app.set('trust proxy', oxyTrustProxy);
app.use(activity.observeHttp);

/**
 * The capability catalogue's two MCP lanes — `/_oxy/mcp` (Alia, capability
 * tickets, host `api.homiio.com`) and `/mcp` (OAuth clients, host
 * `mcp.homiio.com`). FIRST, above helmet, CORS, the session middleware, the
 * rate limiter and every body parser: each lane owns its raw body, its host
 * check and its auth challenge (`capabilities/mount.ts`). Never on
 * `routes/public.ts`.
 */
const capabilityLanes = createCapabilityLanes();
mountCapabilityLanes(app, capabilityLanes);

// The Oxy baseline (Helmet + CSP). Helmet's CORP `same-origin` stays the
// default for API routes; image routes set `Cross-Origin-Resource-Policy:
// cross-origin` in imageController so listing photos embed from homiio.com
// without weakening CORP on sensitive endpoints.
app.use(createOxySecurityHeaders());

// Anonymous case cards have their own narrow browser integration policy.
app.use('/api/v1/cases', publicCaseCors);
app.use(createOxyCors({ appOrigins, exposedHeaders: ['Content-Length'] }));

// No request over the shared per-request budget, on any route: refused from
// its declared length, after CORS so a browser can read the answer and before
// anything buffers a byte (`middlewares/uploadBudget.ts`). The MCP lanes above
// carry their own, smaller cap.
app.use(rejectOversizedRequest);

// The SDK's budgets per 15 minutes: 5000 per validated session, 600 per salted
// hash of the client IP otherwise. Behind the ALB many people share one egress
// address, so the limiter resolves the session first and keys on it. The SDK
// exempts health probes, preflight and image fan-out; the upload door is
// Homiio's own addition.
app.use(
  '/api',
  createOxyRateLimit(oxy, {
    exempt: (req) => req.path.startsWith('/files/upload'),
    message: 'Too many requests.',
    auth: oxyAuthOptions.auth,
  }),
);

/**
 * CrowdSource webhook — mounted BEFORE every body parser, for the same reason
 * the Stripe webhook below is.
 *
 * The HMAC covers the bytes that arrived, and a JSON parser destroys them.
 * `@crowdsource.you/core/express` reads the raw body itself and refuses outright
 * rather than verifying a signature over a re-serialisation, so a late mount
 * fails every delivery loudly instead of silently trusting the wrong bytes.
 * `__tests__/integration/crowdSourceWebhookMount.test.ts` asserts that nothing
 * upstream has parsed the body by the time this route runs.
 *
 * Ahead of `apiLimiter` and outside `/api` deliberately: the signature IS the
 * authentication, Homiio's limiter keys on an authenticated Oxy user a webhook
 * will never have, and a 429 would put a real decision back on a retry schedule
 * for no reason.
 */
app.use('/webhooks', createCrowdSourceWebhookRoutes());

/**
 * Oxy file events (ADR 0043 D9): takedowns, deletions and visibility changes
 * of the files Homiio shows. Before every body parser and outside `/api`, for
 * the CrowdSource webhook's reasons — `routes/oxyFilesWebhook.ts`.
 */
app.use('/webhooks', createOxyFilesWebhookRoutes());

// Stripe webhook must be mounted BEFORE any body parser that consumes the body
app.post('/api/billing/webhook', bodyParser.raw({ type: '*/*' }), (req: Request, res: Response) => {
  const rawRequest = req as RawBodyRequest;
  if (Buffer.isBuffer(req.body)) {
    rawRequest.rawBody = req.body;
  }
  void stripeWebhook(rawRequest, res);
});

// Public confirm endpoint to finalize entitlements after redirect (does not require auth)
app.post(
  '/api/billing/confirm',
  bodyParser.json({ limit: '1mb' }),
  (req: Request, res: Response) => {
    void confirmCheckoutSession(req, res);
  },
);

// Pre-create body parsers to avoid re-creation per request
const jsonParser = bodyParser.json({ limit: '1mb' });
const urlencodedParser = bodyParser.urlencoded({ extended: true, limit: '1mb' });

// Apply body parser based on content type
app.use((req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('multipart/form-data')) {
    next();
  } else if (contentType.includes('application/json')) {
    jsonParser(req, res, next);
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    urlencodedParser(req, res, next);
  } else {
    next();
  }
});
app.use(requestLogger);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to the Homio API',
    version,
    description: 'Housing and rental solutions API',
    features: ['Property management', 'Room management', 'Oxy ecosystem integration'],
  });
});

/**
 * Health check endpoint (unauthenticated) — the ALB target-group check.
 *
 * Answers 200 whatever the database says, and reports the store's state in the
 * BODY. That split is the contract: the status code means "this task is
 * serving", and a Postgres outage is something every task shares, so failing
 * the check would drain them all and replace them with tasks that cannot boot
 * either (`initializeDatabase` exits non-zero without a pool). The probe it
 * calls is bounded and never throws, for the same reason.
 */
app.get('/health', async (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version,
    environment: config.environment,
    features: ['property-management', 'room-management'],
    database: {
      status: await healthService.getDatabaseHealth(),
    },
  });
});

// The v1 API keeps parser errors in its public contract as well.
app.use(publicApiBodyErrorHandler);

// Mount public API routes (no authentication required)
app.use('/api', publicRoutes());

// Mount authenticated API routes
app.use('/api', createOxyAuthMiddleware(oxy, oxyAuthOptions), routes());

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

const port = process.env.PORT || config.port;

// Start server with database initialization
async function startServer() {
  try {
    await initializeDatabase();

    const server = app.listen(port, () => {
      activityReady = true;
      // Register the catalogue now, so a refusal (a missing Oxy scope, a
      // catalogue Oxy will not parse) is in the boot log, not in Alia's first
      // call. A failure leaves `/_oxy/mcp` answering 503 and retrying.
      void capabilityLanes.internal.bound();
      logger.info(`Homio Backend running on port ${port} [${config.environment}]`);
      // Initialize cron jobs (only in non-serverless persistent environments)
      if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
        initCronJobs();
        /**
         * Drain the moderation outbox from every task.
         *
         * NOT leader-gated: each event is claimed with `FOR UPDATE SKIP LOCKED`
         * and an owner check, so the API and the worker share the queue and a task that
         * dies mid-delivery has its lease reclaimed rather than stranding the
         * work. No-ops when CROWDSOURCE_ENABLED=false, leaving the durable rows
         * intact so switching the flag on delivers the backlog instead of
         * losing it.
         */
        moderationOutboxDispatcher.start();
        /**
         * Register and remove Homiio's uses of Oxy files from every task — the
         * claim is `FOR UPDATE SKIP LOCKED` with a lease, like the outbox above
         * (`services/files/referenceSync.ts`).
         */
        fileReferenceSyncLoop.start();
        /**
         * Write the legacy photo door's counts every minute from boot, ZEROS
         * included, so a day nothing came through the door can be told from a
         * day nothing was counting (`services/files/legacyReadCounter.ts`).
         */
        startLegacyReadCounter();
      }
    });

    /**
     * Let an event already in flight reach a durable state before the process
     * goes away. `stop()` stops CLAIMING new work; it does not abandon a
     * delivery mid-call, which is what would leave a report's outbox row
     * `processing` until its lease expired.
     */
    let shuttingDown = false;
    const shutdown = async (signal: string): Promise<void> => {
      if (shuttingDown) return;
      shuttingDown = true;
      activityReady = false;
      logger.info('Stopping backend', { signal });
      const timeout = setTimeout(() => process.exit(1), 10_000);
      timeout.unref();
      await Promise.all([
        new Promise<void>((resolve) => server.close(() => resolve())),
        moderationOutboxDispatcher.stop(),
        fileReferenceSyncLoop.stop(),
        stopLegacyReadCounter(),
      ]);
      await activity.stop();
      clearTimeout(timeout);
      process.exit(0);
    };
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
    process.once('SIGINT', () => void shutdown('SIGINT'));

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        logger.error(`Port ${port} is already in use.`);
      } else {
        logger.error('Server error', { error: err.message, code: err.code });
      }
      process.exit(1);
    });
  } catch (error) {
    logger.error('Failed to start server', { error: getErrorMessage(error) });
    process.exit(1);
  }
}

// Export for serverless environments (Vercel)
export default app;

// For local development, start the server
if (process.env.NODE_ENV !== 'production' || process.env.VERCEL !== '1') {
  startServer();
}
