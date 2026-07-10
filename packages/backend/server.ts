// Load environment variables first
require('dotenv').config();

import express from "express";
import type { Request, Response, NextFunction } from 'express';
import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import bodyParser from 'body-parser';
import { version } from './package.json';

import config from './config';
import routes from './routes';
import { logger, requestLogger, errorLogger } from './middlewares/logging';
import { notFound, errorHandler } from './middlewares/errorHandler';
import database from './database/connection';
import publicRoutes from './routes/public';
import { OxyServices } from '@oxyhq/core';
import { createOptionalOxyAuth, createOxyAuthMiddleware } from '@oxyhq/core/server';
import { stripeWebhook, confirmCheckoutSession } from './controllers/billingController';
import { initCronJobs } from './services/cron';
import { getErrorMessage } from './utils/errors';

interface RawBodyRequest extends Request {
  rawBody?: Buffer;
}

const oxy = new OxyServices({ baseURL: config.oxy.baseURL });

const isDev = config.environment === 'development';

/**
 * Per-window rate-limit budgets (window = config.rateLimit.windowMs, 15 min).
 *
 * Homiio fans out into many small GETs per screen (property cards, city tiles,
 * cover/gallery images, geocoding lookups). Behind the AWS ALB many clients
 * share one egress IP, so the previous IP-keyed `max: 100` bucket (config.ts)
 * was shared across all users and exhausted almost instantly — the cause of the
 * frequent 429s. We now resolve the user BEFORE the limiter and key per user,
 * with realistic media-app budgets.
 */
const AUTHENTICATED_RATE_LIMIT_MAX = 5000; // ~5.5 req/sec sustained per user
const UNAUTHENTICATED_RATE_LIMIT_MAX = 600; // ~0.66 req/sec per anonymous IP

/**
 * Resolve the user from the bearer token WITHOUT rejecting unauthenticated
 * requests, via the shared `@oxyhq/core/server` helper. It is idempotent (skips
 * re-verification when a prior pass already resolved the user) and a
 * failed/expired token never blocks public traffic.
 *
 * Runs BEFORE the global rate limiter so the limiter can key/scale per user
 * instead of per shared egress IP behind the ALB.
 */
const optionalAuth = createOptionalOxyAuth(oxy);

/**
 * Paths exempt from the global API rate limiter.
 *
 * Image bytes (self-hosted store + uploads) and AI streaming sub-requests fan
 * out heavily and are individually authorised/validated, so counting each one
 * against the coarse global bucket exhausts it. Liveness probes must never be
 * limited. Shared by the rate limiter's `skip` so the policy lives in one place.
 */
const isRateLimitExempt = (req: Request): boolean => {
  const path = req.path;
  return (
    // Liveness/readiness probes from the ALB/ECS.
    path === '/health' ||
    // Self-hosted image store + image upload endpoints (per-screen fan-out).
    path.startsWith('/api/images/') ||
    path.includes('/images/') ||
    path.startsWith('/api/files/upload') ||
    // AI streaming (SSE) sub-requests are long-lived and self-limited.
    path.startsWith('/api/ai/stream') ||
    path.startsWith('/api/ai/analyze-file/stream')
  );
};

/**
 * Per-user (authenticated) or per-IP (anonymous) key. Using the user id avoids
 * the shared-IP collision behind the ALB; `ipKeyGenerator` handles IPv6 subnets.
 */
const rateLimitKey = (req: Request): string => {
  const userId = req.user?.id || req.user?._id;
  if (userId) {
    return `user:${userId}`;
  }
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return ipKeyGenerator(ip);
};

// Initialize database connection
async function initializeDatabase() {
  try {
    await database.connect();
  } catch (error) {
    logger.error('Database initialization failed', { error: getErrorMessage(error) });
    process.exit(1);
  }
}

// Express setup
const app = express();

// Behind AWS ALB — trust the first proxy hop so req.ip reflects the client IP
app.set('trust proxy', 1);

// CORP must be cross-origin: Homiio's web app (homiio.com / Expo web) loads
// listing images from api.homiio.com. Helmet's default `same-origin` CORP
// triggers `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin` in <img>/canvas.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }),
);

// CORS configuration — O(1) Set lookup instead of Array.includes per request
const allowedOriginsSet = new Set([
  'https://homiio.com',
  'http://localhost:3000',
  'http://localhost:8081',
  'http://localhost:19006',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:19006'
]);
// Extra production web origins (e.g. Cloudflare Pages), comma-separated
for (const origin of (process.env.CORS_ALLOWED_ORIGINS || '').split(',')) {
  const trimmed = origin.trim();
  if (trimmed) allowedOriginsSet.add(trimmed);
}
// Single combined regex for all private LAN ranges
const lanRegex = /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);

    // O(1) exact match
    if (allowedOriginsSet.has(origin)) return callback(null, true);

    // In development, allow localhost and private LAN IPs
    if (isDev) {
      if (origin.includes('localhost') || origin.includes('127.0.0.1') || lanRegex.test(origin)) {
        return callback(null, true);
      }
    }

    return callback(null, false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'Cache-Control',
    'Pragma'
  ],
  exposedHeaders: ['Content-Length'],
  maxAge: 86400
};

// Database connection middleware for serverless environments
const ensureDatabaseConnection = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const status = database.getStatus();
    if (!status.isConnected || status.readyState !== 1) {
      try {
        await database.connect();
      } catch (connectError) {
        logger.warn('Database reconnect required', { error: getErrorMessage(connectError) });
        await database.forceReconnect();
      }
    }
    next();
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        message: 'Database connection failed',
        code: 'DATABASE_ERROR',
        statusCode: 500
      }
    });
  }
};

// Middleware
app.use(cors(corsOptions));

// Resolve the user BEFORE rate limiting so the limiter keys per authenticated
// user (high budget) rather than per shared egress IP behind the ALB. Strict
// `oxy.auth()` still guards the protected routers below.
app.use(optionalAuth);

const apiLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  // Per-user budget for authenticated traffic; smaller per-IP budget for
  // anonymous traffic. Authenticated users are keyed individually, so a busy
  // user can no longer exhaust the shared-IP bucket.
  max: (req: Request): number =>
    req.user?.id || req.user?._id
      ? AUTHENTICATED_RATE_LIMIT_MAX
      : UNAUTHENTICATED_RATE_LIMIT_MAX,
  keyGenerator: rateLimitKey,
  standardHeaders: true,
  legacyHeaders: false,
  skip: isRateLimitExempt,
});
app.use('/api', apiLimiter);

// Stripe webhook must be mounted BEFORE any body parser that consumes the body
app.post('/api/billing/webhook', bodyParser.raw({ type: '*/*' }), (req: Request, res: Response) => {
  const rawRequest = req as RawBodyRequest;
  if (Buffer.isBuffer(req.body)) {
    rawRequest.rawBody = req.body;
  }
  void stripeWebhook(rawRequest, res);
});

// Public confirm endpoint to finalize entitlements after redirect (does not require auth)
app.post('/api/billing/confirm', bodyParser.json({ limit: '1mb' }), (req: Request, res: Response) => {
  void confirmCheckoutSession(req, res);
});

// Pre-create body parsers to avoid re-creation per request
const jsonParser = bodyParser.json({ limit: '1mb' });
const urlencodedParser = bodyParser.urlencoded({ extended: true, limit: '1mb' });
// AI chat accepts inline data-URL attachments (<IMAGE_DATA_URL>/<FILE_DATA_URL>) in JSON
const aiJsonParser = bodyParser.json({ limit: '25mb' });
app.use('/api/ai', (req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('application/json')) {
    return aiJsonParser(req, res, next);
  }
  next();
});

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

// Apply database middleware in serverless environments (before routes)
if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
  app.use(ensureDatabaseConnection);
}

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to the Homio API',
    version,
    description: 'Housing and rental solutions API',
    features: [
      'Property management',
      'Room management',
      'Oxy ecosystem integration'
    ]
  });
});

// Health check endpoint (unauthenticated)
app.get('/health', async (req, res) => {
  const dbHealth = await database.healthCheck();

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version,
    environment: config.environment,
    features: ['property-management', 'room-management'],
    database: {
      status: dbHealth.status,
      message: dbHealth.message
    }
  });
});

// Mount public API routes (no authentication required)
app.use('/api', publicRoutes());

// Mount authenticated API routes
app.use('/api', createOxyAuthMiddleware(oxy), routes());

// Error handling middleware
app.use(errorLogger);
app.use(notFound);
app.use(errorHandler);

const port = process.env.PORT || config.port;

// Start server with database initialization
async function startServer() {
  try {
    await initializeDatabase();

    const server = app.listen(port, () => {
      logger.info(`Homio Backend running on port ${port} [${config.environment}]`);
      // Initialize cron jobs (only in non-serverless persistent environments)
      if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
        initCronJobs();
      }
    });

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
module.exports = app;

// For local development, start the server
if (process.env.NODE_ENV !== 'production' || process.env.VERCEL !== '1') {
  startServer();
}
