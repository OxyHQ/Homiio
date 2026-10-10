# Migration contract — Homiio

Homiio's **deltas only**. The ecosystem-wide rules — what a deploy phase means,
how the ledger works, why the migrator is drizzle-orm's and not drizzle-kit's,
what a `@oxy.so/db` column builder guarantees — live in oxy-api's own
`MIGRATION-CONTRACT.md` and in `@oxy.so/db`'s module docs. Read those first; this
file states only what is different HERE.

Schema-level conventions are in `db/schema/CONVENTIONS.md`. This file is about
the rules a schema change, a migration and the repository code around it must
keep, and the specific places Homiio's code breaks in ways nothing reports.

---

## Rank a SWEEP above a read

A stale read returns zero to a caller who can at least see an empty result. A
stale sweep — `cleanupService`'s retention delete, an expiry job — produces no
output at all: it reaps nothing, and the only symptom is disk, months later, by
which time nobody connects it to the change that broke it. `db/expiry.ts` records
the same hazard from the schema side.

**A query that answers zero for its whole life is worth opening**, because a
selector naming a field nothing stores matches nothing in Postgres just as
reliably as anywhere else, and looks finished. Re-point it at the fact the
product really stores, or delete it, and say which in the PR. Where the stored
fact does not exist at all, the fix is an additive column, registered in
`schema/unmappedColumns.ts`.

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

## Ids are text, and two shapes coexist

Every primary key is `text`. Older rows carry a 24-character hex id; rows created
now get a uuid v7. There is no remapping table and no id translation anywhere,
which is how every foreign key holds by construction: an id never changes, so a
reference to it cannot break.

In the child tables below, older rows carry a uuid v7 MINTED deterministically
from the parent's id, the path and the index — `sha256(parentId|path|index)` for
the random bits and the PARENT's own `created_at` for the timestamp prefix, with
the version and variant nibbles pinned exactly as `@oxy.so/db`'s `uuidv7` pins
them so `isLiveEntityId` still accepts it. Nothing references any of them by
id:

| Target table |
|---|
| `review_reports` |
| `review_helpful_votes` |
| `tenant_application_references` |
| `tenant_application_documents` |
| `eviction_case_attendees` |
| `place_poi_categories` |
| `property_availability_windows` |

**Two tables take an id that is neither shape.** `moderation_outbox.id` is
DETERMINISTIC (`moderation:report.submit:<reportId>`) and `moderation_events.id`
IS the CrowdSource event id. Both are declared with no default, because in both
cases the id is the deduplication mechanism and minting one would delete it.

### Never branch on an id's FORMAT

A guard that tests whether a string looks like a 24-character hex id is `false`
for every uuid v7, so it does not merely reject — a site that BRANCHES on the
answer turns into a silent wrong answer: an exclude list that drops entries, an
id-versus-name switch that looks a city id up as a place name, an enforcement
that reports "the reported listing no longer exists" while it sits there intact.

Where a route genuinely needs to reject malformed input before it reaches a
query, it uses `isLiveEntityId` from `db/ids.ts` and returns **400**. Otherwise
there is no guard at all: a `text` column takes any string, and a lookup for a
nonsense id returns no rows and 404s.

Never use `isLiveEntityId` as a precondition on a query. That re-introduces the
same fail-open bug in a new costume.

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
- **Storage.** The shared `oxy-postgres` instance is also home to `oxy_api` and
  `mention`, and GiST + GIN + tsvector indexes are not small. This is the
  precondition most easily skipped and the only one whose failure is an
  incident for **three** applications.

## Both migration guards are required here

`db/migrate.ts` carries `--target-database=<name>` **and** `--phase=pre|post|all`,
and neither has a default. They catch different mistakes:

- **`--target-database`** answers "am I pointed where I think I am?", checked
  against `current_database()` before any other statement. The migration step
  needs it because it fails SUCCESS-SHAPED: aimed at the wrong database the
  migrator finds an empty ledger, applies the whole journal, logs `Applied N migration(s)` and
  exits 0 — leaving the real database untouched while an operator reads a success
  line.
- **`--phase`** answers "which side of a deployment is this?" Every migration
  `.sql` declares its side on one line and a CI gate refuses a file that does
  not.

`package.json`'s `db:migrate` supplies `--phase=all` because a developer
database, the jest harness and a manual dispatch have no previous image to
protect. A production one-shot task states its phase explicitly.

**`DRY_RUN=true` reports the plan and the `journalEntries` count and writes
nothing** — not the ledger, not the extensions. The count is the thing to read before
a production run: an image built before a migration existed prints `No migrations to
apply`, exits 0, and is otherwise byte-identical to the correct case. Compare it
against `meta/_journal.json` at the pinned SHA and refuse if they differ.

## An empty answer needs a SECOND number, because the control can be the thing that broke

`~/AGENTS.md` already says to ask what a check would report if the thing it
measures were absent, and to give every census a positive control and a vacuity
floor. This is the sharpening that rule does not cover: **in each of the three
cases below the control was sound in principle and useless in practice, because
the instrument returned nothing and "nothing" is what a correct answer looks
like too.** What caught all three was a SECOND number, derived from the same data
by a different route, that had to agree with the first.

Measured on 2026-08-11, all three while verifying migration `0014` and the deploy
work around it:

| the check | what it returned | why it was wrong | what caught it |
|---|---|---|---|
| catalogue diff, production-shaped database vs a fresh one | `IDENTICAL` | an ambiguous `oid` made the query error; **both** dumps were empty and `diff` compared nothing to nothing | a line-count floor: 1,722 rows expected, 0 seen |
| census of docs-only commits on `main` | `0 pairs`, `longest streak 0` | a `split(' ', 2)` put the verdict in the wrong field, so the predicate was always false | the same run also reported **10 docs-only commits**, and a streak of 0 is impossible alongside that |
| control on a comments-only diff | empty, i.e. "the filter cannot see code" | `origin/main` had advanced, so the range no longer touched the file | a commit known to have changed that file must show changes |

The first was a missing floor. The second and third are the ones worth keeping,
because in both **the control itself was the broken part** — a positive control
aimed at the wrong range reports absence exactly like a clean result, and adding
more controls of the same kind does not help.

**So: before believing an empty or zero answer, have an independent expectation
of the answer's MAGNITUDE, and prefer one you can derive from the same run.** A
floor works when you know roughly how big the answer should be. When you do not,
two numbers computed from one dataset by different routes will disagree if either
route is broken — 10 docs-only commits and a zero-length streak cannot both be
true, and that contradiction needs no prior knowledge of the right answer.

The corollary is the one that keeps costing time: **a grep answers the question
you asked, not the question you meant.** The same day, a check for whether a
false claim had been removed from `main` returned a hit — the corrective text
quoting the old wording in order to correct it. Both are the same failure at
different scales: an instrument reporting faithfully about something adjacent to
what was wanted.

Related, and deliberately not repeated here: the fixture rule above (a fixture
has to sit on the side of the distinction the test exists to make) is the same
principle applied to test inputs rather than to measurements.

## Two branches generating a migration off one parent fork the SNAPSHOT chain

**Measured on `main` at `0a9a53f6` (2026-08-11).** `drizzle-kit generate` could
not run at all:

```
Error: [drizzle/meta/0012_snapshot.json, drizzle/meta/0013_snapshot.json] are
pointing to a parent snapshot: … which is a collision.
```

`#356` (watches → 0012) and `#358` (evictions → 0013) were each generated off
0011 and merged back to back. **Nothing recomputes a snapshot**, so
`0013_snapshot.json` kept `prevId = c209c091…` — 0011's id, the same parent 0012
names — and the chain forked. It sat there from the moment #358 merged until
somebody needed a 0014.

### The refused `generate` is the harmless half

A snapshot is a FULL picture of the schema, taken on the tree that generated it.
`0013_snapshot.json` was taken on a tree that never had 0012, so it described 69
tables and was **missing all three of 0012's** (`housing_alerts`,
`housing_domain_events`, `housing_watch_rules`) plus 0012's nine `saved_searches`
columns.

Repair the POINTER and leave the CONTENT, and the next generated migration
re-emits those objects — `CREATE TABLE housing_alerts …` in a 0014. Since the
deploy applies migrations, that is a release that fails at apply time with
"relation already exists", not a confusing local error.

### Nothing that runs today could have caught it

A FRESH database applies every migration in order and never reads a snapshot's
contents. So CI, the per-worker throwaway databases and a developer's local
reset all pass **either way** — the disagreement exists only against a database
that already has the migrations applied, which is production and only
production. It is the same shape as every other trap in this file: green
everywhere the check runs, wrong where it matters.

### The check, and it is cheap

`__tests__/unit/migrationSnapshotChain.test.ts` reads the files and needs no
database. Two assertions, and **both are needed because they catch opposite
halves**:

1. **Every snapshot's `prevId` names its immediate predecessor, and no two share
   a parent.** This is the CAUSE, caught at the moment the second branch merges.
2. **The head snapshot describes exactly the tables the schema barrel declares.**
   This is the CONSEQUENCE, caught independently — a pointer-only repair leaves
   the head still missing the other branch's objects, and that is the half that
   reaches production.

Mutation-tested three ways: reintroducing the real `prevId` (only assertion 1
reds), deleting one table from the head snapshot with the chain left intact (only
assertion 2 reds), and dropping a migration from `_journal.json` (only the
journal assertion reds). A fourth assertion — "every migration declares a deploy
phase" — was WRITTEN AND THEN REMOVED: stripping the marker killed the run, but
through `@oxy.so/db`'s migrator in `globalSetup` rather than through the
assertion, which therefore could never fire. The migrator's check is strictly
stronger because it also runs at apply time in production.

### How to repair one, and how to prove the repair

Do NOT hand-edit the snapshot's contents. Fix `prevId`, then run the generator on
an **unmodified** tree and adopt its output as the repaired snapshot, keeping the
old snapshot's own `id` so nothing downstream sees an identity change.

**Two measurements make a repair verified rather than plausible**, and "generate
works now" is neither:

- **The set difference BOTH ways.** Here: the regenerated snapshot had 72 tables
  against 69, the difference was exactly 0012's three, and the difference in the
  other direction was EMPTY. One direction alone cannot tell a repair from a
  replacement.
- **Apply the chain to a database that ALREADY HAS the previous migration**, not
  only to a fresh one — a fresh run cannot distinguish the two cases, which is
  the whole problem. Bring a probe database to the production state (hide the new
  `.sql` and its journal entry, migrate, seed rows into the affected tables),
  then restore and migrate again: exactly one migration must apply. Verified for
  0014 on 2026-08-11 — `Applying 1 migration(s)`, exit 0, over a seeded
  `addresses` — and the resulting catalogue was **byte-identical to a
  fresh-database build across 1,722 rows** of columns, constraints and index
  definitions. Give that comparison a negative control (add a column to one side
  and confirm the diff sees it): a broken catalogue query returns two empty
  files, and `diff` reports them identical. That happened on the first attempt
  here — an ambiguous `oid` — and only the line-count floor exposed it.

**The cause is structural, not carelessness.** Any two branches that both
generate a migration will do this, and neither author can see it from their own
branch. The check is what makes it visible at merge time.

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
  inside `ci.yml`'s run, whose group also does not cancel on `refs/heads/main`.
  Both halves are pinned by `__tests__/unit/deployRolloutConcurrency.test.ts`.
- **Be precise about what that group guarantees**, because the natural reading is
  wrong: `cancel-in-progress: false` protects a run that has STARTED, and does
  not queue the rest. A run still PENDING in the group is evicted by the next
  push — measured 2026-08-10, runs `31376441022` and `31376457516` were both
  cancelled with ZERO jobs each while `31376855242` proceeded. For the migrator
  that is sufficient and not accidental: a run that never started never ran
  `migrate.js`. What it costs is that an intermediate commit's deploy can be
  dropped, so its migrations wait for the next one — which applies everything
  pending.
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

## Decisions that must not be silently reversed

### `properties`

- **`offerings` equals exactly the set of present priced blocks**, as four
  per-offering CHECKs, so the ingest writer and the user-facing writer cannot
  disagree about it. The POSITIVITY half of `validateOfferings` is deliberately
  NOT expressed — `> 0` is a range constraint over unmeasured data, which
  `CONVENTIONS.md` defers to a `post`-phase migration.
- **`has_images` is kept as a stored column** because it is the primary sort key
  of every discovery feed and a correlated `EXISTS` in an `ORDER BY` is not
  indexable. It pays for that with an obligation: ONE writer (`db/hasImages.ts`),
  never settable from a request body, and a reconciliation check that is
  asserted.
- **Both copies of every duplicated field pair are kept.** `available_from` vs
  `availability_available_from` DISAGREE on real rows and are read by different
  filter paths, so collapsing them changes what a filter matches.
- **`properties.source` has a CHECK derived from the registered-provider union
  plus `internal` and `fixture`**, never from the values production happens to
  hold. `internal` is what every user-created listing carries.
- **`properties.source_url` is NOT `NOT NULL`.** It has exactly one writer
  family (the scraper and `IngestionService`) and is absent from both
  `CREATABLE_PROPERTY_FIELDS` and `EDITABLE_PROPERTY_FIELDS`, so a blanket
  `NOT NULL` turns `POST /api/properties` into a guaranteed `23502`. What the
  product states is the conditional — **external listings must carry a
  `sourceUrl`** — which is `properties_external_source_url_check`. `source_url`
  also takes NO `UNIQUE`: two portal rows can share a search-results URL while
  their `(source, source_id)` stays unique, and that pair is the real key.
- **`accommodation_details_wifi_password` is a PROTECTED COLUMN.** A bare drizzle
  `select()` returns it, so the exclusion is at the TYPE level and a serializer
  reading it fails `tsc`.
- **`moderation_restricted` is `NOT NULL DEFAULT false`**, because it is written
  ONLY by `ModerationEnforcementService` and absent means "no jury has restricted
  this listing". **Do not generalise that to `listing_flags_*`.** Those booleans
  are THREE-state — `true` (the text says students only), `false` (the classifier
  looked and said no), NULL (the classifier never ran) — so a `false` default
  there would manufacture a claim nobody made. They stay nullable.
- **`views` and `title` are declared with no external source** — see
  `schema/unmappedColumns.ts`.

### Constraints derived from the data are biased by who wrote it

Production's catalogue is dominated by external aggregator listings, so any
constraint derived from "what the data holds" encodes the external path and
breaks the internal one the first time a user uses it. `source = 'internal'` and
a NULL `source_url` are both values production barely holds and both are
required. Ask who WRITES a column before reading its distribution.

### References and account columns

- **`properties.agency_id` and `properties.sourced_by_partner_id` are REAL
  foreign keys**, both `SET NULL`.
- **Every column holding an Oxy account id is named for it**
  (`partners.oxy_user_id`, `moderation_reports.reporter_oxy_user_id`,
  `lease_documents.uploaded_by_oxy_user_id`), because a name that hides what the
  column holds hides it from `isOxyAccountColumn` and from `idShapedColumns`.
- **`OXY_ACCOUNT_COLUMN_NAMES` is a MEASURED set**, not a predicted one. A name
  in that allow-list matching nothing is indistinguishable from one matching
  something, which makes the set unreviewable — and it is the only thing
  standing between an account column and shipping unclassified.
- **`leases.room_id` is a foreign key into `properties`.** A room is a Property
  with `type: 'room'` and a `parent_property_id`; there is no rooms table.

### Derived counts are not stored

`count(*)` over `eviction_case_attendees` answers an eviction case's attendee
count, and `count(*)` over `conversation_messages` a conversation's message
count. Neither sorts a feed, so no `ORDER BY` has to survive an aggregate — which
is the one reason `properties.has_images` is kept. A conversation's
`last_activity` and `total_tokens` ARE stored: the first moves on any save, not
only on an append, and the second comes from the provider's response.

## The catalogue read paths

Every geo-scoped property read is ONE join, with the spatial predicate on
`addresses.geo` and the `LIMIT` reaching the planner. Never materialise a list of
address ids in the application and ship it back as a parameter — for a city that
is tens of thousands of ids on a request path.

### Deliberate behaviour, each stated rather than discovered

| Behaviour | Why |
|---|---|
| Free text is `websearch_to_tsquery` (AND), not OR | "apartment barcelona" must not return every apartment anywhere |
| Price sorts are `NULLS LAST` in BOTH directions | "cheapest first" must not lead with unpriced listings |
| An unknown `sortBy` falls back to recency | the alternative is building a column name from user input |
| A bounding box is `ST_MakeEnvelope(…)::geography`, whose edges are great-circle arcs | the cast is what makes an antimeridian box work at all — `db/properties/propertyGeo.ts` records the measurement |

### Pre-existing defects, pinned rather than silently fixed

Each is a test, not a comment, so fixing it is a deliberate change to what an
endpoint returns rather than a side effect of a refactor:

- **`/api/properties/by-ids` and `/api/properties/owner/:id` filter
  `status: 'active'`**, which is not a member of `PropertyStatus` — so both
  return empty pages, and `properties_status_check` would refuse to store the
  value at all.
- **`sortBy=salePrice` is unreachable.** `buildSearchPlan` lower-cases the
  requested sort and tests it against a camelCase set, so `salePrice` becomes
  `saleprice` and falls back to recency. `createdAt` has the same defect and is
  harmless because its fallback IS recency.
- **`list.ts` and `geospatial.ts` disagree about `?available=true`** — the first
  yields "available, not a draft", the second "available, published" — and about
  which price column a bare `minRent` applies to. `controllers/property/commonFilters.ts`
  shares only the clauses that genuinely agree, so the difference stays visible.

### One trap that will recur

**An array interpolated into a drizzle `sql` template renders as a ROW
CONSTRUCTOR, not an array parameter.** `sql` + "`${values}::text[]`" emits
`($1, $2)::text[]`, which Postgres rejects outright — a RUNTIME error that
`tsc` cannot see and that four predicates shipped with (`typeIn`,
`exchangeModeIn`, `hasAnyAmenity` — since removed — and `hasAllAmenities`). `sql.param(values)` binds
the whole array as ONE parameter. It was caught by the real-database suite and
by nothing else, which is the argument for that suite.

## Behaviour the repository layer owns

- **Derivations the DATABASE checks, so a wrong writer fails loudly:**
  `reviews.lived_for_months` (`db/reviews/reviewWrites.deriveLivedForMonths`)
  and `reservations.nights` are COMPUTED by their writer, and the CHECKs beside
  them (`lived_to > lived_from`, `nights >= 1`) refuse a wrong one. A tenant
  application's `decided_at` stamp and a viewing's `cancelled_by` are
  equivalences the database enforces.
- **Idempotency lives in a unique key, never in a read.** Agency
  find-or-create, `ensureBilling`, review votes and reports, the one-review-per-
  author-and-address rule (`reviews_author_address_key`), the eviction RSVP and
  adding a property to a saved folder are each a unique key. The code INSERTs
  and handles `23505` — **inside `inSavepoint` if it can run in a caller's
  transaction** (see below). A read-then-write has a window; a unique key does
  not.
- **Aggregations are SQL** — `db/reviews/reviewAggregates.ts` holds the review
  explore and agency rollups. Every one carries `visibleModeration()`, spelled as
  a LITERAL so the seven partial indexes stay reachable under a generic plan.
- **Values a DTO computes, because no column holds them:** a lease's
  `isFullySigned`, `leaseDuration`, `formattedRent` and `daysUntilExpiration`; a
  conversation's `messageCount` and `lastMessage`; a review's
  `livedDurationText` (`db/reviews/reviewSerializer.livedDurationText`, on EVERY
  review); a saved folder's `propertyCount`.
- **Methods with real logic:** a lease's payment schedule
  (`db/leases/paymentSchedule.ts`), the rent ledger (`db/leases/paymentLedger.ts`)
  and signing (`signLease`); `consumeFileCredit` (one conditional `UPDATE … SET
  file_credits = file_credits - 1 WHERE … AND file_credits > 0`, so
  `billing_file_credits_non_negative_check` is a backstop rather than the guard);
  a conversation's share token (the four `sharing_*` columns move together by
  CHECK).
- **The `conversations.sharing_expires_at` sweep CLEARS those four columns and
  never deletes the row** — `db/expiry.ts`'s
  `EXPIRY_COLUMNS_THAT_MUST_NOT_DELETE`.
- **An `undefined` in a drizzle SET clause is OMITTED, not written.** Code that
  means "clear this column" writes `null`. `plusCanceledAt: undefined` once kept
  `syncSubscriptionStatus` reporting `statusChanged: true` forever for anyone who
  had cancelled and come back; the test asserts the SECOND sync reports no change.

## The moderation pipeline and the eviction board

### Duplicate rules are enforced by the DATABASE, not by the single writer

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

### Guarantees nothing else would catch the loss of

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

## Reviews

- **`reviews_author_address_key`** is NOT partial on
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
  called by both write paths — the create AND the edit. `updateOwnReview`
  re-reads the stored dates `FOR UPDATE` so an edit that moves one side of the
  tenancy recomputes against the other.
- **The street/building hierarchy is resolved by COLUMN VALUES.**
  `resolveAddressHierarchy` projects onto explicit column values and dedupes on
  `normalized_key`, so a unit review's building and street levels are the real
  building and street rows, never the unit's own address — which is what lets
  two flats in one building roll up together in `getBuildingSummaries`.
- **`populatedAddress` is `serializeAddressRow`**, the single address wire shape.

## Billing

### A catch-and-read repository function needs a SAVEPOINT

`ensureBilling` INSERTs and handles `23505` by reading
the row back — correct, and correct only on the ROOT connection, where each
statement is its own implicit transaction. In Postgres a failed statement aborts
the WHOLE transaction, so inside one that recovery read dies with `25P02
current_transaction_is_aborted`.

`creditCheckoutSession` is the caller that made it real: the session claim and
the payment it authorises must commit together, so it opens a transaction and
calls `ensureBilling` inside it. That path runs on **every payment after an
account's first** — the row exists, so the insert always conflicts — which means
without `inSavepoint` the second purchase by any existing subscriber 500s. 
`findOrCreateAgencyByName` has the same shape under the review create path. The
rule: a
repository function that catches a constraint violation and then READS is not
transaction-safe until its write is wrapped, and nothing about it looks wrong
until somebody wraps a transaction around it.

`__tests__/db/billingCheckout.test.ts` asserts the caller's transaction is still
USABLE afterwards, not merely that the function returned — the weaker assertion
passes against the broken version.

### Decisions that must not be reversed

- **The session claim and the credit commit TOGETHER.** `creditCheckoutSession`
  is the single entry point for all three callers — the webhook, the confirm
  redirect and the manual-activation fallback — which is what makes "Stripe
  delivered this twice" and "the user pressed the button twice" the same question
  with the same answer. The confirm redirect races the webhook by design.
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

### `processedSessions` stays on the wire

It is a TABLE and nothing renders the field, but
`packages/frontend/store/subscriptionStore.ts` declares it REQUIRED on
`Entitlements`. Removing it is a two-sided change; shipping the halves
separately is the failure `~/Oxy/AGENTS.md` records against Homiio's own
`_id` → `id`.
