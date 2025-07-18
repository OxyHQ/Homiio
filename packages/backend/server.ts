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

import { OxyServices } from '@oxyhq/services/core';

const oxy = new OxyServices({
  baseURL: 'http://localhost:3001'
});

// Initialize database connection
async function initializeDatabase() {
  try {
    await database.connect();
    console.log('✅ Database initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    process.exit(1);
  }
}

// Express setup
const app = express();

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    console.log('CORS Origin Check:', origin);
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      console.log('CORS: Allowing request with no origin');
      return callback(null, true);
    }
    
    const allowedOrigins = [
      'https://homiio.com',
      'http://localhost:3000',
      'http://localhost:8081',
      'http://localhost:19006', // Expo web dev
      'http://127.0.0.1:3000',
      'http://127.0.0.1:8081',
      'http://127.0.0.1:19006'
    ];
    
    // In development, allow all localhost origins
    if (config.environment === 'development') {
      if (origin && (origin.includes('localhost') || origin.includes('127.0.0.1'))) {
        console.log('CORS: Allowing development origin:', origin);
        return callback(null, true);
      }
    }
    
    if (allowedOrigins.includes(origin)) {
      console.log('CORS: Allowing whitelisted origin:', origin);
      return callback(null, true);
    }
    
    console.log('CORS: Rejecting origin:', origin);
    // Don't throw an error, just reject silently
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
  exposedHeaders: ['Content-Length', 'X-Foo', 'X-Bar'],
  maxAge: 86400 // 24 hours
};

// Database connection middleware for serverless environments
const ensureDatabaseConnection = async (req: any, res: any, next: any) => {
  try {
    const status = database.getStatus();
    console.log('📦 Database status check:', status);
    
    if (!status.isConnected || status.readyState !== 1) {
      console.log('📦 Ensuring database connection for request...');
      try {
        await database.connect();
        console.log('✅ Database connection established');
      } catch (connectError) {
        console.error('❌ Initial connection failed, trying force reconnect...');
        await database.forceReconnect();
        console.log('✅ Database force reconnection successful');
      }
    }
    next();
  } catch (error) {
    console.error('❌ Database connection failed in middleware:', error.message);
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
app.use(bodyParser.json());
app.use(requestLogger);

// Apply database middleware in serverless environments (before routes)
if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
  console.log('🔧 Applying database middleware for serverless environment');
  app.use(ensureDatabaseConnection);
}

// Use OxyHQServices middleware for authentication
const authenticateToken = oxy.createAuthenticateTokenMiddleware({
  loadFullUser: true,
  onError: (error, req, res, next) => {
  console.error('Auth error:', error);
  let status = 403;
  let message = 'Unknown error';
  if (error && typeof error === 'object') {
    if (typeof error.status === 'number') status = error.status;
    if (typeof error.message === 'string') message = error.message;
  }
  res.status(status).json({ error: message });
}
});

app.use((req, res, next) => {
  console.log('Authorization header:', req.headers.authorization);
  next();
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to the Homio API',
    version,
    description: 'Housing and rental solutions API',
    features: [
      'Property management',
      'Room management', 
      'Energy monitoring',
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
    features: ['property-management', 'room-management', 'energy-monitoring'],
    database: {
      status: dbHealth.status,
      message: dbHealth.message
    }
  });
});

// Mount public API routes (no authentication required)
app.use('/api', publicRoutes());

// Mount authenticated API routes
app.use('/api', authenticateToken, routes());

// Temporary test route without authentication to verify route mounting
app.get('/api/test-routes', (req, res) => {
  res.json({
    message: 'Routes are mounted correctly',
    timestamp: new Date().toISOString(),
    availableRoutes: [
      'GET /api/health',
      'GET /api/profiles/me',
      'POST /api/profiles/me/save-property',
      'DELETE /api/profiles/me/saved-properties/:propertyId',
      'PUT /api/profiles/me/saved-properties/:propertyId/notes'
    ]
  });
});

// Error handling middleware
app.use(errorLogger);
app.use(notFound);
app.use(errorHandler);

const port = process.env.PORT || config.port;

// Start server with database initialization
async function startServer() {
  try {
    // Initialize database first
    await initializeDatabase();
    
    // Start the Express server
    const server = app.listen(port, () => {
      console.log(`🚀 Homio Backend running on port ${port}`);
      console.log(`Environment: ${config.environment}`);
      console.log('Features: Property & Room Management, Energy Monitoring, AI Streaming');
      console.log('Available endpoints:');
      console.log('  GET  /health - Health check (public)');
      console.log('  GET  /api/health - API health check');
      console.log('  GET  /api/properties - List properties');
      console.log('  GET  /api/properties/search - Search properties');
      console.log('  POST /api/properties - Create property (authenticated)');
      console.log('  GET  /api/properties/:id/rooms - List rooms in property');
      console.log('  GET  /api/properties/:id/stats - Property statistics (authenticated)');
      console.log('  GET  /api/properties/:id/rooms/:roomId/stats - Room statistics (authenticated)');
      console.log('  GET  /api/analytics - User analytics (authenticated)');
      console.log('  POST /api/test - Test endpoint (authenticated)');
      console.log('  POST /api/ai/stream - AI text streaming (authenticated)');
      console.log('  POST /api/ai/chat - AI chat completion (authenticated)');
      console.log('  GET  /api/ai/health - AI service health check');
    });

    // Handle EADDRINUSE gracefully
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${port} is already in use. Please stop the other process or use a different port (set PORT env variable).`);
        process.exit(1);
      } else {
        console.error('❌ Server error:', err);
        process.exit(1);
      }
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

// Export for serverless environments (Vercel)
module.exports = app;

// For local development, start the server
if (process.env.NODE_ENV !== 'production' || process.env.VERCEL !== '1') {
  startServer();
}

