const config = {
  // Environment
  environment: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 4000,
  
  // Oxy Services Configuration
  oxy: {
    baseURL: process.env.NODE_ENV === 'production' 
      ? process.env.OXY_API_URL || 'https://api.oxy.so'
      : 'http://localhost:3001',
    apiKey: process.env.OXY_API_KEY,
  },
  
  // Database Configuration
  database: {
    url: process.env.DATABASE_URL || 'mongodb://localhost:27017/homiio',
    options: {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    }
  },
  
  // FairCoin Integration
  fairCoin: {
    apiUrl: process.env.FAIRCOIN_API_URL || 'https://api.faircoin.co',
    apiKey: process.env.FAIRCOIN_API_KEY,
    webhookSecret: process.env.FAIRCOIN_WEBHOOK_SECRET,
  },
  
  // Horizon Integration
  horizon: {
    apiUrl: process.env.HORIZON_API_URL || 'https://api.horizon.oxy.so',
    apiKey: process.env.HORIZON_API_KEY,
  },
  
  // JWT Configuration
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  
  // Redis Configuration (for caching and sessions)
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    ttl: process.env.REDIS_TTL || 3600, // 1 hour
  },
  
  // Email Configuration
  email: {
    service: process.env.EMAIL_SERVICE || 'gmail',
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASSWORD,
  },
  
  // Rate Limiting
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
  },
  
  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || './logs/app.log',
  },
};

module.exports = config;
