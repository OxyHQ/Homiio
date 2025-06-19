const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { OxyServices } = require('@oxyhq/services/core');
const { version } = require('./package.json');

// Initialize OxyServices with your Oxy API URL
const isProduction = process.env.NODE_ENV === 'production';
const oxyServices = new OxyServices({
  baseURL: isProduction
    ? process.env.OXY_API_URL || 'https://api.oxy.so' // Use your prod API URL
    : 'http://localhost:3001', // Dev API URL
});

// Express setup
const app = express();
app.use(cors());
app.use(bodyParser.json());

// Create authentication middleware
const authenticateToken = oxyServices.createAuthenticateTokenMiddleware({  
  loadFullUser: true,  
  onError: (error) => {  
    console.error('Auth error:', error);
  }  
});

app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to the Homiio API',
    version
  });
});

// Health check endpoint (unauthenticated)
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    version,
    environment: process.env.NODE_ENV || 'development',
    apiUrl: isProduction ? process.env.OXY_API_URL : 'http://localhost:3001',
    features: ['device-based-auth', 'session-isolation', 'multi-user-support']
  });
});

// Apply authentication middleware to all other API routes
app.use('/api', authenticateToken);

// Messages endpoint (authenticated)
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

app.listen(4000, () => {
  console.log('🚀 Homiio Backend running on port 4000');
  console.log('Features: JWT Authentication with OxyServices');
  console.log('Available endpoints:');
  console.log('  GET  /api/health - Health check (public)');
  console.log('  POST /api/test - Send message (authenticated)');
});