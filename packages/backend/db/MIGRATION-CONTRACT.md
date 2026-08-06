# Migration contract — Homiio

Homiio's **deltas only**. The ecosystem-wide rules — what a deploy phase means,
how the ledger works, why the migrator is drizzle-orm's and not drizzle-kit's,
what a `@oxyhq/db` column builder guarantees — live in oxy-api's own
`MIGRATION-CONTRACT.md` and in `@oxyhq/db`'s module docs. Read those first; this
file states only what is different HERE.

Schema-level conventions are in `db/schema/CONVENTIONS.md`. This file is about
the MIGRATION: what may not be lost, what may not be touched, and the specific
places Homiio's code will break in ways nothing reports.

---

## The two prime directives

1. **No relational link is lost.**
2. **No Mongo baggage travels.**

Where they conflict, **STOP and escalate**. Do not resolve it silently in a
schema file — record it as an open decision.

## Ids are preserved verbatim, and that is not a convenience

Every primary key is `text`. A row that existed before the cutover keeps its
24-char ObjectId hex EXACTLY; rows created after it get a uuid v7. There is no
remapping table and no id translation anywhere in the copy, which is precisely
how every foreign key survives by construction: if the id does not change, a
reference to it cannot break.

The one exception in the whole migration is `Review.reports[]`, whose
subdocuments are declared `_id: false` and therefore have no id to preserve. The
backfill MINTS a uuid v7 for those rows. That is not a remap — it is an id where
there was none, and nothing references a review report by construction.

## `isValidObjectId` guards are DELETED, not widened

There are **48 guard sites** — see `db/ids.ts`, which carries the measurement.
(This file said "499" until batch 3. That figure counted committed `dist/` build
output and the `models/` tree, i.e. the same code twice; `d0aaf50` corrected
`db/ids.ts` and left this copy behind, so the two contradicted each other in the
same repository. The number matters beyond pedantry: 499 makes the sweep sound
like a mechanical mass-edit, and 48 makes it sound like what it is — a small,
reviewable set where a handful genuinely branch.)

Post-cutover, `mongoose.isValidObjectId(uuidv7())` is
`false` for every row created from that day forward, so a guard left in place
does not merely reject — **several Homiio sites BRANCH on the answer**, and those
turn into silent wrong answers rather than errors:

- **`controllers/property/geospatial.ts`** filters an `excludeIds` list through
  `ObjectId.isValid` and **silently drops** the entries that fail. Post-cutover
  every uuid v7 in an exclude list is dropped, and the excluded listings
  reappear in search results. No error, no log.
- **`services/geoQueryService.ts`** branches id-versus-name on it: a value that
  fails the test is treated as a place NAME. A uuid v7 city id would be looked up
  as if the user had typed it as a search string.

Where a route genuinely needs to reject malformed input before it reaches a
query, it uses `isLiveEntityId` from `db/ids.ts` and returns **400**. Where the
guard only ever existed to avoid a `CastError`, it goes away entirely: a `text`
column takes any string, and a lookup for a nonsense id returns no rows.

Never use `isLiveEntityId` as a precondition on a query. That re-introduces the
same fail-open bug in a new costume.

## Production Mongo is never touched by a code-porting task

The copy READS. Mongo stays intact and authoritative for the entire migration and
through any rollback, which is what makes the rollback "redeploy the pinned
revisions" rather than a data restore. A task whose job is to port code has no
business writing to Mongo, and a task whose job is to copy has no business
writing to it either.

## Rollback depends on a precondition that is already met

`config.ts` no longer reads `DATABASE_URL` as a fallback for the Mongo
connection string (batch 0). This has to be true **weeks before** the cutover,
not during it: once `DATABASE_URL` names a Postgres database on the task
definition, a rollback image that still treats it as a Mongo URI fails to connect
— and it fails at the exact moment a rollback is in progress, which is the worst
possible time to discover a configuration bug.

Three legacy scripts (`scripts/check-subscription-db.js`,
`migrate-billing-field.js`, `test-subscription-save.js`) carried the same
fallback and were corrected in the same change. `.env.example` documents both
variables separately.

## What must be true of a target database before it can be migrated

Checked, not assumed. Each of these fails in a way that is either loud in the
wrong place or silent in the right one:

- **`CREATE DATABASE homiio OWNER homiio`.** From PG15 the `public` schema
  belongs to `pg_database_owner`, so the owning role gets `CREATE`, owns every
  table, and needs no `GRANT`. A rehearsal database created a different way
  proves a configuration that will never exist.
- **`CREATE EXTENSION postgis; unaccent; pg_trgm;` by an `rds_superuser`, once.**
  These are not TRUSTED extensions, so **owning the database is not enough**.
  `IF NOT EXISTS` short-circuits on the duplicate check BEFORE the privilege
  check, which makes it a no-op where they exist and a hard failure where they
  do not — it looks like a fallback and is not one.
- **The `homiio_simple` text-search configuration.** Per-database, and it does
  **not** travel through `template1`. `db/extensions.ts` creates it on every
  migrate rather than assuming infrastructure did, because a database restored
  from a plain dump can be fully migrated and still be missing it — and that is a
  silent wrong answer (searches stop matching accented names), not an error.
- **The target holds no application tables and no `drizzle.__drizzle_migrations`.**
  That emptiness is what makes the backfill's `assertTargetsEmpty` a real guard
  rather than a formality.
- **Storage.** The shared `oxy-postgres` instance is also home to `oxy_api` and
  `mention`. Postgres with GiST + GIN + tsvector is not smaller than BSON. This
  is the precondition most easily skipped and the only one whose failure is an
  incident for **three** applications.

## Both migration guards are required here

`db/migrate.ts` carries `--target-database=<name>` **and** `--phase=pre|post|all`,
and neither has a default. They catch different mistakes:

- **`--target-database`** answers "am I pointed where I think I am?", checked
  against `current_database()` before any other statement. The migration step
  needs it more than the copy does because it fails SUCCESS-SHAPED: aimed at the
  wrong database the copy dies on a missing table, while the migrator finds an
  empty ledger, applies the whole journal, logs `Applied N migration(s)` and
  exits 0 — leaving the real database untouched while an operator reads a success
  line.
- **`--phase`** answers "which side of a deployment is this?" Every migration
  `.sql` declares its side on one line and a CI gate refuses a file that does
  not.

`package.json`'s `db:migrate` supplies `--phase=all` because a developer
database, the jest harness and a manual dispatch have no previous image to
protect. A production one-shot task states its phase explicitly.

**`DRY_RUN=true` reports the plan and the `journalEntries` count and writes
nothing** — not the ledger, not the extensions. The count is the thing to read at
cutover: an image built before a migration existed prints `No migrations to
apply`, exits 0, and is otherwise byte-identical to the correct case. Compare it
against `meta/_journal.json` at the pinned SHA and refuse if they differ.

## Open — required before the deploy runs migrations (batch 12)

**There is no cross-process advisory lock**, and one is needed before
`deploy-aws.yml` gains a migration step. drizzle's migrator takes no lock of any
kind: it reads the ledger's high-water mark OUTSIDE its transaction, then opens
one and replays everything newer. Two concurrent runs therefore both read the
same mark and both replay the same DDL, and the loser fails on an already-applied
statement after the winner has committed — leaving a duplicate ledger row behind.

Homiio has no path that can run two migrators today, because nothing runs
migrations automatically at all. Wiring the deploy to migrate is exactly what
creates the race (a deploy's own step against a manual dispatch, in two GitHub
concurrency groups that cannot see each other). oxy-api's `db/migrate.ts` has the
reference implementation: a session-scoped `pg_try_advisory_lock` held on its own
connection for the caller's lifetime, not on the short-lived one `runMigrations`
opens internally.

## Batch 0 scope, and what it deliberately leaves for later

Migration 0000 carries `countries`, `regions`, `cities`, `neighborhoods`,
`images` and `addresses` — the root of the foreign-key graph, chosen so the whole
pipeline (FKs, partial uniques, PostGIS, the text-search configuration) is
exercised end to end before anything depends on it.

Deliberately deferred, with the reason:

- **Format and range validators** (`^[A-Z]{2}$` on country codes, `maxlength`,
  `min: 0`) do not become CHECKs. A CHECK rejects existing production rows mid-copy,
  and nothing has measured what those rows contain yet. They belong in a
  `post`-phase migration AFTER the census. The coordinate-range CHECK on
  `addresses` is the one exception and `CONVENTIONS.md` explains why.
- **`Region.imageIds[]` / `City.imageIds[]`** are not ported. The relation already
  exists as `images.(entity_type, entity_id)`, so the array was a second,
  disagreeable copy of it. The resolution rule this used to state as "the
  backfill BLOCKS if any element has no `images` row" is now measured and
  named — see the section below.
- **Enum CHECKs are written from the CODE** and are subject to the production
  `distinct()` audit that Phase 0 of the tracking issue blocks on.

## Named resolutions — `City.imageIds[]` and `cities.cover_image_id`

The census measured production on 2026-08-06 and turned an open question into
two rules. **A blocking check was the right default before the numbers existed
and is the wrong one now**: it would stop the copy on rows whose only content is
a broken pointer, i.e. it would refuse to migrate BECAUSE of the bug it is
supposed to be dropping.

Both rules apply to the copy AND to the verifier. A resolution the verifier does
not know about is reported as a fidelity failure on every row it touched.

| Rule | Applies to | Measured | Action |
|---|---|---|---|
| `IMAGE_IDS_WITHOUT_IMAGE` | `City.imageIds[]` elements with no matching `images` row | **22 of 1,235** (1.8 %) — 21 name no `Image` at all (Telde, Ingenio, Santa Brígida, Las Palmas, Barakaldo, Bilbao, Erandio, …) | Dropped with the column. Count frozen at **22**. |
| `CITY_COVER_DANGLING` | `cities.cover_image_id` naming no `images` row | **17 of 1,230** (1.4 %) | Written **NULL**. Count frozen at **17**. The FK is real (`ON DELETE SET NULL`), so copying the id verbatim would be a `23503` mid-copy. |

One of the 22 deserves naming rather than counting, because it is a different
defect: **Agüimes → `6a5142339b66c268ba10214d`** points at an `Image` that
EXISTS but whose `entityType` is `property`. A city carrying a listing's photo is
wrong by construction — it is the bug `cityCoverSyncService`'s
`forceReplaceListingCovers` path exists to undo — so that element is dropped as a
defect being deleted, not as a link being lost. Recording the id here is what
makes that a decision rather than an accident.

`Region.imageIds[]` costs nothing: **0 elements across all 211 regions**, and no
`entityType: 'region'` image exists anywhere in the collection.

## Batch 3 scope (migration 0002, `properties`), and the decisions it fixes

`properties` (135 columns), `property_images`, `property_documents` and
`property_availability_windows`. SCHEMA ONLY — no controller or service is
ported. Six decisions here are contract-level, because a later batch that
reverses one of them silently changes what the copy means:

- **`offerings` equals exactly the set of present priced blocks**, as four
  per-offering CHECKs. This is the largest correctness win in the Property port:
  today the rule has TWO enforcement paths for one invariant, and the one that
  writes all 17,644 external listings (`scraperService.ts:285`, `updateOne`)
  enforces nothing. The POSITIVITY half of `validateOfferings` is deliberately
  NOT expressed — `> 0` is a range constraint over unmeasured data, which
  `CONVENTIONS.md` defers to a `post`-phase migration.
- **`hasImages` is kept**, against the rule that Mongo's join-less workarounds do
  not travel, because it is the primary sort key of every discovery feed and a
  correlated `EXISTS` in an `ORDER BY` is no more indexable in Postgres than in
  Mongo. It pays for that with an obligation: ONE writer (`db/hasImages.ts`),
  never settable from a request body, DERIVED by the backfill rather than
  copied, and a reconciliation check that is asserted.
- **Both copies of every duplicated field pair are carried.** `available_from`
  vs `availability_available_from` DISAGREE on 1,630 of 17,644 rows and are read
  by different filter paths, so collapsing them changes what a filter matches.
  The five `rules.*` pairs agree on every row — but only because every row is at
  the default in both copies, so the DATA cannot elect an authority either.
- **`coverImageIndex` is deleted** (`-1` on all 17,644 rows; the meaning moves to
  `property_images.is_primary`), and **`views` and `title` are declared with no
  Mongo source** — see `schema/unmappedColumns.ts`. `views` starting to count
  and `title` becoming searchable after the cutover are EXPECTED conditions.
- **`properties.source` gets a CHECK derived from the registered-provider union
  plus `internal` and `fixture`**, never from the fifteen values production
  happens to hold. `fixture` is test data really sitting in production; and
  `internal` is the Mongoose default that every user-created listing will carry,
  observed zero times only because production holds zero user-created listings.
- **`accommodation_details_wifi_password` is a PROTECTED COLUMN.** Mongoose hid
  it by accident — it is not `select: false`, it just never appeared in a DTO's
  field list — and a bare drizzle `select()` returns it. The exclusion is at the
  TYPE level so a serializer reading it fails `tsc`.

### Named resolutions the Property backfill owes

Measured against production on 2026-08-06. Each is a rule the copy AND the
verifier must both apply — a resolution the verifier does not know about is
reported as a fidelity failure on every row it touched.

| Rule | Applies to | Measured | Action |
|---|---|---|---|
| `MODERATION_ABSENT` | the `moderation` sub-object missing entirely | **17,642 of 17,644** (99.99 %) | `moderation_restricted` written **`false`**. Count frozen at **17,642**. |
| `PRICE_ETHICS_ABSENT` | `priceEthics` missing | **133 of 17,644** | All eight columns NULL. No default. |
| `LISTING_FLAGS_ABSENT` | `listingFlags` missing | **9,594 of 17,644** | All eleven columns NULL — see below, this is a THREE-state field. |
| `EXTERNAL_CONTACT_ABSENT` | `externalContact` missing | **5,174 of 17,644** | All six columns NULL. |
| `HAS_IMAGES_DERIVED` | `hasImages` | 1 row disagrees with its own array | DERIVED from `images[]`, never copied. |

**`moderation` is not a legacy cohort and the dates prove it.** The field was
added to `PropertySchema` on 2026-07-30 (`0bbc574`, PR #248); the newest
`createdAt` in the whole collection is 2026-07-25, so every row predates the
schema change. And the rows WITHOUT it have a max `updatedAt` four minutes LATER
than the two that have it — **re-ingesting does not add it**, across all twelve
providers. The only two rows carrying it are the two `fixture` rows. So this is
a stable steady state, not a backlog that will drain on its own, and
`moderation_restricted NOT NULL` without a DEFAULT would fail `23502` on 99.99 %
of the table mid-window.

`false` is the right value and not merely a convenient one: `moderation
.restricted` is written ONLY by `ModerationEnforcementService`, CrowdSource is
switched off in production entirely, and the schema's own default is `false`.
Absent here unambiguously means "no jury has restricted this listing".

**Do not generalise that to `listingFlags`.** Those booleans are THREE-state —
`true` (the text says students only), `false` (the classifier looked and said
no), NULL (the classifier never ran) — so a `false` default there would
manufacture a claim about 9,594 listings that nobody made. They stay nullable,
which is why the four objects above get three different answers rather than one
rule applied four times.

### Two constraints that a table of external listings would have got WRONG

Both are the same trap, and it is worth naming because it will recur in every
later batch: **production contains ONLY external aggregator listings**
(`oxy_user_id` absent on all 17,644), so any constraint derived from "what the
data holds" encodes the external path and breaks the internal one the first time
a user uses it.

- **`properties.source` must accept `internal`**, the Mongoose default every
  user-created listing will carry. Observed zero times.
- **`properties.source_url` must NOT be `NOT NULL`**, even though it is present
  and non-empty on 17,644 of 17,644 rows. It has exactly one writer
  (`scraperService.ts:276`, plus `IngestionService`), and it is absent from BOTH
  `CREATABLE_PROPERTY_FIELDS` and `EDITABLE_PROPERTY_FIELDS` — so no user-created
  listing can ever have one, and a blanket `NOT NULL` turns `POST /api/properties`
  into a guaranteed `23502`. The measurement is real; the population is biased.
  What the measurement DOES support is the conditional the product actually
  states: **external listings must carry a `sourceUrl`**, which is a CHECK
  (`properties_external_source_url_check`) that holds on every production row and
  leaves the internal path alone. `source_url` also takes NO `UNIQUE`: two
  habitaclia rows (`52795000011615`, `39875000001003`) share
  `https://www.habitaclia.com/alquiler-madrid.htm` — the Madrid search-results
  page, from a parser falling back to the results `href` — while their
  `(source, source_id)` stays unique, so the real key is unaffected.

## Two live hazards found in adjacent code — NOT batch 0, do not fix here

Recorded so they are not lost. Both are silent under Postgres:

- ~~**`utils/helpers.ts`** detects a populated address by the PRESENCE of
  `_id`.~~ **FIXED in batch 1.** The guard now asks whether the value carries
  `street` — the address's own mandatory field in both stores — instead of
  asking how Mongo spells an id.
- **`.toHexString()`** on ids in `services/moderation/subjects/propertySubject.ts:321`
  and `reviewSubject.ts:243` throws on a plain string. Batch 2.
