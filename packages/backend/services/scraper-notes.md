# Scraper notes

## Current architecture (2026-07)

External listing ingestion is handled by `packages/backend/worker.ts` + `@homiio/listing-providers` on BullMQ. See **Listing Provider Plugins** in `AGENTS.md` for the full architecture, queue names, plugin contract, and how to add providers.

The legacy Fotocasa cron scrape loop (`localhost:3000` sidecar) is retired. `services/cron.ts` now runs only health + TTL cleanup. The `scraperService` upsert helpers (`upsertExternalListing`, `getScraperHealth`, `cleanupExpiredProperties`) remain for TTL cleanup, health reporting, and manual admin-triggered runs via the admin-only `/api/scraper/*` routes.

## US portal probes (2026-07)

| Portal | Status | Acquisition |
|--------|--------|-------------|
| realtor.com | **shipped** | Direct GraphQL HTTP (`ConsumerSearchMainQuery` / `HomeDetails`) |
| hotpads.com | **shipped** | Public JSON API (`area/byResourceId` + `listing/byCoordsV2`) |
| redfin.com | **shipped** | Playwright session warm + Stingray AJAX (`{}&&` prefix) |
| rent.com | skipped | `302 → ratelimited.rent.com` |
| trulia.com | skipped | Zillow Group overlap |

Enable via `PROVIDER_REALTOR_COM_ENABLED`, `PROVIDER_HOTPADS_ENABLED`, `PROVIDER_REDFIN_ENABLED` (Redfin also needs `LISTING_BROWSER_ENABLED`). Optional city list: `LISTING_US_CITIES` (comma-separated, e.g. `Austin, TX,Miami, FL`).

## Habitaclia AJAX probe (2026-07-10) — listainmuebles shipped

Probed habitaclia.com with residential proxy (`LISTING_RESIDENTIAL_PROXY_URL` from SSM) and Playwright warm sessions.

### Endpoints

| Endpoint | Method | Direct | Proxy HTTP | Notes |
|----------|--------|--------|------------|-------|
| Search | GET `/alquiler-{city}.htm` | 403 Imperva | 200 (~295k HTML) | Listing cards in `data-href` (not `href`) |
| Paginate | POST `/dotnet/listados/listainmuebles` | 403 | 200 HTML fragment (~249k) | Body: hidden `Filtros.*` + `pagina=N`; **not JSON** |
| Detail | GET `/alquiler-…-i{id}.htm` | 403 | 200 (~386k HTML) | **No JSON-LD on live pages** — microdata + meta |
| Images | POST `/Ficha/GetImagesInmueble` | — | 404 | Not used — gallery URLs already in detail HTML |
| `__NEXT_DATA__` / GraphQL | — | absent | Server-rendered ASP.NET portal |

### Shipped path

- **Discover:** warm session → page 1 from search HTML → pages 2+ via listainmuebles POST; HTTP/proxy POST fallback when no browser session.
- **Fetch:** HTML ladder; JSON-LD when present, else microdata parser (`itemprop=price/image`, `#js-detail-description`, `.feature-container`).
