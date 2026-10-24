import path from 'node:path';

/**
 * WHICH LINKS THE BUILT APP CLAIMS.
 *
 * The dev-only `http://localhost:4130` link host was gated on
 * `IS_DEV = !IS_TESTFLIGHT || !IS_PRODUCTION`, which is true for every build, so
 * every release build shipped it — inside the `autoVerify` filter, where an http
 * host can never verify. The development variant is now chosen explicitly with
 * `APP_VARIANT=development`, and this asserts what each variant claims.
 */

interface IntentFilter {
  autoVerify?: boolean;
  data: ({ scheme?: string; host?: string; port?: string } | false)[];
}

interface ExpoConfig {
  name: string;
  android: { package: string; intentFilters: IntentFilter[] };
  ios: { bundleIdentifier: string };
}

type Env = { EXPO_PUBLIC_ENV?: string; APP_VARIANT?: string; EAS_BUILD_PLATFORM?: string };

const ENV_KEYS = ['EXPO_PUBLIC_ENV', 'APP_VARIANT', 'EAS_BUILD_PLATFORM'] as const;

function loadAppConfig(env: Env): ExpoConfig {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) {
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  try {
    jest.resetModules();
    // app.config.js is CommonJS and reads the env when CALLED, so it is loaded here.
    const factory = require(path.join(__dirname, '..', 'app.config.js')) as (config: unknown) => {
      expo: ExpoConfig;
    };
    return factory({}).expo;
  } finally {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

/** Anything that names this machine or a private network rather than a public host. */
const LOCAL_HOST = /localhost|127\.0\.0\.1|10\.0\.2\.2|0\.0\.0\.0|\.local\b|:4130|:8130/;

/** Every build the stores receive: `EXPO_PUBLIC_ENV` set to these, or nothing. */
const PRODUCTION_BUILDS: Env[] = [
  {},
  { EXPO_PUBLIC_ENV: 'production' },
  { EXPO_PUBLIC_ENV: 'testflight' },
  { EXPO_PUBLIC_ENV: 'development' },
  { EXPO_PUBLIC_ENV: 'production', EAS_BUILD_PLATFORM: 'android' },
  { EXPO_PUBLIC_ENV: 'production', EAS_BUILD_PLATFORM: 'ios' },
];

describe.each(PRODUCTION_BUILDS)('production app config (%j)', (env) => {
  const config = loadAppConfig(env);

  it('is the production app', () => {
    expect(config.name).toBe('Homiio');
    expect(config.android.package).toBe('com.homiio.android');
    expect(config.ios.bundleIdentifier).toBe('com.homiio.android');
  });

  it('names no localhost or other development host anywhere', () => {
    expect(JSON.stringify(config)).not.toMatch(LOCAL_HOST);
  });

  it('has only https entries, and no `false` holes, in its link filters', () => {
    for (const filter of config.android.intentFilters) {
      for (const entry of filter.data) expect(entry).toMatchObject({ scheme: 'https' });
    }
  });
});

describe('development variant', () => {
  const config = loadAppConfig({ APP_VARIANT: 'development' });

  it('is a separate app', () => {
    expect(config.name).toBe('Homiio (Dev)');
    expect(config.android.package).toBe('com.homiio.android.dev');
  });

  it('opens the local server from its own filter, outside the verified one', () => {
    const local = config.android.intentFilters.filter((filter) =>
      JSON.stringify(filter).match(/localhost/),
    );
    expect(local).toHaveLength(1);
    expect(local[0].autoVerify).toBeUndefined();
    expect(local[0].data).toEqual([{ scheme: 'http', host: 'localhost', port: '4130' }]);
    const verified = config.android.intentFilters.filter((filter) => filter.autoVerify);
    expect(JSON.stringify(verified)).not.toMatch(LOCAL_HOST);
  });
});
