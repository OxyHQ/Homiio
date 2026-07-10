# Homiio — Real Estate Platform

Expo/RN frontend + Express backend. Agent: `homiio`.

## Deployment

- **Port**: `4000` | **Domain**: `api.homiio.com` | **ECR**: `oxy/homiio`
- Build: `linux/arm64` Dockerfile in `packages/backend/`.

## Commands

```bash
bun run dev                 # All packages dev mode
bun run dev:frontend        # Frontend only (Expo tunnel)
bun run dev:backend         # Backend only
bun run build               # Build all
bun run test                # Test all
bun run lint                # Lint all
bun run clean               # Clean everything
```

## Architecture

```
packages/
  frontend/       @homiio/frontend      Expo 56 / React Native 0.85 / React 19 / NativeWind 5 (preview)
  backend/        @homiio/backend       Express 4.21 / Mongoose 8 / Stripe / Sharp
  shared-types/   @homiio/shared-types  Types: address, city, lease, profile, property, review
```

Version numbers live in each `package.json` — read them there, don't trust this block for exact pins.

## Key Features

- **Properties**: Listings, search, saved, viewings
- **Payments**: Stripe 16.11 (billing, subscriptions)
- **AI**: `@ai-sdk/openai` for smart features
- **Location**: `expo-location` for geolocation
- **Messaging**: Telegram + WhatsApp integrations
- **Media**: Image processing (Sharp), AWS S3 storage
- **i18n**: i18next with locales

## Routes

**Frontend**: addresses, contracts, horizon, insights, profile, properties, reviews, roommates, saved, search, settings, sindi, tips, viewings

**Backend**: addresses, ai, analytics, billing, cities, images, leases, notifications, profiles, properties, public, reviews, roommates, rooms, scraper, telegram, tips, viewings

## IDOR Fix (CRITICAL)

Property/room/**lease** create and update use a server-resolved owner id (`profileId` for property/room, `landlordProfileId` for lease) + an explicit editable-field whitelist. Never accept raw owner ids or lifecycle/system fields (`status`, `signatures`, `paymentSchedule`, …) from the request body — the backend resolves the owner from the authenticated user via `getRequiredOxyUserId`/`Profile.findActiveByOxyUserId`. Do not regress this.

- Shared guard: `packages/backend/utils/pickFields.ts` (one implementation for every write controller).
- Whitelists: `controllers/property/editableFields.ts` (property + room) and `controllers/lease/editableFields.ts` (`CREATABLE_LEASE_FIELDS`/`EDITABLE_LEASE_FIELDS`).
- Rule: never `new Model(req.body)`, never `...req.body`, never a denylist — pick the allowlist, then set server-only fields explicitly. Keep whitelists in sync with the schemas.

## Backend Client (Live)

The Oxy linked client is live in `packages/frontend/utils/api.ts` (`oxyClient.createLinkedClient({ baseURL })`). It owns auth: it mirrors the Oxy session token, delegates 401 refresh, and invalidates the session on refresh failure — apps must NOT add local token providers, auth interceptors, or manual `Authorization` headers.

- `normalizeEnvelope` in `utils/api.ts` is the INTENTIONAL bridge that re-wraps the linked client's auto-unwrapped payload back into the `{ success, data, … }` envelope Homiio's ~45 consumers read (`response.data.data`). It stays until those consumers migrate — do not "fix" or remove it piecemeal.
- The only sanctioned `oxyServices.getAccessToken()` use is Sindi's streaming fetch (`hooks/useSindiAuthenticatedFetch.ts`): the linked client is JSON-only and cannot stream. Do not add new `getAccessToken` call sites.

## Listing Provider Plugins (Market Aggregator)

Homiio aggregates external market listings (Idealista, Fotocasa, Habitaclia, Blueground, apartments.com, Zillow, …) as **first-party data** — never hotlinked, never live-proxied.

### Model
- External properties have `isExternal: true`, no `profileId`, `status: 'published'`, and a mandatory `sourceUrl`.
- The frontend already handles these: source badge, blocked apply/viewing, CTA to `sourceUrl`. Do not remove that differentiation.
- Upsert key is `(source, sourceId)` — handled by `scraperService.upsertExternalListing`.

### Package layout

```
packages/
  listing-providers/   @homiio/listing-providers   Plugin contract, ProviderRegistry, FetchRuntime, plugins
  backend/
    services/ingestion/IngestionService.ts          NormalizedListing → Property upsert + image pipeline
    services/ingestion/ExternalMediaIngest.ts       fetch → Sharp → S3 → Image doc → PropertyImageRef
    services/ingestion/queues.ts                    BullMQ queue definitions
    worker.ts                                        Worker entrypoint (separate process, same image)
```

`shared-types` exports `NormalizedListing` — the handoff DTO from provider → ingest.

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

`FetchRuntime` (shared, not per-plugin) owns: rate limiting, retries, circuit breaker, Playwright pool, proxy/managed ladder, challenge/CAPTCHA detection → requeue or escalate.

- **Escalation tiers are WORKER-ONLY and env-gated (default OFF).** Build the worker runtime with `createListingFetchRuntimeFromEnv()` (never in the API). Browser tier: `LISTING_BROWSER_ENABLED=true` + Playwright installed (it is an OPTIONAL peer of `@homiio/listing-providers`, loaded via dynamic `import()`; absent → tier skipped, logged, CI still green). Managed tier: `LISTING_MANAGED_FETCH_URL` (+ optional `LISTING_MANAGED_FETCH_KEY`/`*_KEY_HEADER`/`*_KEY_PARAM`/`*_URL_PARAM`); unset → rung does not exist (never faked). The ladder keys tier availability off method presence, so an unprovisioned rung is skipped, not attempted-and-failed. Worker must `await runtimeHandle.shutdown()` to close the browser pool.

### BullMQ queues (Valkey via `REDIS_URL`)

| Queue | Purpose |
|-------|---------|
| `listing-discover` | city/bbox + provider → produces `ExternalListingRef` batch |
| `listing-fetch` | single `sourceId` → fetch + normalize → ingest |
| `listing-media` | propertyId + remote URLs (if media is decoupled from upsert) |

- Queue names must NOT contain `:` (BullMQ + Valkey restriction).
- Dedup job ids: sha256 of `(provider, sourceId)` — never pass raw values with colons as custom ids.
- BullMQ connections need `maxRetriesPerRequest: null`.

### Ingest pipeline (no portal CDN hotlinks ever)

1. Validate `NormalizedListing`.
2. `Address.findOrCreateCanonical` + geocode.
3. Upsert Property with `isExternal: true`, `status: 'published'`, `sourceUrl`, `expiresAt` TTL.
4. For each `remoteImages` entry: download → Sharp → `createImageForEntity('property', id, …)` → `PropertyImageRef`. Dedup by URL/hash stored in Image metadata; re-syncs add/remove refs.
5. Never store a portal CDN URL as a runtime `images[].url`.

### How to add a new provider

1. Create `packages/listing-providers/src/providers/<name>/index.ts` implementing `ListingProvider`.
2. Register it in `packages/listing-providers/src/registry.ts`.
3. Gate it with a feature flag env var `PROVIDER_<NAME>_ENABLED=true` (see below).
4. Add integration test: normalize fixture → upsert → Image refs with storage mock.

### Feature flags

Each provider is opt-in via env:

```
PROVIDER_IDEALISTA_ENABLED=true
PROVIDER_FOTOCASA_ENABLED=true
PROVIDER_HABITACLIA_ENABLED=true
PROVIDER_BLUEGROUND_ENABLED=true
PROVIDER_APARTMENTS_COM_ENABLED=true
PROVIDER_ZILLOW_ENABLED=true
```

The worker reads these at startup; disabled providers are not registered.

### Legacy retirement

- The legacy Fotocasa 30-second cron scrape loop is **gone**. `services/cron.ts` now runs only health + TTL cleanup.
- The `localhost:3000` sidecar dependency and `config/cron.ts` `scrapeSources` array are removed.
- `/api/scraper/*` routes are admin-only (`middlewares/requireAdmin.ts`).
- `scraperService` upsert helpers (`upsertExternalListing`, `getScraperHealth`, `cleanupExpiredProperties`) remain for TTL cleanup, health reporting, and manual admin runs.
- See `packages/backend/services/scraper-notes.md` for the archived migration log.

### Worker deploy

`packages/backend/worker.ts` is the worker entrypoint — same Docker image as the API, different start command. Run with a separate ECS task definition. Separate container only if Playwright memory becomes a concern.

## Layout Shell & Design Tokens (CRITICAL)

### ContentPanel (Bloom, Mention-shaped)

The center column uses Bloom `ContentPanel` (`framed` + `maskColor`) — **not** a flat `mainContentWrapper` or custom bleed-mask. Reference: Mention `app/(app)/_layout.tsx`.

- `framed={Platform.OS === 'web' && isScreenNotMobile}` (≥500 px wide).
- `maskColor={theme.colors.background}` (unscoped — matches page bg).
- Native phone: `framed={false}` / full-bleed.
- Explore is fixed-viewport: no page scroll; still wraps center in ContentPanel when framed.
- **Never hand-roll a bleed-mask** — ContentPanel owns it.

### Scroll ownership (one owner per surface)

Web default = **document scroll**. Do NOT wrap SideBar+Slot in a layout-level `Animated.ScrollView`. The layout is a static flex row; only the screen (or document on web) scrolls.

| Surface | Owner |
|---------|-------|
| Web (default) | Document |
| Native tabs | Screen `Animated.ScrollView` (local SharedValue) |
| Explore | Fixed shell (no page scroll) |

Remove `LayoutScrollProvider` / layout scroll handler when not needed. No dual writers of `scrollY`. Sticky Header `top` = Bloom `PANEL_TOP_INSET` (8) when framed.

### Section stacking (NativeWind gap)

Use NativeWind `gap-8 md:gap-12` on the section container — **not** per-section `marginTop: sectionGap` or `resolveSectionSpacing()`. Bottom padding: `pb-14` (home) / `pb-20` (agent).

- Drop `HomeCarouselSection` outer `marginBottom`.
- Wide CTA rows: `flex-row items-stretch gap-8 md:gap-12`.

### Design-token CSS (no hand-copied radius)

`@import "@oxyhq/bloom/design-tokens/theme.css"` in `packages/frontend/styles/global.css` after the Tailwind import. This provides `rounded-radius-28`, `p-space-8`, etc. without pasting anything locally.

- **Never declare `--radius-radius-*` or other Bloom scales in `global.css`** — the Bloom import is the sole authority.
- Keep only Homiio-local color seeds / `:root` overrides in `global.css`.
- Bump `@oxyhq/bloom` in `packages/frontend/package.json` + lockfile in the same commit when the import is added.

## NativeWind — `Pressable` Function-Form `style`

The NativeWind css-interop (v4 `react-native-css-interop`, and the v5 preview / `react-native-css` this app now runs) does NOT support React Native's function-form `style={({ pressed }) => [...]}` — the function is swallowed and the `Pressable` renders with no style at all.

**Fix:** static style array + `onPressIn`/`onPressOut` + `useState`:

```tsx
const [pressed, setPressed] = useState(false);
<Pressable
  onPressIn={() => setPressed(true)}
  onPressOut={() => setPressed(false)}
  style={[styles.x, pressed && styles.xPressed]}
>
```

- For web hover, use `onHoverIn`/`onHoverOut` + state instead of `({ hovered })`.
- Hooks can't run inside `.map()` — extract a small component when a function-form `Pressable` lives in a list.
- Canonical template: `packages/frontend/components/search/SearchSummaryBar.tsx`
- Audit: `grep -rn "style={({" app components --include=*.tsx` must return ZERO.
