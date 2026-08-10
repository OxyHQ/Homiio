# Homiio

Housing platform: find a place, research its history, understand what it really
costs, and manage or defend the tenancy. Expo/RN frontend plus an Express
backend. Agent: `homiio`.

> Org-wide engineering standards (package manager, TypeScript, React, naming,
> error handling, security, testing, git and PR conventions) live in
> <https://github.com/OxyHQ/engineering>. This file carries only what is true of
> Homiio specifically. Versions are in `package.json`, never here.

## The four architecture decision records (READ BEFORE DESIGNING ANYTHING)

`docs/adr/` holds the contracts every housing, location, privacy and pricing
change is bound by. They are the authority; this file summarises where they
apply and never restates their rules. Index: [`docs/adr/README.md`](docs/adr/README.md).

| ADR | Decides |
|---|---|
| [0001](docs/adr/0001-canonical-housing-graph.md) | Street / building / unit / listing — what a dwelling IS, and what a listing is not |
| [0002](docs/adr/0002-location-and-search-contract.md) | One location + search contract for Home, Explore, reviews and evictions |
| [0003](docs/adr/0003-privacy-verification-publication.md) | Data classification, the precision ladder, verification, publication |
| [0004](docs/adr/0004-local-explainable-pricing.md) | Local, explainable, versioned price assessments |

All four are **Status: Proposed** as of 2026-08-10. They bind DESIGN — a new
feature must not contradict them — but they describe target contracts, so do not
document their rules as shipped behaviour. Re-read the `Status` line rather than
trusting this sentence; it is the kind of fact that goes stale quietly.

### The invariants they establish

Four rules, stated here only so nobody has to read 5,000 lines to find out a
change is disallowed. The ADR is the authority for each; do not re-derive.

1. **A dwelling is permanent; a listing is temporary.** The identity of a place
   is a row in `addresses` at a declared level (`STREET` / `BUILDING` / `UNIT`).
   A row in `properties` is a sourced advertisement POINTING AT a place — it may
   exist several times over for one dwelling, disappear, and come back. Never
   treat a `properties.id` as the identity of a home. (ADR 0001)
2. **Location is never implicit.** Every surface answering "where?" states the
   area it is querying, and a geocoding failure never degrades into a worldwide
   feed. Free text and geographic scope are independent dimensions. (ADR 0002)
3. **Privacy by precision.** A coordinate, an address and a review are stored at
   one precision and published at another; the reduction happens on the way OUT.
   Never widen a published precision without ADR 0003.
4. **Pricing must be explainable.** A price assessment is local, versioned and
   carries its reasoning and confidence. No universal score. (ADR 0004)

**Do not duplicate an ADR's rules into this file, a doc page or a code comment.**
Link the ADR. A rule copied twice diverges, and the copy is what people read.

## Deployment

Homiio runs on **AWS ECS Fargate**, not DigitalOcean App Platform or droplets.
Infra (ECS task definitions, ALB, ECR, SSM, the S3 bucket) lives in
`~/Oxy/oxy-infra/terraform-uswest2/`.

- Port `4000`, domain `api.homiio.com`, ECR `oxy/homiio`, region `us-west-2`.
- Built from the `linux/arm64` Dockerfile in `packages/backend/`.
- Deploy: push to `main`, then `.github/workflows/deploy-aws.yml` (OIDC
  `oxy-github-deploy`, no AWS keys in GitHub).
- Secrets: GitHub repo secrets to SSM `/oxy/homiio/*` and `/oxy/_shared/*`,
  injected by ECS at task launch.
- Media: S3 bucket `oxy-homiio-media-usw2-237343248947`, set via `AWS_S3_BUCKET`
  in the ECS env.
- Worker: the same ECR image, a separate ECS service (`app-homiio-worker.tf`),
  entrypoint `packages/backend/worker.ts`.
<!-- vocabulary-exempt:start names the secret that was REMOVED, so the removal can be verified against SSM -->
- `DATABASE_URL` is the only database secret either task definition carries;
  `MONGODB_URI` is off both and deleted from SSM. A secret added to either task
  definition must be added to `deploy-aws.yml`'s explicit sync allowlist in the
  SAME change, or it is silently never synced to SSM.
<!-- vocabulary-exempt:end -->

## Commands

```bash
bun run dev                 # All packages dev mode
bun run dev:frontend        # Frontend only (Expo tunnel)
bun run dev:backend         # Backend only
bun run build               # Build all
bun run test                # Test all
bun run lint                # Lint all
bun run check:lockfile      # Two-layer lockfile sync check
bun run clean               # Clean everything
```

## Workflow

**Automated PR reviews run on `listing-providers` and `backend`.** After opening a
PR, address the automated review comments (Gemini, Bugbot, CodeQL, Copilot)
before merge: fix high-confidence security and correctness findings, and defer
bikeshed or docs-only ones unless trivial.

## Architecture

```
packages/
  frontend/           @homiio/frontend          Expo / RN / NativeWind
  backend/            @homiio/backend           Express / PostgreSQL (drizzle) / Stripe / Sharp
  shared-types/       @homiio/shared-types      address, city, lease, profile, property, review
  listing-providers/  @homiio/listing-providers Plugin contract, FetchRuntime, provider plugins
```

The production Dockerfile builds in dependency order: `shared-types`, then
`listing-providers`, then `backend`. The API image includes
`@homiio/listing-providers`, and the worker uses the same image with a different
start command.

## Data storage: PostgreSQL, and nothing else

PostgreSQL is the only store. Database `homiio` on the shared RDS instance
`oxy-postgres`, with **PostGIS** installed once by a privileged role (it is not a
trusted extension — the app role that owns the database cannot install it
itself). `DATABASE_URL` is the only database secret either process needs, and
`initializeDatabase()` exits non-zero without it.

<!-- vocabulary-exempt:start states what was REMOVED and names the reintroduction gate; both need the old vocabulary to be checkable -->
**The Mongo→Postgres migration is finished.** `database/connection.ts`,
`models/`, `db/backfill/`, `mongoose` and `mongodb-memory-server` are all
deleted, `config.ts` reads no `MONGODB_URI` and has no `config.database` key,
and `homiio-production` is archived. There is no rollback target: the only copy
of the old data is an offline dump.

`__tests__/unit/mongoUnreachable.test.ts` stays, and is now a REINTRODUCTION
GATE rather than a progress tracker — its `PENDING_MONGO_FILES` map is empty, so
any module that imports mongoose or opens a Mongo connection fails the build. It
scans COMMENT-STRIPPED source on purpose, because several modules here document
what they no longer do in exactly that vocabulary. Bringing Mongo back is
allowed, but it has to be a decision somebody makes on purpose and writes down.
<!-- vocabulary-exempt:end -->

**The porting rules — id preservation, the census-before-porting discipline,
schema-fixture pitfalls already found and fixed once — live in
`packages/backend/db/MIGRATION-CONTRACT.md`, and the table-by-table schema
decisions in `packages/backend/db/schema/CONVENTIONS.md`. Those two documents are
HISTORY plus durable rules; this section is the current state.**

- **Every domain is on Postgres.** Repository code lives under
  `packages/backend/db/<domain>/`; controllers call a repository, never an ORM
  model. That includes the property catalogue's reads AND WRITES
  (`db/properties/propertyWrites.ts`, reached by
  `controllers/property/create.ts`, `updateDelete.ts` and `transact.ts`),
  addresses and geo reference data, images, tenancy (leases, applications,
  viewings, reservations, home exchanges), saved properties/folders/recently
  viewed, conversations, profiles, notifications and saved searches, the roommate
  handshake, the CrowdSource moderation pipeline, evictions, billing, partner
  commissions, analytics and the listing-ingestion pipeline.
- **There is no divided authority left, and there is no split-store caveat to
  work around.** Earlier revisions of this file described property writes and
  profile reads as still living on the pre-migration store. That was true when
  written and is not now — re-measure rather than trusting either statement:

  <!-- vocabulary-exempt:start a reintroduction census must name the term it searches for, or it measures nothing -->

  ```bash
  # Real imports, not prose. Expect ZERO.
  git ls-files -- 'packages/' | grep -E '\.(ts|tsx|js|mjs|cjs)$' \
    | xargs grep -nE "from ['\"]mongoose['\"]|require\(['\"]mongoose['\"]\)"
  # Positive control — the same shape against a package that IS imported.
  git ls-files -- 'packages/' | grep -E '\.(ts|tsx|js|mjs|cjs)$' \
    | xargs grep -lE "from ['\"]drizzle-orm['\"]" | wc -l
  ```

  Measured on `docs/architecture-vocabulary-349` at base `bf3ef48b`
  (2026-08-10): **0 real mongoose imports** against **161 files importing
  `drizzle-orm`**, over 1,181 scanned source files. The only textual hits are
  `__tests__/unit/mongoUnreachable.test.ts`'s own detector fixtures, one
  assertion in `reviewSystem.test.ts`, and a commented-out line in
  `scripts/test-telegram-topics.js`. A bare `grep -i mongoose` matches prose and
  is the wrong instrument — it returns non-zero on a clean tree.

  <!-- vocabulary-exempt:end -->
- **Counting the port's remaining work is no longer a thing to do.** If you need
  to know whether a domain reads Postgres, read its controller's imports. The
  file-count figures this section used to carry moved every week and were the
  single most misleading thing in this document.
- **Migrations:** `bun run db:migrate` (`db/migrate.ts --phase=all` for a
  developer database). Never `drizzle-kit migrate`.

  In production `deploy-aws.yml` applies them as one-shot ECS tasks running the
  compiled `dist/db/migrate.js`, on both sides of the rollout: `--phase=pre` in
  the API lane before `update-service`, `--phase=post` in the WORKER lane after
  its rollout, because the worker rolls last and `post` is only safe once no old
  image is serving. Both are unconditional and pinned by
  `.github/scripts/test-deploy-ecs-image.sh` and
  `__tests__/unit/deployMigrationWiring.test.ts`.

  **This paragraph described an intention until 2026-08-10.** `RUN_MIGRATIONS`
  defaulted to `false` and nothing set it, so no deploy had ever applied a
  migration; production ran four behind and answered 500 on `/api/cities` and
  `/api/home/sections`. The durable lesson is the shape, not the date: the CI
  gate that checks every migration DECLARES a phase passed the whole time,
  because nothing consumed the declaration. Before trusting any gate here, ask
  what reads its output.
- **Tests:** `docker-compose.postgres.yml` runs `postgis/postgis:17-3.5` on
  `127.0.0.1:5434` (5432 and 5433 are already taken by oxy-api's and Mention's
  own compose files on the same machine). `bun run --cwd packages/backend test`
  treats a reachable Postgres as a **hard prerequisite** — the suite refuses to
  start without it, it does not skip silently. `db/testDatabase.ts` gives each
  jest worker its own throwaway, fully-migrated database
  (`@oxyhq/db/testing`, prefix `oxydb_test_`), migrated by calling the real
  `db/migrate.ts` entrypoint rather than a second, divergent migrator.
- **Expiry is a SWEEP, and it is the quietest way to break a table.** Postgres
  never deletes an expired row on its own — nothing in the engine watches a
  deadline column. Any table whose rows are supposed to expire needs an entry in
  `db/expiry.ts`'s `EXPIRY_SWEEP_TARGETS`, and `services/cron.ts` is what runs
  it. A table added without an entry grows forever with no error and no failing
  test. Read that module's header before adding one: `EXPIRY_COLUMNS_THAT_MUST_NOT_DELETE`
  exists because one deadline (`conversations.sharing_expires_at`) belongs to a
  share LINK and must clear four columns rather than delete the row.

## Key features

Properties (listings, search, saved, viewings); payments through Stripe (billing,
subscriptions); AI features via `@ai-sdk/openai`; geolocation via
`expo-location`; Telegram and WhatsApp messaging integrations; image processing
with Sharp into AWS S3; i18n with i18next.

## Routes

The full table — every mounted Express router, every Expo Router screen, which
endpoints are public and which need a session, and the `/search` → `/explore`
redirect — is [`docs/routes.mdx`](docs/routes.mdx). It is generated from reading
`packages/backend/routes/` and `packages/frontend/app/`, and
`scripts/check-docs.mjs` fails the build when it drifts from either. Two things
that belong here rather than there:

- **`/explore` is the discovery surface. `/search` is a redirect and nothing
  else.** `app/search/index.tsx` and `app/search/[query].tsx` are two-line
  `<Redirect>` components kept for existing links; query-string params survive
  because they live on the URL rather than the path. Never add a screen, a
  filter or a data hook under `/search` — it goes to `/explore`.
- **Public vs authenticated is decided by which ROUTER a handler is mounted on,
  not by a per-handler check.** `routes/public.ts` is mounted at `/api` first;
  `routes/index.ts` is mounted at `/api` behind `createOxyAuthMiddleware(oxy)`.
  A handler moved between the two files changes its auth requirement silently, so
  a handler on the public router must never read `req.user` for authorization.

Do not maintain a second route list anywhere. A list in two places is a list that
disagrees with itself.

## Ownership (CRITICAL)

Property, room and **lease** create and update take the session `oxyUserId` from
`@oxyhq/core/server` (`requireSessionOxyUserId`), never an owner id from the
client. Ownership is enforced in the REPOSITORY QUERY, so a non-owner gets a 404
rather than a 403: property and room filter on `properties.oxy_user_id`
(`db/properties/propertyWrites.ts`'s `ownedBy` option), lease filters on
`landlordOxyUserId` / `tenantOxyUserId`. Profile is an optional real-estate
sidecar keyed by `oxyUserId`, not an ownership authority.

- Shared guard: `packages/backend/utils/pickFields.ts`, one implementation for
  every write controller.
- Whitelists: `controllers/property/editableFields.ts` (property and room) and
  `controllers/lease/editableFields.ts` (`CREATABLE_LEASE_FIELDS`,
  `EDITABLE_LEASE_FIELDS`). **Keep them in sync with the schemas**, and never use
  a denylist.

## Leases and contracts

Leases are on **Postgres** (`leases` and six child tables — `db/leases/`, see
"Data storage" above), and empty in production at cutover, so the port carried
no backfill. `controllers/leaseController.ts` calls the `db/leases/` repository
rather than a model; `leaseSerializer.ts` is the DTO boundary — it decides the
`id` and the optional hydrated `property` / `landlord` / `tenant` the frontend
reads, and it is the only place that shape is assembled.

- **Backend routes:** `/api/leases`, with list (`?status=`, `?propertyId=`),
  CRUD, sub-resources (`/:id/payments`, `/:id/documents`) and lifecycle
  (`/:id/sign`, `/:id/terminate`, `/:id/renew`). Static sub-routes are declared
  before `/:id`.
- **Frontend screens:** `/contracts` (list), `/contracts/[id]` (detail and sign),
  `/contracts/new` (landlord draft from an application).
- **Create flow:** the landlord-only bridge
  `POST /api/applications/:id/create-lease` resolves property, tenant and rent
  server side from an **approved** application and returns a draft lease.
  `/contracts/new?application=<id>` is the only create entry point; there is no
  standalone tenant picker and no manual lease form.
- **Writes** follow the same IDOR pattern, and `landlordProfileId` is server
  resolved, never taken from `req.body`.

## Notifications (CRITICAL)

Event-driven in-app notifications have **one write chokepoint**:
`services/notificationDispatchService.ts`, backed by
`db/notifications/notificationRepository.ts` on **Postgres** (see "Data
storage" above). Controllers call `createForUser` for domain events (lease
signed, viewing approved, roommate request) and never write the repository
directly. Dispatch is best effort, swallowing and logging, because the domain
action must succeed even if the mailbox write fails.

The frontend has **no realtime socket client** for notifications. Mailbox refresh
is refetch-on-focus plus React Query invalidation after writes
(`NotificationContext`, `services/notificationService.ts`). See
`packages/frontend/docs/NOTIFICATIONS.md`.

## No admin or moderator surfaces (CRITICAL)

Never build admin panels, moderator queues, or privileged moderation actions on
user content. The user vetoed this explicitly: the admin moderation queue (PR
#229) was reverted in PR #231. The one exception is `/api/scraper/*`'s
`requireAdmin`, which is infra tooling, not content moderation.

Community-level machinery is the only moderation: per-user `reports[]` on reviews
with automatic `moderationStatus: under_review` at 3 or more reports,
`EvictionReport`s, and owners cancelling or deleting their own content. The
`removed` moderation status is intentionally unreachable. If a future need
arises, ask the user first.

## Roommates

The roommate handshake (requests and accepted relationships) is on **Postgres**
(`roommate_requests` / `roommate_relationships`, `db/roommates/roommateRepository.ts`
— see "Data storage" above). Routes: `GET /api/roommates/relationships` and
`DELETE /api/roommates/relationships/:relationshipId`. Participant resolution
goes through `findProfileByOxyUserId` from `db/profiles/profileRepository.ts`, so
the whole handshake reads one store.

## Partner commissions (mark-transacted)

Owner-only close endpoint:
`POST /api/properties/:propertyId/mark-transacted`
(`controllers/property/transact.ts`). It sets a terminal status (`rented` or
`sold`, inferred from offerings when omitted) and runs the idempotent
`onPropertyTransacted` commission trigger. Re-marking never creates a second
commission. Frontend: `useMarkPropertyTransacted` on `/properties/my`.

## External listings and deep links

External properties (`isExternal: true`) block in-app apply and viewing. Never
route them to Homiio enquiry flows. Guard a missing `sourceUrl` with a
user-facing error.

- **Portal CTA:** always offer `Linking.openURL(sourceUrl)` as the fallback.
- **Direct contact:** when ingest captured owner or agent contact from portal
  AJAX (phone, email, WhatsApp, agency name), show in-app direct contact actions
  too, not only the portal link. Never invent contacts.

## Neighborhood widget

`NeighborhoodRatingWidget` renders **only real Homiio-derived metrics** (listing
count, average rent, vs-city contrast). No invented walkability, transit or
safety scores. When no neighborhood resolves, or the lookup errors, the widget
renders nothing.

It is gated by `EXPO_PUBLIC_NEIGHBORHOOD_WIDGET_ENABLED=true` (off by default) in
`components/widgets/WidgetManager.tsx`. Enable it only when neighborhood data
coverage is broad enough.

## Backend client (live)

The Oxy linked client is live in `packages/frontend/utils/api.ts`
(`oxyClient.createLinkedClient({ baseURL })`). It owns auth: it mirrors the Oxy
session token, delegates 401 refresh, and invalidates the session on refresh
failure. Do NOT add local token providers, auth interceptors or manual
`Authorization` headers.

- `normalizeEnvelope` in `utils/api.ts` is the INTENTIONAL bridge that re-wraps
  the linked client's auto-unwrapped payload back into the
  `{ success, data, ... }` envelope Homiio's many consumers read
  (`response.data.data`). It stays until those consumers migrate. Do not "fix" or
  remove it piecemeal.
- The only sanctioned `oxyServices.getAccessToken()` use is Sindi's streaming
  fetch (`hooks/useSindiAuthenticatedFetch.ts`), because the linked client is
  JSON-only and cannot stream. Do not add new `getAccessToken` call sites.

## Listing provider plugins (market aggregator)

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

## Cold-start check (the only thing that sees a white screen)

```bash
bun run --cwd packages/frontend build          # produces dist/
bun run --cwd packages/frontend check:cold-start / /properties
bun run --cwd packages/frontend check:cold-start:test   # mutation-tests the check
```

`packages/frontend/scripts/check-cold-start.mjs` loads the exported web app in a
REAL headed browser with a fresh profile and asserts it actually **rendered**.

**Run it after touching anything in the boot path**: `app/_layout.tsx`, the
providers under `context/`, the readiness and splash gate, and after any change
the React Compiler lint rules prompt in those files.

Why it exists: nothing else here can see a white-screen boot. `tsc` passes,
`jest` passes, `expo export` succeeds, and the app still mounts nothing. A
boot-mounted component calling a suspenseful hook deadlocks the render, so the
init effect never runs and the promise never resolves: a blank page with ZERO
console output. Provider ordering fails the same silent way.

Four properties worth keeping if you edit it:

- It asserts `document.visibilityState === 'visible'` **before** any verdict and
  exits INCONCLUSIVE (3) otherwise. A backgrounded tab pauses
  `requestAnimationFrame`, which presents exactly as "blank", a false reading
  that has cost this ecosystem a debugging session.
- It asserts rendered CONTENT, not merely that nothing threw. "Nothing threw" is
  not the property.
- **It fails on any error logged during boot, because AN ERROR BOUNDARY IS
  CONTENT.** A content assertion cannot tell a booted app from a caught crash:
  React's boundary renders "Something went wrong" and logs to `console.error`,
  throwing no uncaught exception. Measured 2026-08-10 on `/explore` — an
  infinite render loop produced 33 elements, a visible error, and **exit 0**.
  The two channels differ and only one used to be gated: `pageErrors`
  (`Runtime.exceptionThrown`) is uncaught and usually means nothing mounted;
  `consoleErrors` (`Runtime.consoleAPICalled`, `type: 'error'`) is what a
  boundary produces. The allow-list of benign messages is deliberately EMPTY,
  and that is a measurement — eight routes on `main` produced zero console
  errors, so strictness costs nothing. Prefer fixing the source over adding an
  entry; a gate that reds on noise gets switched off, and an off gate is worse
  than the hole.
- It carries a mutation test **per failing condition** — a broken entry bundle
  (nothing mounts) and an injected console error (a caught crash that still
  renders) — so it can tell "ran and found nothing" from "did not run". Add a
  condition, add a mutation only it catches, and confirm the others still pass.

**Standing rule when reading its output, or any check's here: print the full
output and the exit code.** Do not ask a grep whether it matched, because an
empty match reads identically to a pass. That mistake was made three separate
times while building this.

## Known react-hooks findings (frontend)

`eslint-plugin-react-hooks` v7 runs the React Compiler's rules statically.
**This app does not enable the compiler** (there is no `experiments.reactCompiler`
in `app.config.js`), so separate the two kinds before "fixing" anything:
`set-state-in-effect` and `rules-of-hooks` are genuine either way, while
`immutability`, `refs` and `preserve-manual-memoization` reason about a
transformation that does not run here.

`react-hooks/immutability` is switched off for
`components/SindiExplanationBottomSheet.tsx` in `eslint.config.js`, with the
premise and a revisit condition written there and beside `experiments` in
`app.config.js`. Do not widen it.

**Open, deliberately deferred: `context/NotificationContext.tsx`, 2 findings.**
`loadNotifications` opens with a synchronous
`setState({ isLoading: true, error: null })` before its first `await`, called
from an effect, which is a real cascading render on mount. Unlike `ProfileContext`
(fixed by deleting dead API) this state is LIVE, since
`app/(tabs)/inbox/index.tsx` consumes `isLoading` and `error`, so the fix is to
move the notifications list to React Query, which is already the design this
file's own notifications section describes (refetch-on-focus plus invalidation);
the hand-rolled `useState` is the drift. `notifications`, `unreadCount`,
`isLoading` and `error` become query state, while `preferences`,
`hasPermission`, `badgeCount` and `scheduledNotifications` are device state and
stay.

**It was not done because it cannot be verified without an authenticated
session.** Unauthenticated, `loadNotifications` returns at its guard and the path
never executes, so the cold-start check above cannot reach it. Get a session
first; do not ship it on reasoning alone. The same applies to
`SindiExplanationBottomSheet:136`.

## Layout shell and design tokens (CRITICAL)

### ContentPanel (Bloom, Mention-shaped)

The center column uses Bloom `ContentPanel` (`framed` plus `maskColor`), **not** a
flat `mainContentWrapper` or a custom bleed mask. Reference: Mention
`app/(app)/_layout.tsx`.

- `framed={Platform.OS === 'web' && isScreenNotMobile}` (500 px wide or more).
- `maskColor={theme.colors.background}`, unscoped, matching the page background.
- Native phone: `framed={false}`, full bleed.
- Explore is fixed-viewport: no page scroll, but it still wraps the center in
  ContentPanel when framed.
- **Never hand-roll a bleed mask.** ContentPanel owns it.

### Scroll ownership (one owner per surface)

Web default is **document scroll**. Do NOT wrap SideBar plus Slot in a
layout-level `Animated.ScrollView`. The layout is a static flex row; only the
screen (or the document on web) scrolls.

| Surface | Owner |
|---|---|
| Web (default) | Document |
| Native tabs | Screen `Animated.ScrollView` (local SharedValue) |
| Explore | Fixed shell (no page scroll) |

Remove `LayoutScrollProvider` and the layout scroll handler when not needed. No
dual writers of `scrollY`. Sticky header `top` is Bloom `PANEL_TOP_INSET` when
framed.

### Section stacking (NativeWind gap)

Use NativeWind `gap-6 md:gap-8` on the section container, **not** per-section
`marginTop: sectionGap` or `resolveSectionSpacing()`. Bottom padding is `pb-14`
(home) or `pb-20` (agent).

- Drop the `HomeCarouselSection` outer `marginBottom`.
- Wide CTA rows use `flex-row items-stretch gap-6 md:gap-8`.

### Design-token CSS (no hand-copied radius)

`@import "@oxyhq/bloom/design-tokens/theme.css"` in
`packages/frontend/styles/global.css`, after the Tailwind import. That provides
`rounded-radius-28`, `p-space-8` and the rest without pasting anything locally.

- **Never declare `--radius-radius-*` or other Bloom scales in `global.css`.** The
  Bloom import is the sole authority.
- Keep only Homiio-local color seeds and `:root` overrides in `global.css`.

## NativeWind: `Pressable` function-form `style`

The NativeWind css-interop (v4 `react-native-css-interop`, and the v5 preview /
`react-native-css` this app now runs) does NOT support React Native's
function-form `style={({ pressed }) => [...]}`. The function is swallowed and the
`Pressable` renders with no style at all.

**Fix:** a static style array plus `onPressIn` / `onPressOut` plus `useState`:

```tsx
const [pressed, setPressed] = useState(false);
<Pressable
  onPressIn={() => setPressed(true)}
  onPressOut={() => setPressed(false)}
  style={[styles.x, pressed && styles.xPressed]}
>
```

- For web hover, use `onHoverIn` / `onHoverOut` plus state instead of
  `({ hovered })`.
- Hooks cannot run inside `.map()`, so extract a small component when a
  function-form `Pressable` lives in a list.
- Canonical template:
  `packages/frontend/components/search/SearchSummaryBar.tsx`.
- **Audit: `packages/frontend/__tests__/noFunctionFormStyle.test.ts`**, which runs
  in the ordinary suite. It replaced `grep -rn "style={({" app components`,
  and the reason is worth keeping: a grep is LINE-based, so it cannot tell code
  from prose, and it started reporting a violation the moment a component's own
  doc comment quoted the forbidden form in order to warn about it. A gate that
  cries wolf gets switched off by whoever hits it next. The test strips comments
  first — through `@homiio/shared-types/testing/stripComments`, the one stripper
  this repo has — and carries a positive control, a negative control (that very
  comment), and a floor on files scanned.

## `pointerEvents: 'box-none'` / `'box-only'` in a STYLE is BROKEN on web

`box-none` and `box-only` are React Native-ONLY values and are NOT valid CSS
`pointer-events`. Put them in a `style` object
(`style={{ pointerEvents: 'box-none' }}`) and RN-Web **silently drops** them,
leaving the element at `pointer-events: auto`, so a transparent, full-size
overlay (a save layer, a scrim wrapper, a padded popover) **swallows every tap
and hover beneath it** with no error. This hid the property-card carousel arrows
and would freeze the whole mobile-web screen behind the closed sidebar drawer
(PR #202 and the box-none sweep).

- **Correct pattern:** split into a pass-through container with
  `pointerEvents: 'none'` (valid CSS) plus genuinely interactive children that
  re-enable themselves with `pointerEvents: 'auto'` (also valid CSS: a child
  `auto` inside a parent `none` IS hittable). That reproduces box-none semantics
  with values RN-Web actually applies.
- The RN `pointerEvents` **PROP** (`<View pointerEvents="box-none">`) is fine,
  because RN-Web maps it correctly. Only the STYLE form is broken. Prefer the
  none/auto split.
- Audit:
  `grep -rn "pointerEvents: 'box-none'\|pointerEvents: 'box-only'" app components`
  should stay ZERO in style objects.

## Masked image zoom (ZoomableImage)

Cards NEVER scale on hover or press ("cutrada"). The app-wide move is the **image
zooming inside the card's rounded mask**: the photo scales, the card stays put,
and corners stay clipped. There is **one** primitive,
`components/ui/ZoomableImage.tsx`.

- Wrap the `<Image>`, not the card:
  `<ZoomableImage borderRadius aspectRatio active style>` renders an
  `overflow:'hidden'` mask around an inner wrapper applying
  `transform:[{scale: active?1.05:1}]`. Overlays (badges, scrim, heart, price)
  stay **siblings of** `ZoomableImage` so they do not zoom.
- **The hover source is the CARD, not the image.** `active` is CONTROLLED first:
  when the caller passes `active` it drives the zoom (external wins) and
  `ZoomableImage` attaches NO hover listeners of its own. Each card owns ONE
  `onPointerEnter` / `onPointerLeave` on web (`onHoverIn` / `onHoverOut` on a
  `Pressable`, or `onPointerEnter` / `onPointerLeave` gated to
  `Platform.OS==='web'` on a plain `View` or `TouchableOpacity`) on its whole
  container, feeding a `hovered` state, and passes `active={hovered || pressed}`
  down, so the photo zooms on hover ANYWHERE on the card, photo or text.
  `onPointerEnter` / `onPointerLeave` fire on the container boundary and do not
  re-fire moving between children on RN-Web, so one handler covers the whole
  card. `pressed` (touch) drives the native zoom. When `active` is omitted,
  `ZoomableImage` falls back to owning its own web hover over the image, for
  standalone use. It is its own component, so there are no hooks in `.map`, and
  it uses static style arrays only.
- The card-level hover must ONLY feed the image `active`. NEVER re-add a
  `transform:[{scale}]`, lift or shadow on the card itself; that is the
  "cutrada" removed in #164.
- For the in-card carousel, thread `imageActive` through
  `PropertyImageCarousel` to each page's `ZoomableImage`, OR-ed with the page's
  own touch press.
- The web transition and the Safari corner-clip fix are baked in (web-cast
  `transitionProperty` and `willChange`, the sanctioned
  `as unknown as ViewStyle` web-CSS pattern). NEVER add a per-component variant;
  reuse this one.
- Wired in: `PropertyImageCarousel` and `PropertyCard` (both paths),
  `CityShowcaseSection`, `Host/AgentCtaBanner`, tips `TipCard`, `RoomList`. Card,
  banner and tile surfaces are otherwise **flat**, with no
  `transform:[{scale}]` card interaction anywhere (audit:
  `grep -rnE "transform.*scale" components app` shows only `ZoomableImage`'s
  image zoom plus genuinely animated worklets).

## Icon button (IconButton)

`components/ui/IconButton.tsx` is the ONE app-wide icon-button primitive: a
circular button with pressed and hover state (static style arrays, no
function-form `style`) and three chrome **variants**. Never hand-roll
`<Pressable style={[barIconButton, pressed && barIconButtonPressed]}><Ionicons/></Pressable>`
again.

- Variants: `ghost` (flat transparent, `mutedSubtle` pressed tint, for headers
  and bars, reusing the shared `barIconButton` / `barIconSize` /
  `barBackIconSize` tokens), `overlay` (frosted white circle for on-photo use,
  such as the card save heart), and `filled` (brand fill plus
  `primaryForeground` glyph). Props: `icon`, `onPress`, `accessibilityLabel`,
  plus optional `variant`, `size`, `color`, `active` and `activeColor`,
  `onLongPress`, `disabled`, `loading`, `badge` and `style`.
- **`SaveButton` is a stateful COMPOSITION of `IconButton`.** It owns save logic
  (mutation, optimistic toggle, count, long-press folder sheet) and passes
  `chrome` to `IconButton`'s `variant` (`ghost` in headers and bars, `overlay` on
  cards). There is no separate cream or shadow save chrome. Every SaveButton site
  inherits the shared button.
- Wired in: `Header` back, `StickyPropertyHeader` back and share, property `[id]`
  floating host/share/viewings (checkmark via `badge`), and `SaveButton`
  everywhere. Future icon-button sites reuse `IconButton`.

## Infinite scroll and pagination primitive

Homiio has **one** reusable infinite-scroll primitive. Never hand-roll
`ScrollView.onScroll` distance math again. It respects the "one scroll owner per
surface" rule above (web sentinel, native handler) rather than copying Mention's
`FlatList.onEndReached`.

- **Web** (document scroll or a nested `overflow:auto`): render
  `components/common/LoadMoreSentinel.tsx` at the list's end, a 1px `View` plus
  `IntersectionObserver` (600px `rootMargin`), inert on native.
- **Native** (the surface's own scroll owner): `hooks/useInfiniteScroll.ts`
  returns an `{ onScroll }` end-detect handler (0.7 threshold, re-arms on scroll
  up) to spread onto the screen's `ScrollView`. The home page instead gets end
  detection from `components/PageScrollView.tsx`'s Reanimated worklet
  (`runOnJS`) firing `onEndReached` and `onEndReachedThreshold`, sharing the same
  `END_REACHED_THRESHOLD` constant.
- A screen wires **both** (sentinel plus native handler), and each platform only
  fires its own. The guarded loader
  (`if (hasNextPage && !isFetchingNextPage) fetchNextPage()`) stays in the
  consumer, not the primitive.
- Canonical data hooks, to reuse rather than writing a new pagination engine:
  `hooks/usePropertySearch.ts` (search, browse, home feed) and
  `hooks/useInfiniteCityProperties.ts` (a city's listings), both
  `useInfiniteQuery`-based and page based. Render results with
  `components/ui/PropertyResultsGrid.tsx` and `PropertyResultsGridSkeleton`, a
  `.map` grid that intentionally does not own scroll, for embedding in the single
  page scroller.
- Wired in: home `app/(tabs)/index.tsx`,
  `components/search/SearchResultsView.tsx`, `app/properties/index.tsx`,
  `app/properties/type/[type].tsx`, `app/properties/city/[id].tsx`.
  `app/(tabs)/saved/index.tsx` does client-side incremental reveal, since there
  is no backend pagination endpoint for it.
- Backend list endpoints feeding an infinite grid should expose flat `hasMore`
  and `totalPages` aliases alongside the nested `pagination` object, which keeps
  `normalizeEnvelope` intact. See `/api/properties/search` and
  `cityController.getPropertiesByCity`.
