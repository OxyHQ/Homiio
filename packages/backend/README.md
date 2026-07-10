# Homiio Backend API

Express + Mongoose API for the Homiio real estate platform. See `~/Oxy/Homiio/AGENTS.md` for architecture, IDOR rules, listing ingestion, and deployment detail.

## Packages in this monorepo

| Package | Role |
|---------|------|
| `packages/backend` | HTTP API + worker entrypoint |
| `packages/shared-types` | Cross-package DTOs and enums |
| `packages/listing-providers` | External listing provider plugins + FetchRuntime |
| `packages/frontend` | Expo/RN client (separate package) |

The production Dockerfile builds `shared-types` → `listing-providers` → `backend` in that order.

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

Worker (same Docker image, different command): `packages/backend/worker.ts`.

## Layout

```
packages/backend/
├── controllers/        # Route handlers (property/, lease/, …)
├── models/             # Mongoose schemas + documentTypes
├── routes/             # Express routers mounted in routes/index.ts
├── services/           # Business logic (ingestion, notifications, commission, …)
├── middlewares/        # Auth (Oxy), validation, errorHandler, logging
├── utils/              # pickFields, helpers
├── worker.ts           # BullMQ listing-ingestion worker
├── server.ts           # API entrypoint
└── Dockerfile          # linux/arm64 → ECR oxy/homiio
```

## Auth

Uses `@oxyhq/core/server` (`createOxyAuthMiddleware`, `requireOxyAuth`, `getRequiredOxyUserId`). The linked Oxy client on the frontend owns token refresh — no app-local bearer parsers.

Profile ownership resolves via `Profile.findActiveByOxyUserId` — never trust client-supplied profile ids.

## Key API areas

| Mount | Purpose |
|-------|---------|
| `/api/properties` | Listings CRUD, search, `POST /:id/mark-transacted` |
| `/api/leases` | Lease CRUD, sign/terminate/renew, payments/documents |
| `/api/applications` | Tenant applications, `POST /:id/create-lease` bridge |
| `/api/roommates` | Matching, requests, `RoommateRelationship` |
| `/api/notifications` | Mailbox read/mark (writes from `notificationDispatchService` only) |
| `/api/viewings` | Viewing requests |
| `/health` | Public health check |

Full route list: `routes/index.ts` and `~/Oxy/Homiio/AGENTS.md`.

## Write safety (IDOR)

All create/update handlers use `utils/pickFields.ts` with explicit allowlists:

- `controllers/property/editableFields.ts` — property + room
- `controllers/lease/editableFields.ts` — lease

Never `new Model(req.body)` or spread `req.body`. Server-resolved owner ids + lifecycle fields set explicitly after picking.

## Environment

Copy `.env.example` → `.env`. Core vars: `PORT`, `MONGODB_URI`, Oxy auth config, optional `REDIS_URL` (BullMQ worker), provider feature flags (`PROVIDER_*_ENABLED`), listing fetch tiers (`LISTING_BROWSER_ENABLED`, `LISTING_MANAGED_FETCH_URL`).

Secrets for production live in GitHub repo secrets → SSM `/oxy/homiio/*` → ECS task env. See `~/Oxy/oxy-infra`.

## Deployment

- **Port**: 4000
- **Domain**: `api.homiio.com`
- **ECR**: `oxy/homiio` (linux/arm64)
- Push to `main` triggers `.github/workflows/deploy-aws.yml`
