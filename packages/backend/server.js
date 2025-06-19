const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { OxyServices } = require('@oxyhq/services/core');
const { version } = require('./package.json');

// Import our modules
const config = require('./config');
const routes = require('./routes');
const { errorHandler, logging } = require('./middlewares');

// Initialize OxyServices with your Oxy API URL
const isProduction = config.environment === 'production';
const oxyServices = new OxyServices({
  baseURL: config.oxy.baseURL
});

// Express setup
const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(logging.requestLogger);

// Create authentication middleware for Oxy integration
const authenticateToken = oxyServices.createAuthenticateTokenMiddleware({  
  loadFullUser: true,  
  onError: (error) => {  
    console.error('Auth error:', error);
  }  
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
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version,
    environment: config.environment,
    features: ['property-management', 'room-management', 'energy-monitoring']
  });
});

// Apply authentication middleware to API routes
app.use('/api', authenticateToken);

// Mount API routes
app.use('/api', routes);

// Test endpoint (authenticated)
app.post('/api/test', async (req, res) => {  
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

// Error handling middleware
app.use(logging.errorLogger);
app.use(errorHandler.notFound);
app.use(errorHandler.errorHandler);

// Test endpoint (authenticated)
app.post('/api/test', auth.authenticate, async (req, res) => {  
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

const port = config.port;

app.listen(port, () => {
  console.log(`🚀 Homio Backend running on port ${port}`);
  console.log(`Environment: ${config.environment}`);
  console.log('Features: Property & Room Management, Energy Monitoring');
  console.log('Available endpoints:');
  console.log('  GET  /health - Health check (public)');
  console.log('  GET  /api/health - API health check');
  console.log('  GET  /api/properties - List properties');
  console.log('  POST /api/properties - Create property (authenticated)');
  console.log('  GET  /api/properties/:id/rooms - List rooms in property');
  console.log('  POST /api/test - Test endpoint (authenticated)');
});

