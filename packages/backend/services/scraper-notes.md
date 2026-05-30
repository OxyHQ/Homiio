# Scraper notes

## Status (2026-05-28)

The Fotocasa cron scraper has been **disabled by default**. It is now opt-in
via `FOTOCASA_ENABLED=true` in the environment.

## Why it was disabled

The cron loop was firing every 30 seconds and hitting
`http://localhost:3000/search/all/barcelona`, which expects an upstream
scraper proxy service to be running locally. Without that sidecar the
endpoint responds `HTTP 401: Unauthorized` and our backend log fills with the
following stack on every cycle:

```
[Scraper:fotocasa] ERROR: Scrape failed: Error: HTTP 401: Unauthorized
    at makeRequest (services/scraperService.ts:243:15)
    at runExternalScrape (services/scraperService.ts:336:18)
    at ScraperService.runExternalScrape (services/scraperService.ts:480:22)
    at SourceScraper.scrapeSingle (services/cron.ts:94:20)
```

The current `makeRequest` only injects a `Bearer` token when `apiKey` is set
and only retries on 5xx / `ECONNRESET` / `ETIMEDOUT`. A 401 is treated as a
hard failure (correctly), so the loop never self-heals.

This is a deployment/operations problem, not a code bug: the scraper proxy
is simply not running.

## Re-enabling it

To re-enable the scraper:

1. Run the Fotocasa proxy service locally (it must accept the configured
   endpoint and return the expected JSON shape — see
   `validateExternalProperty` in `scraperService.ts`).
2. Export `FOTOCASA_ENDPOINT=<url>` to point at the proxy.
3. Export an API key if the proxy requires one (the scraper will send it as
   `Authorization: Bearer <key>` when `apiKey` is set on the source config —
   currently there is no env var wired for this; add one if needed).
4. Export `FOTOCASA_ENABLED=true`.
5. Restart the backend.

## Longer-term plan

To make scraping resilient in production we will need at least one of:

- a managed scraping service (e.g. Bright Data, ScraperAPI) so we no longer
  depend on a local sidecar;
- Playwright-based scraping for CAPTCHA-heavy sources;
- per-source backoff so a single hard-failing source cannot dominate the
  log stream.

Until then the cron loop is OPT-IN and silent by default.
