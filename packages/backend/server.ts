// Load environment variables first
require('dotenv').config();

import express from "express";
import cors from 'cors';
import bodyParser from 'body-parser';
import { version } from './package.json';

import config from './config';
import routes from './routes';
import { requestLogger, errorLogger } from './middlewares/logging';
import { notFound, errorHandler } from './middlewares/errorHandler';
import database from './database/connection';
import publicRoutes from './routes/public';
import { OxyServices } from '@oxyhq/core';
import { stripeWebhook, confirmCheckoutSession } from './controllers/billingController';
import { initCronJobs } from './services/cron';

const oxy = new OxyServices({ baseURL: 'https://localhost:3001' });

const isDev = config.environment === 'development';

// Initialize database connection
async function initializeDatabase() {
  try {
    await database.connect();
  } catch (error) {
    console.error('Database initialization failed:', error.message);
    process.exit(1);
  }
}

// Express setup
const app = express();

// CORS configuration — O(1) Set lookup instead of Array.includes per request
const allowedOriginsSet = new Set([
  'https://homiio.com',
  'http://localhost:3000',
  'http://localhost:8081',
  'http://localhost:19006',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:8081',
  'http://127.0.0.1:19006',
  'http://192.168.86.44:8081'
]);
// Single combined regex for all private LAN ranges
const lanRegex = /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, server-to-server)
    if (!origin) return callback(null, true);

    // O(1) exact match
    if (allowedOriginsSet.has(origin)) return callback(null, true);

    // Allow Vercel preview deployments
    if (origin.endsWith('.vercel.app')) return callback(null, true);

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
const ensureDatabaseConnection = async (req: any, res: any, next: any) => {
  try {
    const status = database.getStatus();
    if (!status.isConnected || status.readyState !== 1) {
      try {
        await database.connect();
      } catch (connectError) {
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

// Stripe webhook must be mounted BEFORE any body parser that consumes the body
app.post('/api/billing/webhook', bodyParser.raw({ type: '*/*' }), (req, res, next) => {
  (req as any).rawBody = (req as any).body;
  return stripeWebhook(req as any, res as any);
});

// Public confirm endpoint to finalize entitlements after redirect (does not require auth)
app.post('/api/billing/confirm', bodyParser.json({ limit: '1mb' }), (req, res) => {
  return confirmCheckoutSession(req as any, res as any);
});

// Pre-create body parsers to avoid re-creation per request
const jsonParser = bodyParser.json({ limit: '25mb' });
const urlencodedParser = bodyParser.urlencoded({ extended: true, limit: '25mb' });

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
app.use('/api', oxy.auth(), routes());

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
      console.log(`Homio Backend running on port ${port} [${config.environment}]`);
      // Initialize cron jobs (only in non-serverless persistent environments)
      if (!process.env.VERCEL && !process.env.AWS_LAMBDA_FUNCTION_NAME) {
        initCronJobs();
      }
    });

    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use.`);
      } else {
        console.error('Server error:', err);
      }
      process.exit(1);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

// Export for serverless environments (Vercel)
module.exports = app;

// For local development, start the server
if (process.env.NODE_ENV !== 'production' || process.env.VERCEL !== '1') {
  startServer();
}
