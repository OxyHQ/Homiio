/**
 * Playwright session pool for warmed portal contexts.
 *
 * Providers that need in-page AJAX (Idealista georeach, Fotocasa search API, …)
 * open a session via {@link PlaywrightSessionPool.openSession} or
 * `runtime.openBrowserSession`. Portable warm-up / fetch helpers live in
 * {@link ./session} — import those directly when you already own a page.
 */

import { BROWSER_USER_AGENT } from './http';
import {
  createProxySessionId,
  type PlaywrightProxyOptions,
  type ResidentialProxyConfig,
  toPlaywrightProxy,
} from './proxy';
import type { PlaywrightModule } from './browser';
import {
  BrowserSessionChallengeError,
  DEFAULT_SESSION_TIMEOUT_MS,
  exportStorageState,
  fetchJsonInPage,
  setupAssetBlocking,
  warmBrowserPage,
  type BrowserSessionRequestInit,
  type BrowserSessionRequestResult,
  type BrowserStorageState,
  type SessionContext,
  type SessionPage,
  type WarmBrowserPageOptions,
  type BrowserSession,
} from './session';

export {
  BrowserSessionChallengeError,
  type BrowserSession,
  type BrowserStorageState,
};

export interface BrowserSessionOptions extends WarmBrowserPageOptions {
  locale?: string;
  acceptLanguage?: string;
  userAgent?: string;
  proxy?: ResidentialProxyConfig;
  stickyProxySession?: boolean;
  /** Reuse cookies from a prior session on the same sticky proxy IP. */
  storageState?: BrowserStorageState;
  /** When sticky, pin this id instead of generating a new one. */
  proxySessionId?: string;
  /** Abort image/CSS/font requests (default ON — cheap residential GB). */
  blockAssets?: boolean;
}

/* -------------------------------------------------------------------------- */
/* Pool-local Playwright shapes (browser launch + context creation).          */
/* -------------------------------------------------------------------------- */

interface PwContextOptions {
  userAgent: string;
  locale: string;
  viewport: { width: number; height: number };
  extraHTTPHeaders?: Record<string, string>;
  javaScriptEnabled: boolean;
  proxy?: PlaywrightProxyOptions;
  storageState?: BrowserStorageState;
}

interface PwBrowserContext extends SessionContext {
  newPage(): Promise<SessionPage>;
  close(): Promise<void>;
}

interface PwBrowser {
  newContext(options: PwContextOptions): Promise<PwBrowserContext>;
  isConnected(): boolean;
  close(): Promise<void>;
}

interface PwLaunchOptions {
  headless: boolean;
  args: string[];
}

interface PwChromium {
  launch(options: PwLaunchOptions): Promise<PwBrowser>;
}

const DEFAULT_LAUNCH_ARGS: readonly string[] = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
];

class PlaywrightBrowserSession implements BrowserSession {
  constructor(
    private readonly page: SessionPage,
    private readonly context: PwBrowserContext,
    private readonly defaultTimeoutMs: number,
    private readonly onClose: () => void,
  ) {}

  pageUrl(): string {
    return this.page.url();
  }

  async content(): Promise<string> {
    return this.page.content();
  }

  async request(url: string, init?: BrowserSessionRequestInit): Promise<BrowserSessionRequestResult> {
    return fetchJsonInPage(this.page, url, {
      ...init,
      timeoutMs: init?.timeoutMs ?? this.defaultTimeoutMs,
    });
  }

  async exportStorageState(): Promise<BrowserStorageState> {
    return exportStorageState(this.context);
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => undefined);
    this.onClose();
  }
}

/** Options for {@link PlaywrightSessionPool}. */
export interface PlaywrightSessionPoolOptions {
  timeoutMs?: number;
  maxConcurrency?: number;
  userAgent?: string;
  launchArgs?: string[];
  proxy?: ResidentialProxyConfig;
  blockAssets?: boolean;
  stickyProxySession?: boolean;
}

/**
 * Manages warmed Playwright sessions on a shared browser instance. One session
 * = one isolated context that stays open until the caller closes it.
 */
export class PlaywrightSessionPool {
  private readonly timeoutMs: number;
  private readonly maxConcurrency: number;
  private readonly userAgent: string;
  private readonly launchArgs: string[];
  private readonly proxy?: ResidentialProxyConfig;
  private readonly blockAssets: boolean;
  private readonly stickyProxySession: boolean;

  private browser?: PwBrowser;
  private launching?: Promise<PwBrowser>;
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  private closed = false;

  constructor(
    private readonly playwright: PlaywrightModule,
    options: PlaywrightSessionPoolOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
    this.maxConcurrency = Math.max(1, options.maxConcurrency ?? 2);
    this.userAgent = options.userAgent ?? BROWSER_USER_AGENT;
    this.launchArgs = [...DEFAULT_LAUNCH_ARGS, ...(options.launchArgs ?? [])];
    this.proxy = options.proxy;
    this.blockAssets = options.blockAssets ?? true;
    this.stickyProxySession = options.stickyProxySession ?? false;
  }

  private async ensureBrowser(): Promise<PwBrowser> {
    if (this.browser && this.browser.isConnected()) return this.browser;
    if (this.launching) return this.launching;
    const chromium = this.playwright.chromium as PwChromium;
    this.launching = chromium
      .launch({ headless: true, args: this.launchArgs })
      .then((browser) => {
        this.browser = browser;
        this.launching = undefined;
        return browser;
      })
      .catch((error: unknown) => {
        this.launching = undefined;
        throw error;
      });
    return this.launching;
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrency) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }

  /**
   * Open a warmed session. Caller MUST {@link BrowserSession.close} when done.
   * Concurrency slot is held until close.
   */
  async openSession(options: BrowserSessionOptions): Promise<BrowserSession> {
    if (this.closed) throw new Error('PlaywrightSessionPool is closed');
    await this.acquire();
    let context: PwBrowserContext | undefined;
    try {
      const browser = await this.ensureBrowser();
      const sessionId =
        options.proxySessionId ??
        (this.stickyProxySession || options.stickyProxySession ? createProxySessionId() : undefined);
      const locale = options.locale ?? 'es-ES';
      const acceptLanguage =
        options.acceptLanguage ?? `${locale},${locale.split('-')[0]};q=0.9,en;q=0.8`;
      const contextOptions: PwContextOptions = {
        userAgent: options.userAgent ?? this.userAgent,
        locale,
        viewport: { width: 1366, height: 900 },
        extraHTTPHeaders: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': acceptLanguage,
        },
        javaScriptEnabled: true,
      };
      if (this.proxy) {
        contextOptions.proxy = toPlaywrightProxy(this.proxy, sessionId);
      }
      if (options.storageState) {
        contextOptions.storageState = options.storageState;
      }
      context = await browser.newContext(contextOptions);
      const page = await context.newPage();
      await setupAssetBlocking(page, this.blockAssets && options.blockAssets !== false);
      const onAbort = (): void => {
        void context?.close().catch(() => undefined);
      };
      if (options.signal) {
        if (options.signal.aborted) onAbort();
        else options.signal.addEventListener('abort', onAbort, { once: true });
      }
      try {
        await warmBrowserPage(page, {
          warmUrl: options.warmUrl,
          timeoutMs: options.timeoutMs ?? this.timeoutMs,
          signal: options.signal,
          contentSelector: options.contentSelector,
          isChallenge: options.isChallenge,
          challengeWaitMs: options.challengeWaitMs,
        });
      } finally {
        if (options.signal) options.signal.removeEventListener('abort', onAbort);
      }
      return new PlaywrightBrowserSession(page, context, options.timeoutMs ?? this.timeoutMs, () =>
        this.release(),
      );
    } catch (error) {
      if (context) await context.close().catch(() => undefined);
      this.release();
      throw error;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    const browser = this.browser;
    this.browser = undefined;
    if (browser) await browser.close().catch(() => undefined);
  }
}

/**
 * Alias for {@link PlaywrightSessionPool.openSession} — the shared warm-up
 * entry point other portal providers should call via `runtime.openBrowserSession`.
 */
export async function warmSession(
  pool: PlaywrightSessionPool,
  options: BrowserSessionOptions,
): Promise<BrowserSession> {
  return pool.openSession(options);
}
