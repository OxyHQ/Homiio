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
    worker.ts                                       Worker entrypoint (separate browser-enabled target)
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

## Is the pipeline alive? (the 2026-09-20 outage and what now watches it)

### What happened

The Evomi residential-proxy account ran out of balance. From that moment every
CONNECT was answered `402 Payment Required`, so every HTTP fetch and every
Playwright navigation failed — `LISTING_HTTP_USE_PROXY=true` and
`LISTING_BROWSER_ENABLED=true` route both tiers through the proxy and there is
no direct fallback. No external listing was ingested again.

Ingestion stopping was not what the user saw. External properties carry
`expiresAt = now + EXTERNAL_PROPERTY_TTL_DAYS` (30), refreshed on every
re-ingest, and `db/expiry.ts` sweeps the expired ones. So the table drained
itself, a row at a time, over the following month until **two seeded fixtures
were the entire database**. Measured span: at least 60 days, the full depth of
the retained worker logs.

### Why nobody noticed

Three failures stacked, and each one alone would have been survivable.

1. **Nothing ever asked the proxy whether it worked.** The worker found out by
   failing a real job, then another, 19,497 times.
2. **The reason was unreachable.** Node reports a refused CONNECT as a bare
   `TypeError: fetch failed` and buries the status three `cause` levels down.
   The worker logged `error.message` only, so every one of those failures read
   as four generic words — indistinguishable from a portal being down.
3. **The one metric that looked like a heartbeat was masked by test data.** The
   `fixture` provider needs no network, so it kept ingesting 2 listings on every
   worker boot, 8 a day, for the entire outage. Any "did anything ingest?" check
   would have been green throughout.

That third point is the one worth carrying to other subsystems. It is
`AGENTS.md`'s "ask what reads its output" in a new shape: the output existed and
was even plausible, but the signal was diluted by rows that prove nothing.

### What watches it now

Two log markers, defined in
`services/ingestion/ingestHealthMarkers.ts`, matched by
`aws_cloudwatch_log_metric_filter` resources in
`oxy-infra/terraform-uswest2/alerts.tf`, alarmed onto the `oxy-alerts` SNS topic
and relayed to Telegram (oxy-infra runbook 23).

| Marker | Emitted when | Alarm |
| --- | --- | --- |
| `listing-ingest-ok` | a **non-fixture** listing is ingested | fires when the 6h sum is 0 twice running |
| `listing-proxy-unusable` | the proxy refuses CONNECT with 402/407 | fires on one occurrence; clears only after 60 min silent |

`listing-ingest-ok` is the catch-all and does not care why: dead proxy, a portal
changing its markup, Redis gone, the worker crashed, queues silently drained —
all of them end in no homes arriving, which is the thing actually worth paging
about. `listing-proxy-unusable` exists to make the most likely cause legible in
the first line of the alert instead of after a log dig.

**The catch-all alarm is fail-safe in both directions, on purpose.** Delete the
heartbeat call, rename the marker, or break the filter, and the metric sits at
its `default_value` of 0 — which fires the alarm. A broken watchdog here is
loud, never quiet. That is the opposite of the arrangement it replaces, and it
is the property to preserve if this is ever refactored.

`listing-proxy-unusable` does NOT have that property: rename it and it simply
never fires again. It is a diagnostic shortcut layered on top of the catch-all,
never the thing relied on. The marker literals are pinned by
`__tests__/unit/ingestHealthMarkers.test.ts` so a rename fails a test that names
the terraform file to change.

### The proxy check

`checkResidentialProxy` (in `@homiio/listing-providers`) opens one tunnel and
classifies the outcome. **Any HTTP response is a pass** — the probe target's own
health is irrelevant, only whether the proxy carried the bytes. A captcha, a
redirect or a 500 from the far end all mean the proxy did its job; treating them
as failures would let an unrelated third party's bad day declare Homiio's proxy
dead.

Failures split into what a human must act on and what will clear by itself:

- `billing` (402) and `auth` (407) — **never transient.** Retrying is pointless;
  the balance or the credentials need a person. These alarm.
- `refused` (any other status) — the proxy answered and said no. Alarms.
- `network` (no status at all) — a blip. Logged as a warning and deliberately
  never alarms, because paging on ordinary packet loss trains everyone to ignore
  the channel that must work on the day the balance runs out.

It runs at boot **and every `LISTING_PROXY_CHECK_INTERVAL_MINUTES` (default 30,
`0` disables)**. Boot-only would not have caught this outage: the balance ran
out mid-run and the worker then ran for two months.

**That cadence is coupled to the alarm's recovery window**, which is the one
thing to remember before changing it. The marker repeats on this interval while
the fault persists, and the alarm returns to OK only once its entire window is
marker-free — an hour, against a 30-minute cadence. Shrink the window below the
cadence and every other window is empty by construction: the alarm flaps
ALARM → OK → ALARM and announces recoveries that never happened. Raising the
interval past 30 minutes therefore requires widening
`homiio-listing-proxy-unusable` in the same change; both sides say so and
oxy-infra's `test_homiio_listing_pipeline_alarms_iac.py` pins the ratio.

The check also only runs **when a live tier actually routes listing traffic
through the proxy** (`LISTING_HTTP_USE_PROXY`, or a browser tier that really
loaded Playwright — asked of the constructed runtime, not of the env var that
requests it). A proxy URL can be present purely for the optional media fallback
while every listing fetch goes direct, and paging about a credential nothing
depends on is the same mistake as paging on a transient blip.

The check deliberately **does not exit the process.** A hard exit turns a
transient blip at boot into a self-inflicted crashloop, and it would stop the
worker recovering on its own when the balance is topped up — which is how the
incident actually ended, with nothing needed beyond forcing the queues to re-run.
Being loud is the alarm's job.

### Recovery, when the alert fires

```bash
# Is it really the proxy?
curl -x "$(aws ssm get-parameter --region us-west-2 \
  --name /oxy/homiio/LISTING_RESIDENTIAL_PROXY_URL --with-decryption \
  --query Parameter.Value --output text)" https://api.ipify.org
```

An IP means the proxy is fine and the cause is elsewhere. `402` means top up the
account; `407` means rotate the credential in that SSM parameter. Once it
answers, re-run discovery immediately rather than waiting up to 6h for the next
cycle:

```bash
aws ecs update-service --region us-west-2 --cluster oxy-cluster \
  --service homiio-worker --force-new-deployment
```

Repopulation is not instant and is not supposed to be: 224 scopes on a 6h cycle,
with the browser-tier ES portals serialising behind the Playwright pool.

## The Adevinta portals, and the second silent zero (2026-09-20)

Habitaclia rebuilt its site. `/alquiler-<city>.htm` now 302s to
`/alquiler/viviendas/<province>/<city>/s`, the card markup changed, and the old
`data-href*="-i"` selectors match nothing. **A search that parses to zero cards
is indistinguishable from a city with no homes**, so discover reported success,
yielded nothing, and logged nothing — twelve consecutive jobs at 0 refs with no
error, while Spain sat at 31 listings against Germany's 481.

Exactly the shape of the 402 above: a zero wearing the costume of a normal
result. The fix is the same in spirit — make the failure say so.

### What the portals serve now

Both Spanish portals run the same front end (Habitaclia's photos are served from
`static.fotocasa.es`) and ship the whole result set as JSON inside the page,
under two different spellings:

| portal | wrapper |
| --- | --- |
| Fotocasa | `<script id="__initial_props__" type="application/json">` |
| Habitaclia | `window.__INITIAL_PROPS__ = JSON.parse("…")` — a JS string literal holding JSON, two layers of escaping |

`providers/adevinta/initialProps.ts` reads both. Measured on live pages through
the production proxy:

| city | listings | pages |
| --- | --- | --- |
| Madrid | 8,121 | 271 |
| Barcelona | 3,269 | 109 |
| Valencia | 2,605 | 87 |
| Zaragoza | 130 | 5 |

Each item carries title, full description, street name and number, coordinates,
district and neighbourhood layers, rooms, bathrooms, built surface, floor,
feature flags, the energy certificate, every image URL, and **the advertiser's
email and phone** — which the old detail-page path never saw and which the
classifieds contact rule asks for.

### Why the detail fetch is gone

Not as an optimisation. **The detail page is now client-rendered**: a live
listing returns 200 and 577 KB containing no JSON-LD, no embedded props and
nothing else a server-side parser can read. The search payload is the only place
the data exists, so `discover` carries the mapped listing on the ref's `hints`
and `fetch` returns it without touching the network. The ladder remains for refs
with no carried listing, and fails loudly rather than quietly if it is ever hit.

The cost follows for free: **one request per 30 listings instead of 31.**
Barcelona's 3,269 rentals cost 109 requests instead of 3,378.

### Reading the payload: three outcomes, never two

```
payload read, listings present  -> yield them
payload read, zero listings     -> the city really is exhausted, stop
NO PAYLOAD AT ALL               -> we could not read this page; escalate
```

The third is the one that was missing. It is scoped to **a city that has
produced nothing at all**, not to "this page was empty" — running off the end of
pagination is also an empty page, and on the legacy markup that is the normal
way a city finishes. Escalating there would open a browser session at the end of
every successful city. Both halves are pinned by tests in
`__tests__/unit/habitacliaProvider.test.ts`.

The payload also states its own `totalPages`, so discover stops at the end of the
result set instead of spending `maxSearchPages` requests finding it — for a small
city that is 5 requests instead of 100.

### `LISTING_MAX_IMAGES_PER_LISTING`

The single most expensive number in the ingest, and until now it had no knob:
30, hardcoded in two places. Every image is **re-hosted**, not hotlinked —
downloaded, resized through Sharp, written to S3 and served from it — so this
one integer multiplies bandwidth, worker CPU and storage together, once per
listing, on every market. Four Spanish cities alone advertise ~14,000 rentals;
at 30 images each that is 420,000 downloads for four cities out of 68.

The default is unchanged at 30, because lowering it is a product decision about
how a gallery looks, not a refactor. What changed is that it can be lowered from
the task definition without a deploy, and that providers carrying image URLs
through the queue read the SAME value — measured on live pages, images are the
largest part of a carried listing (2,340 bytes against ~1,500 for the
description and ~660 for everything else), so carrying more than the ingest
keeps is waste twice over.

### Still open: Fotocasa's browser tier

Fotocasa's JSON gateway (`web.gw.fotocasa.es/v2/propertysearch/searchads`) now
returns **404**, so its primary discover path is dead and it falls back to
markup — which is why it yields tens of refs where a German provider yields
1,500. Its search page carries the same embedded payload as Habitaclia's and
**plain HTTP through the proxy reaches it** (measured: 200 on Barcelona, Madrid
page 2, and Valencia, 30-31 listings each, no Playwright involved), while the
current code only reaches `realEstates` through a warmed browser session. Moving
it to the HTTP path would recover the yield and drop the browser tier for ES
discovery entirely. Not done here; this change is already large.

## Fotocasa was collecting one listing in thirty

`parseFotocasaSearch` reads anchors out of the rendered page. On the live site
that yields **one ref for a page whose SSR payload holds thirty** — measured on
a Barcelona rental search through the production proxy. Discover was paginating
correctly the whole time and taking a thirtieth of every page, which is why this
provider produced tens of refs where a market-wide provider produces 1,500.

Two things hid it:

- **The gateway is gone.** `web.gw.fotocasa.es/v2/propertysearch/searchads` now
  returns **404**, so the JSON-first path the provider was designed around fails
  and every city falls through to markup parsing. The fallback was never meant
  to carry the provider.
- **The fixture had drifted.** `FOTOCASA_FIXTURE_SSR_SEARCH_HTML` carries
  `window.__STATE__={"realEstates":[{propertyId, detailUrl}]}`; the live page
  carries `<script id="__initial_props__">` with `initialSearch.result.realEstates`
  and `id` / `detail`. Both parse, so the suite stayed green while production
  collected a thirtieth. **A fixture that has drifted from reality cannot fail
  for the right reason** — `*_LIVE` is captured from the real page and both are
  kept, the old one for the legacy shape that still reaches the parser.

`fotocasaRefsFromSearchCards` builds refs from the cards `extractFotocasaSearchCards`
already reads, and the two sources are **unioned** rather than chosen between: a
card the anchors missed and an anchor the payload missed are both listings. The
cards were already carried into `hints`, so refs derived this way arrive with
their whole listing attached and need no detail fetch — the same shape
Habitaclia now uses. Measured end to end on the live page: **30 refs, 30 with a
card hint, 30 normalized with zero network calls.**

## The scraper endpoint was an SSRF (CRITICAL, open since 2025-08-23)

`POST /api/scraper/run` takes `endpoint` straight from the request body and
hands it to `axios.get`. `requireAdmin` guards the route — but **it bounds who,
not what**, and this process runs inside the VPC. An admin-supplied endpoint
makes the API issue a GET from a position nothing on the internet has:
`169.254.170.2/v2/credentials/…` (the task role's IAM credentials), IMDS,
`postgres.internal.oxy.so`, every internal service. App-admin becomes AWS-role.

To be precise about impact, because it is easy to overstate: the response body
is parsed into listings and returned as counts, not echoed to the caller, so
this is not a clean credential read-back. It is arbitrary GET from inside the
VPC, which is enough.

`utils/outboundGuard.ts` puts two layers in front of it, and **both are
required**:

| defeat | what stops it |
| --- | --- |
| an allow-listed host answering `302 Location: http://169.254.170.2/…` | `maxRedirects: 0` — follow none, not fewer |
| a name that resolves to public at validation and link-local at connect | a `dns.lookup` on the socket that refuses internal addresses **at connect time** |

The allowlist alone is defeated by rebinding; the address check alone would
permit any public host and turn the API into an open proxy.

**`SCRAPER_ALLOWED_ORIGINS` is empty by default, and empty means nothing is
allowed.** The legacy scrape loop this route drove is retired; what remains is
manual admin tooling nothing runs on a schedule. A default of "any host" is what
made the finding critical, and a default of "none" fails as a 400 rather than as
a leaked IAM role.

The endpoint is validated **outside** `runExternalScrape`'s try block on
purpose: that catch folds every failure into `errorDetails` and still returns a
200-shaped result, so a refusal raised inside it would read as "the scrape ran
and found nothing" — the same silent-zero shape as everything else on this page.
A 3xx from the destination is likewise treated as a failure rather than as an
empty feed.

## Throughput: the ingest was 120 sequential round trips per listing

Measured in production on 2026-09-20, from the worker's own log timestamps:

```
4.6 listings/minute
median gap between ingests: 9.5 s
```

At that rate Madrid's 8,121 rentals take **thirty hours** and the Spanish market
takes weeks — which is why Spain crawled up in tens while the portals advertise
tens of thousands.

The cause was not the network, the queue or the parsers. **Image ingest ran
strictly serially**: one `await` per image in `ingestForProperty`, and inside
each image one `await` per size variant in `processAndUpload`. A listing carries
up to 30 images and every image is re-hosted into four variants, so one property
cost up to **120 sequential fetch → Sharp → S3 round trips**. 30 images at
~300 ms each is 9 s, which is the median gap almost exactly.

Nothing about the work required that order. The images of one listing are
independent, and `isPrimary` / `order` come from the INDEX rather than from
insertion sequence, so running them together changes the clock and nothing else.

- images within a listing: bounded-parallel via `utils/concurrency.ts`
  (`LISTING_IMAGE_INGEST_CONCURRENCY`, default 6)
- the four variants of one image: `Promise.all` — there are exactly four

**Bounded, not `Promise.all`, on the outer loop.** Unbounded would fan 30 Sharp
pipelines and 120 S3 PUTs out of a single job, times the fetch-worker count —
enough to exhaust sockets and thrash libvips' thread pool, turning a throughput
fix into an availability problem.

**`LISTING_FETCH_CONCURRENCY` was deliberately NOT raised.** Six images in
flight per listing times six fetch workers times four variants is already ~144
concurrent S3 operations. The image parallelism multiplies the worker count;
raising both compounds.

### What the tests pin, and why they pull against each other

Going parallel is easy. Going parallel without reordering the gallery or losing
a listing to one dead photo is the work, so all three are asserted:

| property | why it is fragile |
| --- | --- |
| order preserved | the cover photo is decided by position; a push-as-they-land implementation passes "did everything run?" and silently shuffles every gallery |
| concurrency bounded | an unbounded fan-out passes a timing test and fails in production |
| one bad photo skipped, not fatal | the `catch` must stay INSIDE the task; outside, one 404 rejects the batch and costs the whole property |

The timing test is sized so it **can fail**: 24 images at 40 ms is 960 ms
serially against a 600 ms budget. Verified by mutation — forcing concurrency
back to 1 turns it red at 969 ms.

## `LISTING_HTTP_DIRECT_FIRST`: stop paying for bandwidth you don't need

The residential proxy is **metered**, and search pages are enormous: a
Habitaclia results page is ~1.9 MB and a Fotocasa one ~1.0 MB. Discovery walks
up to `LISTING_ES_MAX_PAGES` (100) of them per city, across 68 Spanish cities,
four times a day. Routing all of that through residential bandwidth is tens of
gigabytes daily — and is the most plausible reason the account emptied itself
and took the pipeline down with it.

Most of those requests do not need a residential IP at all. Every search page
tested here — Habitaclia, Fotocasa, Pisos — was served in full to an ordinary
connection.

So `fetchHttp` now tries **direct first** and falls back to the proxy when the
attempt is refused: a non-2xx, a body the caller recognises as a challenge
(`FetchRuntimeInit.isChallenge`), or a throw.

**The worst case is one free request.** A refused attempt is retried through the
proxy immediately, so the outcome is what it is today plus one unbilled try.
That is what makes the default ON defensible rather than a gamble. Set it to
`false` if a portal starts treating the datacentre IP as hostile in a way the
fallback cannot see.

`isChallenge` matters more than it looks: a portal that soft-blocks with a
**200** is invisible to a status check, and without the predicate the cheap
attempt would be accepted, the page would parse to nothing, and the provider
would escalate to the browser tier — the most expensive path of all — instead of
simply retrying through the proxy.

### Measured effect of the throughput work

After parallelising image ingest (`LISTING_IMAGE_INGEST_CONCURRENCY`), taken
from the worker's own log timestamps:

| | before | after |
| --- | --- | --- |
| listings/minute | 4.6 | **36.5** |
| median gap between ingests | 9,520 ms | **518 ms** |

Madrid's 8,121 rentals go from a thirty-hour import to under four.

## Rotation: why three providers imported nothing while being perfectly healthy

Measured 2026-09-21, with the worker stable for twelve hours:

```
discover jobs started, 14h:  17
on the live task:            5 started, 2 finished
ingests in 12h: immowelt 636 · habitaclia 456 · otodom 391 · immoweb 375
                openrent 351 · mercadolibre_mx 317 · mercadolibre_ar 232
                kleinanzeigen 75 · immobilienscout24 69 · fotocasa 4 · pisos 2
                rightmove 0 · onthemarket 0 · blueground 0
```

`rightmove`, `onthemarket` and `blueground` were **enabled, registered, healthy
and producing nothing** — and the logs contained not one error for them in
twelve hours, because nothing had gone wrong. **They were never reached.**

Discovery schedules 224 scopes every 6 hours and ran three at a time, and one
deep city walk — up to `LISTING_ES_MAX_PAGES` pages of 1-2 MB each — can hold a
slot for tens of minutes. A full rotation at that pace takes days, so whatever
sits at the back of the list never runs at all.

Two changes make rotation a property rather than a hope:

- **`LISTING_DISCOVER_JOB_BUDGET_MS`** (default 5 min): a scope yields what it
  found when its time is up and frees the slot. Partial results are kept — a
  timed-out scope that found 300 homes contributed 300 homes. The pages it did
  not reach come on a later cycle, since discovery re-walks from page 1 and the
  fetch queue dedupes on `(provider, sourceId)`. The budget is capped below the
  10-minute BullMQ lock so a job can never outlive its lock and be redelivered.
- **`LISTING_DISCOVER_CONCURRENCY` default 3 → 6.** The old value dates from
  when every Spanish portal paged through a warmed Playwright session. Habitaclia
  and Fotocasa now read their whole result set from JSON in the search page over
  plain HTTP, so most scopes never touch a browser and three slots left the
  queue idle.

A timed-out scope is reported (`timedOut: true`) so a scope that is permanently
too big to finish is visible rather than merely slow — a market whose every
scope times out is under-collected, and nothing else would say so.

## 44 providers implemented, 13 switched on

The single largest lever on how much is imported is not code: 31 implemented
providers are `PROVIDER_<ID>_ENABLED=false`, most of them documented above as
"OFF until a browser plus residential proxy" for their market. Enabling them is
a task-definition change, and it is **not free** — each one spends metered
residential bandwidth, and an exhausted balance is what took the pipeline down
on 2026-09-20. Turn them on in small batches and watch
`Oxy/Homiio ListingsIngested` per market rather than all at once.
## Every provider runs; the fleet rests what cannot work

The registry used to be opt-in, one `PROVIDER_<ID>_ENABLED` per portal. Measured
2026-09-21: **44 providers implemented, 13 switched on.** Thirty-one finished
portals imported nothing because a variable nobody revisited said so — and
three of the thirteen that *were* on also imported nothing, for an unrelated
reason. Nothing in the system could tell those two cases apart.

The default is now ON, and the environment carries **one** variable:
`LISTING_DISABLED_PROVIDERS` (comma separated, empty by default). A provider
that ships is a provider that runs.

### What replaced the per-portal knowledge

The old flags carried real operational knowledge — *"OFF: DataDome"*, *"OFF:
Akamai hard-blocks from datacenter AND residential"*, *"keep OFF until
confirmed"*. That is not discarded; it moves from a static list a human
maintains to a runtime decision.

`services/ingestion/providerBackoff.ts` rests a provider whose discover passes
keep coming back empty, then retries it an hour later:

- **empty counts the same as failed.** A hard-blocked portal usually answers 200
  with a challenge page, so "produced zero" and "raised an error" describe one
  condition from outside. Treating only the noisy one as failure would rest
  exactly the providers honest enough to fail loudly.
- **one good pass clears the streak outright**, not by one. A provider
  recovering from a lifted block should not have to earn back three turns.
- **resting is logged, with the reason and the retry time.** A provider that
  quietly stopped being tried is the defect this week has been about.
- **state is in memory on purpose.** It is a cost heuristic about the last few
  minutes, not a durable fact about a portal; persisting it would let a restart
  inherit a verdict formed under conditions that no longer hold.

The property that matters, and the one a flag never had: **a portal whose block
lifts comes back on its own.** `OFF until Cloudflare clears` stays off after
Cloudflare clears, because nobody is watching for the day it does.

### This costs money

More providers means more metered residential bandwidth, and an exhausted
balance is what took the pipeline down on 2026-09-20. Three things bound it that
did not exist then: the direct-first ladder tries an unbilled request first, the
discover budget stops one scope holding a slot, and `Oxy/Homiio ListingsIngested`
alarms per market. Watch the proxy balance over the first days.
