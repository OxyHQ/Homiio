// Load environment variables first
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { version } = require('./package.json');

// Import our modules
const config = require('./config');
const routes = require('./routes');
const logging = require('./middlewares/logging');
const { notFound, errorHandler } = require('./middlewares/errorHandler');
const database = require('./database/connection');
const oxyServices = require('./services/oxyServices');

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
      'https://www.homiio.com',
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

// Middleware
app.use(cors(corsOptions));
app.use(bodyParser.json());
app.use(logging.requestLogger);

// Create authentication middleware for Oxy integration
const authenticateToken = oxyServices.createAuthenticateTokenMiddleware({  
  loadFullUser: true,  
  onError: (error) => {  
    console.error('Auth error:', error);
    // Don't throw error for expired tokens, let the route handle it
    if (error.message && error.message.includes('No refresh token available')) {
      console.warn('JWT token expired and no refresh token available - user needs to re-authenticate');
    }
  }  
});

// Custom middleware to extract Oxy user ID with better error handling
const extractOxyUserId = (req, res, next) => {
  try {
    if (req.user) {
      req.userId = req.user.id || req.user._id;
      console.log(`[extractOxyUserId] User authenticated: ${req.userId}`, {
        hasUser: !!req.user,
        userId: req.userId,
        userFields: req.user ? Object.keys(req.user) : []
      });
    } else {
      console.log('[extractOxyUserId] No user object found in request');
      req.userId = null;
    }
  } catch (error) {
    console.error('[extractOxyUserId] Error extracting user ID:', error);
    req.userId = null;
  }
  next();
};

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
const publicRoutes = require('./routes/public');
app.use('/api', publicRoutes());

// Mount authenticated API routes
app.use('/api', authenticateToken, extractOxyUserId, routes());

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

// Test endpoint (authenticated)
app.post('/api/test', authenticateToken, async (req, res) => {
  try {  
    const { title, content } = req.body;
      
    res.json({   
      success: true,
      userId: req.userId,
      user: {
        id: req.user.id || req.user._id,
        username: req.user.username,
        email: req.user.email
      },
      message: 'Test run successfully',
      data: { title, content },
      timestamp: new Date().toISOString()
    });  
  } catch (error) {  
    res.status(500).json({ error: error.message });  
  }  
});

// Debug endpoint to check authentication status
app.get('/api/debug/auth', authenticateToken, (req, res) => {
  res.json({
    success: true,
    authenticated: true,
    userId: req.userId,
    user: req.user ? {
      id: req.user.id || req.user._id,
      username: req.user.username,
      email: req.user.email,
      fields: Object.keys(req.user)
    } : null,
    headers: {
      authorization: req.headers.authorization ? 'present' : 'missing',
      'user-agent': req.headers['user-agent']
    },
    timestamp: new Date().toISOString()
  });
});

// Debug endpoint without authentication to check what happens
app.get('/api/debug/no-auth', (req, res) => {
  res.json({
    success: true,
    authenticated: false,
    userId: req.userId,
    user: req.user,
    headers: {
      authorization: req.headers.authorization ? 'present' : 'missing',
      'user-agent': req.headers['user-agent']
    },
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use(logging.errorLogger);
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
    server.on('error', (err) => {
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

// Start the server
startServer();

// Export app for testing purposes
module.exports = {
  app
};

