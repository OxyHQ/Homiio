# Postgres schema conventions — Homiio

Binding for every table in this migration. Decision + reason, nothing else.
Two prime directives: **no relational link may be lost**, and **no Mongo baggage
travels**. Where they conflict, STOP and escalate rather than resolving it
silently.

Several of these are enforced by tests, not by discipline — see the bottom.

---

## The fact that shapes everything: there is no `users` table

Oxy owns identity. Homiio reaches it over HTTP, so **every `oxy_user_id` and
every `*_oxy_user_id` in this schema is a foreign SERVICE's primary key** and can
carry no foreign key. That is not a gap to close later: a shadow `users` table
would be a cache that can disagree with Oxy, and validating on write would put an
HTTP round trip in front of every insert.

This is the same rule `AGENTS.md` states from the application side — writes
resolve the owner from the session `oxyUserId` and never accept one from the
client — seen from the database.

`deferredForeignKeys.ts` classifies them with ONE predicate
(`isOxyAccountColumn`); every OTHER unconstrained id-shaped column is listed
individually with its own reason. Between those two lists and the real
constraints, every id-shaped column is classified — which is what lets a NEW one
nobody decided about fail the build.

## Naming

**Tables: explicit snake_case, plural.** Never Mongoose's derived collection
name — that is a `pluralize()` artifact, not a design, and nothing reads it.

**Columns: camelCase in TypeScript, snake_case in SQL**, derived by drizzle. Do
not pass an explicit column name unless the SQL name genuinely differs from the
property.

Several Mongo fields are ALREADY snake_case (`postal_code`, `building_name`,
`address_lines`, `land_plot`, `po_box`). Declare them camelCase in TypeScript
anyway (`postalCode`) — drizzle derives the identical SQL name, so the wire
format is unchanged and the TypeScript stays consistent with every other table.

**`db/casing.ts` is the naming authority.** `DATABASE_CASING` is read by
`drizzle()` (what queries reference), by `drizzle.config.ts` (what the DDL
creates), and by `sqlColumnName`. One setting, not three copies.

> **Trap:** `column.name` on a drizzle column is the TypeScript **property** name
> (`postalCode`), never the SQL name (`postal_code`). Using it in hand-written SQL
> throws `column "postalCode" does not exist`; using it in a catalogue query or an
> `endsWith('_id')` filter silently matches nothing and **the check passes
> vacuously**. Always `sqlColumnName(column)`, or interpolate the Column itself
> into `sql` and let drizzle render it.

> **Trap, second guise — the one that costs data, not a crash:** a drizzle column
> interpolated into `sql` renders **bare** when its table is not in that
> statement's `FROM`. In a correlated subquery,
> `where ${addresses.cityId} = ${cities.id}` renders `where "city_id" = "id"` —
> both names then resolve against the SUBQUERY's own table, the predicate compares
> two of its columns to each other, and the query returns `[]` **with no error at
> all**. This shipped in the sibling oxy-api port. Homiio has three live queries
> of exactly this shape: `cities.propertiesCount`, saved-listing counts, and the
> review aggregates. Qualify every correlated reference with `qualified(column)`.

> **Third trap, on the read side:** `db.execute` bypasses drizzle's column
> mappers. A `timestamptz` comes back as a raw STRING and `res.json` ships it as
> happily as a `Date`, changing the wire format with nothing to notice.

**Reserved words are fine.** `images.order` stays `order`; drizzle quotes every
identifier it emits. Hand-written SQL must quote it too.

## Primary keys

`text`, holding the 24-char ObjectId hex verbatim for pre-cutover rows and a
**uuid v7** for new ones (`generatedId()` from `@oxyhq/db`). Ids are preserved
because that is how every foreign key survives the copy by construction — there
is no remapping table, so there is nothing to get wrong.

**v7 is generated in the application**, not by a database `DEFAULT`: Postgres 17
has no native `uuidv7()`. Rows inserted by raw SQL get no id — intended, since
the backfill supplies `_id` verbatim.

`db/ids.ts` carries the other half of this: `isValidObjectId` guards are
**deleted, not widened**, and several Homiio sites BRANCH on the result rather
than merely rejecting.

## Closed value sets

**`text` + a CHECK constraint. Never a pg `enum` type.**

- `text({ enum: [...] })` gives drizzle the same literal-union TypeScript type an
  enum would, so the enum type buys nothing at compile time.
- Adding a value to a pg enum is easy; **removing or renaming one is not
  possible**. A CHECK is ordinary `DROP CONSTRAINT` / `ADD CONSTRAINT`.
- Declare the values once as a `const` tuple and derive both the column type and
  the CHECK from it (`inList` from `@oxyhq/db`), so they cannot drift.

**Mongoose enums were never enforced on an update.** `runValidators` is off for
updates in this package, so the live collections may contain values the schemas
forbid. **A production `distinct()` audit is REQUIRED before the backfill** — the
tuples here are derived from the CODE, and only the data can confirm them. That
audit is Phase 0 of the tracking issue and it BLOCKS the copy.

## Which Mongoose declarations become constraints, and which do not

This is the line that decides whether the backfill runs or dies half way, so it
is drawn explicitly rather than case by case.

| Mongoose | Postgres | Why |
|---|---|---|
| `required: true` | `NOT NULL` | The value was enforced on every save path |
| `default: <v>` | `NOT NULL DEFAULT <v>` | Mongoose applies a default at document CONSTRUCTION and persists it, so the stored BSON already carries it |
| `enum: [...]` | `text` + CHECK | Subject to the `distinct()` audit above |
| a range the data cannot violate meaningfully | CHECK | e.g. coordinate bounds — see below |
| `validate:` on a FORMAT (`^[A-Z]{2}$`) | **nothing yet** | A CHECK rejects existing production rows mid-copy. Deferred to a `post`-phase migration AFTER the census measures the real values |
| `min` / `max` / `maxlength` | **nothing yet** | Same class as the row above, same reason |
| `trim` / `lowercase` | **nothing** | Application behaviour with no Postgres counterpart — re-apply at the CALL SITE. Deliberately not a CHECK, which would reject existing rows and convert a silent normalization into a 500 |

**The coordinate-range CHECK on `addresses` is the exception that proves the
rule, and it is there because the obvious assumption is false.** `geography` does
NOT validate its input — measured on PostGIS 3.5, not reasoned about:

```
select ST_AsText(ST_MakePoint(0, 100)::geography);
NOTICE:  Coordinate values were coerced into range [-180 -90, 180 90]
POINT(0 80)
```

A NOTICE, and the insert SUCCEEDS. The coercion is not a clamp to the nearest
valid value — latitude 100 becomes **80**, wrapping over the pole — so dropping
Mongo's validator without replacing it converts a loud rejection into a listing
silently pinned to a different, entirely plausible place. It is safe to apply
during the backfill precisely because Mongo enforced the same bound on the way
in.

## Timestamps

Always `timestamptz` (`timestamptz()` / `createdAt()` / `updatedAt()` from
`@oxyhq/db`). `timestamp` without a time zone reinterprets the value in the
session's `TimeZone` on every read, silently changing what a Mongo `Date` meant.

`created_at` / `updated_at` both default to
`date_trunc('milliseconds', now())`, not plain `now()`: `timestamptz` carries
MICROSECONDS and a JS `Date` carries milliseconds, so a value written by `now()`
does not survive the round trip — and any keyset cursor built from that read is
comparing against a value smaller than the row it came from. Mongo stores dates
at millisecond precision anyway, so every backfilled row already ends in `000`.

**`updated_at` is maintained by the application** (`$onUpdate`), matching
Mongoose. Deliberately not a trigger: a trigger is invisible in the schema file,
and it would fire during backfill and overwrite the historical value the
migration exists to preserve.

Where Mongo kept a SECOND, application-written timestamp beside
`timestamps: true` — `cities.last_updated` — both are ported. They are two
different facts: one moves on any write, the other only when the count is
recomputed.

## Foreign keys

Every relation gets a real constraint with an **explicitly decided `ON DELETE`**.
`ON UPDATE` is never declared: ids are immutable.

| Relation | Action | Why |
|---|---|---|
| `regions/cities/addresses` → parent geo | RESTRICT | An address whose city vanished is not an address with a missing city, it is silent data loss that takes every property at that address with it. Refusing is the answer; nothing deletes a city today, and anything that ever does must reassign first |
| `addresses.neighborhood_id` | SET NULL | The one genuinely OPTIONAL geo reference — NULL already means "none resolved", so the action introduces no second meaning |
| `regions/cities.cover_image_id` | SET NULL | Deleting an image must not delete a region. NULL already means "no cover" |

**`ON DELETE SET NULL` needs care where NULL already means something.** Both uses
above were checked against that test; check it for every new relation.

## Expiry — the Mongo TTL replacement

Postgres has no TTL index. The mechanism is `db/expiry.ts` over
`@oxyhq/db/expiry`; a table adds a registry entry rather than its own cleanup
path. **A table ported without an entry grows FOREVER — no error, no failing
test, no symptom until disk**, and it is invisible in review because the thing
doing the work was never in Homiio's code to be missed.

No table in migration 0000 had a TTL index. Migration 0001 brings the first
entry and the largest one this migration will produce: `properties.expires_at`
is populated on **100% of production rows**, so the entire external-listing
inventory is under an active scythe today and stops being reaped the moment the
cutover lands. Registering it is only half the port — `services/cron.ts` still
has to CALL the sweep, and the registry makes that omission visible rather than
closing it.

Check every TTL for INTENT before replicating it — `Conversation
.sharing.expiresAt` deletes the whole conversation and must NOT be ported as a
delete.

## Unique constraints

Mongo unique index → `UNIQUE`. Mongo `sparse` / `partialFilterExpression` → a
Postgres partial unique index (`uniqueIndex().where(...)`).

Postgres treats NULLs as DISTINCT by default, so a plain `UNIQUE` on a nullable
column is already correct — but the partial form is kept where Mongo used one
(`addresses.normalized_key`), because it also keeps the index the size of the
real set and states the rule at the constraint.

**A sparse-unique column must be written NULL, never `''`** — an empty string is
a VALUE, so it collides for real, converting a non-problem into a live bug.

## Arrays and objects

- A scalar array only ever read whole → a native `type[]`
  (`addresses.address_lines`). A child table for a set never queried by element
  is over-normalization.
- **An array of IDS → a real junction table, or nothing.** `Region.imageIds[]`
  and `City.imageIds[]` are NOT ported: the junction already exists as
  `images.(entity_type, entity_id)`, so the array was a denormalized second copy
  of a queryable relation — and one that can disagree with it. The backfill
  BLOCKS if any element has no `images` row.
- **A subdocument with a KNOWN, closed shape → flattened columns.**
  `Image.keys` / `Image.urls` (four fixed variants each) become eight named
  columns; `Address.land_plot` becomes three. `jsonb` would make
  `urls.medium` — the most-read value in the product — untyped and unindexable.
- **A positional ARRAY whose order carries meaning → named columns.**
  `Neighborhood.bbox: [west, south, east, north]` becomes four named columns plus
  an all-or-none CHECK. `[2.1, 41.3, 2.2, 41.4]` and `[41.3, 2.1, 41.4, 2.2]` are
  both valid arrays and only one is Barcelona; `bbox_west = 41.3` is obviously
  wrong to anyone who reads it.
- **`jsonb` is for genuinely shape-less data only.** There is exactly one in the
  whole schema: `addresses.extras`, declared `Mixed` in Mongo precisely because
  its shape is whatever a portal sent. Shapelessness is its purpose. `properties`
  flattens TWELVE subdocuments into columns and adds none.
- **Flattening an OPTIONAL subdocument makes every one of its columns NULLABLE**,
  including the ones whose sub-schema declares a default. Column nullness is the
  only representation of block ABSENCE once the block is gone, so
  `properties.long_term_rent_currency` (Mongo default `'EUR'`) is nullable while
  `properties.rules_pets` (Mongo default `false`, on a sub-schema declared
  `default: {}`) is `NOT NULL DEFAULT false`. Which of the two a subdocument is
  was MEASURED against this repository's mongoose, not assumed: `default:
  undefined` never materializes; `default: {}` and a NESTED PATH carrying at
  least one default both do, arrays included. That nullability is not a
  compromise — it is what makes the four offering CHECKs on `properties`
  expressible at all.

## Generated columns

Where Mongoose derived a value in a hook or a METHOD, the derivation belongs in
the schema — not because it is tidier, but because a hook is bypassable and a
`GENERATED ALWAYS ... STORED` column is not. No write path (route, service,
backfill, `psql`) can produce a row whose derived value disagrees with its
source: an attempt fails with SQLSTATE `428C9`.

Three so far, two on `addresses` and one on `properties`:

- **`addresses.geo`** — see PostGIS below.
- **`addresses.address_level`** — was `getAddressLevel()`, a METHOD, which every
  one of this package's 153 `.lean()` reads skips. The whole street → building →
  unit review hierarchy depends on it, and mis-deriving it mis-files a review
  permanently.
- **`properties.search_vector`** — the port of Mongo's text index. It covers
  `description` ALONE: `title` is not declared in `PropertySchema`, so mongoose
  strict mode drops it from every write and it exists on ZERO of the 17,644
  production rows, while Mongo spends 43.51 MiB — 89% of that collection's whole
  index footprint — indexing it. Weighting a field with no data would copy the
  phantom index into Postgres. Add `setweight` when `title` starts carrying
  data, not before.

**The trap: the expression must be IMMUTABLE, and the obvious spellings are not.**

| Want | Rejected | Use |
|---|---|---|
| a `tsvector` from text | `to_tsvector(x)` — STABLE, reads `default_text_search_config` | `to_tsvector('homiio_simple', x)` with a LITERAL config |
| a point | — | `ST_MakePoint(lon, lat)::geography`, both IMMUTABLE in PostGIS 3.5 |

**A ported derivation must reproduce the SOURCE's truthiness, not its shape.**
`address_level` uses `coalesce(floor, '') <> ''`, never `floor is not null`: the
Mongo method tested `if (this.floor || ...)`, so an empty-string `floor` counted
as ABSENT. `is not null` would count it as present and promote a street-level
address to UNIT.

## Text search

A Mongo text index becomes a `tsvector` GENERATED column plus a GIN index — never
`LIKE '%…%'`, which is not a port of a text index but a table scan wearing one's
clothes.

**The configuration is `homiio_simple`, never `'english'`.** Homiio's corpus is
Spanish-first (Idealista, Fotocasa, Habitaclia, …) while Mongo applied ENGLISH
stemming by default, so a faithful port of the config would carry a bug rather
than a behaviour. `homiio_simple` is `COPY = simple` with the `word` / `hword` /
`hword_part` mappings rewired through `unaccent`, which is what makes a search
for `malaga` find `Málaga`.

It is created by `db/extensions.ts`, not by a migration: **a text-search
configuration is PER DATABASE and does not travel through `template1`**, so
every ephemeral test database needs it created explicitly.

The three Mongo `{ name: 'text' }` indexes on Country / Region / City are
**dead** — nothing ever issued a `$text` query against them — and are not ported.
What those names actually need is a functional btree on `lower(name)` for the
`^name$/i` equality lookups, plus a `pg_trgm` GIN index for the unanchored
typeahead in `cityController` / `neighborhoodController`.

## PostGIS — adopted, and the point is GENERATED

`addresses.coordinates` had the `2dsphere` index every `$near` / `$geoWithin` /
`$centerSphere` property search runs against, so it gets the genuine Postgres
equivalent: a `geography` point with a GiST index. No `earthdistance`/`cube`
stand-in and no bounding box dressed up as a distance — a wrong "nearby" is worse
than an absent one.

**The column is `GENERATED ALWAYS AS (ST_MakePoint(longitude, latitude)::geography)
STORED`, never written.** That shape is the decision, not the type. A
hand-written geo column and the two coordinate columns are two representations of
one fact, so they can disagree — and a coordinate-ordering mistake is the most
likely thing to get wrong here, because it does not look wrong: a lat/lon swap
yields a plausible point in the wrong hemisphere. NAMED coordinate columns are the
other half of the same fix; Mongo's `[lng, lat]` was positional.

**Any spatial test must verify ORDERING against an independently checkable
real-world distance.** A test asserting only "a row came back" passes against the
exact bug. `postgis.test.ts` anchors on Barcelona → Madrid (~505 km); the
transposed pair reads 658 km and the assertion goes red. Both figures are
measured against this database, not quoted.

**drizzle-kit cannot emit the `(Point,4326)` typmod** (its `parseType` quotes any
type name outside a hardcoded list, and `geography` is not on it as of drizzle-kit
0.31.10), so the column is declared bare. The typmod would only constrain WRITES,
and there are none; that the stored value really is a Point at SRID 4326 is
asserted against real rows instead.

**`cities` and `neighborhoods` deliberately get NO geography column and NO GiST
index**, only plain `latitude` / `longitude`. Mongo has no `2dsphere` on either
and nothing queries them spatially — a "cities near me" search resolves through
`addresses`. Adding a point because the columns look like the ones on `addresses`
is exactly the speculative index this document forbids.

## Indexes

Port the indexes that earn their keep, drop the ones that do not, add the ones
Mongo needed and lacked.

- **Dropped as redundant:** a standalone `{countryId}` on `regions`, `{regionId}`
  on `cities`, `{cityId}` on `neighborhoods` — each is the leading prefix of a
  compound unique index, and a btree serves any leading prefix. Also `images`'
  two standalone `index: true` declarations.
- **Dropped as dead:** the three `{name: 'text'}` indexes.
- **Merged:** Mongo's `{isActive}` and `{propertiesCount: -1}` on `cities` were
  two single-field indexes that every real query used TOGETHER. One partial
  composite (`(properties_count desc, name) WHERE is_active`) answers all three
  call sites; neither single answered any of them completely. This is the "add
  the index Mongo needed and lacked" case — derived from existing call sites, not
  speculation.

Do not add an index speculatively.

---

## What is enforced by a test

Not by discipline — these fail the build. All of them run against a REAL
Postgres through the application's own pool.

| Convention | Test |
|---|---|
| snake_case tables and columns; every table has a PK; every timestamp is `timestamptz`; no `''` default; no `_id`/`__v`; the three extensions installed | `__tests__/db/schemaInvariants.test.ts` |
| Deferred FK becomes mandatory when its parent lands; every id-shaped column classified; every FK declares an explicit `ON DELETE` | `__tests__/db/foreignKeys.test.ts` |
| `geo` is generated, SRID 4326, POINT, built as `(longitude, latitude)`, GiST-indexed, unwritable, and measures a real distance; `address_level` reproduces the source truthiness; out-of-range coordinates refused | `__tests__/db/postgis.test.ts` |
| `homiio_simple` exists in a FRESHLY CREATED database and matches `malaga` against `Málaga` | `__tests__/db/textSearch.test.ts` |
| Protected-column registry agrees with its reasons, and the type-level exclusion still excludes — including `properties.accommodation_details_wifi_password`, which is UNREACHABLE on the public row TYPE | `__tests__/db/protectedColumns.test.ts` |
| `offerings` equals exactly the set of present priced blocks, in BOTH directions, each violation naming its own offering | `__tests__/db/propertyOfferings.test.ts` |
| At most one `is_primary` photo per listing, on INSERT and on UPDATE; `image_id` is mandatory; a property delete CASCADES and an image delete is REFUSED; `has_images` derives, detects its own drift and repairs it | `__tests__/db/propertyImages.test.ts` |
| The five portal-writable vocabularies (`type`, `status`, `furnished_status`, `*_currency`, `source`) refuse an undeclared value and accept the declared-but-never-observed ones; `amenities` stays unconstrained | `__tests__/db/propertyVocabularies.test.ts` |
| The calendar's `tstzrange` GiST index serves an overlap query — asserted on the PLAN and on the exact result set — with `[)` bounds so adjacent windows do not collide | `__tests__/db/propertyCalendar.test.ts` |
| `search_vector` matches through `unaccent` in both directions, covers `description` and not `title`, and cannot be written on INSERT or UPDATE | `__tests__/db/propertySearch.test.ts` |
| Every registered expiry column has a leading btree, and the registry is not empty | `__tests__/db/expiry.test.ts` |
| Every unmapped column names a real property and keeps its declared shape | `__tests__/db/unmappedColumns.test.ts` |

And one gate that is NOT a test, because a test of this shape cannot check
itself: `scripts/mutation-test-property-constraints.mjs`
(`bun run test:constraints:mutate`) breaks each of the ten constraints above in
the migration SQL one at a time and requires the suite to go red AND to NAME the
constraint. It takes a green BASELINE first, restores IN PLACE and verifies the
restore by md5. It found a real hole on its first run — `properties_type_check`
survived, because no test covered it — which is why the vocabulary suite exists.
