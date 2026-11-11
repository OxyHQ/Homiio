# Homiio

Housing platform (find a place, research its history, understand its real cost, manage the tenancy): Expo/RN frontend plus an Express/PostgreSQL backend.

## Commands

```bash
bun install                           # postinstall builds contracts and shared-types
bun run dev                           # all packages; dev:frontend (Expo tunnel) / dev:backend for one
bun run build                         # shared-types -> listing-providers -> backend
bun run test                          # backend tests need Postgres, see Testing
bun run lint                          # Biome + frontend ESLint; lint:fix and format write
bun run db:migrate                    # dev database; never drizzle-kit migrate
bun run check:lockfile                # two-layer lockfile sync
bun run check:docs                    # docs and generated route table (docs/routes.mdx)
bun run validate:agents-md            # AGENTS.md size budget (12 KB root, 8 KB nested)
bun run doctor:oxy && bun run i18n:check
```

## Map

- Start at [docs/index.mdx](docs/index.mdx); contracts are in [docs/adr/](docs/adr/README.md).
- Schema rules: `packages/backend/db/schema/CONVENTIONS.md`; migrations: `packages/backend/db/MIGRATION-CONTRACT.md`.
- Entry points: `packages/backend/routes/public.ts` and `routes/index.ts` (auth boundary), `packages/backend/capabilities/` (MCP tools), `packages/frontend/utils/api.ts`.
- Subsystems: [listing-providers](docs/listing-providers.md), [frontend-conventions](docs/frontend-conventions.md), [postgres](docs/postgres.md), [oxy-files](docs/oxy-files.md), [sindi](docs/sindi.md), [deployment](docs/deployment.mdx).

## Conventions that differ from defaults

Full rules and reasons: [docs/agent-rules.md](docs/agent-rules.md).

- The four ADRs bind every housing, location, privacy and pricing change; re-read each `Status` line, they describe target contracts. Why: a `properties.id` is an advertisement, not a home.
- Controllers call a repository under `packages/backend/db/<domain>/`, never an ORM model.
- Write routes take the owner from `requireSessionOxyUserId` (`@oxy.so/core/server`), never from the client; ownership is enforced in the repository query (404, not 403).
- Whitelist editable fields with `utils/pickFields.ts`; never denylists.
- Public vs authenticated is decided by which router mounts a handler; a public handler never reads `req.user` for authorization.
- Auth is owned by the Oxy linked client (`bindApiToOxy`); no local token providers, interceptors or manual `Authorization` headers.
- Every photo and document is an Oxy file; Homiio stores no bytes and has no bucket.
- A table whose rows expire needs an entry in `EXPIRY_SWEEP_TARGETS` (`db/expiry.ts`); otherwise it grows forever silently.
- Notifications are written only through `services/notificationDispatchService.ts` (`createForUser`).
- `/explore` is the discovery surface; `/search` is a redirect only.
- `docs/routes.mdx` is generated; never keep a second route list.
- Id-shape rule and keyset pagination: [Postgres and Drizzle](https://github.com/OxyHQ/oxy/blob/main/docs/postgres-and-drizzle.md), [API conventions](https://github.com/OxyHQ/oxy/blob/main/docs/engineering/api-conventions.md).
- UI composes Bloom first: [Bloom app conventions](https://github.com/OxyHQ/Bloom/blob/main/docs/app-conventions.mdx).

## Boundaries

Never:
- Build admin panels, moderator queues or privileged moderation actions on user content. The owner vetoed them (PR #229 reverted by #231); `/api/scraper/*` behind `homiio.scraper.operate` is the one exception.
- Add a screen, filter or data hook under `/search`.
- Route `isExternal` properties into in-app apply or viewing flows, or invent a contact.
- Run `drizzle-kit migrate`; production applies migrations as ECS tasks (`bun run db:migrate`).
- Publish to npm from a laptop ([npm releases](https://github.com/OxyHQ/oxy/blob/main/docs/npm-releases.md)).
- Print or commit secrets, or fall back to another file store when Oxy refuses an upload.

Ask first:
- Any change that widens location precision (ADR 0003) or adds a new notification path.
- A new authenticated route (needs an MCP tool or a written exclusion in `capabilities/routeCoverage/*`; a changed tool bumps the catalogue `version`).
- A new column pointing at `images` (must join migration `0037_oxy_files`, `services/files/referenceUsage.ts` and `db/images/unusedImages.ts` in the same change).

## Testing

- Backend tests need Postgres and refuse to start without it: `docker compose -f docker-compose.postgres.yml up -d postgres` (`postgis/postgis:17-3.5` on `127.0.0.1:5434`), then `bun run --cwd packages/backend test`.
- Run `bun run lint`, `bun run test` and `bun run check:docs` before pushing; docs-only changes need `check:docs` and `validate:agents-md`.
- Done means CI is green. Before trusting a gate, check what reads its output (see [agent-rules](docs/agent-rules.md)); gate-writing: [oxy docs](https://github.com/OxyHQ/oxy/blob/main/docs/engineering/gate-writing.md).

## PRs and commits

- Branch from `main`, open a PR, never push to `main`; merging a version bump publishes it via `release-packages.yml`.
- Automated reviews run on `listing-providers` and `backend`; address high-confidence security and correctness findings before merge.
- Lint and format with Biome ([lint-and-format](https://github.com/OxyHQ/oxy/blob/main/docs/engineering/lint-and-format.md)).

## Secrets

- Runtime secrets live only in SSM `/oxy/homiio/*`; write one with `aws ssm put-parameter` before a task definition names it. No workflow writes SSM or reads a runtime repo secret.
- `DATABASE_URL` is the only database secret; never print it.
- Deploy: AWS ECS Fargate via `.github/workflows/deploy-aws.yml` on push to `main`; infra is in [oxy-infra](https://github.com/OxyHQ/oxy-infra/blob/main/docs/infra-and-deploys.md) (private).

Owner: OxyHQ. Last reviewed: 2026-11-11.
