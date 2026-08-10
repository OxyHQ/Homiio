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

## Before porting a table, census who ELSE reads it

A table is not finished when its own controller stops importing the Mongoose
model. It is finished when NOTHING reads it from Mongo — and the readers that
get left behind are, by construction, the ones in files the porting batch does
not own.

They fail **silently**, because a Mongo query against a collection whose rows
now live in Postgres is not an error: it is an empty result. And they are
INVISIBLE while the table is empty, which is the same condition that makes a
domain look cheap to port in the first place.

Run this before the first schema line, not after the merge:

```
grep -rn "\bModelName\b" controllers/ services/ routes/ utils/ middlewares/
```

**Census every table already on Postgres, not only the ones this batch moves.**
That correction is the whole rule, and it was paid for. The first census taken
for the tenancy stragglers grepped only the models that batch had moved and
reported **4 files**; re-run across every table already on Postgres it reported
**5 files carrying 10 stale model reads**. The miss was exactly the tables the
author had not personally touched — `Saved` and `RecentlyViewed`, moved by a
sibling batch, read from three `controllers/property/*` files, one of which
(`retrieve.ts`) the first census never named at all.

Scoping a census by AUTHORSHIP is the failure mode; scoping it by what is on
Postgres is the fix. Note the shape: an inventory whose job is to answer "is
anything still using this?" **cannot tell "found less" from "there is less"**,
so give it a positive control — the count of files importing the model barrel at
all — and be suspicious of any run that returns zero everywhere.

**Rank a SWEEP above a read.** A stale read returns zero to a caller who can at
least see an empty result. A stale sweep — `cleanupService`'s retention
`deleteMany`, an expiry job — produces no output at all: it reaps nothing, and
the only symptom is disk, months later, by which time nobody connects it to a
migration. `db/expiry.ts` records the same hazard from the schema side.

**A stale reader is worth opening**, because a query written against the old
store often turns out to have been broken independently of it. Porting
`analyticsController` surfaced three defects that predated the migration and
made the endpoint return zeros for its whole life: a `distinct` filtered on
`profileId`, which `PropertySchema` never declared, so the selector matched
nothing and the two aggregates guarded by `propertyIds.length ? … : …` never ran
at all; a viewing rollup comparing `ownerOxyUserId` against a PROFILE id; and an
`$addToSet` on a column that does not exist. Moving those reads to Postgres
while leaving the selectors alone would have been the worst available outcome —
three queries ported, still answering 0, and looking done.

### `strictQuery: false` turns a mis-declared FILTER into a silent empty page

The `analyticsController` defects above are the WRITE-side version of mongoose
strict mode (a path the schema does not declare is dropped from the update).
The roommate port found the READ-side version, and the two produce opposite
symptoms from the same misspelling, so it is worth naming which one this
package is exposed to.

`database/connection.ts:39` sets `mongoose.set('strictQuery', false)`. With
`strictQuery: true` an undeclared path is stripped from the FILTER, which makes
the query too BROAD — it returns rows the caller meant to exclude. With `false`
it is passed through to MongoDB, where a path no document has matches
**nothing**. `getRoommateProfiles` filtered on `personalProfile.gender`,
`personalProfile.location` and `personalProfile.dateOfBirth`;
`personalProfileSchema` declares none of the three, so `?gender=`, `?location=`
and `?ageRange=` returned an empty page for the whole life of the feature.

The rule this yields for the rest of the migration: **a Mongo selector naming a
path the schema does not declare is not a bug to port, and porting it faithfully
is the worst available outcome** — it answers zero just as reliably in Postgres
and looks finished. Re-point it at the fact the product really stores, or delete
it, and say which in the PR. Where the stored fact does not exist at all (the
roommate `location` filter, and the `interests` the compatibility score reads),
the field is usually already ACCEPTED by a write allow-list and discarded by
strict mode on the way in — so the fix is an additive column, registered in
`schema/unmappedColumns.ts` with the other columns that have no Mongo source.

`?ageRange=` is the case where no honest column exists: there is no date of
birth in either store and there must not be one (Oxy owns identity). It is
re-expressed as an OVERLAP against the candidate's own stated preferred age
range — a different question with the same intent, recorded here because it is
the kind of semantic change a later reader would otherwise take for a bug.

## A fixture has to sit on the side of the distinction the test exists to make

The tidiest fixture is often the one that makes a check vacuous, and a green run
does not distinguish the two. Before trusting a passing test on any check that
tells two things apart, ask what input shape would make the two DISAGREE, and
confirm a fixture has that shape.

Measured here, three times, each caught only by mutation testing:

| check | the too-tidy fixture | why it could not fail |
|---|---|---|
| half-open `[)` range overlap | two "adjacent" windows built from two separate `Date.now()` calls | they land milliseconds apart, so they are disjoint under `[)` AND `[]` — three closed-bound mutations survived a test whose comment claimed to pin exactly that boundary |
| `count_distinct` vs `count` | 2 views by 2 people | the two figures agree; swapping one for the other passes. One viewer across two listings plus a second viewer (3 views, 2 people) is the shape that discriminates |
| a renewal not inheriting signatures | a co-tenant who never signed the original | inheriting `status` verbatim still reads `pending`, so the assertion holds either way |

The general form: **a boundary test built from two independent `Date.now()`
calls tests nothing about the boundary.** Same family as the checks
`~/Oxy/AGENTS.md` calls "a check that cannot distinguish success from failure" —
here the failure is in the FIXTURE rather than the assertion, which is why
reading the test does not reveal it and mutating the code does.

## Ids are preserved verbatim, and that is not a convenience

Every primary key is `text`. A row that existed before the cutover keeps its
24-char ObjectId hex EXACTLY; rows created after it get a uuid v7. There is no
remapping table and no id translation anywhere in the copy, which is precisely
how every foreign key survives by construction: if the id does not change, a
reference to it cannot break.

**The exceptions are the `_id: false` embedded arrays**, whose subdocuments have
no id to preserve; the backfill MINTS a uuid v7 for each of those rows. That is
not a remap — it is an id where there was none, and nothing references any of
them by construction.

This file said "the one exception … is `Review.reports[]`" until batch 4. That
was true of the batches that had landed and is not true of the migration, and the
difference matters: a reader who trusted it would look for a preserved id on four
other tables and not find one. The complete set:

| Source array | Target table |
|---|---|
| `Review.reports[]` | `review_reports` |
| `Review.helpfulVoters[]` (a `[String]`, so not even a subdocument) | `review_helpful_votes` |
| `TenantApplication.referenceContacts[]` | `tenant_application_references` |
| `TenantApplication.documents[]` | `tenant_application_documents` |
| `EvictionCase.attendees[]` | `eviction_case_attendees` |
| `PlacePoi.categories[]` | `place_poi_categories` |
| `Property.availabilityWindows[]` and `Property.exchange.availabilityWindows[]` | `property_availability_windows` |

Every OTHER embedded array in this migration is an implicit or explicit
`{ _id: true }` subdocument and keeps its id verbatim — including
`Lease.paymentSchedule[]`, whose ids `recordPayment` already looks rows up by,
and `Conversation.messages[]`.

**The last row was missing until the data backfill was written, and its absence
was not harmless.** `availabilityWindowSchema` (`models/schemas/PropertySchema.ts`)
declares `{ _id: false }` and backs BOTH property calendars, so this table has no
id to preserve — while the sentence above asserted that it does. A reader
trusting the table would look for a stored id and not find one.

## A minted id must be DETERMINISTIC, or idempotence is a false claim

The rule above and "every insert is `ON CONFLICT DO NOTHING`, so a re-run
converges" cannot both hold if the mint is random: a freshly-random primary key
never conflicts, so a second run does not skip those rows, it DUPLICATES every
one of them — in precisely the resumed-partial-run case the idempotence rule
exists for.

So a minted id is a pure function of the position the row occupies:
`sha256(parentId|path|index)` supplies the 74 random bits and the PARENT's own
`created_at` supplies the 48-bit timestamp prefix, with the version and variant
nibbles pinned exactly as `@oxyhq/db`'s `uuidv7` pins them so `isLiveEntityId`
still accepts it. `db/backfill/dataPlan.ts`'s `deterministicUuidV7` is the
implementation. Same reasoning that already makes `moderation_outbox.id`
deterministic: where the id IS the deduplication mechanism, minting a fresh one
deletes it.

The fallback for an unusable `created_at` is the Unix epoch and NEVER
`Date.now()`. `Date.now()` reintroduces the whole defect for exactly the rows
whose timestamps are broken, which is the version hardest to notice.

**Two tables take an id that is neither an ObjectId nor a minted uuid.**
`moderation_outbox.id` is DETERMINISTIC (`moderation:report.submit:<reportId>`)
and `moderation_events.id` IS the CrowdSource event id. Both are declared with no
default, because in both cases the id is the deduplication mechanism and minting
one would delete it. Neither table has a production row to copy.

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

## Open — the deploy runs migrations, and the interlock is the workflow's

**There is still no cross-process advisory lock.** drizzle's migrator takes no
lock of any kind: it reads the ledger's high-water mark OUTSIDE its transaction,
then opens one and replays everything newer. Two concurrent runs therefore both
read the same mark and both replay the same DDL, and the loser fails on an
already-applied statement after the winner has committed.

**This section used to say the lock was required BEFORE `deploy-aws.yml` gained
a migration step. That step landed on 2026-08-10 without it, deliberately**, and
the reasoning is worth keeping rather than the old sentence:

- The interlock a GitHub deploy actually needs is a workflow-level `concurrency`
  group with `cancel-in-progress: false`, and `deploy-aws.yml` has carried one
  (`deploy-homiio-backend`) throughout. It is a CALLED workflow, so it runs
  inside `ci.yml`'s run, whose group also does not cancel on `refs/heads/main` —
  two merges to main queue rather than overlap. Both halves are pinned by
  `__tests__/unit/deployRolloutConcurrency.test.ts`.
- What that leaves open is a `workflow_dispatch` of `deploy-aws.yml` landing
  while a push-triggered deploy is mid-flight: different runs, and the old
  parenthetical about "two concurrency groups that cannot see each other" is
  right about exactly that case and no other.
- The cost there is a red deploy rather than a damaged database — the loser
  exits non-zero on an already-applied statement. **The old claim that it leaves
  "a duplicate ledger row behind" is not something this repository has measured,
  and the ecosystem measurement of the same drizzle replay rule says the ledger
  ends correct with one row.** Do not repeat the duplicate-row claim without
  measuring it here.

oxy-api's `db/migrate.ts` still has the reference implementation if the lock is
wanted: a session-scoped `pg_try_advisory_lock` held on its own connection for
the caller's lifetime, not on the short-lived one `runMigrations` opens
internally.

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

## The geo copy — `db/backfill/geo.ts`

The first backfill to run against production, and the shape every later batch
should follow. It lives in `db/`, not `scripts/`, because
`tsconfig.build.json` EXCLUDES `scripts` from `dist` on purpose and the runtime
image has no ts-node — `dist/db/migrate.js` is the precedent, and
`dist/db/backfill/geo.js` is the second entry point of that kind.

```
node packages/backend/dist/db/backfill/geo.js \
  --source-database=homiio-production --target-database=homiio [--audit-only|--verify-only]
```

**Both database names are required, and they fail differently.**
`--target-database` reuses the migrator's `assertMigrationTarget`, issued as the
first statement on the Postgres connection. `--source-database` is its mirror:
Mongo has no server-side `current_database()` — the database is chosen by the
CLIENT from the connection string — so the check compares the driver's resolved
`databaseName` AND asserts every source collection exists. That second half is
the one that matters, because a collection that is not there reads as "0
documents copied", which is success-shaped.

**The audit runs over the WHOLE plan before the first insert.** It reads each
target table's own column metadata (`notNull`, `hasDefault`, `dataType`,
`enumValues`) rather than restating the rules, so it cannot drift from
`db/schema/`; the table-level CHECKs and the foreign keys are passed in as named
rules because no column carries them. It reports every violation in one pass,
grouped with counts and example ids — a copy that discovered these by inserting
would stop half way with a driver error naming one row.

**Only the geo hierarchy's own images travel** (`city` / `region` / `country`).
A cover naming an image outside that set is REFUSED rather than nulled: nulling
would lose a live relational link, which prime directive 1 forbids. A cover
naming no image at all is the `CITY_COVER_DANGLING` rule above and is written
NULL.

### What the 2026-08-09 census measured, against a live `homiio-production`

Run before the copy, from a one-shot on the live task definition. It CONFIRMS
the two frozen counts above and adds the figures the copy depends on:

| Measured | Value |
|---|--:|
| countries / regions / cities / neighborhoods | 7 / 211 / 1,660 / 4,521 |
| images, total | 171,976 |
| images by `entityType` | `property` 170,679 · `city` 1,297 — and **nothing else** |
| cities carrying a `coverImageId` | 1,230 |
| …that resolve to an `images` row | 1,213, **every one of them `entityType: 'city'`** |
| …that resolve to nothing (`CITY_COVER_DANGLING`) | **17** — unchanged from 2026-08-06 |
| regions carrying a `coverImageId` | **0** |
| `distinct(currency)` on countries and on cities | `EUR`, `GBP`, `USD` — all inside `LISTING_CURRENCIES` |
| `distinct(entityType)` on images | `city`, `property` — both inside `IMAGE_ENTITY_TYPES` |
| required fields absent, any of the five collections | **0** |
| foreign-key orphans (`region→country`, `city→country/region`, `neighborhood→city`) | **0** |
| `bbox` lengths across all 4,521 neighborhoods | **length 0 on every row** — nothing has ever had a bounding box |
| duplicates against the target's unique indexes | **0** |
| non-numeric / out-of-`integer`-range / non-string values | **0** |

So the `distinct()` audit `db/schema/CONVENTIONS.md` blocks the copy on is
DISCHARGED for these five tables: production holds no value the CHECKs refuse.
That is a fact about this data on this date, not a general one — the audit still
runs on every invocation, because the collections stay writable until the
cutover.

### `--reconcile`, and why the plain copy could not close the incident

`ON CONFLICT DO NOTHING` cannot repair a row, which is correct for a copy and a
gap the moment the target holds rows this script did not write. Both ways that
happens are real and both happened here:

- **Somebody else populated the tables.** A hand copy had already loaded the four
  geo tables with every `cover_image_id` NULL — it had no `images` rows to point
  at, so copying them would have been a `23503`. Every row was present, the copy
  skipped all 1,660, and `/api/cities/popular` — whose whole filter is
  `cover_image_id is not null` — kept answering `[]`. The verifier is what found
  it; the copy alone reported five clean `skippedExisting` lines.
- **Mongo is still live.** It stays authoritative until the cutover, so a row
  copied an hour ago can be edited now and the target is stale by definition.
  Measured: four rows had a newer `updated_at` in Mongo than in Postgres within
  half an hour of the first copy.

`--reconcile` is explicit, never the default, and writes EVERY column of a
differing row rather than only the wrong one — `updated_at` carries drizzle's
`$onUpdate`, so an `UPDATE` that does not name it stamps the row with the moment
of the repair, replacing the historical value this migration exists to preserve.

**`properties_count` is copied, not recomputed.** Properties do not exist in
Postgres yet, so recomputing would write zero to every row and flatten the sort
key `GET /api/cities`, `/popular` and `/search` all order by. The stored value is
the last count Mongo computed, which is exactly what the Mongo-backed endpoint
was serving.

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

## Batches 4-8 scope (migrations 0003-0007) — the remaining 51 tables

SCHEMA ONLY. No controller, service or repository is ported; the Mongo path is
untouched and still serves production. With these, **every Mongoose model in
`models/` has a table** and `DEFERRED_FOREIGN_KEYS` is empty.

| Migration | Tables | What |
|---|--:|---|
| `0003_identity_partners_billing` | 11 | `profiles` (+5 children), `agencies`, `partners`, `commissions`, `billing` (+1) |
| `0004_tenancy_leases_bookings` | 14 | `leases` (+6), `tenant_applications` (+2), `reservations`, `viewing_requests`, `exchange_requests`, `exchange_reviews` |
| `0005_community_reviews_evictions` | 11 | `reviews` (+2), `listing_reports`, `eviction_cases` (+2), `eviction_comments`, `eviction_reports`, `roommate_requests`, `roommate_relationships` |
| `0006_engagement_saved_cache` | 11 | `conversations` (+2), `notifications`, `saved_items`, `saved_searches`, `saved_property_folders` (+1), `recently_viewed`, `place_pois` (+1) |
| `0007_crowdsource_moderation` | 4 | `moderation_reports`, `moderation_outbox`, `moderation_events`, `moderation_enforcements` |

**Only two of these tables have data to copy.** The live census (2026-08-06)
measured `agencies` at 2,627 rows and `profiles` at 5; every other collection in
these five migrations is at ZERO. That is what makes their constraints
expressible — see `CONVENTIONS.md` on the line between a deferred format
validator and an expressed range or coherence rule.

### Decisions here that a later batch must not silently reverse

- **`properties.agency_id` and `properties.sourced_by_partner_id` become REAL
  foreign keys** in 0003, closing the ledger 0001 opened. Both are `SET NULL`.
- **Three references were RENAMED**, each because the old name hid what the
  column holds from `isOxyAccountColumn` or from `idShapedColumns`:
  `Partner.userId` → `partners.oxy_user_id`, `ModerationReport.reporter` →
  `moderation_reports.reporter_oxy_user_id`, and
  `Lease.documents[].uploadedBy` → `lease_documents.uploaded_by_oxy_user_id`.
  All three tables are empty, so each costs the backfill one mapping entry.
- **`OXY_ACCOUNT_COLUMN_NAMES` is now a MEASURED set**, not a predicted one. Six
  names that were pre-registered in 0000 turned out never to exist
  (`sender_`, `user_`, `participant_`, `organizer_`, `author_`, `partner_`) and
  were removed; ten real ones were added. A name in that allow-list matching
  nothing is indistinguishable from one matching something, which makes the set
  unreviewable — and it is the only thing standing between an account column and
  shipping unclassified.
- **`Lease.roomId` declared `ref: 'Room'`, and no `Room` model exists.**
  `roomController.createRoom` creates a **Property** with `type: 'room'` and a
  `parentPropertyId`; nothing populates the path, which is why
  `MissingSchemaError` never fired. It is a real foreign key into `properties`
  here. The link was already half lost; this restores it rather than inventing
  one.

### Uncarried fields (a SOURCE field with no target column)

The mirror of `schema/unmappedColumns.ts`. `properties.coverImageIndex` was the
first; these two are the rest, and both are DERIVED COUNTS with exactly one
source of truth once their array becomes a table:

| Field | Replaced by | Why not carried |
|---|---|---|
| `EvictionCase.attendeeCount` | `count(*)` over `eviction_case_attendees` | It existed because `attendees` was `select: false` and counting it meant loading it. Unlike `properties.has_images` — which is kept against the same rule — it is not a SORT key of any feed, so no `ORDER BY` has to survive an aggregate |
| `Conversation.analytics.messageCount` | `count(*)` over `conversation_messages` | Same shape, same reason. Its two siblings ARE carried: `lastActivity` moves on any save (not only on an append) and `totalTokens` comes from the provider's response, so neither is derivable from the messages |

### A behaviour change the backfill must EXPECT, not diagnose

`controllers/property/stats.ts` counts saves with
`targetId: new mongoose.Types.ObjectId(propertyId)` against a field Mongo
declares `String` — a BSON type mismatch, so the count has always been **0**.
Under Postgres both sides are `text` and the comparison simply works. A save
count that starts being non-zero after the cutover is correct behaviour arriving,
the same class of finding as `properties.views` starting to increment.

## Batch 4 — the catalogue READ paths, and the read/write split it creates

The property, address and image READS are served from Postgres.
**Every write is still Mongoose**, deliberately: the backfill is a point-in-time
copy and the ingest worker keeps writing to Mongo, so a read that moved is
refreshed by the next copy while a write that moved would be lost by it. Nothing
in this batch may become the only writer of a Postgres row.

There is exactly ONE exception, and it is not a listing write:
`cityController.getPropertiesByCity` refreshes `cities.properties_count` from the
count it just computed. That column was copied verbatim by the geo backfill
*because properties did not exist in Postgres yet*, and no endpoint reads the
Mongo `City` document any more, so it is a cache of a number this statement
already has rather than a fact only Mongo holds.

### What the collapse actually removed

Every geo-scoped property read ran in two phases —
`Address.find({...}).select('_id')` with **no `.limit()`**, then
`Property.find({ addressId: { $in: [...] } })`. Barcelona is tens of thousands of
ids, materialized in the application and shipped back as a query document, on a
request path behind no feature flag. It appeared SIX times:
`geoQueryService.resolveGeoFilterAddressIds`, `Property.findNearby`,
`Property.findWithinRadius`, `search.ts`'s `resolveAddressIds` /
`resolveTextAddressIds` / `resolveGeoAddressIdsForText` (the last calling the
first twice per request), plus `cityController` and `City.updatePropertiesCount`
open-coding it. All of them are one join now, with the spatial predicate on
`addresses.geo` and the `LIMIT` reaching the planner.

### Deliberate behaviour changes, each stated rather than discovered

| Change | Why |
|---|---|
| Free text is `websearch_to_tsquery` (AND) rather than `$text` (OR) | "apartment barcelona" returned every apartment anywhere |
| Price sorts are `NULLS LAST` in BOTH directions | Mongo sorted a MISSING price first ascending, so "cheapest first" led with unpriced listings |
| An unknown `sortBy` falls back to recency | Mongo passed any string through as a field path (a silent no-op); the SQL equivalent would be building a column name from user input |
| `savesCount` reports real numbers | See below — this one was forced |
| A bounding box uses `ST_MakeEnvelope` (straight edges in lat/lon) rather than a GeoJSON polygon (great-circle edges) | The box is a map VIEWPORT; the two share all four corners and differ only inside a very large one |

**The saves count could not be left alone, and the reason is worth recording
because the first decision was the opposite one.** `Saved.targetId` is declared
`String` while the `$match` compared it against `ObjectId`s, and `aggregate`
does not cast — the identical defect this file already names in `stats.ts`. The
plan was to preserve it verbatim and let it move with `Saved`. The integration
suite then showed what the cast DOES: `new ObjectId('019fd591-…')` throws
SYNCHRONOUSLY, outside the `.catch()`, so the first listing carrying a uuid v7
id turns the whole home feed into a 500 — and every listing created after the
cutover carries one. Preserving a comparison that can never match, at the price
of a guaranteed outage, is not preservation.

### Pre-existing defects carried across VERBATIM, and pinned

Each is a test, not a comment, so fixing it is a deliberate change to what an
endpoint returns rather than a side effect of a store migration:

- **`/api/properties/by-ids` and `/api/properties/owner/:id` filter
  `status: 'active'`**, which is not a member of `PropertyStatus` — so both have
  been returning empty pages for as long as the vocabulary has been settled, and
  `properties_status_check` would now refuse to store the value at all.
- **`sortBy=salePrice` is unreachable.** `buildSearchPlan` lower-cases the
  requested sort and tests it against a camelCase set, so `salePrice` becomes
  `saleprice` and falls back to recency. `createdAt` has the same defect and is
  harmless because its fallback IS recency.
- **`list.ts` and `geospatial.ts` disagree about `?available=true`** — the first
  yields "available, not a draft", the second "available, published" — and about
  which price column a bare `minRent` applies to. `controllers/property/commonFilters.ts`
  shares only the clauses that genuinely agree, so the difference stays visible.

### One trap this port hit, which will recur in every later batch

**An array interpolated into a drizzle `sql` template renders as a ROW
CONSTRUCTOR, not an array parameter.** `sql` + "`${values}::text[]`" emits
`($1, $2)::text[]`, which Postgres rejects outright — a RUNTIME error that
`tsc` cannot see and that four predicates shipped with (`typeIn`,
`exchangeModeIn`, `hasAnyAmenity`, `hasAllAmenities`). `sql.param(values)` binds
the whole array as ONE parameter. It was caught by the real-database suite and
by nothing else, which is the argument for that suite.

## Model BEHAVIOUR the repository layer still has to absorb

Deliberately NOT ported in these batches, and listed so the next one has the
inventory rather than rediscovering it. Every item is a Mongoose hook, static,
method or virtual that has no Postgres counterpart:

- **Derivations now enforced by the DATABASE, so the hook is deleted rather than
  ported:** ~~`Review.pre('validate')`'s `livedForMonths`~~ (DONE —
  `db/reviews/reviewWrites.deriveLivedForMonths`) and `Reservation.pre('save')`'s
  `nights` still have to be COMPUTED by a writer, but the CHECKs beside them
  (`livedTo > livedFrom`, `nights >= 1`) mean a wrong one fails loudly. `TenantApplication.pre('save')`'s `decidedAt` stamp and
  `ViewingRequest`'s `cancelledBy` are now equivalences the database enforces.
- **Idempotency that MOVED into an index and must not be re-implemented as a
  read:** ~~`Agency.findOrCreateByName`~~ (DONE), ~~`Billing.pre('save')`'s
  duplicate check~~ (DONE — `db/billing/billingRepository.ensureBilling`),
  ~~`reviewController`'s `alreadyVoted` and `alreadyReported`~~
  (DONE — and the duplicate-REVIEW check joined them as
  `reviews_author_address_key`), `evictionController`'s RSVP check, and
  `SavedPropertyFolder.addProperty`. Each was a read-then-write with a window;
  each is now a unique key. The ported code should INSERT and handle `23505` —
  **inside `inSavepoint` if it can run in a caller's transaction**, which is what
  `findOrCreateAgencyByName` had to learn the moment it got one.
- ~~**Aggregations to rewrite as SQL:** `Review`'s six explore/agency
  pipelines.~~ **DONE** — `db/reviews/reviewAggregates.ts`, all seven of them
  (the list undercounted: `findByUnitLevel` is a finder the UNIT view needs, and
  `getStreetViewData` is two queries, not one). Every one carries
  `visibleModeration()`, spelled as a LITERAL so the seven partial indexes stay
  reachable under a generic plan.
- **Virtuals a DTO has to compute:** `Lease.isFullySigned`, `leaseDuration`,
  `formattedRent`, `daysUntilExpiration`; `Conversation.messageCount` and
  `lastMessage`; ~~`Review.livedDurationText`~~ (DONE —
  `db/reviews/reviewSerializer.livedDurationText`, and it now appears on EVERY
  review rather than only on the non-lean reads); `SavedPropertyFolder.propertyCount`.
- **Methods with real logic to port:** `Lease.generatePaymentSchedule`,
  `recordPayment`, `signAsLandlord`/`signAsTenant`;
  ~~`Billing.consumeFileCredit`~~ (DONE — one conditional `UPDATE … SET
  file_credits = file_credits - 1 WHERE … AND file_credits > 0`, so
  `billing_file_credits_non_negative_check` is a backstop rather than the guard);
  `Conversation.generateShareToken`/`revokeSharing` (the four `sharing_*` columns
  now move together by CHECK).
- **The `conversations.sharing_expires_at` sweep**, which must CLEAR those four
  columns and must never delete the row. `services/cron.ts` owes this alongside
  the `sweepAllExpiredRows` call the expiry registry already made visible.

## Two live hazards found in adjacent code — NOT batch 0, do not fix here

Recorded so they are not lost. Both are silent under Postgres:

- ~~**`utils/helpers.ts`** detects a populated address by the PRESENCE of
  `_id`.~~ **FIXED in batch 1.** The guard now asks whether the value carries
  `street` — the address's own mandatory field in both stores — instead of
  asking how Mongo spells an id.
- ~~**`.toHexString()`** on ids in `services/moderation/subjects/propertySubject.ts:321`
  and `reviewSubject.ts:243` throws on a plain string.~~ **FIXED with the
  moderation batch below.** Both providers read drizzle rows now, whose ids are
  already plain strings, so the coercion had nothing left to convert and was
  deleted along with the `GeoRef` union that existed only to tell a populated ref
  from a bare `ObjectId`.

## The moderation pipeline and the eviction board

Both domains were **empty in production** — measured 2026-08-09 against a live
`homiio-production` by a one-shot ECS task on `oxy-homiio:25`:
`evictioncases`, `evictioncomments`, `evictionreports`, `moderation_reports`,
`moderation_outbox`, `moderation_events` and `moderation_enforcements` all
**zero**, in the same scan that returned `properties = 17,644` and
`images = 171,976`. The non-zero figures are the positive control: a broken scan
and an empty domain look identical without one. So there is no backfill and no
consistency window for either domain — but the guarantees below are what the
FIRST real report will depend on, and none of them survives being re-derived
later.

### Three `isValidObjectId` guards deleted, and why these three mattered most

Consistent with the rule above, and listed because all three BRANCH rather than
merely reject: `ModerationEnforcementService.applyToProperty` /
`applyToReview`, and `reviewController.reportReview`. Left in place, a listing
or review created after the cutover would carry a uuid v7, fail the guard, and
be reported back as `changed: false` — *"the reported listing no longer
exists"* — while sitting there perfectly intact. A jury could vote to restrict
it and nothing would happen, with an enforcement row claiming the action was
handled. `__tests__/db/moderationWrites.test.ts` pins both id shapes.

### What is enforced by the DATABASE rather than by its single writer

`listing_reports`, `review_reports` and `eviction_reports` each have exactly ONE
writer (their intake controller). That single writer legitimately owns the SHAPE
of a row — the reason allowlist, the details ceiling, the reporter coming from
the session and never from a body. It does **not** own the duplicate rules, and
single-writer is the wrong reason to think it could: one writer means one code
PATH, not one at a time, and that path runs concurrently with itself on every
ECS task. So the partial unique indexes carry them
(`listing_reports_open_reporter_key`, `review_reports_review_user_key`,
`eviction_reports_open_reporter_key`), the intake INSERTS and converges on
`23505`, and the preceding read survives only to ANSWER with the existing row.
`review_reports` is the sharpest case: the COUNT of those rows crossing three is
what flips a review to `under_review`, so a duplicate that slipped through is a
vote for removal cast twice by one person.

### Carried across unchanged, because nothing else would catch their loss

- **A 201 means STORED, never "CrowdSource accepted it."** The report row and its
  outbox row commit in ONE transaction, with no outbound request in the handler.
  `db/moderation/transactionGuard.ts` refuses the ROOT connection at runtime,
  because `DatabaseOrTransaction` is satisfied by it — so a caller that forgets
  to thread the handle through compiles, commits the report alone, and passes any
  test that only asserts the row exists.
- **A repeated enqueue is a genuine no-op.** `ON CONFLICT DO NOTHING` writes no
  tuple version at all; `DO UPDATE` would move `updated_at` even writing the same
  values back (drizzle applies `$onUpdate` to a conflict branch's `set`) and
  contend with a live dispatcher lease. Asserted on `updated_at` AND `xmin`.
- **`UNIQUE(decision_id, revision, action)` with `revision` IN the key**, so a
  correction's `restore` is a different action from the `restrict` it supersedes
  and an upheld appeal can still relist a listing.
- **The webhook route stays mounted BEFORE `express.json()`**, and the dedupe
  claim is `INSERT … ON CONFLICT DO NOTHING … RETURNING` in Postgres — Homiio
  runs more than one task, so an in-process store would only dedupe the task that
  received both copies. The empty vs one-row `RETURNING` set IS the answer; a
  caught `23505` would let a dropped connection read as a duplicate.
- **The LOOP is gated, never the durable record.** Reports taken while
  `CROWDSOURCE_ENABLED` is off still get their delivery event.

### Uncarried, and one seam left open

`EvictionCase.attendeeCount` is **deleted** — `count(*)` over
`eviction_case_attendees` answers it, and unlike `properties.has_images` it sorts
nothing, so no `ORDER BY` has to survive a correlated aggregate. The RSVP
toggle's read-then-write went with it.

~~**`reviewController` is otherwise still Mongoose.**~~ **CLOSED by the reviews
batch below.** Only `reportReview` had moved with the moderation pipeline, which
left the seam it named: a review created through this controller was not visible
to the report path. All sixteen handlers are on Postgres now.

## The reviews domain — `reviewController`, and the two defects it surfaced

`db/reviews/` (reads, writes, aggregates, serializer), `db/agencies/agencyReads.ts`,
`controllers/review/reviewInput.ts` and `resolveAddressHierarchy` in
`services/addressService.ts`. Zero Mongoose call sites remain in
`controllers/reviewController.ts`, and `git grep '\bReview\.\|\bAgency\.'` over
`controllers/ services/ routes/ utils/ db/` returns no live call site anywhere —
both models are now dead, and are left in `models/` with the rest rather than
deleted piecemeal.

### Two pre-existing defects, fixed rather than ported

- **The street/building hierarchy resolved onto the review's OWN address.**
  `Address.findOne(address.createBuildingLevel())` matched the unit row itself,
  because a Mongo filter constrains only the fields it names and the building
  projection is a strict SUBSET of a unit address's fields. MEASURED against the
  real model, not inferred: for a UNIT address, both that call and the street one
  returned the same document, so every UNIT review stored
  `streetLevelId === buildingLevelId === addressId`. Two flats in one building
  therefore never rolled up together — `getBuildingSummaries` groups by
  `building_level_id`, so the neighbourhood explore page showed one card per FLAT
  and `getBuildingViewData` for a real building address found nothing.
  `resolveAddressHierarchy` projects onto explicit COLUMN VALUES and dedupes on
  `normalized_key`, which has no subset semantics.
- **`findOrCreateAgencyByName` could not run inside a transaction**, which is the
  only way the review create path calls it. Its slug-collision branch is an
  insert, a caught `23505` and a RETRY on the same handle — the idiom that works
  on the root connection and dies with `25P02` inside a transaction. It has taken
  a transaction parameter since it was written; this batch is the first caller to
  pass one. Both attempts now run in `inSavepoint`.

Two smaller ones went with them: `getUserReviews` hid a `removed` review from its
own AUTHOR, contradicting both `getReviewById` and the docblock on
`reviews_oxy_user_created_idx` (the one scoped index that is deliberately NOT
partial, so that listing can serve exactly that row); and four UNWIRED review
validators in `middlewares/validation.ts` carried two `isMongoId()` calls — the
express-validator guise of the guard sweep, INVISIBLE to `db/ids.ts`'s census,
which greps `isValidObjectId` / `ObjectId.isValid` — plus a boolean
`depositReturned` and a client-suppliable `livedForMonths`. Deleted; validation
lives in `controllers/review/reviewInput.ts`, derived from the same tuples the
CHECKs are.

### Decisions a later batch must not reverse

- **`reviews_author_address_key` (migration 0008, `pre`)** replaces
  `Review.findOne({ oxyUserId, addressId })`. It is NOT partial on
  `moderation_status <> 'removed'`, unlike the seven scoped indexes: a removal
  still occupies its author's slot, or a jury's decision is undone by pressing
  submit again. The preceding read survives as the ANSWER path, exactly as
  `hasReportedReview` does beside `review_reports_review_user_key`.
- **`visibleModeration()` spells `'removed'` INLINE**, not as a bound parameter.
  Measured: under a CUSTOM plan both forms keep the partial index, and under a
  GENERIC one the parameter form falls onto a different index with the predicate
  demoted to a Filter. `__tests__/db/reviewAggregates.test.ts` forces
  `plan_cache_mode` to make the two distinguishable at all.
- **`livedForMonths` is derived at ONE chokepoint** (`deriveLivedForMonths`) and
  called by both write paths — the create AND the edit, because the
  `pre('validate')` hook ran on every `save()`. `updateOwnReview` re-reads the
  stored dates `FOR UPDATE` so an edit that moves one side of the tenancy
  recomputes against the other.
- **`livedDurationText` is now computed for EVERY review.** It was a Mongoose
  virtual, and virtuals do not survive `.lean()` — five of the six read paths
  were lean, so it reached the wire from the hierarchical address reads and
  nowhere else. Stated as a behaviour change rather than discovered as one.
- **`populatedAddress` is `serializeAddressRow`**, the single address wire shape,
  where Mongo emitted a bespoke `cityId: { _id, name }` projection nothing else
  in the product produces. `_id` and the `_id: null` that Mongo's `$group` leaked
  into every summary object are gone with the store.
- **`scripts/migrateReviewDepositReturned.ts` is DELETED as spent.** It converted
  a legacy BOOLEAN `depositReturned` into the enum; `reviews_deposit_returned_check`
  cannot store a boolean, the collection is empty, and there is no target left
  for it to run against.

## The billing domain — `billingController`, the half the repository was built for

The repository and `routes/profiles.ts` landed first (#331); this closes the
domain with `controllers/billingController.ts`. The census that scoped it was
verb-agnostic and comment-stripped over `git ls-files`, with the count of files
importing the model barrel as its positive control: scoping to Mongoose verbs
misses custom statics, and counting raw lines counts docblocks as call sites. It
found **39** live `Billing` expressions — 36 in the controller and 3 in
`routes/profiles.ts` — against the "~33" a verb-scoped estimate had produced.
`models/schemas/BillingSchema.ts` is now dead and is left in `models/` with the
rest rather than deleted piecemeal.

### `ensureBilling` needed a SAVEPOINT the moment it got a transactional caller

The most important line in this batch, and it is a fix to code that was already
merged and already green. `ensureBilling` INSERTs and handles `23505` by reading
the row back — correct, and correct only on the ROOT connection, where each
statement is its own implicit transaction. In Postgres a failed statement aborts
the WHOLE transaction, so inside one that recovery read dies with `25P02
current_transaction_is_aborted`.

`creditCheckoutSession` is the caller that made it real: the session claim and
the payment it authorises must commit together, so it opens a transaction and
calls `ensureBilling` inside it. That path runs on **every payment after an
account's first** — the row exists, so the insert always conflicts — which means
without `inSavepoint` the second purchase by any existing subscriber 500s. The
identical lesson `findOrCreateAgencyByName` learned when the review create path
became its first transactional caller, and it is worth stating as a rule: a
repository function that catches a constraint violation and then READS is not
transaction-safe until its write is wrapped, and nothing about it looks wrong
until somebody wraps a transaction around it.

`__tests__/db/billingCheckout.test.ts` asserts the caller's transaction is still
USABLE afterwards, not merely that the function returned — the weaker assertion
passes against the broken version.

### Decisions a later batch must not reverse

- **The session claim and the credit commit TOGETHER.** `creditCheckoutSession`
  is the single entry point for all three callers — the webhook, the confirm
  redirect and the manual-activation fallback — which is what makes "Stripe
  delivered this twice" and "the user pressed the button twice" the same question
  with the same answer. Under Mongo they were three independently written copies
  of one guard, and the confirm redirect races the webhook by design.
- **`deactivateSubscriptionByStripeId` must NOT clear the subscription id**, so
  it is deliberately not `setPlusActive(…, {active: false})`, which does.
  `syncSubscriptionStatus` and `reactivateSubscription` both look the
  subscription up by that id afterwards, so erasing it strands a cancelled
  subscriber with no way back.
- **`recordSubscriptionPayment` carries its `plus_active` scope IN the
  statement.** An invoice paid against a subscription Homiio believes is
  cancelled must not silently revive it, and a preceding read would let the check
  and the write interleave.
- **`listProcessedSessions` is ORDERED.** Without an `ORDER BY` Postgres may
  return the rows however it likes, which turns a cached client response into a
  spurious diff. Pinning it needs a fixture whose PHYSICAL order differs from the
  sorted one — three rows written directly with explicit reversed timestamps —
  because rows credited in sequence are read back in insertion order anyway, so
  the obvious fixture agrees with an unordered read and the check is vacuous.
  (Measured: with the obvious fixture, both an unordered and a `DESC` mutant
  survived.)

### Two Mongoose no-ops fixed rather than ported

Both are the same defect and porting the SPELLING would have carried it across
invisibly — **drizzle omits an `undefined` from a SET clause exactly as Mongoose
strips it from a `$set`**, so the code keeps looking as though it clears a column
while clearing nothing.

`reactivateSubscription` and `syncSubscriptionStatus`'s active branch both wrote
`plusCanceledAt: undefined` meaning "clear the cancellation". They never did, and
`syncSubscriptionStatus`'s own guard reads `|| billing.plusCanceledAt`, so it
then re-fired on every later call and reported `statusChanged: true` forever for
anyone who had cancelled and come back. Both write `null` now, and the test
asserts the SECOND sync reports no change — pinning the defect, not just the fix.

One smaller change is stated rather than discovered:
`manuallyActivateSubscription` validates the product BEFORE claiming the session,
where Mongo checked `processedSessions` first. Exactly one case answers
differently — an invalid product naming an already-spent session, `200 "already
activated"` before and `400` now.

### `processedSessions` stays on the wire

It is a TABLE now and nothing renders the field, but
`packages/frontend/store/subscriptionStore.ts` declares it REQUIRED on
`Entitlements`. Removing it is a two-sided change and this was a port; shipping
the halves separately is the failure `~/Oxy/AGENTS.md` records against Homiio's
own `_id` → `id`.

### Three legacy scripts DELETED as spent, and why they were a footgun

`scripts/migrate-billing-field.js`, `check-subscription-db.js` and
`test-subscription-save.js`, with their `package.json` entries. All three read or
wrote `Profile.billing.*` — an EMBEDDED shape `ProfileSchema` no longer declares,
which the standalone `Billing` collection replaced — so each was doubly spent:
its source field is gone AND its target store is being retired. This file already
named all three once, for the `DATABASE_URL`-fallback correction.

The migration one was not merely dead weight. It WRITES to Mongo, so an operator
running `bun run migrate:billing` after this batch would populate a collection
nothing reads and come away believing billing had been migrated — the "rank a
SWEEP above a read" hazard in its writing form. They could not have run either:
each calls `mongoose.model('Profile')` without requiring a schema, so a plain
`node` invocation raises `MissingSchemaError`.
