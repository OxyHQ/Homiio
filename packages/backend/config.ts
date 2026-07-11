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
  redis: {
    url: string;
    ttl: number;
  };
  /**
   * Listing-ingestion worker + queue settings. `enabled` is env-gated on an
   * explicit `REDIS_URL`; without it the worker falls back to inline processing.
   */
  listingWorker: {
    /** Whether a real Redis/Valkey URL is configured (enables BullMQ). */
    redisConfigured: boolean;
    /** BullMQ key prefix (Oxy convention `bull:homiio-listings`). */
    queuePrefix: string;
    /** Enqueue an initial discover pass on worker boot (default false). */
    discoverOnBoot: boolean;
    /**
     * Repeat discover every N hours via BullMQ schedulers. `0` or unset =
     * boot-only (when `discoverOnBoot` is true). Requires Redis.
     */
    discoverIntervalHours: number;
  };
  /**
   * Admin gate. Only these Oxy user ids may call privileged endpoints (e.g.
   * `/api/scraper/*`). Sourced from `HOMIIO_ADMIN_OXY_USER_IDS` (comma-separated).
   * An empty list denies everyone — privileged routes are locked until set.
   */
  admin: {
    oxyUserIds: string[];
  };
  email: {
    service: string;
    user?: string;
    password?: string;
  };
  s3: {
    /** Custom S3-compatible endpoint. Empty = native AWS S3. */
    endpoint: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
  };
  /** Public, externally-reachable base URL of this backend (no trailing slash). */
  publicUrl: string;
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
  web: {
    /**
     * Public base URL of the Homiio web/app frontend. Sourced from
     * `FRONTEND_URL`, falling back to the production domain or the local Expo
     * dev server. The single place server-built deep links (e.g. partner
     * referral links) are derived from, so they can never hardcode a host.
     */
    baseUrl: string;
  };
  geocoding: {
    /**
     * Base URL of the Nominatim (OpenStreetMap) instance used for forward
     * and reverse geocoding. Defaults to the public OSM endpoint, which is
     * free and requires no API key.
     */
    nominatimBaseUrl: string;
    /**
     * Descriptive User-Agent sent with every Nominatim request. The OSM
     * usage policy REQUIRES an identifying User-Agent; requests without one
     * are blocked. See https://operations.osmfoundation.org/policies/nominatim/
     */
    userAgent: string;
    /** Optional Referer header, also accepted by the OSM usage policy. */
    referer?: string;
    /**
     * Minimum milliseconds between Nominatim request *starts*. The OSM usage
     * policy caps the public endpoint at ~1 req/sec, so every network call is
     * serialized behind this interval — both to stay within policy AND to avoid
     * self-inflicted 429s when a high-volume ingest floods the geocoder. Set to
     * `0` (via `GEOCODING_MIN_INTERVAL_MS`) when pointing at a self-hosted
     * Nominatim that has no such limit.
     */
    minIntervalMs: number;
  };
  overpass: {
    /**
     * Endpoint URL of the Overpass API instance used to look up nearby
     * points of interest. Defaults to the public OSM Overpass endpoint,
     * which is free and requires no API key. Like Nominatim it is rate-limited
     * and REQUIRES a descriptive User-Agent; results are cached aggressively to
     * stay within the usage policy.
     * See https://wiki.openstreetmap.org/wiki/Overpass_API
     */
    apiUrl: string;
    /**
     * Descriptive User-Agent sent with every Overpass request. Reuses the
     * geocoding User-Agent by default so all OSM-bound traffic identifies the
     * same way.
     */
    userAgent: string;
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
  
  // Redis Configuration (for caching and sessions)
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    ttl: parseInt(process.env.REDIS_TTL || '3600', 10), // 1 hour
  },

  // Listing-ingestion worker + queue (BullMQ on the existing REDIS_URL).
  listingWorker: {
    redisConfigured: Boolean(process.env.REDIS_URL),
    // Oxy convention: queue/prefix names must not contain ':'; BullMQ joins the
    // prefix and queue name with ':' itself, so keep our parts colon-free.
    queuePrefix: process.env.LISTING_QUEUE_PREFIX || 'bull-homiio-listings',
    discoverOnBoot: process.env.LISTING_DISCOVER_ON_BOOT === 'true',
    discoverIntervalHours: Math.max(
      0,
      parseInt(process.env.LISTING_DISCOVER_INTERVAL_HOURS || '0', 10) || 0,
    ),
  },

  // Admin gate for privileged endpoints (scraper/ingestion management).
  admin: {
    oxyUserIds: (process.env.HOMIIO_ADMIN_OXY_USER_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  },
  
  // Email Configuration
  email: {
    service: process.env.EMAIL_SERVICE || 'gmail',
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASSWORD,
  },
  
  // Object storage — native AWS S3 in production (oxy-infra media bucket).
  // Set AWS_ENDPOINT_URL only for S3-compatible mocks / local MinIO; leave
  // unset for real AWS so the SDK uses the regional endpoint.
  s3: {
    endpoint: (process.env.AWS_ENDPOINT_URL || '').trim(),
    region: process.env.AWS_REGION || 'us-west-2',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
    bucketName: process.env.AWS_S3_BUCKET || 'homiio-images',
  },

  // Public, externally-reachable base URL of THIS backend. Used to build
  // absolute URLs the client can fetch directly — most importantly the
  // self-hosted local image store served at `/api/images/file/*` when object
  // storage (S3) is not configured. Sourced from `PUBLIC_API_URL`, falling back
  // to the local dev server. (For an Android emulator pointing at the host's
  // 10.0.2.2 alias, set `PUBLIC_API_URL=http://10.0.2.2:<port>`.)
  publicUrl: process.env.PUBLIC_API_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://api.homiio.com'
      : `http://localhost:${process.env.PORT || '4000'}`),
  
  // Rate Limiting. The global API limiter (server.ts) keys per authenticated
  // user with realistic media-app budgets (see AUTHENTICATED_RATE_LIMIT_MAX /
  // UNAUTHENTICATED_RATE_LIMIT_MAX) and only consumes `windowMs` from here.
  // `max` is retained as the legacy/anonymous fallback documented value.
  rateLimit: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 600, // anonymous per-IP fallback budget per window
  },
  
  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    file: process.env.LOG_FILE || (process.env.VERCEL ? '/tmp/app.log' : './logs/app.log'),
  },
  
  // Web frontend base URL — single source for server-built deep links.
  web: {
    baseUrl: process.env.FRONTEND_URL ||
      (process.env.NODE_ENV === 'production' ? 'https://homiio.com' : 'http://localhost:8081'),
  },

  // Stripe Configuration (optional)
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    pricePlus: process.env.STRIPE_PRICE_PLUS,
    priceFile: process.env.STRIPE_PRICE_FILE,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    // Automatic URLs based on NODE_ENV:
    // - In development: always use the web base URL (localhost) to avoid redirecting to production
    // - In production: allow STRIPE_* overrides, else default to the web base URL
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
  
  // Geocoding Configuration (Nominatim / OpenStreetMap — free, no API key)
  geocoding: {
    nominatimBaseUrl: process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org',
    // OSM requires a descriptive, identifying User-Agent on every request.
    userAgent: process.env.GEOCODING_USER_AGENT || 'Homiio/1.0 (+https://homiio.com)',
    referer: process.env.GEOCODING_REFERER || 'https://homiio.com',
    minIntervalMs: parseInt(process.env.GEOCODING_MIN_INTERVAL_MS || '1000', 10),
  },

  // Overpass Configuration (OpenStreetMap POI lookup — free, no API key)
  overpass: {
    apiUrl: process.env.OVERPASS_API_URL || 'https://overpass-api.de/api/interpreter',
    // OSM requires a descriptive, identifying User-Agent on every request.
    userAgent: process.env.OVERPASS_USER_AGENT || process.env.GEOCODING_USER_AGENT || 'Homiio/1.0 (+https://homiio.com)',
  }
};

export default config;
