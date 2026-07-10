# Scraper notes

## Current architecture (2026-07)

External listing ingestion is handled by `packages/backend/worker.ts` + `@homiio/listing-providers` on BullMQ. See **Listing Provider Plugins** in `AGENTS.md` for the full architecture, queue names, plugin contract, and how to add providers.

The legacy Fotocasa cron scrape loop (`localhost:3000` sidecar) is retired. `services/cron.ts` now runs only health + TTL cleanup. The `scraperService` upsert helpers (`upsertExternalListing`, `getScraperHealth`, `cleanupExpiredProperties`) remain for TTL cleanup, health reporting, and manual admin-triggered runs via the admin-only `/api/scraper/*` routes.
