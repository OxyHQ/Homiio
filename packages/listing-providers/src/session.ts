/**
 * Shared Playwright session helpers for portal ingest.
 *
 * Preferred pattern for DataDome / JS-gated portals:
 *   1. {@link warmBrowserPage} — goto origin, poll until challenge clears
 *   2. {@link fetchJsonInPage} — same-origin AJAX via `page.request` (cookies)
 *   3. {@link exportStorageState} — optional sticky reuse on the next context
 *
 * Asset blocking and residential proxy wiring live in {@link PlaywrightSessionPool}
 * (`browserSession.ts`) and the browser escalation tier (`browser.ts`).
 */

import { isDataDomeHtmlChallenge } from './parse/challenge';
import { BLOCKED_BROWSER_RESOURCE_TYPES } from './proxy';
import { isAllowedBrowserRequest, portalDomainFromUrl } from './requestFilter';

/** Hard per-navigation timeout when a caller does not pass one (ms). */
export const DEFAULT_SESSION_TIMEOUT_MS = 60_000;
/** Poll interval while waiting for a DataDome interstitial to clear (ms). */
const CHALLENGE_POLL_MS = 1_500;
/** Brief pause after challenge markers clear before waiting for content (ms). */
const DEFAULT_POST_CHALLENGE_SETTLE_MS = 2_000;
/** Reload warmUrl after this many challenge polls without clearance (0 = off). */
export const DEFAULT_CHALLENGE_RELOAD_AFTER_POLLS = 6;
/** Selectors that indicate Idealista (or similar) real content loaded. */
export const DEFAULT_CONTENT_SELECTORS =
  'article.item, .items-list, section.items-container, main#main-content';

/** Raised when `page.goto` times out (proxy hang, TLS, or portal never commits). */
export class BrowserSessionNavigationError extends Error {
  constructor(
    readonly warmUrl: string,
    readonly detail: string,
  ) {
    super(`Browser session navigation failed at ${warmUrl}: ${detail}`);
    this.name = 'BrowserSessionNavigationError';
  }
}

/** Raised when a warmed session is still on an anti-bot interstitial. */
export class BrowserSessionChallengeError extends Error {
  constructor(
    readonly warmUrl: string,
    readonly detail: string,
  ) {
    super(`Browser session warm-up blocked by anti-bot challenge at ${warmUrl}: ${detail}`);
    this.name = 'BrowserSessionChallengeError';
  }
}

export interface BrowserSessionRequestInit {
  headers?: Record<string, string>;
  referer?: string;
  timeoutMs?: number;
  method?: 'GET' | 'POST';
  data?: string;
}

export interface BrowserSessionRequestResult {
  status: number;
  body: string;
}

/** Playwright storage snapshot for sticky-session reuse. */
export interface BrowserStorageState {
  cookies: ReadonlyArray<{
    name: string;
    value: string;
    domain: string;
    path: string;
  }>;
}

export interface WarmBrowserPageOptions {
  warmUrl: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** CSS selector(s) indicating real portal content (comma-separated). */
  contentSelector?: string;
  /** When set, HTML bodies matching this are treated as an unresolved challenge. */
  isChallenge?: (html: string) => boolean;
  /** Max time to poll for challenge clearance after the initial goto (ms). */
  challengeWaitMs?: number;
  /** Reload `warmUrl` every N challenge polls when clearance stalls (0 = disabled). */
  reloadAfterPolls?: number;
  /** Pause after challenge markers clear before waiting for content selectors (ms). */
  postChallengeSettleMs?: number;
}

/** A warmed Playwright page + request context; caller must {@link close} it. */
export interface BrowserSession {
  /** Same-origin fetch via Playwright's API request context (inherits cookies). */
  request(url: string, init?: BrowserSessionRequestInit): Promise<BrowserSessionRequestResult>;
  /** Current page HTML after warm-up (prefer for detail JSON-LD). */
  content(): Promise<string>;
  /** Current page URL after warm-up (used as default Referer). */
  pageUrl(): string;
  /**
   * Navigate the existing page to another portal URL and poll until content
   * loads. Reuses cookies from the current context (cheaper than `close` +
   * `openBrowserSession` per city/page).
   */
  warmNavigate(options: WarmBrowserPageOptions): Promise<void>;
  /** Serialized cookies/localStorage for reuse on the next sticky context. */
  exportStorageState(): Promise<BrowserStorageState>;
  close(): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Minimal Playwright surface (no @types/playwright dependency).              */
/* -------------------------------------------------------------------------- */

export interface PwGotoOptions {
  timeout: number;
  waitUntil: 'domcontentloaded' | 'load' | 'networkidle' | 'commit';
}

export interface PwWaitForSelectorOptions {
  timeout?: number;
}

export interface PwRouteRequest {
  resourceType(): string;
  url(): string;
}

export interface PwRoute {
  request(): PwRouteRequest;
  abort(): Promise<void>;
  continue(): Promise<void>;
}

export interface PwAPIResponse {
  status(): number;
  text(): Promise<string>;
}

export interface PwAPIRequestContext {
  get(
    url: string,
    options?: { headers?: Record<string, string>; timeout?: number },
  ): Promise<PwAPIResponse>;
  post(
    url: string,
    options?: { headers?: Record<string, string>; timeout?: number; data?: string },
  ): Promise<PwAPIResponse>;
}

/** Warmed page — exposes `request` (inherits cookies) and `url()` for Referer. */
export interface SessionPage {
  goto(url: string, options: PwGotoOptions): Promise<unknown>;
  content(): Promise<string>;
  url(): string;
  waitForSelector(selector: string, options?: PwWaitForSelectorOptions): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  route(pattern: string, handler: (route: PwRoute) => void | Promise<void>): Promise<void>;
  request: PwAPIRequestContext;
  evaluate<R, A>(fn: (arg: A) => R | Promise<R>, arg: A): Promise<Awaited<R>>;
}

/** Browser context — exposes `request` and {@link exportStorageState}. */
export interface SessionContext {
  request: PwAPIRequestContext;
  storageState(): Promise<BrowserStorageState>;
}

export type InPageRequestTarget = SessionPage | SessionContext;

function isSessionPage(target: InPageRequestTarget): target is SessionPage {
  return typeof (target as SessionPage).url === 'function';
}

function resolveReferer(target: InPageRequestTarget, init?: BrowserSessionRequestInit): string {
  if (init?.referer) return init.referer;
  if (isSessionPage(target)) return target.url();
  return '';
}

/** Ensure cross-origin gateway URLs stay absolute for Playwright's request API. */
function resolveAbsoluteRequestUrl(url: string, referer: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (!referer) {
    throw new Error(`Cannot resolve relative AJAX URL without referer: ${url}`);
  }
  return new URL(url, referer).toString();
}

function isCrossOriginRequest(pageUrl: string, requestUrl: string): boolean {
  try {
    return new URL(pageUrl).origin !== new URL(requestUrl).origin;
  } catch {
    return false;
  }
}

async function fetchViaPageEvaluate(
  page: SessionPage,
  absoluteUrl: string,
  referer: string,
  init?: BrowserSessionRequestInit,
): Promise<BrowserSessionRequestResult> {
  const method = init?.method ?? 'GET';
  const headers: Record<string, string> = {
    Accept: 'application/json, text/javascript, text/html, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    ...(referer ? { Referer: referer } : {}),
    ...init?.headers,
  };
  const payload = await page.evaluate(
    async (args: {
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: string;
    }) => {
      const response = await fetch(args.url, {
        method: args.method,
        headers: args.headers,
        credentials: 'include',
        body: args.method === 'POST' ? args.body : undefined,
      });
      return { status: response.status, body: await response.text() };
    },
    {
      url: absoluteUrl,
      method,
      headers,
      body: init?.data,
    },
  );
  return payload;
}

/**
 * Trim what a page is allowed to fetch to keep residential-proxy GB down: abort
 * image/CSS/font/media, and — when `portalDomain` is given — abort any request
 * off the portal's own domain except the anti-bot vendors a warm session needs.
 * Safe to call when disabled (no-op).
 */
export async function setupAssetBlocking(
  page: SessionPage,
  enabled = true,
  portalDomain?: string,
): Promise<void> {
  if (!enabled) return;
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
      // Context closed mid-intercept.
    }
  });
}

/**
 * Navigate to `warmUrl` and poll until real content appears or the challenge
 * wait budget expires. Throws {@link BrowserSessionChallengeError} when still
 * blocked.
 */
function isWarmPageChallenge(html: string, isChallenge?: (html: string) => boolean): boolean {
  if (isChallenge?.(html)) return true;
  return isDataDomeHtmlChallenge(html);
}

function isGotoTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /timeout.*exceeded|TimeoutError/i.test(error.message);
}

async function gotoWarmUrl(page: SessionPage, warmUrl: string, timeoutMs: number): Promise<void> {
  try {
    await page.goto(warmUrl, { timeout: timeoutMs, waitUntil: 'commit' });
  } catch (error) {
    if (isGotoTimeoutError(error)) {
      throw new BrowserSessionNavigationError(
        warmUrl,
        `page.goto timed out after ${timeoutMs}ms (waitUntil=commit) — proxy hang, TLS failure, or portal never committed`,
      );
    }
    throw error;
  }
}

export async function warmBrowserPage(page: SessionPage, options: WarmBrowserPageOptions): Promise<void> {
  const perGotoTimeoutMs = options.timeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
  const challengeWaitMs = options.challengeWaitMs ?? perGotoTimeoutMs;
  const selector = options.contentSelector ?? DEFAULT_CONTENT_SELECTORS;
  const deadline = Date.now() + challengeWaitMs;
  const reloadAfterPolls = options.reloadAfterPolls ?? DEFAULT_CHALLENGE_RELOAD_AFTER_POLLS;
  const postChallengeSettleMs = options.postChallengeSettleMs ?? DEFAULT_POST_CHALLENGE_SETTLE_MS;
  let challengePolls = 0;
  let clearedChallenge = false;

  await gotoWarmUrl(page, options.warmUrl, perGotoTimeoutMs);

  while (Date.now() < deadline) {
    if (options.signal?.aborted) {
      throw new Error('Browser session warm-up aborted');
    }
    const html = await page.content();
    if (isWarmPageChallenge(html, options.isChallenge)) {
      challengePolls += 1;
      if (reloadAfterPolls > 0 && challengePolls % reloadAfterPolls === 0) {
        await gotoWarmUrl(page, options.warmUrl, perGotoTimeoutMs);
      } else {
        await page.waitForTimeout(CHALLENGE_POLL_MS);
      }
      continue;
    }
    if (!clearedChallenge && postChallengeSettleMs > 0) {
      clearedChallenge = true;
      await page.waitForTimeout(postChallengeSettleMs);
    }
    try {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      await page.waitForSelector(selector, { timeout: Math.min(12_000, remaining) });
      return;
    } catch {
      const settledHtml = await page.content();
      if (
        settledHtml.length >= 4_096 &&
        !isWarmPageChallenge(settledHtml, options.isChallenge)
      ) {
        return;
      }
      await page.waitForTimeout(CHALLENGE_POLL_MS);
    }
  }

  const finalHtml = await page.content();
  const detail = isWarmPageChallenge(finalHtml, options.isChallenge)
    ? options.isChallenge?.(finalHtml)
      ? 'portal-specific challenge markers still present'
      : 'DataDome captcha-delivery interstitial'
    : `content selector "${selector}" not found within ${challengeWaitMs}ms`;
  throw new BrowserSessionChallengeError(options.warmUrl, detail);
}

/**
 * Same-origin AJAX from a warmed page or context (GET or POST). Uses Playwright's
 * `request` API so portal cookies ride along.
 */
export async function fetchJsonInPage(
  target: InPageRequestTarget,
  url: string,
  init?: BrowserSessionRequestInit,
): Promise<BrowserSessionRequestResult> {
  const timeout = init?.timeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
  const referer = resolveReferer(target, init);
  const absoluteUrl = resolveAbsoluteRequestUrl(url, referer);
  const headers = {
    Accept: 'application/json, text/javascript, text/html, */*; q=0.01',
    'X-Requested-With': 'XMLHttpRequest',
    ...(referer ? { Referer: referer } : {}),
    ...init?.headers,
  };
  const method = init?.method ?? 'GET';
  if (isSessionPage(target) && referer && isCrossOriginRequest(referer, absoluteUrl)) {
    return fetchViaPageEvaluate(target, absoluteUrl, referer, init);
  }
  const response =
    method === 'POST'
      ? await target.request.post(absoluteUrl, { timeout, headers, data: init?.data })
      : await target.request.get(absoluteUrl, { timeout, headers });
  const body = await response.text();
  return { status: response.status(), body };
}

/** Alias for {@link fetchJsonInPage} — preferred name for portal AJAX discover. */
export const fetchAjaxInPage = fetchJsonInPage;

/** Serialize cookies/localStorage from a context for sticky-session reuse. */
export async function exportStorageState(context: SessionContext): Promise<BrowserStorageState> {
  return context.storageState();
}
