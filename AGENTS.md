# Homiio

Housing platform: find a place, research its history, understand what it really
costs, and manage or defend the tenancy. Expo/RN frontend plus an Express
backend. Agent: `homiio`.

> **For anything about how this project WORKS, read `docs/index.mdx`** —
> `docs/adr/` holds the binding contracts, `docs/routes.mdx` the generated route
> table, and `packages/backend/db/schema/CONVENTIONS.md` binds every schema
> decision.
>
> **This file carries only RULES — things that break silently if you get them
> wrong.** Design notes, subsystem walkthroughs and per-issue write-ups go in
> `docs/`, never here. Org-wide standards are in `~/AGENTS.md` and
> `~/Oxy/AGENTS.md`; do not repeat them. Versions live in `package.json`.
>
> **Budget: under 12 KB**, enforced by `scripts/check-agents-md-size.mjs`. An
> addition that pushes it over is paid for in the SAME edit.

## The four ADRs (READ BEFORE DESIGNING ANYTHING)

`docs/adr/` holds the contracts every housing, location, privacy and pricing
change is bound by. They are the authority. **Do not duplicate an ADR's rules
into this file, a doc page or a code comment** — a rule copied twice diverges,
and the copy is what people read. Index: `docs/adr/README.md`.

They bind DESIGN, so a new feature must not contradict them, but they describe
TARGET contracts — re-read each `Status` line rather than documenting their rules
as shipped behaviour. The four invariants, stated only so nobody reads 5,000
lines to find out a change is disallowed:

1. **A dwelling is permanent; a listing is temporary.** Identity is a row in
   `addresses` at a declared level; a `properties` row is a sourced advertisement
   POINTING at a place. Never treat a `properties.id` as a home's identity. (0001)
2. **Location is never implicit.** Every "where?" surface states the area it
   queries, and a geocoding failure never degrades into a worldwide feed. (0002)
3. **Privacy by precision.** Stored at one precision, published at another; the
   reduction happens on the way OUT. Never widen without ADR 0003.
4. **Pricing must be explainable** — local, versioned, carrying its reasoning and
   confidence. No universal score. (0004)

## Commands

npm releases: only Actions → Release packages (`release-packages.yml`, Oxy's shared
workflow, OIDC); a package's gates are its `prepublishOnly`. Never publish from a laptop —
`~/Oxy/docs/npm-releases.md`.

```bash
bun run dev                 # all packages
bun run dev:frontend        # Expo tunnel
bun run dev:backend
bun run build               # shared-types → listing-providers → backend
bun run test
bun run lint
bun run check:lockfile      # two-layer lockfile sync check
bun run --cwd packages/backend test   # needs Postgres up; see below
bun run db:migrate          # db/migrate.ts --phase=all, for a dev database
```

Packages: `frontend` (Expo/RN/NativeWind) · `backend` (Express/PostgreSQL via
drizzle/Stripe/Sharp) · `shared-types` · `listing-providers` (plugin contract,
`FetchRuntime`, provider plugins). The production Dockerfile builds in that
dependency order and has separate `api` and `worker` targets from the same
compiled build: only `worker` carries Playwright/Chromium/X11.

## Data storage: PostgreSQL, and nothing else

Database `homiio` on the shared RDS instance `oxy-postgres`, with **PostGIS**
installed once by a privileged role (not a trusted extension — the owning app
role cannot install it). `DATABASE_URL` is the only database secret either
process needs; `initializeDatabase()` exits non-zero without it. Full state and
measurements: **`docs/postgres.md`**.

- **Controllers call a repository under `packages/backend/db/<domain>/`, never an
  ORM model.**
- **Migrations: `bun run db:migrate`, never `drizzle-kit migrate`.** Production
  applies them as one-shot ECS tasks on both sides of the rollout — `--phase=pre`
  in the API lane before `update-service`, `--phase=post` in the WORKER lane
  after its rollout, because the worker rolls last and `post` is only safe once
  no old image is serving.
- **Before trusting any gate here, ask what reads its output.** `RUN_MIGRATIONS`
  defaulted to `false` and nothing set it, so no deploy had ever applied a
  migration while the CI gate checking that every migration DECLARES a phase
  passed the whole time — nothing consumed the declaration. Production ran four
  behind and answered 500.
- **Tests need a reachable Postgres and refuse to start without one** — they do
  not skip silently. `docker-compose.postgres.yml` runs `postgis/postgis:17-3.5`
  on `127.0.0.1:5434` (5432 and 5433 are taken by oxy-api's and Mention's compose
  files on the same machine).
- **Expiry is a SWEEP, and it is the quietest way to break a table.** Postgres
  deletes nothing on a deadline. Any table whose rows expire needs an entry in
  `db/expiry.ts`'s `EXPIRY_SWEEP_TARGETS`, run by `services/cron.ts`; without one
  it grows forever with no error and no failing test. Read that module's header
  first — `EXPIRY_COLUMNS_THAT_MUST_NOT_DELETE` exists because a deadline can be
  a STAMP (`eviction_cases.archived_at`) whose row must survive it.

## Ownership and auth (CRITICAL)

- **Property, room and lease writes take the session `oxyUserId` from
  `@oxy.so/core/server` (`requireSessionOxyUserId`), never an owner id from the
  client.** Ownership is enforced in the REPOSITORY QUERY, so a non-owner gets a
  404 rather than a 403. Profile is an optional real-estate sidecar keyed by
  `oxyUserId`, not an ownership authority.
- **Capability tools act as the effective account and nothing else**: the
  verified ticket's `effectiveAccountId` on `/_oxy/mcp`, the OAuth connection's
  active account on `/mcp` (`capabilities/homiio.handlers.ts`) — never an id
  from tool input, never `requireSessionOxyUserId`. Handlers call `domain/*`,
  the use case the route calls, never a controller or HTTP. A new authenticated
  route needs a tool or a written exclusion in `capabilities/routeCoverage/*`
  (`routeParity.test.ts`), and a changed tool bumps the catalogue `version`.
- **Field whitelists, never denylists** — `utils/pickFields.ts` is the one guard;
  `controllers/property/editableFields.ts` and
  `controllers/lease/editableFields.ts` must stay in sync with the schemas.
  `landlordProfileId` is server-resolved, never from `req.body`.
- **Public vs authenticated is decided by which ROUTER a handler is mounted on**,
  not by a per-handler check: `routes/public.ts` is mounted at `/api` first,
  `routes/index.ts` behind `createOxyAuthMiddleware(oxy)`. Moving a handler
  between the two files changes its auth requirement silently, so a handler on
  the public router must never read `req.user` for authorization.
- **The Oxy linked client owns auth** (`createLinkedClient({ baseURL })` on the
  provider's `OxyServices`, bound by `bindApiToOxy` in `packages/frontend/utils/api.ts`). Do NOT add local token providers, auth
  interceptors or manual `Authorization` headers. Read complete domain envelopes
  through the SDK's `requestResponse`; do not reconstruct them heuristically.
  Sindi and Alia are reached from the frontend through `@alia.onl/sdk` under the
  person's Oxy session; Homiio's backend never calls Alia. Do not add a manual
  token path. Detail: `docs/sindi.md`.

## Product rules that are vetoed or load-bearing

- **Never build admin panels, moderator queues or privileged moderation actions
  on user content.** The user vetoed this explicitly (PR #229 reverted by #231).
  Moderation is community-level only — per-user `reports[]` with automatic
  `under_review` at 3+, `EvictionReport`s, and owners removing their own content;
  the `removed` status is intentionally unreachable. `/api/scraper/*`'s
  `requireAdmin` is infra tooling and is the one exception. If a need arises,
  ask the user first.
- **`/explore` is the discovery surface; `/search` is a redirect and nothing
  else.** Never add a screen, filter or data hook under `/search`.
- **Do not maintain a second route list anywhere.** `docs/routes.mdx` is
  generated and `scripts/check-docs.mjs` fails the build when it drifts.
- **External properties (`isExternal: true`) block in-app apply and viewing** —
  never route them to Homiio enquiry flows, always offer
  `Linking.openURL(sourceUrl)`, guard a missing `sourceUrl` with a user-facing
  error, and never invent a contact.
- **`NeighborhoodRatingWidget` renders only real Homiio-derived metrics** — no
  invented walkability, transit or safety scores; nothing at all when no
  neighborhood resolves. Gated off by default.
- **Notifications have ONE write chokepoint**,
  `services/notificationDispatchService.ts`. Controllers call `createForUser` and
  never the repository. Dispatch is best-effort and swallows, because the domain
  action must succeed even if the mailbox write fails. There is no realtime
  socket client.
- **`/contracts/new?application=<id>` is the only lease create entry point** —
  no standalone tenant picker, no manual lease form.
- **Re-marking a property transacted never creates a second commission**
  (`onPropertyTransacted` is idempotent).

## Deployment

**AWS ECS Fargate**. Port `4000`, `api.homiio.com`, ECR
`oxy/homiio`, `us-west-2`, `linux/arm64`. Infra lives in
`~/Oxy/oxy-infra/terraform-uswest2/`; deploy is `.github/workflows/deploy-aws.yml`
on push to `main`. Detail: `docs/deployment.mdx`.

- **Runtime secrets live ONLY in SSM `/oxy/homiio/*`** (oxy-infra runbook 46). Write
  a new one with `aws ssm put-parameter` BEFORE a task definition names it; no
  workflow writes SSM or reads a runtime repo secret (`deploySecretSync.test.ts`).
- **Both images run Bun.** Every command run on an image (CMD, migrator
  one-shots, the worker's command) names THAT image's runtime. The worker's ECS
  command comes from deploy-aws.yml's `TASK_COMMAND_JSON`, not terraform:
  `docs/deployment.mdx`.
- **Automated PR reviews run on `listing-providers` and `backend`.** Address the
  high-confidence security and correctness findings before merge.

## Where the rest lives

`docs/listing-providers.md` (the market aggregator: fetch strategy, the plugin
contract, the warm Playwright session, queues, the ingest pipeline, feature flags
and how to add a provider) · `docs/frontend-conventions.md` (layout shell, scroll
ownership, design tokens, the NativeWind and `pointerEvents` traps, the shared
primitives) · `docs/cold-start.md` (the white-screen check and the known
react-hooks findings) · `docs/postgres.md`.
