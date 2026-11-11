# Agent rules

The full rules and reasons behind the short list in [AGENTS.md](../AGENTS.md). These are things that break silently if you get them wrong. Design notes and walkthroughs belong in the other docs, linked from [index.mdx](./index.mdx).

## The four ADRs

`docs/adr/` holds the contracts every housing, location, privacy and pricing change is bound by (index: [adr/README.md](./adr/README.md)). Do not duplicate an ADR's rules into AGENTS.md, a doc page or a code comment: a rule copied twice diverges, and the copy is what people read. They bind design, so a new feature must not contradict them, but they describe target contracts: re-read each `Status` line rather than documenting their rules as shipped behaviour.

1. **A dwelling is permanent; a listing is temporary.** Identity is a row in `addresses` at a declared level; a `properties` row is a sourced advertisement pointing at a place. Never treat a `properties.id` as a home's identity (0001).
2. **Location is never implicit.** Every "where?" surface states the area it queries, and a geocoding failure never degrades into a worldwide feed (0002).
3. **Privacy by precision.** Stored at one precision, published at another; the reduction happens on the way out. Never widen without ADR 0003.
4. **Pricing must be explainable**: local, versioned, carrying its reasoning and confidence. No universal score (0004).

## Data storage: PostgreSQL, and nothing else

Database `homiio` on the shared RDS instance `oxy-postgres`, with PostGIS installed once by a privileged role (not a trusted extension, so the owning app role cannot install it). `DATABASE_URL` is the only database secret either process needs; `initializeDatabase()` exits non-zero without it. Full state and measurements: [postgres.md](./postgres.md).

- Controllers call a repository under `packages/backend/db/<domain>/`, never an ORM model.
- Migrations: `bun run db:migrate`, never `drizzle-kit migrate`. Production applies them as one-shot ECS tasks on both sides of the rollout: `--phase=pre` in the API lane before `update-service`, `--phase=post` in the worker lane after its rollout, because the worker rolls last and `post` is only safe once no old image is serving.
- Before trusting any gate, ask what reads its output. `RUN_MIGRATIONS` defaulted to `false` and nothing set it, so no deploy had ever applied a migration while the CI gate checking that every migration declares a phase passed the whole time: nothing consumed the declaration. Production ran four behind and answered 500.
- Tests need a reachable Postgres and refuse to start without one; they do not skip silently. `docker-compose.postgres.yml` runs `postgis/postgis:17-3.5` on `127.0.0.1:5434` (5432 and 5433 are taken by oxy-api's and Mention's compose files on the same machine).
- Expiry is a sweep, and it is the quietest way to break a table. Postgres deletes nothing on a deadline. Any table whose rows expire needs an entry in `db/expiry.ts`'s `EXPIRY_SWEEP_TARGETS`, run by `services/cron.ts`; without one it grows forever with no error and no failing test. Read that module's header first: `EXPIRY_COLUMNS_THAT_MUST_NOT_DELETE` exists because a deadline can be a stamp (`eviction_cases.archived_at`) whose row must survive it.
- Every photo and document is an Oxy file (ADR 0043); Homiio stores no bytes and has no bucket (retired 2026-10-21), see [oxy-files.md](./oxy-files.md). A person's upload is their file (`uploadUserMedia`); scraped photos and covers are the Homiio application's (`importAppFile[s]`). A new column pointing at `images` must join the trigger set of migration `0037_oxy_files`, `services/files/referenceUsage.ts` and `db/images/unusedImages.ts` in the same change, or Oxy collects a photo still shown, or the sweep deletes one. Private documents (private files in the uploader's account, `oxy:<fileId>` on the row; migration `0038_oxy_private_documents`) go through `services/files/privateDocuments.ts` only, and a client may never name one. An Oxy refusal fails the upload: never a fallback to another store.

## Ownership and auth

- Property, room and lease writes take the session `oxyUserId` from `@oxy.so/core/server` (`requireSessionOxyUserId`), never an owner id from the client. Ownership is enforced in the repository query, so a non-owner gets a 404 rather than a 403. Profile is an optional real-estate sidecar keyed by `oxyUserId`, not an ownership authority.
- Capability tools act as the effective account and nothing else: the verified ticket's `effectiveAccountId` on `/_oxy/mcp`, the OAuth connection's active account on `/mcp` (`capabilities/homiio.handlers.ts`), never an id from tool input, never `requireSessionOxyUserId`. Handlers call `domain/*`, the use case the route calls, never a controller or HTTP. A new authenticated route needs a tool or a written exclusion in `capabilities/routeCoverage/*` (`routeParity.test.ts`), and a changed tool bumps the catalogue `version`.
- Field whitelists, never denylists: `utils/pickFields.ts` is the one guard; `controllers/property/editableFields.ts` and `controllers/lease/editableFields.ts` must stay in sync with the schemas. `landlordProfileId` is server-resolved, never from `req.body`.
- Public vs authenticated is decided by which router a handler is mounted on, not by a per-handler check: `routes/public.ts` is mounted at `/api` first, `routes/index.ts` behind `createOxyAuthMiddleware(oxy)`. Moving a handler between the two files changes its auth requirement silently, so a handler on the public router must never read `req.user` for authorization.
- The Oxy linked client owns auth (`createLinkedClient({ baseURL })` on the provider's `OxyServices`, bound by `bindApiToOxy` in `packages/frontend/utils/api.ts`). Do not add local token providers, auth interceptors or manual `Authorization` headers. Read complete domain envelopes through the SDK's `requestResponse`; do not reconstruct them heuristically. Sindi and Alia are reached from the frontend through `@alia.onl/sdk` under the person's Oxy session; Homiio's backend never calls Alia. Do not add a manual token path. Detail: [sindi.md](./sindi.md).

## Product rules that are vetoed or load-bearing

- Never build admin panels, moderator queues or privileged moderation actions on user content. The user vetoed this explicitly (PR #229 reverted by #231). Moderation is community-level only: per-user `reports[]` with automatic `under_review` at 3+, `EvictionReport`s, and owners removing their own content; the `removed` status is intentionally unreachable. `/api/scraper/*` is infra tooling behind the `homiio.scraper.operate` application permission (`services/applicationPermissions.ts`) and is the one exception, never an env list of user ids. The key is declared in oxy's first-party registry and held by owning-organization role (see [application roles](https://github.com/OxyHQ/oxy/blob/main/docs/auth/application-roles.md)); keep both names equal. If a need arises, ask the user first.
- `/explore` is the discovery surface; `/search` is a redirect and nothing else. Never add a screen, filter or data hook under `/search`.
- Do not maintain a second route list anywhere. `docs/routes.mdx` is generated and `scripts/check-docs.mjs` fails the build when it drifts.
- External properties (`isExternal: true`) block in-app apply and viewing: never route them to Homiio enquiry flows, always offer `Linking.openURL(sourceUrl)`, guard a missing `sourceUrl` with a user-facing error, and never invent a contact.
- `NeighborhoodRatingWidget` renders only real Homiio-derived metrics: no invented walkability, transit or safety scores; nothing at all when no neighborhood resolves. Gated off by default.
- Notifications have one write chokepoint, `services/notificationDispatchService.ts`. Controllers call `createForUser` and never the repository. Dispatch is best-effort and swallows, because the domain action must succeed even if the mailbox write fails. There is no realtime socket client.
- `/contracts/new?application=<id>` is the only lease create entry point: no standalone tenant picker, no manual lease form.
- Re-marking a property transacted never creates a second commission (`onPropertyTransacted` is idempotent).

## Deployment

AWS ECS Fargate. Port `4000`, `api.homiio.com`, ECR `oxy/homiio`, `us-west-2`, `linux/arm64`. Infra lives in the private oxy-infra repo (`terraform-uswest2/`; see [infra and deploys](https://github.com/OxyHQ/oxy-infra/blob/main/docs/infra-and-deploys.md)); deploy is `.github/workflows/deploy-aws.yml` on push to `main`. Detail: [deployment.mdx](./deployment.mdx).

- Runtime secrets live only in SSM `/oxy/homiio/*` (oxy-infra runbook 46). Write a new one with `aws ssm put-parameter` before a task definition names it; no workflow writes SSM or reads a runtime repo secret (`deploySecretSync.test.ts`).
- Both images run Bun. Every command run on an image (CMD, migrator one-shots, the worker's command) names that image's runtime. The worker's ECS command comes from deploy-aws.yml's `TASK_COMMAND_JSON`, not terraform: [deployment.mdx](./deployment.mdx).
- The production Dockerfile builds `shared-types`, `listing-providers`, then `backend`, and has separate `api` and `worker` targets from the same compiled build; only `worker` carries Playwright/Chromium/X11.
- Automated PR reviews run on `listing-providers` and `backend`. Address the high-confidence security and correctness findings before merge.
- npm releases: merging a version bump to main publishes it (`release-packages.yml`, OIDC, once CI passed on that commit). Never publish from a laptop; see [npm releases](https://github.com/OxyHQ/oxy/blob/main/docs/npm-releases.md).
