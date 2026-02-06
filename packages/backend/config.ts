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
      dbName: string;
      maxPoolSize: number;
      serverSelectionTimeoutMS: number;
      socketTimeoutMS: number;
      connectTimeoutMS?: number;
      bufferCommands?: boolean;
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
  s3: {
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
  };
  rateLimit: {
    windowMs: number;
    max: number;
  };
  logging: {
    level: string;
    file: string;
  };
  stripe?: {
    secretKey?: string;
    pricePlus?: string;
    priceFile?: string;
    webhookSecret?: string;
    successUrl?: string;
    cancelUrl?: string;
  };
  mapbox?: {
    token?: string;
  };
}

const config: Config = {
  // Environment
  environment: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  
  // Oxy Services Configuration
  oxy: {
    baseURL: process.env.NODE_ENV === 'production' 
      ? process.env.OXY_API_URL || 'https://api.oxy.so'
      : 'http://192.168.86.44:3001',
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
      dbName: `homiio-${process.env.NODE_ENV || 'development'}`,
      // Optimized for serverless environments
      maxPoolSize: process.env.VERCEL ? 1 : 10, // Smaller pool for serverless
      serverSelectionTimeoutMS: process.env.VERCEL ? 30000 : 5000, // Longer timeout for serverless
      socketTimeoutMS: process.env.VERCEL ? 60000 : 45000, // Longer socket timeout for serverless
      connectTimeoutMS: process.env.VERCEL ? 30000 : 10000, // Connection timeout
      bufferCommands: false, // Disable buffering for serverless
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
    ttl: parseInt(process.env.REDIS_TTL || '3600', 10), // 1 hour
  },
  
  // Email Configuration
  email: {
    service: process.env.EMAIL_SERVICE || 'gmail',
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASSWORD,
  },
  
  // S3 Configuration (DigitalOcean Spaces)
  s3: {
    endpoint: process.env.AWS_ENDPOINT_URL || 'https://nyc3.digitaloceanspaces.com',
    region: process.env.AWS_REGION || 'nyc3',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    bucketName: process.env.AWS_S3_BUCKET || 'homiio-images',
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
  
  // Stripe Configuration (optional)
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    pricePlus: process.env.STRIPE_PRICE_PLUS,
    priceFile: process.env.STRIPE_PRICE_FILE,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    // Automatic URLs based on NODE_ENV:
    // - In development: always use FRONTEND_URL (or localhost) to avoid redirecting to production
    // - In production: allow STRIPE_* overrides, else default to homiio.com
    ...((): { successUrl: string; cancelUrl: string } => {
      const isProd = process.env.NODE_ENV === 'production';
      const defaultFrontend = process.env.FRONTEND_URL || (isProd ? 'https://homiio.com' : 'http://localhost:8081');
      const successDefault = `${defaultFrontend}/payments/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelDefault = `${defaultFrontend}/payments/cancelled`;
      return {
        successUrl: isProd ? (process.env.STRIPE_SUCCESS_URL || successDefault) : successDefault,
        cancelUrl: isProd ? (process.env.STRIPE_CANCEL_URL || cancelDefault) : cancelDefault,
      };
    })(),
  },
  
  // Mapbox Configuration
  mapbox: {
    token: process.env.MAPBOX_TOKEN,
  }
};

export default config;
