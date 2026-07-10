# Scraper notes

## Current architecture (2026-07)

External listing ingestion is handled by `packages/backend/worker.ts` + `@homiio/listing-providers` on BullMQ. See **Listing Provider Plugins** in `AGENTS.md` for the full architecture, queue names, plugin contract, and how to add providers.

The legacy Fotocasa cron scrape loop (`localhost:3000` sidecar) is retired. `services/cron.ts` now runs only health + TTL cleanup. The `scraperService` upsert helpers (`upsertExternalListing`, `getScraperHealth`, `cleanupExpiredProperties`) remain for TTL cleanup, health reporting, and manual admin-triggered runs via the admin-only `/api/scraper/*` routes.

## Idealista — Playwright session + AJAX (2026-07-10)

**Reference pattern (JSON/AJAX first, HTML last):** warm Playwright session (residential proxy, asset blocking ON) → call internal AJAX/JSON → fall back to HTML JSON-LD only if AJAX fails.

Shared helpers in `@homiio/listing-providers`:

- `runtime.openBrowserSession` / `PlaywrightSessionPool` / `warmSession`
- `BrowserSession.request` / `fetchAjaxInPage` / `fetchJsonInPage`
- Sticky reuse: `LISTING_PROXY_STICKY=true` keeps `proxySessionId` + `storageState` across Idealista discover cities

### Discover

1. Warm `https://www.idealista.com/alquiler-viviendas/{city}/` until content selectors appear or DataDome clears (poll, not blind 90s goto).
2. `GET /es/ajax/listing/georeach/{city}-{province}` via `session.request`.
3. Parse `adId` / `propertyCode` / embedded HTML (`parseIdealistaGeoreach`).
4. On warm-up failure or georeach 403/captcha → HTML search ladder (`fetchListingViaLadder`).

### Fetch

1. Warm detail page in Playwright.
2. **Contact AJAX (best-effort):**
   - `/es/ajax/ads/{adId}/contact-phones`
   - `/es/ajax/listingController/adContactInfoForDetail.ajax?adId=`
   - Merge phone / email / WhatsApp / agencyName into `NormalizedListing.contact` → Property `externalContact`.
3. Detail body from warmed-page HTML JSON-LD (no rich public detail AJAX for address/images).
4. Ladder HTML fallback when session warm-up fails.
5. **Datalayer** remains analytics-only — never sole ingest source.

### Cold HTTP probe (still blocked without browser session)

| Endpoint | Direct | Proxy (no browser) | Result |
|----------|--------|--------------------|--------|
| Georeach | 403 | 403 | DataDome captcha JSON |
| Datalayer | 200 | 200 | Sparse GTM fields only |
| Contact AJAX | 403 | 403 | DataDome |

Cold cookie warm without solving the challenge does **not** unlock georeach/contact. Headless + residential proxy may still fail DataDome after warm-up — provider records `challenge` metrics and falls back to HTML; contact stays empty. Report honestly if prod stays blocked.

### Georeach / contact response shapes (undocumented)

Fixtures: `IDEALISTA_FIXTURE_GEOREACH_*`, `IDEALISTA_FIXTURE_CONTACT_*`.

Live samples via proxy+Playwright were not recorded in this workspace (no local SSM proxy). Re-record when a warm session succeeds in the worker.

### Decision (updated)

**Ship session+georeach+contact AJAX** as Idealista's primary path; HTML ladder is last resort. Unblocking still requires a solved DataDome session (browser tier) or Idealista partner API credentials (`hasOfficialApi` already gated).

## Fotocasa — Playwright session + searchads (2026-07-10)

Same reference pattern as Idealista: warm Playwright session → `web.gw.fotocasa.es` JSON via `session.request` → SSR/HTML fallback.

### Endpoints (probed via residential proxy + Playwright, Jul 2026)

| Endpoint | Host | Cold HTTP | Warm session |
|----------|------|-----------|--------------|
| `urllocationsegments?location={city}-capital&zone=todas-las-zonas` | `web.gw.fotocasa.es/v2/propertysearch/` | 403 PerimeterX | 200 during page load |
| `searchads?combinedLocations=&latitude=&longitude=&pageNumber=&transactionType=RENT&propertyType=HOMES` | same | 403 | 200 when session fresh (intermittent) |
| `property?propertyId=&transactionType=RENT&language=es` | same | 403 | detail fetch fallback |

Search SSR also embeds `"realEstates":[...]` in warmed search HTML (~1.2MB) when gateway XHR is not captured — `parseFotocasaSsrSearch`. Detail pages often stay challenged (~12KB) on cold navigation; property JSON API before HTML ladder.

Code: `packages/listing-providers/src/providers/fotocasa/searchads.ts` + session-aware `FotocasaProvider`.

## Italy portals probe (2026-07-10)

Probed with SSM residential proxy + Playwright headless (`scripts/probe-it-portals.ts`). Password never logged.

| Portal | Warm search | Result |
|--------|-------------|--------|
| idealista.it | `/affitto-case/roma-roma/` | DataDome interstitial (~1.5KB); georeach `/it/ajax/listing/georeach/roma-roma` → 403 captcha JSON |
| immobiliare.it | `/affitto-case/roma/` | DataDome interstitial |
| casa.it | `/affitto/roma/` | DataDome interstitial |
| subito.it | `/annunci-lazio/affitto/appartamenti/roma/` | 403 (Akamai-ish); not DataDome HTML |

**Shipped anyway (fixture-tested, flags OFF):** `idealista_it`, `immobiliare`, `casa_it`, `subito` — AJAX/JSON-first + session pattern, contact capture into `NormalizedListing.contact` → `Property.externalContact`. Subito is housing-only (`/appartamenti/` discover + normalize reject). Enable with `PROVIDER_*_ENABLED=true` + `LISTING_BROWSER_ENABLED` + proxy once a warm session clears challenges in the worker.

## ES portal probe (2026-07-10) — pisos / milanuncios / yaencontre / indomio

| Portal | Cold HTTP | Proxy+PW | JSON path | Ship |
|--------|-----------|----------|-----------|------|
| pisos.com | 200 search+detail | — | JSON-LD search + `data-var`/tracking JSON detail + contact AJAX | **YES** (`PROVIDER_PISOS_ENABLED`) |
| milanuncios | 405 GeeTest | GeeTest | housing-only AJAX after session | code shipped, **OFF** until filter+session verified |
| yaencontre | 403 CF | CF challenge | AJAX after session | code shipped, **OFF** |
| indomio.es | 403 CF | CF challenge | AJAX after session | code shipped, **OFF** |
| vibbo | redirects → milanuncios | — | — | skip (alias) |
| wallapop RE | HTML 200 / API 403 | — | no clean API | skip |

Classifieds rule: milanuncios discover only via housing category allowlist; `normalize()` rejects cars/jobs via `assertHousingListing`.

## US portal probe (2026-07-10) — realtor / hotpads / redfin / rent / trulia

| Portal | Cold HTTP | JSON/AJAX path | Ship |
|--------|-----------|----------------|------|
| realtor.com | GraphQL 200 with `rdc-client-name` headers | `POST /frontdoor/graphql` — `ConsumerSearchMainQuery` + `HomeDetails` | **YES** (`PROVIDER_REALTOR_COM_ENABLED`) — direct HTTP, no browser |
| hotpads.com | Public API 200, no auth | `area/byResourceId` + `listing/byCoordsV2` on `hotpads-api-gke-prod-...hotpads.com` | **YES** (`PROVIDER_HOTPADS_ENABLED`) — direct HTTP |
| redfin.com | Stingray `Invalid arguments` / CloudFront 403 cold | `/stingray/api/gis` + `/stingray/api/home/details/initialInfo` after Playwright warm | **YES** (`PROVIDER_REDFIN_ENABLED`) — browser session required |
| rent.com | 302 → `ratelimited.rent.com` | no clean API without session | **SKIP** (rate-limited at edge) |
| trulia.com | Zillow Group / PerimeterX | GraphQL exists but ownership overlap with zillow track | **SKIP** per zillow conflict rule |

Shared helpers: `providers/us/portals.ts` (city slugs, Stingray prefix), `session.ts` + `browserSession.ts` (warm + `fetchJsonInPage`). Optional `LISTING_US_CITIES` overrides default US discover cities.
