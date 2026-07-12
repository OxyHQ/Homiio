/**
 * Headless-browser escalation tier (Playwright).
 *
 * The second rung of the shared fetch ladder (HTTP → **browser** → managed). It
 * exists so JS-rendered pages and simple bot walls resolve to real HTML when the
 * plain HTTP tier is blocked. It is deliberately OPTIONAL:
 *
 *   - Playwright is NOT a hard dependency of this package — it is an optional
 *     peer, loaded via a dynamic `import()`. When it is not installed (e.g. CI
 *     without browsers), {@link createBrowserFetcher} resolves to `undefined`
 *     and the ladder simply skips the browser tier.
 *   - It is env-gated behind `LISTING_BROWSER_ENABLED=true`. Disabled → skipped.
 *
 * The pool keeps ONE shared Chromium instance (lazily launched, relaunched if it
 * crashes) and runs each fetch in a fresh, ISOLATED {@link PwBrowserContext}
 * (no shared cookies/storage between listings) under a hard per-request timeout
 * and a small concurrency cap — portals are rate sensitive and a browser is
 * memory-heavy, so we keep the footprint small.
 */

import { BROWSER_USER_AGENT } from './http';
import { isAllowedBrowserRequest, portalDomainFromUrl } from './requestFilter';
import {
  BLOCKED_BROWSER_RESOURCE_TYPES,
  createProxySessionId,
  type PlaywrightProxyOptions,
  type ResidentialProxyConfig,
  toPlaywrightProxy,
} from './proxy';
import type { FetchRuntimeInit, UrlFetcher } from './types';

/** Hard per-navigation timeout when a caller does not pass one (ms). */
const DEFAULT_BROWSER_TIMEOUT_MS = 45_000;
/** Default concurrent-context cap (a browser is memory-heavy — keep it small). */
const DEFAULT_MAX_CONCURRENCY = 2;

/* -------------------------------------------------------------------------- */
/* Minimal structural view of the parts of the Playwright API we depend on.   */
/* Declared locally so this package does not need `@types/playwright` and so   */
/* the dynamic import stays type-safe without `any`.                          */
/* -------------------------------------------------------------------------- */

interface PwLaunchOptions {
  headless: boolean;
  args: string[];
}

interface PwContextOptions {
  userAgent: string;
  locale: string;
  viewport: { width: number; height: number };
  extraHTTPHeaders?: Record<string, string>;
  javaScriptEnabled: boolean;
  proxy?: PlaywrightProxyOptions;
}

interface PwGotoOptions {
  timeout: number;
  waitUntil: 'domcontentloaded' | 'load' | 'networkidle' | 'commit';
}

interface PwRouteRequest {
  resourceType(): string;
  url(): string;
}

interface PwRoute {
  request(): PwRouteRequest;
  abort(): Promise<void>;
  continue(): Promise<void>;
}

interface PwPage {
  goto(url: string, options: PwGotoOptions): Promise<unknown>;
  content(): Promise<string>;
  waitForSelector?(selector: string, options?: { timeout?: number }): Promise<unknown>;
  route(
    pattern: string,
    handler: (route: PwRoute) => void | Promise<void>,
  ): Promise<void>;
}

/** Soft content markers — waited after goto when present (not a hard failure). */
const SOFT_CONTENT_SELECTORS =
  'article.item, .items-list, section.items-container, main, [itemtype*="schema.org"], script[type="application/ld+json"]';

interface PwBrowserContext {
  newPage(): Promise<PwPage>;
  close(): Promise<void>;
}

interface PwBrowser {
  newContext(options: PwContextOptions): Promise<PwBrowserContext>;
  isConnected(): boolean;
  close(): Promise<void>;
}

interface PwChromium {
  launch(options: PwLaunchOptions): Promise<PwBrowser>;
}

export interface PlaywrightModule {
  chromium: PwChromium;
}

function isPlaywrightModule(value: unknown): value is PlaywrightModule {
  if (typeof value !== 'object' || value === null) return false;
  const chromium = (value as { chromium?: unknown }).chromium;
  if (typeof chromium !== 'object' || chromium === null) return false;
  return typeof (chromium as { launch?: unknown }).launch === 'function';
}

/**
 * Load Playwright via a dynamic import, or `undefined` when it is not installed.
 * The specifier is a variable so the compiler does not try to resolve the module
 * type at build time — this package intentionally does NOT depend on Playwright.
 */
export async function loadPlaywright(): Promise<PlaywrightModule | undefined> {
  const specifier = 'playwright';
  try {
    const mod: unknown = await import(specifier);
    if (isPlaywrightModule(mod)) return mod;
    // Some bundlers wrap CJS interop under `.default`.
    const wrapped = (mod as { default?: unknown }).default;
    return isPlaywrightModule(wrapped) ? wrapped : undefined;
  } catch {
    return undefined;
  }
}

/** Options for {@link PlaywrightBrowserPool}. */
export interface BrowserPoolOptions {
  /** Hard per-navigation timeout (ms). Overridden per request by `init.timeoutMs`. */
  timeoutMs?: number;
  /** Max concurrent browser contexts (default {@link DEFAULT_MAX_CONCURRENCY}). */
  maxConcurrency?: number;
  /** User-Agent applied to every isolated context. */
  userAgent?: string;
  /** Extra Chromium launch args (merged after the hardened defaults). */
  launchArgs?: string[];
  /** Residential proxy for anti-bot bypass (HTML/JSON only — assets blocked separately). */
  proxy?: ResidentialProxyConfig;
  /**
   * When true (default), abort image/media/font/stylesheet requests via `page.route`
   * and use `domcontentloaded` instead of `networkidle`.
   */
  blockAssets?: boolean;
  /**
   * When true, each fetch gets a unique `-session-<id>` suffix on the proxy username
   * (DataImpulse-compatible sticky IP per context).
   */
  stickyProxySession?: boolean;
  /**
   * When true, launch a HEADED Chromium (`headless: false`) instead of headless.
   * DataDome/Kasada fingerprint and block headless; a real headed browser under a
   * virtual display clears those challenges. The worker MUST then run under an X
   * server (no `DISPLAY` → headed launch throws), e.g.
   * `xvfb-run -a --server-args="-screen 0 1920x1080x24" node packages/backend/dist/worker.js`.
   * Default false → current headless behaviour.
   */
  headed?: boolean;
}

/** Chromium flags that keep the headless browser lean and container-friendly. */
const DEFAULT_LAUNCH_ARGS: readonly string[] = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
];

/**
 * A small, self-managing Playwright pool exposing the {@link UrlFetcher}
 * contract. One shared browser, isolated context per fetch, hard timeouts and a
 * concurrency gate. Accepts the loaded {@link PlaywrightModule} by injection so
 * it can be unit-tested with a fake module (no real browser needed).
 */
export class PlaywrightBrowserPool implements UrlFetcher {
  private readonly timeoutMs: number;
  private readonly maxConcurrency: number;
  private readonly userAgent: string;
  private readonly launchArgs: string[];
  private readonly proxy?: ResidentialProxyConfig;
  private readonly blockAssets: boolean;
  private readonly stickyProxySession: boolean;
  private readonly headed: boolean;

  private browser?: PwBrowser;
  private launching?: Promise<PwBrowser>;
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private closed = false;

  constructor(
    private readonly playwright: PlaywrightModule,
    options: BrowserPoolOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_BROWSER_TIMEOUT_MS;
    this.maxConcurrency = Math.max(1, options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY);
    this.userAgent = options.userAgent ?? BROWSER_USER_AGENT;
    this.launchArgs = [...DEFAULT_LAUNCH_ARGS, ...(options.launchArgs ?? [])];
    this.proxy = options.proxy;
    this.blockAssets = options.blockAssets ?? true;
    this.stickyProxySession = options.stickyProxySession ?? false;
    this.headed = options.headed ?? false;
  }

  /** Lazily launch (or relaunch after a crash) the single shared browser. */
  private async ensureBrowser(): Promise<PwBrowser> {
    if (this.browser && this.browser.isConnected()) return this.browser;
    if (this.launching) return this.launching;
    // `headless: false` (this.headed) requires a live X display — the worker runs
    // under `xvfb-run` when LISTING_BROWSER_HEADED=true (see Dockerfile header).
    this.launching = this.playwright.chromium
      .launch({ headless: !this.headed, args: this.launchArgs })
      .then((browser) => {
        this.browser = browser;
        this.launching = undefined;
        return browser;
      })
      .catch((error) => {
        this.launching = undefined;
        throw error;
      });
    return this.launching;
  }

  /** Acquire a concurrency slot, waiting when the pool is saturated. */
  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  /** Release a slot and wake the next waiter, if any. */
  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }

  async fetch(url: string, init?: FetchRuntimeInit): Promise<string> {
    if (this.closed) throw new Error('PlaywrightBrowserPool is closed');
    const timeout = init?.timeoutMs ?? this.timeoutMs;
    await this.acquire();
    let context: PwBrowserContext | undefined;
    try {
      const browser = await this.ensureBrowser();
      const sessionId = this.stickyProxySession ? createProxySessionId() : undefined;
      const esLocale = init?.proxyCountry?.toLowerCase() === 'es';
      const contextOptions: PwContextOptions = {
        userAgent: this.userAgent,
        locale: esLocale ? 'es-ES' : 'en-US',
        viewport: { width: 1366, height: 900 },
        extraHTTPHeaders: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': esLocale ? 'es-ES,es;q=0.9,en;q=0.8' : 'en-US,en;q=0.9',
          ...init?.headers,
        },
        javaScriptEnabled: true,
      };
      if (this.proxy) {
        contextOptions.proxy = toPlaywrightProxy(this.proxy, sessionId, init?.proxyCountry);
      }
      context = await browser.newContext(contextOptions);
      const page = await context.newPage();
      if (this.blockAssets) {
        const portalDomain = portalDomainFromUrl(url);
        await page.route('**/*', async (route) => {
          try {
            const request = route.request();
            if (BLOCKED_BROWSER_RESOURCE_TYPES.has(request.resourceType())) {
              await route.abort();
              return;
            }
            if (portalDomain && !isAllowedBrowserRequest(request.url(), portalDomain)) {
              await route.abort();
              return;
            }
            await route.continue();
          } catch {
            // Context/page closed mid-intercept — ignore unhandled rejections.
          }
        });
      }
      // External abort cancels the navigation via the context teardown below.
      const onAbort = (): void => {
        void context?.close().catch(() => undefined);
      };
      if (init?.signal) {
        if (init.signal.aborted) onAbort();
        else init.signal.addEventListener('abort', onAbort, { once: true });
      }
      try {
        // Prefer commit (fast first byte) over domcontentloaded — ES portals
        // behind residential proxy often never fire DCL within 90s.
        const waitUntil = this.blockAssets ? 'commit' : 'load';
        await page.goto(url, { timeout, waitUntil });
        if (page.waitForSelector) {
          try {
            await page.waitForSelector(SOFT_CONTENT_SELECTORS, {
              timeout: Math.min(12_000, Math.max(3_000, Math.floor(timeout / 4))),
            });
          } catch {
            // Soft wait — page may still be usable without matching selectors.
          }
        }
        return await page.content();
      } finally {
        if (init?.signal) init.signal.removeEventListener('abort', onAbort);
      }
    } finally {
      if (context) await context.close().catch(() => undefined);
      this.release();
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const browser = this.browser;
    this.browser = undefined;
    if (browser) await browser.close().catch(() => undefined);
  }
}

/** Env/behaviour options for {@link createBrowserFetcher}. */
export interface CreateBrowserFetcherOptions extends BrowserPoolOptions {
  /**
   * Whether the browser tier is enabled. When false the factory resolves to
   * `undefined` and the ladder skips the browser tier entirely.
   */
  enabled?: boolean;
  /** Optional structured log sink for the "Playwright not installed" notice. */
  onLog?: (message: string) => void;
  /** Injected module for tests; when omitted, Playwright is dynamically loaded. */
  playwright?: PlaywrightModule;
}

/**
 * Build the browser-tier {@link UrlFetcher}, or `undefined` when it is disabled
 * or Playwright is not installed. Probes Playwright ONCE at construction so the
 * ladder never attempts a tier that cannot run.
 */
export async function createBrowserFetcher(
  options: CreateBrowserFetcherOptions = {},
): Promise<UrlFetcher | undefined> {
  if (options.enabled === false) return undefined;
  const playwright = options.playwright ?? (await loadPlaywright());
  if (!playwright) {
    options.onLog?.(
      'LISTING_BROWSER_ENABLED is set but Playwright is not installed — browser fetch tier disabled. Run `bun add -D playwright && bunx playwright install chromium` in packages/backend to enable it.',
    );
    return undefined;
  }
  return new PlaywrightBrowserPool(playwright, options);
}
