export interface Config {
  environment: string;
  port: number | string;
  oxy: {
    baseURL: string;
  };
  openai: {
    apiKey?: string;
    organization?: string;
    model: string;
  };
  telegram: {
    botToken?: string;
    enabled: boolean;
    defaultGroup: {
      id: string;
      language: string;
      name: string;
    };
    groups: Record<string, { language: string; name: string }>;
  };
  database: {
    url: string;
    options: {
      maxPoolSize: number;
      serverSelectionTimeoutMS: number;
      socketTimeoutMS: number;
    };
  };
  jwt: {
    secret: string;
    expiresIn: string;
    refreshSecret: string;
    refreshExpiresIn: string;
  };
  redis: {
    url: string;
    ttl: number;
  };
  email: {
    service: string;
    user?: string;
    password?: string;
  };
  rateLimit: {
    windowMs: number;
    max: number;
  };
  logging: {
    level: string;
    file: string;
  };
}

const config: Config = {
  // Environment
  environment: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 4000,
  
  // Oxy Services Configuration
  oxy: {
    baseURL: process.env.NODE_ENV === 'production' 
      ? process.env.OXY_API_URL || 'https://api.oxy.so'
      : 'http://localhost:3001',
  },
  
  // OpenAI Configuration
  openai: {
    apiKey: process.env.OPENAI_API_KEY,
    organization: process.env.OPENAI_ORG_ID,
    model: process.env.OPENAI_MODEL || 'gpt-4o',
  },
  
  // Telegram Bot Configuration
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN,
    enabled: process.env.TELEGRAM_NOTIFICATIONS_ENABLED === 'true',
    // Default group (Spanish)
    defaultGroup: {
      id: process.env.TELEGRAM_GROUP_DEFAULT || '-1002750613848',
      language: 'es', // Spanish as default
      name: 'Homiio España'
    },
    // Group configurations with language settings
    groups: {
      // Current Spanish group
      [process.env.TELEGRAM_GROUP_DEFAULT || '-1002750613848']: { 
        language: 'es', 
        name: 'Homiio España' 
      },
      // Future groups can be added here
      // [process.env.TELEGRAM_GROUP_US]: { language: 'en', name: 'Homiio US' }
    }
  },
  
  // Database Configuration
  database: {
    url: process.env.MONGODB_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/homiio',
    options: {
      // Modern MongoDB driver doesn't need these deprecated options
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    }
  },
  
  // JWT Configuration
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'your-refresh-secret-key',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
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
    file: process.env.LOG_FILE || (process.env.VERCEL ? '/tmp/app.log' : './logs/app.log'),
  },
};

export default config;
