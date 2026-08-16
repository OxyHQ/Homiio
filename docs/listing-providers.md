# Listing provider plugins (the market aggregator)

> Moved out of `AGENTS.md` unchanged.


Homiio aggregates external market listings (Idealista, Fotocasa, Habitaclia,
Blueground, apartments.com, Zillow and more) as **first-party data**, never
hotlinked and never live-proxied.

### Fetch strategy (CRITICAL)

**JSON/AJAX first, HTML last.** Providers MUST prefer internal JSON, XHR, GraphQL
or datalayer APIs, ideally after a Playwright session warm. HTML parsing and
embedded JSON-LD via `fetchListingViaLadder` are **fallback only**, for when no
usable JSON endpoint exists.

### AJAX-with-session pattern (Idealista is the reference)

When a portal gates JSON behind DataDome or JS:

1. `runtime.openBrowserSession` / `warmSession`: warm cookies on a search or home
   page (residential proxy, asset blocking ON, poll for content or challenge
   clearance).
2. `session.request` / `fetchAjaxInPage` / `fetchJsonInPage`: same-origin XHR with
   Referer and `X-Requested-With`.
3. Fall back to HTML JSON-LD only when AJAX fails or the session pool is absent.

Sticky reuse: `LISTING_PROXY_STICKY=true` keeps `proxySessionId` and
`storageState` across discover pages. Shared helpers live in
`packages/listing-providers/src/session.ts` and `browserSession.ts`.

### External listing contact (CRITICAL)

**Capture owner and agent contact when the portal exposes it.** After a listing
fetch, call the portal contact AJAX when available (Idealista `contact-phones`,
`adContactInfo`). Persist phone, email, WhatsApp and agency name on the external
Property and `NormalizedListing` so the app can show direct contact, not only
`sourceUrl`. Never invent or guess contacts. The classifieds housing-only filter
still applies (see below).

### Model

- External properties have `isExternal: true`, no `oxyUserId`,
  `status: 'published'`, and a mandatory `sourceUrl`.
- Optional ingested contact fields (phone, email, WhatsApp, agency name) when the
  portal AJAX exposes them.
- The frontend already handles these: source badge, blocked apply and viewing,
  portal CTA to `sourceUrl`, plus direct contact when ingested. Do not remove
  that differentiation.
- The upsert key is `(source, sourceId)`, handled by
  `scraperService.upsertExternalListing`.

### Package layout

```
packages/
  listing-providers/   @homiio/listing-providers   Plugin contract, ProviderRegistry, FetchRuntime, plugins
  backend/
    services/ingestion/IngestionService.ts          NormalizedListing to Property upsert + image pipeline
    services/ingestion/ExternalMediaIngest.ts       fetch, Sharp, S3, Image doc, PropertyImageRef
    services/ingestion/queues.ts                    BullMQ queue definitions
    worker.ts                                       Worker entrypoint (separate process, same image)
```

`shared-types` exports `NormalizedListing`, the handoff DTO from provider to
ingest.

### Plugin contract

```ts
interface ListingProvider {
  readonly id: ProviderId;
  readonly markets: ReadonlyArray<'ES' | 'US'>;
  discover(job: DiscoverJob): AsyncIterable<ExternalListingRef>;
  fetch(ref: ExternalListingRef, ctx: FetchContext): Promise<RawListing>;
  normalize(raw: RawListing): NormalizedListing;
  health(): Promise<ProviderHealth>;
}
```

`FetchRuntime` is shared, not per-plugin, and owns rate limiting, retries, the
circuit breaker, the Playwright pool, the proxy and managed ladder, and
challenge/CAPTCHA detection leading to requeue or escalation.

### Warm Playwright session (preferred portal ingest)

For DataDome and JS-gated portals (Idealista georeach, Fotocasa AJAX), use the
shared helpers in `@homiio/listing-providers` (`src/session.ts`):

1. **`warmBrowserPage(page, { warmUrl, contentSelector?, isChallenge? })`**: goto
   origin, poll until the challenge clears or the content selector appears.
2. **`fetchJsonInPage(page | context, url, { headers?, referer?, timeoutMs? })`**:
   same-origin JSON via `page.request`, with cookies riding along and XHR headers
   set automatically.
3. **`exportStorageState(context)`**: optional sticky reuse, passing the snapshot
   into the next `openBrowserSession({ storageState })` call on the same proxy
   session id.

When you do not own a page: `runtime.openBrowserSession(options)`, then
`session.request(url)` / `session.exportStorageState()`, then `session.close()`.
Asset blocking (`LISTING_BROWSER_BLOCK_ASSETS`, default ON) and the residential
proxy (`LISTING_RESIDENTIAL_PROXY_URL`, sticky via `LISTING_PROXY_STICKY`) are
wired in `PlaywrightSessionPool`, so providers only supply `warmUrl`, challenge
detectors and portal-specific selectors.

- **Escalation tiers are WORKER-ONLY and env-gated, default OFF.** Build the
  worker runtime with `createListingFetchRuntimeFromEnv()`, never in the API. The
  browser tier needs `LISTING_BROWSER_ENABLED=true` plus Playwright installed (an
  OPTIONAL peer of `@homiio/listing-providers`, loaded via dynamic `import()`; if
  absent the tier is skipped and logged, and CI stays green). The managed tier
  needs `LISTING_MANAGED_FETCH_URL` (plus optional `LISTING_MANAGED_FETCH_KEY`,
  `*_KEY_HEADER`, `*_KEY_PARAM`, `*_URL_PARAM`); unset means the rung does not
  exist and is never faked. The ladder keys tier availability off method
  presence, so an unprovisioned rung is skipped, not attempted and failed. The
  worker must `await runtimeHandle.shutdown()` to close the browser pool.
- **Residential proxy is DIY anti-bot, not a scraping API.** Homiio's worker
  scrapes with Playwright and HTTP; `LISTING_RESIDENTIAL_PROXY_URL`
  (`http://user:pass@host:port`, DataImpulse compatible) routes **listing HTML
  and JSON only** through a cheap residential proxy. Playwright blocks images,
  CSS and fonts by default (`LISTING_BROWSER_BLOCK_ASSETS`) and uses
  `domcontentloaded`. Listing photos stay on a **direct** fetch in
  `ExternalMediaIngest`; optional `LISTING_MEDIA_PROXY_FALLBACK=true` retries once
  via proxy on failure. Optional `LISTING_HTTP_USE_PROXY=true` proxies the HTTP
  tier; `LISTING_PROXY_STICKY=true` appends `-session-<id>` to the proxy username
  for a DataImpulse sticky IP. Do not set proxy env in prod SSM until credentials
  exist.

### BullMQ queues (Valkey via `REDIS_URL`)

| Queue | Purpose |
|---|---|
| `listing-discover` | city/bbox plus provider, produces an `ExternalListingRef` batch |
| `listing-fetch` | single `sourceId`, fetch and normalize, then ingest |
| `listing-media` | propertyId plus remote URLs, when media is decoupled from upsert |

- Queue names must NOT contain `:` (a BullMQ and Valkey restriction).
- Dedup job ids are the sha256 of `(provider, sourceId)`. Never pass raw values
  containing colons as custom ids.
- BullMQ connections need `maxRetriesPerRequest: null`.

### Ingest pipeline (no portal CDN hotlinks, ever)

1. Validate the `NormalizedListing`.
2. `findOrCreateCanonicalAddress` (`services/addressService.ts`) plus geocode.
3. Upsert the property row with `isExternal: true`, `status: 'published'`,
   `sourceUrl` and an `expires_at` deadline. Postgres does not reap on its own:
   the row is deleted by the `db/expiry.ts` sweep that `services/cron.ts` runs.
4. For each `remoteImages` entry: download, Sharp,
   `createImageForEntity('property', id, ...)`, `PropertyImageRef`. Dedup by URL
   or hash stored in Image metadata; re-syncs add and remove refs.
5. Never store a portal CDN URL as a runtime `images[].url`.

### How to add a new provider

1. Create `packages/listing-providers/src/providers/<name>/index.ts` implementing
   `ListingProvider`.
2. Register it in `packages/listing-providers/src/registry.ts`.
3. It is gated automatically: see the feature-flag rule below.
4. Add an integration test: normalize a fixture, upsert, and check Image refs
   with a storage mock.

**Shared parse modules (CRITICAL, no copy-paste):** new portals MUST import from
`packages/listing-providers/src/parse/` (plus `session.ts` and
`browserSession.ts`). Do **not** re-implement JSON-LD, `__NEXT_DATA__`, contact,
classifieds or city-list parsers per portal.

| Module | Use for |
|---|---|
| `parse/jsonLd.ts` | schema.org LD+JSON (`extractEsSchemaListings`, `extractItSchemaListings`, `extractSchemaOrgListings`, `collectJsonLdNodes`) |
| `parse/nextData.ts` | `__NEXT_DATA__`, `__PAGE_MODEL__`, `__PRELOADED_STATE__` |
| `parse/contact.ts` | phone, email, whatsapp to `NormalizedListing.contact` |
| `parse/classifieds.ts` | housing category allowlist plus `assertHousingListing` |
| `parse/cities.ts` | `LISTING_*_CITIES` env city lists plus `providerCitiesFromEnv()` |
| `parse/price.ts` and `parse/listing.ts` | monthly/sale price sanity plus ingest validation |
| `session.ts` / `browserSession.ts` | Idealista-like warm plus AJAX |

Root shims (`contact.ts`, `classifieds.ts`, `jsonLd.ts`, `nextData.ts`,
`cities.ts`) re-export `parse/` for short imports; prefer `parse/` for new code.
Portal-specific AJAX URL builders stay under `providers/<name>/`.

**Discover city lists (CRITICAL):** use `citiesFromEnv(market)` or
`DEFAULT_MARKET_CITIES`. Never hardcode a tiny per-provider city allowlist that
bypasses `LISTING_<MARKET>_CITIES` and silently excludes metros. Optional
per-provider narrowing is
`providerCitiesFromEnv('LISTING_<PROVIDER>_CITIES', market)`, which falls back to
the market list. Browser-heavy ES portals enqueue **one discover job per city**
in `worker.ts`; queue fairness is handled there, not by shrinking defaults.

### General classifieds portals (CRITICAL)

Homiio is real estate only. **General classifieds** (milanuncios, kleinanzeigen,
subito, leboncoin marketplace, olx.ro, vivanuncios) must **never** be site-wide
crawled.

- **`discover()`**: housing, rent or sale category URLs or API params only, with
  an explicit per-portal category allowlist (DE kleinanzeigen, IT subito, FR
  leboncoin, RO olx.ro, ES milanuncios, MX vivanuncios).
- **`normalize()`**: reject non-housing listings (cars, jobs, furniture). Ingest
  must skip, never upsert.
- **Tests**: a housing fixture passes normalize, and a non-housing category
  fixture is rejected.

Dedicated real-estate portals (Idealista, Fotocasa, Habitaclia, Immobiliare) are
exempt: they are housing native and need no classifieds guard.

### Feature flags

**Do not maintain a list of provider flags here or anywhere else.** The flag name
is derived mechanically in `packages/listing-providers/src/index.ts`:

```ts
process.env[`PROVIDER_${id.toUpperCase()}_ENABLED`] === 'true'
```

So every registered provider is opt-in as `PROVIDER_<ID>_ENABLED=true`, default
OFF, with the id coming from the plugin itself. A new plugin is gated the moment
it is registered, with no flag to add anywhere. `registry.ts` and the
`providers/` tree are the only authorities for which providers exist; the worker
reads the flags at startup and disabled providers are not registered.

### Market status

Per-market notes on which portals work and what blocks the rest. Everything below
is default OFF unless it says otherwise.

**Multi-country brand expansion** uses thin wrappers over shared factories:
Idealista ES/IT/PT (regional hosts plus georeach AJAX); MercadoLibre
AR/EC/CO/CL/PE/MX (`createMercadolibreProvider` plus `rentSegment` for renta and
arriendo); Navent Zonaprop, Argenprop, Plusvalía, Inmuebles24 and Metrocuadrado
(`createNaventProvider`); Blueground global (one plugin, per-market city slugs).
**Backlog, not yet wired:** MercadoLibre UY/VE/BO; Properati CO/PE; Lamudi
ID/TH/TR; OLX PT/PL; Immowelt AT; Blueground PT/GR/AE/HK; ImmobiliareScout24 AT.

- **Spain / Italy:** Idealista, Fotocasa, Habitaclia and the rest of the ES trio
  are the reference implementations for the warm-session AJAX pattern.
- **United States** (`LISTING_US_CITIES`): realtor.com (direct GraphQL HTTP),
  HotPads (public JSON API), Redfin (Playwright session plus Stingray AJAX,
  requires `LISTING_BROWSER_ENABLED`). Skipped: rent.com (rate limited),
  trulia.com (Zillow Group overlap).
- **Germany** (`LISTING_DE_CITIES`): ImmobilienScout24 (mobile JSON), Immowelt
  (LZ SERP JSON plus optional session), Kleinanzeigen (housing categories only,
  never site-wide).
- **Romania** (`LISTING_RO_CITIES`): Storia (`__NEXT_DATA__` plus session),
  Imobiliare.ro (Inertia search plus JSON-LD detail), OLX.ro (housing
  `/imobiliare/...` only).
- **Ireland / Belgium / Poland / Netherlands**: Daft.ie (`__NEXT_DATA__` search
  plus detail, cold HTTP verified), Immoweb (GET `/en/search-results` plus
  `/en/classified/get-result/{id}` JSON, cold HTTP verified), Otodom (OLX
  vertical `__NEXT_DATA__`, cold HTTP verified), Funda (mobile `*.funda.io`
  NDJSON search plus tinyId detail, Akamai 403 from a datacenter, keep OFF until
  `LISTING_HTTP_USE_PROXY` or the browser tier). Pararius, OLX PL housing-only,
  Willhaben AT and Immowelt AT are deferred.
- **Argentina** (`LISTING_AR_CITIES`): Zonaprop and Argenprop (Navent
  `rplis-api` plus `__PRELOADED_STATE__`, Cloudflare, keep OFF until sticky
  residential clears), MercadoLibre inmuebles (housing only, cold HTML search and
  detail verified, enable), Properati (`__NEXT_DATA__` / JSON-LD, Cloudflare,
  OFF). Never site-wide crawl MercadoLibre.
- **Mexico** (`LISTING_MX_CITIES`): Inmuebles24 (Navent, Cloudflare, OFF), Lamudi
  (JSON-LD MONTH rent, the best HTTP candidate, OFF until live discover),
  Vivanuncios (housing-only classifieds, OFF), Propiedades (JSON-LD, Akamai,
  OFF), MercadoLibre inmuebles (`renta` segment, OFF until probe). EasyBroker is
  inactive, skip it.
- **Colombia** (`LISTING_CO_CITIES`): MercadoLibre inmuebles (housing only, OFF
  until a Playwright and proxy probe), Metrocuadrado (Navent `rplis-api` plus
  `__PRELOADED_STATE__`, Cloudflare, OFF). Fincaraiz is the same Navent stack,
  add it later if needed and do not duplicate parsers.
- **Chile** (`LISTING_CL_CITIES`): MercadoLibre inmuebles (`arriendo` rent
  segment, OFF until probe). Portalinmobiliario and TocToc need bespoke parsers,
  deferred.
- **Peru** (`LISTING_PE_CITIES`): MercadoLibre inmuebles (housing only, OFF until
  probe). Urbania and Adondevivir (same RE group, JSON-LD) deferred until cold
  HTTP is verified.
- **Ecuador** (`LISTING_EC_CITIES`): Plusvalía (Navent, Cloudflare, OFF until
  sticky residential), MercadoLibre EC inmuebles (housing only, OFF until a
  Playwright and proxy probe), Properati EC (JSON-LD fixtures, ALB 403, keep
  OFF). inmo.ec is not viable.
- **Portugal** (`LISTING_PT_CITIES`): Idealista.pt (thin regional clone of
  `idealista_it`: `/imovel/`, `/arrendar-casas/`, georeach plus contact AJAX, OFF
  until a Playwright and proxy probe). Imovirtual and Casa Sapo deferred (bespoke
  parsers).
- **Canada** (`LISTING_CA_CITIES`): Realtor.ca (`api2.realtor.ca` form JSON after
  an Imperva session warm, OFF). Rentals.ca and Kijiji housing-only are deferred
  (Cloudflare, thin Next.js cards).
- **Australia** (`LISTING_AU_CITIES`): realestate.com.au
  (`window.ArgonautExchange` JSON, Kasada, OFF until an AU browser plus
  residential proxy). Domain.com.au deferred (Akamai).
- **UAE** (`LISTING_AE_CITIES`): Bayut (`__NEXT_DATA__` search plus detail,
  hb-captcha, OFF until an AE browser plus residential proxy). Property Finder
  deferred (CloudFront 403). **Never use paid RapidAPI mirrors in the worker.**

### Legacy retirement

- The legacy Fotocasa 30-second cron scrape loop is **gone**. `services/cron.ts`
  now runs only health checks and the expiry sweep.
- The `localhost:3000` sidecar dependency and the `config/cron.ts` `scrapeSources`
  array are removed.
- `/api/scraper/*` routes are admin only (`middlewares/requireAdmin.ts`).
- `scraperService` upsert helpers (`upsertExternalListing`, `getScraperHealth`,
  `cleanupExpiredProperties`) remain for expired-listing cleanup, health
  reporting and manual admin runs.
- See `packages/backend/services/scraper-notes.md` for the archived migration
  log.

### Worker deploy

`packages/backend/worker.ts` is the worker entrypoint: the same Docker image as
the API, a different start command. Run it with a separate ECS task definition.
Use a separate container only if Playwright memory becomes a concern.

