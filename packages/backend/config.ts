import type { ModerationEnforcementMode } from '@homiio/shared-types';

/**
 * A positive integer from the environment, clamped to a sane band.
 *
 * A batch size of zero drains nothing and a poll interval of zero spins a task
 * at 100% CPU; both are typos rather than intentions, so they are corrected
 * rather than obeyed.
 */
function boundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = parseInt(raw || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
}

/**
 * A sampling probability in [0, 1], or 1 when the variable is absent or
 * unparseable.
 *
 * The fallback direction matters and is the opposite of `boundedInteger`'s
 * conservatism: a typo that read as 0 would silently stop recording while every
 * gate stayed green, which is exactly the "check that cannot fail" shape this
 * repository keeps finding. Recording too much is visible; recording nothing is
 * not.
 */
function observabilitySampleRate(raw: string | undefined): number {
  const parsed = Number.parseFloat(raw || '');
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(Math.max(parsed, 0), 1);
}

const CROWDSOURCE_ENFORCEMENT_MODES: readonly ModerationEnforcementMode[] = [
  'observe',
  'manual',
  'automatic',
];

/**
 * The configured enforcement mode, or `observe`.
 *
 * An unrecognised value falls back to `observe` rather than throwing: a typo in
 * a deploy variable must never be able to escalate what Homiio does to a
 * listing, and the safest reading of a mode nobody recognises is "do nothing".
 */
function crowdSourceEnforcementMode(raw: string | undefined): ModerationEnforcementMode {
  const candidate = (raw || '').trim();
  return CROWDSOURCE_ENFORCEMENT_MODES.find((mode) => mode === candidate) || 'observe';
}

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
  /**
   * PostgreSQL — the only database this service opens. There is no longer a
   * `database` key beside it: the Mongo connection is gone, so a second
   * connection-string key would describe a store nothing can reach.
   *
   * `url` stays optional in the TYPE because `connectPostgres()` is what fails,
   * loudly and with a message naming the missing variable. Making it required
   * here would move that failure to module load, where the only thing anyone
   * sees is a config file throwing.
   */
  postgres: {
    /** `DATABASE_URL`. Undefined only in an environment that never provisioned it. */
    url: string | undefined;
    /** Connections one process's pool may open. */
    maxPoolSize: number;
    /** Seconds an idle pooled connection is kept before being closed. */
    idleTimeoutSeconds: number;
    /** Seconds to wait for a new connection before giving up. */
    connectTimeoutSeconds: number;
    /** Seconds a connection may live before the pool recycles it. */
    maxLifetimeSeconds: number;
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
  /**
   * Privacy-safe product observability (#350). Off by default in every
   * environment: an events pipeline that starts recording because somebody
   * deployed is the opposite of the consent posture this feature is for.
   *
   * `sampleRate` applies to events that PASS redaction. Refusals are never
   * sampled away — see `packages/shared-types/src/observability/emitter.ts`.
   */
  observability: {
    enabled: boolean;
    sampleRate: number;
    /** Cap on events accepted from one ingest request. */
    maxEventsPerRequest: number;
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
    /**
     * Registered geocoding providers, MOST PREFERRED FIRST. The order is the
     * gateway's fallback order (`services/geocoding/registry.ts`). An id named
     * here with no adapter registered is skipped rather than faked, so listing
     * a provider that does not exist yet is inert rather than fatal.
     */
    providerOrder: readonly string[];
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
  /**
   * CrowdSource participatory moderation — reports leave Homiio for a randomly
   * drawn jury, and signed decisions come back.
   *
   * The variable names come from the PACKAGES, not from any plan document:
   * `@oxyhq/crowdsource` reads `CROWDSOURCE_SERVICE_KEY` and
   * `CROWDSOURCE_BASE_URL`, `@oxyhq/crowdsource-express` reads
   * `CROWDSOURCE_WEBHOOK_SECRET` and `CROWDSOURCE_WEBHOOK_SECRET_PREVIOUS`.
   *
   * There is deliberately NO `CROWDSOURCE_APP_ID`. The `applicationId` is read
   * off the service credential and no surface in the SDK can carry one, so a
   * variable holding it could only ever disagree with the credential — and a
   * request able to name its own tenant is the cross-tenant hole the whole
   * credential model exists to close.
   */
  crowdSource: {
    enabled: boolean;
    /** `applicationId:credentialId:secret` as ONE opaque value. */
    serviceKey?: string;
    /** Optional; the SDK defaults to the single deployment. */
    baseUrl?: string;
    webhookSecret?: string;
    /** Both secrets are accepted while one is being rotated. */
    webhookPreviousSecret?: string;
    outboxBatchSize: number;
    outboxPollIntervalMs: number;
    /**
     * How much of a decision Homiio may act on.
     *
     * `observe` is the default and the first deployment: decisions are received,
     * stored and PLANNED, every planned action is recorded as not applied, and
     * no listing is ever taken down. The mode is auditable rather than a no-op
     * precisely because the plan and the record are identical to production —
     * you can read exactly what would have happened before allowing it to.
     */
    enforcementMode: ModerationEnforcementMode;
  };
}

const config: Config = {
  // Environment
  environment: process.env.NODE_ENV || 'development',
  // Local dev default only — ECS injects PORT explicitly (oxy-infra
  // terraform-uswest2/app-services.tf sets it to 4000). 4130 is Homiio's slot
  // in the per-app port map so several Oxy backends can run side by side.
  port: parseInt(process.env.PORT || '4130', 10),
  
  // Oxy Services Configuration.
  // api.oxy.so is ALWAYS the default — deliberately no dev branch. Oxy owns the
  // account, and pointing identity at a machine-specific LAN address that is not
  // serving anything does not fail loudly, it just renders a signed-out app.
  // Override with OXY_API_URL when genuinely running an Oxy API yourself.
  oxy: {
    baseURL: process.env.OXY_API_URL || 'https://api.oxy.so',
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
  
  // PostgreSQL Configuration — the only database this service opens.
  //
  // `MONGODB_URI` is no longer read here, and its `|| 'mongodb://localhost:27017/homiio'`
  // fallback went with it rather than surviving as a term nothing consumes. A
  // fallback outlives the code that used it silently: it turns a missing secret
  // into a connection attempt against a host that is not there, which fails
  // slowly and describes the wrong problem. The variable stops being read in
  // the same change that stops the connection being opened.
  postgres: {
    // No fallback URL. A default like `postgres://localhost/homiio` would make
    // an unprovisioned deployment connect to nothing in particular and report a
    // connection error rather than the configuration error it is; `undefined`
    // lets `connectPostgres()` say exactly what is missing.
    url: process.env.DATABASE_URL,
    // 20 is sized for a long-lived API process. The jest harness overrides it
    // to 8 (`jest.globalSetup.ts`), which is a FLOOR rather than a preference —
    // see the constant there.
    maxPoolSize: boundedInteger(process.env.PG_MAX_POOL_SIZE, 20, 1, 200),
    // 30 suits a long-lived API process, where holding a warm connection is the
    // point. The jest harness overrides it to 1 (`jest.globalSetup.ts`), because
    // there a pool is ABANDONED rather than closed every time a test file ends —
    // see the constant there for why that is inherent to jest and not a bug in
    // any suite.
    idleTimeoutSeconds: boundedInteger(process.env.PG_IDLE_TIMEOUT_SECONDS, 30, 1, 3600),
    connectTimeoutSeconds: 10,
    maxLifetimeSeconds: 1800,
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
      : `http://localhost:${process.env.PORT || '4130'}`),
  
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

  // Privacy-safe product observability (#350). See the Config interface above:
  // OFF unless explicitly enabled, and a malformed sample rate reads as 1
  // rather than as 0 — a typo must not silently stop recording.
  observability: {
    enabled: process.env.OBSERVABILITY_ENABLED === 'true',
    sampleRate: observabilitySampleRate(process.env.OBSERVABILITY_SAMPLE_RATE),
    maxEventsPerRequest: boundedInteger(process.env.OBSERVABILITY_MAX_EVENTS_PER_REQUEST, 20, 1, 100),
  },

  // Web frontend base URL — single source for server-built deep links.
  web: {
    baseUrl: process.env.FRONTEND_URL ||
      (process.env.NODE_ENV === 'production' ? 'https://homiio.com' : 'http://localhost:8130'),
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
      const defaultFrontend = process.env.FRONTEND_URL || (isProd ? 'https://homiio.com' : 'http://localhost:8130');
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
    providerOrder: (process.env.GEOCODING_PROVIDER_ORDER || 'osm')
      .split(',')
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean),
  },

  // Overpass Configuration (OpenStreetMap POI lookup — free, no API key)
  overpass: {
    apiUrl: process.env.OVERPASS_API_URL || 'https://overpass-api.de/api/interpreter',
    // OSM requires a descriptive, identifying User-Agent on every request.
    userAgent: process.env.OVERPASS_USER_AGENT || process.env.GEOCODING_USER_AGENT || 'Homiio/1.0 (+https://homiio.com)',
  },

  // CrowdSource participatory moderation. Off by default: an unconfigured
  // deployment still STORES every report and still keeps its delivery events, so
  // switching this on delivers the backlog rather than stranding it.
  crowdSource: {
    enabled: process.env.CROWDSOURCE_ENABLED === 'true',
    serviceKey: process.env.CROWDSOURCE_SERVICE_KEY,
    baseUrl: process.env.CROWDSOURCE_BASE_URL,
    webhookSecret: process.env.CROWDSOURCE_WEBHOOK_SECRET,
    webhookPreviousSecret: process.env.CROWDSOURCE_WEBHOOK_SECRET_PREVIOUS,
    outboxBatchSize: boundedInteger(process.env.CROWDSOURCE_OUTBOX_BATCH_SIZE, 50, 1, 500),
    outboxPollIntervalMs: boundedInteger(
      process.env.CROWDSOURCE_OUTBOX_POLL_INTERVAL_MS,
      5_000,
      250,
      300_000,
    ),
    enforcementMode: crowdSourceEnforcementMode(process.env.CROWDSOURCE_ENFORCEMENT_MODE),
  },
};

/**
 * A half-configured integration is worse than a disabled one.
 *
 * With a service key and no webhook secret, reports leave Homiio and no decision
 * can ever be verified coming back; with a webhook secret and no service key,
 * nothing ever leaves. Either way the gap is invisible until somebody wonders
 * months later why a case never returned, so both directions are required
 * together and the process refuses to boot without them.
 *
 * Thrown at module load rather than checked at the first delivery: a
 * misconfiguration that surfaces on deploy is a rollback, and one that surfaces
 * on the first report is lost moderation work.
 */
if (config.crowdSource.enabled) {
  const missing = [
    config.crowdSource.serviceKey ? null : 'CROWDSOURCE_SERVICE_KEY',
    config.crowdSource.webhookSecret ? null : 'CROWDSOURCE_WEBHOOK_SECRET',
  ].filter((name): name is string => name !== null);
  if (missing.length > 0) {
    throw new Error(
      `CROWDSOURCE_ENABLED=true requires ${missing.join(' and ')}. Reports would leave ` +
        'Homiio with no way for a decision to come back, or never leave at all.',
    );
  }
}

export default config;
