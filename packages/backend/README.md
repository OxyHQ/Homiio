# Homiio Backend API

Express API for the Homiio housing platform, on PostgreSQL + PostGIS via Drizzle. See `../../AGENTS.md` for architecture, IDOR rules, listing ingestion, and deployment detail, and `../../docs/routes.mdx` for the full route table.

## Packages in this monorepo

| Package | Role |
|---------|------|
| `packages/backend` | HTTP API + worker entrypoint |
| `packages/shared-types` | Cross-package DTOs and enums |
| `packages/listing-providers` | External listing provider plugins + FetchRuntime |
| `packages/frontend` | Expo/RN client (separate package) |

The production Dockerfile builds `shared-types` → `listing-providers` →
`backend` in that order, then emits an `api` target and a browser-enabled
`worker` target from the same compiled output.

## Commands

```bash
# From repo root
bun run dev:backend     # API with hot reload
bun run test            # All packages
bun run build           # All packages

# This package only
cd packages/backend
bun run dev
bun run start           # Production (compiled dist)
```

Worker entry point: `packages/backend/worker.ts`. Build its image with
`docker build -f packages/backend/Dockerfile --target worker -t homiio-worker .`;
the default/final `api` target intentionally contains no Playwright, Chromium,
X11 or Bun runtime.

## Layout

```
packages/backend/
├── controllers/        # Route handlers (property/, lease/, …)
├── db/
│   ├── schema/         # Drizzle table definitions, one file per domain
│   ├── <domain>/       # Repositories + serializers — the only place SQL is written
│   ├── expiry.ts       # Expiry sweep registry (Postgres reaps nothing by itself)
│   └── migrate.ts      # The migrator; never `drizzle-kit migrate`
├── drizzle/            # Generated migrations, each declaring a deploy phase
├── routes/             # Express routers — index.ts is authenticated, public.ts is not
├── services/           # Business logic (ingestion, notifications, commission, …)
├── observability/      # Privacy-safe product event sink
├── middlewares/        # Auth (Oxy), validation, errorHandler, wireIds, logging
├── utils/              # pickFields, helpers
├── worker.ts           # BullMQ listing-ingestion worker
├── server.ts           # API entrypoint
└── Dockerfile          # linux/arm64 → ECR oxy/homiio
```

## Database

PostgreSQL with PostGIS, through Drizzle. `DATABASE_URL` is the only database
secret; the process exits non-zero without it.

```bash
docker compose -f ../../docker-compose.postgres.yml up -d   # PostGIS on 127.0.0.1:5434
bun run db:migrate                                          # apply every migration
bun run db:generate                                         # after editing db/schema/
```

The test suite treats a reachable Postgres as a **hard prerequisite** — it
refuses to start rather than skipping, so a green run always means the database
was really there. Each jest worker gets its own throwaway, fully migrated
database, created by calling the real `db/migrate.ts` rather than a second
migrator that could drift from it.

## Auth

Uses `@oxyhq/core/server` (`createOxyAuthMiddleware`, `requireOxyAuth`, `getRequiredOxyUserId`). The linked Oxy client on the frontend owns token refresh — no app-local bearer parsers.

Profile ownership resolves via `findProfileByOxyUserId` (`db/profiles/profileRepository.ts`) — never trust a client-supplied profile id.

## Key API areas

| Mount | Purpose |
|-------|---------|
| `/api/properties` | Listings CRUD, search, `POST /:id/mark-transacted` |
| `/api/leases` | Lease CRUD, sign/terminate/renew, payments/documents |
| `/api/applications` | Tenant applications, `POST /:id/create-lease` bridge |
| `/api/roommates` | Matching, requests, accepted relationships (`roommate_relationships`) |
| `/api/notifications` | Mailbox read/mark (writes from `notificationDispatchService` only) |
| `/api/viewings` | Viewing requests |
| `/health` | Public health check |

Full route list, with the public/authenticated split: `../../docs/routes.mdx`.

## Write safety (IDOR)

All create/update handlers use `utils/pickFields.ts` with explicit allowlists:

- `controllers/property/editableFields.ts` — property + room
- `controllers/lease/editableFields.ts` — lease

Never spread `req.body` into a write. Owner ids come from the session and lifecycle fields are set explicitly after picking, and ownership is enforced in the repository query so a non-owner gets a 404 rather than a 403.

## Environment

Copy `.env.example` → `.env`. Core vars: `PORT`, `DATABASE_URL`, Oxy auth config, optional `REDIS_URL` (BullMQ worker), provider feature flags (`PROVIDER_*_ENABLED`), listing fetch tiers (`LISTING_BROWSER_ENABLED`, `LISTING_MANAGED_FETCH_URL`).

Secrets for production live in GitHub repo secrets → SSM `/oxy/homiio/*` → ECS task env. Point-inference features use Homiio's Oxy service credential; interactive Sindi chat forwards the already-validated user's Oxy session to Alia. AI provider credentials never enter this repository or task and live only in Kaana's encrypted database. See `~/Oxy/oxy-infra`.

## Deployment

- **Port**: 4000
- **Domain**: `api.homiio.com`
- **ECR**: `oxy/homiio` (linux/arm64)
- Push to `main` triggers `.github/workflows/deploy-aws.yml`
