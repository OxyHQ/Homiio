# Data storage: PostgreSQL, and nothing else

> Moved out of `AGENTS.md` unchanged. Porting rules are
> `packages/backend/db/MIGRATION-CONTRACT.md`; schema decisions are
> `packages/backend/db/schema/CONVENTIONS.md`.


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
  (`@oxy.so/db/testing`, prefix `oxydb_test_`), migrated by calling the real
  `db/migrate.ts` entrypoint rather than a second, divergent migrator.
- **Expiry is a SWEEP, and it is the quietest way to break a table.** Postgres
  never deletes an expired row on its own — nothing in the engine watches a
  deadline column. Any table whose rows are supposed to expire needs an entry in
  `db/expiry.ts`'s `EXPIRY_SWEEP_TARGETS`, and `services/cron.ts` is what runs
  it. A table added without an entry grows forever with no error and no failing
  test. Read that module's header before adding one: `EXPIRY_COLUMNS_THAT_MUST_NOT_DELETE`
  exists because one deadline (`conversations.sharing_expires_at`) belongs to a
  share LINK and must clear four columns rather than delete the row.

- **A place's identity inside its region is its SLUG, not its name** (migration
  0029, 2026-09-20). `cities_region_name_key` was unique on `(region_id, name)`,
  and `name` is raw text, so the comparison is case-sensitive: two ingests that
  disagreed about capitalisation each got a row. A census of production that day
  — 1,660 cities, read through `/api/cities` — found **51 groups (102 rows)**
  differing only in case (`AARTSELAAR` beside `Aartselaar`) and **94 slugs used
  by more than one city**, including three rows named Barcelona in Spain, two of
  them holding no listings.

  That was not untidiness, it was the reported bug. `placeLookup` resolves an
  inbound token to a slug and answers an ordered candidate LIST; three
  candidates for `barcelona` is ambiguity, and ambiguity is refused, because
  from the outside a duplicate and a homonym look identical (ADR 0002 §12.2). So
  "show me flats in Barcelona" resolved no location and Sindi did nothing.

  `cities.slug` is `GENERATED ALWAYS` from the name and cannot be written by
  hand, so two rows in ONE region whose names normalise to the same slug are the
  same place. The index is now `cities_region_slug_key` on `(region_id, slug)`,
  and `addressService.upsertCity` — which produced every one of those duplicates
  — matches and conflicts on it. Duplicate slugs remain legal ACROSS regions,
  which is the condition ADR 0002 exists to answer and is untouched.

  **Two tables still have the old shape, deliberately.**
  `regions_country_name_key` is `(country_id, name)`, but its duplicates are
  `Madrid` beside `Comunidad de Madrid` — different names, which no slug would
  merge, so the fix there is an alias table and not a rename.
  `neighborhoods_city_name_key` is `(city_id, name)` and has no slug column to
  be unique on; migration 0029 folds case-colliding neighbourhoods when it
  merges their cities, but nothing stops a new pair.

  What 0029 does NOT do: `addresses.normalized_key` hashes `city_id` and is a
  plain column nothing recomputes (re-keying would break the dedup
  `findOrCreateCanonical` depends on — see the column's header). A moved address
  keeps a key computed under the city it came from. That is the state those rows
  were already in.
- **A city that failed to geocode a province is not a second city** (migration
  0030, 2026-09-20). `upsertGeoChain` falls back to a region literally named
  `Unknown` when a geocode returns no administrative region, because the three
  parent references on `addresses` are NOT NULL and dropping a listing is worse
  than bucketing one. ADR 0001 §1.3 recorded the cost; this pays it. Census of
  production that day: **10** cities sat in the placeholder region and **all 10**
  had a twin with the same country and slug under a real region — Berlin,
  Bremen, Dortmund, Düsseldorf, Frankfurt am Main, Hamburg, Köln, Leipzig,
  München, Stuttgart, i.e. every large German city in the table.

  So `/api/cities/lookup?city=hamburg` answered `ambiguous`, `sindiActions`
  resolved no location, and "muéstrame pisos en Hamburg" produced no action at
  all. **0029 could not fix this and said so**: it folds duplicates WITHIN one
  region, and these two rows are in different regions by construction.

  The rule folds a placeholder row into its twin only when the twin is UNIQUE —
  exactly one city with that country and slug in a non-placeholder region. Two
  or more means we genuinely do not know which, which is ADR 0001 §1.3's
  measured `Santiago` case, and folding those would be the homonym bug wearing a
  repair's clothes. `addressService.cityInKnownRegion` applies the same rule at
  write time so the next one is never created.

  `addresses.region_id` moves with `city_id` here, which 0029 never had to do —
  it merged inside one region, so the two parents could not disagree.
