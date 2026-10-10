# Postgres schema conventions — Homiio

Binding for every table. Decision + reason, nothing else. Prime directive: **no
relational link may be lost**. Where a rule here conflicts with it, STOP and
escalate rather than resolving it silently.

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

**Tables: explicit snake_case, plural.** Never a library-derived name — a
`pluralize()` artifact is not a design.

**Plural where the row is a COUNTABLE noun.** Three tables are not, and they
read as themselves rather than being forced: `billing` (a mass noun — one
billing record per account, and `billings` is not a word anybody uses),
`moderation_outbox` (ONE queue; `moderation_outboxes` would suggest several) and
`recently_viewed` (an adjectival name — `recentlyvieweds` is the `pluralize()`
artifact this rule exists to reject).
Three named exceptions, each stated where the table is declared.

**Columns: camelCase in TypeScript, snake_case in SQL**, derived by drizzle. Do
not pass an explicit column name unless the SQL name genuinely differs from the
property.

**A flattened path may not exceed 63 BYTES, and Postgres truncates SILENTLY.**
Flattening keeps the wire path (`longTermRent.monthlyAmount` →
`long_term_rent_monthly_amount`) so a DTO maps to its columns mechanically. That
rule has a hard ceiling: an identifier
longer than 63 bytes is cut with no error and no warning, and two paths that
differ only past byte 63 collide into one column. `profiles` is where it bites —
`personalProfile.settings.roommate.preferences.lifestyle.cleanliness` spells out
to 68 bytes — so that table drops the `personalProfile.` wrapper, which is 1:1
with the row and carries no information. Measure before flattening a path more
than four levels deep; drop the outermost segment that carries no meaning, and
say so in the table's docblock so the serializer gains ONE mapping rule rather
than a table of exceptions.

Several wire fields are ALREADY snake_case (`postal_code`, `building_name`,
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

`text`. Older rows hold a 24-character hex id and new ones a **uuid v7**
(`generatedId()` from `@oxy.so/db`). An id never changes, which is how every
foreign key holds by construction — there is no remapping table, so there is
nothing to get wrong.

**Two tables deviate, and the deviation IS the mechanism.**
`moderation_outbox.id` and `moderation_events.id` are `text().primaryKey()` with
NO default, because their ids are not Homiio's to mint: the outbox id is
DETERMINISTIC (`moderation:report.submit:<reportId>`), so two concurrent
submissions converge on one row instead of delivering the same report twice, and
the event id IS the CrowdSource event id, so the primary key is the webhook
dedupe. Minting a uuid in either place would silently delete the property the
table exists for. No default means a caller who forgets fails on the insert;
`__tests__/db/coherenceChecks.test.ts` asserts both columns really have none.
Deviate here only where an id carries a MEANING a generated one cannot.

**v7 is generated in the application**, not by a database `DEFAULT`: Postgres 17
has no native `uuidv7()`. Rows inserted by raw SQL get no id — a raw insert must
supply one.

`db/ids.ts` carries the other half of this: never branch on an id's FORMAT —
`isLiveEntityId` rejects malformed input with a 400 and is never a precondition
on a query.

## Closed value sets

**`text` + a CHECK constraint. Never a pg `enum` type.**

- `text({ enum: [...] })` gives drizzle the same literal-union TypeScript type an
  enum would, so the enum type buys nothing at compile time.
- Adding a value to a pg enum is easy; **removing or renaming one is not
  possible**. A CHECK is ordinary `DROP CONSTRAINT` / `ADD CONSTRAINT`.
- Declare the values once as a `const` tuple and derive both the column type and
  the CHECK from it (`inList` from `@oxy.so/db`), so they cannot drift.

**Narrowing a closed set over a table with rows needs a `distinct()` audit
first.** The tuples are derived from the CODE, and only the data can confirm that
no stored row holds a value the new CHECK refuses.

## Which rules become constraints, and which do not

This is the line that decides whether a migration applies or dies half way, so
it is drawn explicitly rather than case by case.

| Rule | Postgres | Why |
|---|---|---|
| required on every write | `NOT NULL` | The value is enforced on every save path |
| a default | `NOT NULL DEFAULT <v>` | Every row carries it |
| a closed value set | `text` + CHECK | Subject to the `distinct()` audit above |
| a range the data cannot violate meaningfully | CHECK | e.g. coordinate bounds — see below |
| a FORMAT rule (`^[A-Z]{2}$`, `isEmail`, `isURL`, a hex colour) | **nothing** | A CHECK rejects existing production rows at apply time. Only in a `post`-phase migration AFTER a census measures the real values |
| `min` / `max` / `maxlength` on a table with PRODUCTION ROWS | **nothing yet** | Same class as the row above, same reason |
| `min` / `max`, an ORDERING rule, or a two-column coherence rule on an EMPTY table | CHECK | Nothing to reject, and an application-side check alone cannot enforce it |
| `trim` / `lowercase` | **nothing** | Application behaviour with no Postgres counterpart — re-apply at the CALL SITE. Deliberately not a CHECK, which would reject existing rows and convert a silent normalization into a 500 |

**The line between rows three and four is the one to get right, and it is drawn
on the DATA rather than on the rule.** A constraint on an empty table cannot
reject anything that exists, so the reason for deferring it is simply absent —
and the rules in question are ones the application already believes
(`reservations.check_out > check_in`, a `paid` instalment carrying its payment, a
`cancelled` viewing naming who cancelled).

FORMAT validators stay deferred even on an empty table, and that asymmetry is
deliberate: a range or an ordering is a fact about the domain, while a regex is a
statement about SPELLING that the product changes more often than it thinks
(`countries.code` has no format CHECK, so `eviction_cases.location_country_code`
has none either — the same rule enforced in one place and not the other is worse
than the rule being absent).

> **Trap: a CHECK passes on NULL.** Only an explicit `false` rejects a row, so a
> constraint written `(a is null and b is null) or (b > a)` admits exactly the
> half-a-pair it exists to refuse: with one side set the first branch is `false`,
> the comparison is NULL, and `false or NULL` is NULL. Spell out `is not null` on
> every column in the positive branch. This shipped in the first draft of
> `exchange_requests_offered_window_check` and was caught only because
> `coherenceChecks.test.ts` asserts the REFUSAL as well as the two coherent
> shapes — a test that only inserts valid rows cannot see it.

**The coordinate-range CHECK on `addresses` is the exception that proves the
rule, and it is there because the obvious assumption is false.** `geography` does
NOT validate its input — measured on PostGIS 3.5, not reasoned about:

```
select ST_AsText(ST_MakePoint(0, 100)::geography);
NOTICE:  Coordinate values were coerced into range [-180 -90, 180 90]
POINT(0 80)
```

A NOTICE, and the insert SUCCEEDS. The coercion is not a clamp to the nearest
valid value — latitude 100 becomes **80**, wrapping over the pole — so without
the CHECK a loud rejection becomes a listing silently pinned to a different,
entirely plausible place. It is safe on a populated table because the
application has always enforced the same bound on the way in.

## Timestamps

Always `timestamptz` (`timestamptz()` / `createdAt()` / `updatedAt()` from
`@oxy.so/db`). `timestamp` without a time zone reinterprets the value in the
session's `TimeZone` on every read, silently changing what a stored instant means.

`created_at` / `updated_at` both default to
`date_trunc('milliseconds', now())`, not plain `now()`: `timestamptz` carries
MICROSECONDS and a JS `Date` carries milliseconds, so a value written by `now()`
does not survive the round trip — and any keyset cursor built from that read is
comparing against a value smaller than the row it came from.

**`updated_at` is maintained by the application** (`$onUpdate`). Deliberately
not a trigger: a trigger is invisible in the schema file, and it would fire
during a repair and overwrite the historical value.

> **That last sentence is the trap, not the reassurance it reads as.** Rejecting
> the trigger did not remove the hazard — it moved it from "always" to "unless
> you name the column". `$onUpdate` fires on **every `db.update()` that does not
> set `updated_at` explicitly**, so a repair touching one wrong column restamps
> the row with the repair's clock and destroys exactly the value the trigger
> was rejected for destroying. Any reconcile or one-shot repair must either
> write the row's real `updated_at` explicitly or write the whole row.
>
> Writing the whole row is the more robust of the two defences, because it does
> not depend on remembering. A test that pins it needs a fixture where
> `updated_at` is ALREADY correct and some other column is wrong: with both
> wrong, "write the columns that differ" and "write every column" produce the
> same result and the weaker one passes.

Where a table keeps a SECOND, application-written timestamp beside `updated_at` —
`cities.last_updated` — the two are different facts: one moves on any write, the
other only when the count is recomputed.

## Foreign keys

Every relation gets a real constraint with an **explicitly decided `ON DELETE`**.
`ON UPDATE` is never declared: ids are immutable.

| Relation | Action | Why |
|---|---|---|
| `regions/cities/addresses` → parent geo | RESTRICT | An address whose city vanished is not an address with a missing city, it is silent data loss that takes every property at that address with it. Refusing is the answer; nothing deletes a city today, and anything that ever does must reassign first |
| `addresses.neighborhood_id` | SET NULL | The one genuinely OPTIONAL geo reference — NULL already means "none resolved", so the action introduces no second meaning |
| `regions/cities.cover_image_id` | SET NULL | Deleting an image must not delete a region. NULL already means "no cover" |
| `properties.agency_id`, `properties.sourced_by_partner_id`, `reviews.agency_id`, `eviction_cases.agency_id`, `eviction_cases.cover_image_id`, `saved_items.folder_id`, `roommate_relationships.request_id` | SET NULL | An attribution, not an ownership. NULL already means "none resolved" on every one of them |
| `leases`, `reservations`, `tenant_applications`, `viewing_requests`, `exchange_requests`, `commissions` → `properties` | RESTRICT | A record of a human transaction, not a copy of an advertisement |
| `listing_reports` → `properties` | **CASCADE** | The one exception, and the reason is the expiry sweep — see below |
| child tables → their parent (`lease_*`, `profile_*`, `eviction_case_*`, `conversation_*`, `review_*`, `tenant_application_*`, `saved_property_folder_items`, `place_poi_categories`, `billing_processed_sessions`, `moderation_outbox.report_id`) | CASCADE | A child row has no meaning without its parent |

**The `properties` group is where the delete rules nearly collided, and the
resolution is worth stating because it will recur.** `properties` is
hard-deleted continuously by the expiry sweep, so a RESTRICT from a table that
can reference an EXTERNAL listing would abort a sweep batch — silently, on a
schedule, growing the table the sweep exists to reap. A CASCADE from a table
holding a human transaction would delete a signed lease along with an
advertisement. Both are unacceptable, and the schema escapes because the two sets
are DISJOINT BY CONSTRUCTION rather than by luck: `expires_at` is set only on
`isExternal` listings, which carry no `oxy_user_id` — while every transactional
path requires an
owner (`markPropertyTransacted` refuses a listing the caller does not own, and
external listings have no in-app apply, viewing or booking). So a property that
can carry a lease never carries a deadline. `listing_reports` is the one table
that can reference either, because reporting an external ad is exactly what the
form is for, so it CASCADEs — and the durable trace survives in
`moderation_reports`, whose `reported_id` deliberately carries no foreign key.

**`ON DELETE SET NULL` needs care where NULL already means something.** Every use
above was checked against that test; check it for every new relation.

**An `ON DELETE` may not be decided from the parent alone.** `moderation_outbox`
holds two references and they get opposite answers: `report_id` CASCADEs (a
submission job for a report that no longer exists is work with no subject, and
`moderation_reports` carries no expiry), while `event_id` gets NO constraint at
all — `moderation_events` is under its own expiry sweep with the same retention,
and two independent sweeps have no ordering between them, so CASCADE would let
one delete the other's unprocessed work and RESTRICT would make one fail. That is
the one place in this schema where a foreign key is refused rather than
impossible, and it is recorded in `ID_COLUMNS_WITHOUT_FOREIGN_KEY` with that
reason so it does not read as an oversight.

## Expiry — a sweep, not an index

Postgres deletes nothing on a deadline. The mechanism is `db/expiry.ts` over
`@oxy.so/db/expiry`; a table adds a registry entry rather than its own cleanup
path. **A table added without an entry grows FOREVER — no error, no failing
test, no symptom until disk.** Registering it is only half the job —
`services/cron.ts` has to CALL the sweep, and the registry makes that omission
visible rather than closing it.

The largest entry is `properties.expires_at`, populated on every external
listing: the whole external-listing inventory is reaped by it.

**Check every deadline for INTENT before registering it.**
`conversations.sharing_expires_at` is the deadline of a share LINK, and deleting
the row would delete the whole conversation — messages included — 24 hours after
anybody shares it. That column is named in
`EXPIRY_COLUMNS_THAT_MUST_NOT_DELETE`, and `__tests__/db/expiry.test.ts` fails if
it ever appears in `EXPIRY_SWEEP_TARGETS`. That list is data rather than a
warning in a comment for one specific reason: a later reader who finds a
deadline column missing from the registry closes the gap, and closing it is
exactly the change that would start deleting people's transcripts.
Mutation-tested — adding that entry turns the suite red and names the column.

## Unique constraints

A total rule → `UNIQUE`. A rule over a subset of rows → a partial unique index
(`uniqueIndex().where(...)`).

Postgres treats NULLs as DISTINCT by default, so a plain `UNIQUE` on a nullable
column is already correct — but the partial form is used where the key is
sparse (`addresses.normalized_key`), because it also keeps the index the size of
the real set and states the rule at the constraint.

**A sparse-unique column must be written NULL, never `''`** — an empty string is
a VALUE, so it collides for real, converting a non-problem into a live bug.
`__tests__/db/partialUniques.test.ts` demonstrates both halves against a real
server rather than describing them.

**A partial unique index has to be tested on what it PERMITS, not only on what
it refuses.** A plain unique index passes every "rejects a duplicate"
assertion — the ones that fail are the permits, and those are the rows a total
index eats silently, months later: a re-filed listing report after the first was
dismissed, a roommate request after the first was declined, two people who lived
together, parted, and moved back in. Nine partial unique indexes exist across the
schema and the test names all nine, so a new one is added there deliberately.

**A case-insensitive unique rule is a FUNCTIONAL unique index on
`lower(column)`** (`saved_property_folders`). Postgres has no per-index collation
strength, and a plain `UNIQUE(owner, name)` passes every test that only inserts
differently-spelled names.

## Arrays and objects

- A scalar array only ever read whole → a native `type[]`
  (`addresses.address_lines`). A child table for a set never queried by element
  is over-normalization.
- **An array of IDS → a real junction table, or nothing.** Regions and cities
  carry no image-id array: the junction already exists as
  `images.(entity_type, entity_id)`, so an array would be a denormalized second
  copy of a queryable relation — and one that can disagree with it.
- **A nested object with a KNOWN, closed shape → flattened columns.** An
  image's keys and urls (four fixed variants each) are eight named columns; an
  address's `land_plot` is three. `jsonb` would make
  `urls.medium` — the most-read value in the product — untyped and unindexable.
- **A positional ARRAY whose order carries meaning → named columns.**
  A neighbourhood's `bbox: [west, south, east, north]` is four named columns plus
  an all-or-none CHECK. `[2.1, 41.3, 2.2, 41.4]` and `[41.3, 2.1, 41.4, 2.2]` are
  both valid arrays and only one is Barcelona; `bbox_west = 41.3` is obviously
  wrong to anyone who reads it.
- **`jsonb` is for genuinely shape-less data only.** There are FIVE in the whole
  schema and every one holds data whose shape is not Homiio's to decide:
  `addresses.extras` (whatever a portal sent),
  `notifications.data` (a deep-link payload each notifier writes and each client
  reads the keys it recognises), `saved_searches.filters` (whatever the search UI
  supported the day it was saved — flattening it would make every filter addition
  a migration and every removal a data loss), and
  `moderation_outbox.decision` / `moderation_events.payload` (a decision document
  validated against the published contract when it is READ, so a newer
  CrowdSource does not break an older client). `properties` flattens TWELVE
  nested objects into columns and adds none; `profiles` flattens a 54-column
  object and adds none. Note the moderation pair flattens the KNOWN half of
  its payload (`report_id`, `event_id`, `case_id`) into columns and leaves only
  the opaque half in `jsonb`.
- **An object array read whole is still a CHILD TABLE, not `jsonb`.**
  `place_pois.categories[]` is the case that looks like an exception and is not:
  twelve fixed keys, always all present, read whole with the row. `jsonb` is
  wrong because the shape is CLOSED and known; 36 flattened columns are wrong
  because a new category would be a migration on a cache. The table also buys a
  constraint the array could not express — `UNIQUE(place_poi_id, key)` — which is
  the tiebreaker whenever the other two arguments are close.
- **Flattening an OPTIONAL nested object makes every one of its columns
  NULLABLE**, including the ones that have a default when the block is present.
  Column nullness is the only representation of block ABSENCE, so
  `properties.long_term_rent_currency` is nullable while `properties.rules_pets`
  (a block that is always present) is `NOT NULL DEFAULT false`. That nullability
  is not a compromise — it is what makes the four offering CHECKs on
  `properties` expressible at all.

## Generated columns

Where a value is DERIVED from other columns, the derivation belongs in the
schema — not because it is tidier, but because application code is bypassable
and a `GENERATED ALWAYS ... STORED` column is not. No write path (route, service,
script, `psql`) can produce a row whose derived value disagrees with its
source: an attempt fails with SQLSTATE `428C9`.

Four in total: two on `addresses`, one on `properties`, one on `eviction_cases`:

- **`eviction_cases.location_geo`** — the second and last PostGIS column, and the
  same shape as `addresses.geo` for the same reason. It has its OWN test file
  (`__tests__/db/evictionGeography.test.ts`) rather than a line in
  `postgis.test.ts`, because a shape being right once says nothing about the
  second time somebody writes it — the whole hazard is that
  `ST_MakePoint(latitude, longitude)` compiles, runs, produces a valid point and
  is wrong. Mutation-tested: transposing the arguments turns that file red.
- **`addresses.geo`** — see PostGIS below.
- **`addresses.address_level`** — the whole street → building → unit review
  hierarchy depends on it, and mis-deriving it mis-files a review permanently.
- **`properties.search_vector`** — the full-text index. It covers `description`
  ALONE: `title` carries no data on production rows, and weighting a field with
  no data would index nothing at a cost. Add `setweight` when `title` starts
  carrying data, not before.

**The trap: the expression must be IMMUTABLE, and the obvious spellings are not.**

| Want | Rejected | Use |
|---|---|---|
| a `tsvector` from text | `to_tsvector(x)` — STABLE, reads `default_text_search_config` | `to_tsvector('homiio_simple', x)` with a LITERAL config |
| a point | — | `ST_MakePoint(lon, lat)::geography`, both IMMUTABLE in PostGIS 3.5 |

**A derivation must reproduce the product's truthiness, not a column's shape.**
`address_level` uses `coalesce(floor, '') <> ''`, never `floor is not null`: an
empty-string `floor` means ABSENT. `is not null` would count it as present and
promote a street-level address to UNIT.

## Text search

Full-text search is a `tsvector` GENERATED column plus a GIN index — never
`LIKE '%…%'`, which is not a text index but a table scan wearing one's clothes.

**The configuration is `homiio_simple`, never `'english'`.** Homiio's corpus is
Spanish-first (Idealista, Fotocasa, Habitaclia, …), so ENGLISH stemming would be
a bug rather than a behaviour. `homiio_simple` is `COPY = simple` with the `word` / `hword` /
`hword_part` mappings rewired through `unaccent`, which is what makes a search
for `malaga` find `Málaga`.

It is created by `db/extensions.ts`, not by a migration: **a text-search
configuration is PER DATABASE and does not travel through `template1`**, so
every ephemeral test database needs it created explicitly.

Country / region / city names get NO full-text index — nothing searches them
that way. What those names actually need is a functional btree on `lower(name)` for the
`^name$/i` equality lookups, plus a `pg_trgm` GIN index for the unanchored
typeahead in `cityController` / `neighborhoodController`.

## PostGIS — adopted, and the point is GENERATED

Every radius, viewport and nearby property search runs against an address's
coordinates, so they get a genuine spatial index: a `geography` point with a
GiST index. No `earthdistance`/`cube`
stand-in and no bounding box dressed up as a distance — a wrong "nearby" is worse
than an absent one.

**The column is `GENERATED ALWAYS AS (ST_MakePoint(longitude, latitude)::geography)
STORED`, never written.** That shape is the decision, not the type. A
hand-written geo column and the two coordinate columns are two representations of
one fact, so they can disagree — and a coordinate-ordering mistake is the most
likely thing to get wrong here, because it does not look wrong: a lat/lon swap
yields a plausible point in the wrong hemisphere. NAMED coordinate columns are the
other half of the same fix; a positional `[lng, lat]` pair invites the swap.

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
index**, only plain `latitude` / `longitude`. Nothing queries them spatially — a "cities near me" search resolves through
`addresses`. Adding a point because the columns look like the ones on `addresses`
is exactly the speculative index this document forbids.

## Indexes

Keep the indexes that earn their keep, and derive each from a real call site.

- **No redundant prefix index:** no standalone `country_id` on `regions`,
  `region_id` on `cities` or `city_id` on `neighborhoods` — each is the leading
  prefix of a compound unique index, and a btree serves any leading prefix.
- **Composite over singles:** `cities` has one partial composite
  (`(properties_count desc, name) WHERE is_active`) because every real query
  filters on `is_active` and sorts on the count TOGETHER; two single-column
  indexes answer none of the three call sites completely.

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
| Every registered expiry column has a leading btree; the registry is exactly the four TTLs that mean "delete this row"; and no column in `EXPIRY_COLUMNS_THAT_MUST_NOT_DELETE` is ever registered | `__tests__/db/expiry.test.ts` |
| Every unmapped column names a real property and keeps its declared shape | `__tests__/db/unmappedColumns.test.ts` |
| `eviction_cases.location_geo` is generated, SRID 4326, POINT, built as `(longitude, latitude)`, GiST-indexed, unwritable, and measures a real distance; out-of-range latitude AND longitude both refused | `__tests__/db/evictionGeography.test.ts` |
| Every partial unique index refuses a duplicate **and permits the row it exists to permit**; `''` collides where NULL does not; the case-insensitive folder key is scoped to one person; and the catalogue names all nine partial uniques | `__tests__/db/partialUniques.test.ts` |
| Eleven two-column coherence CHECKs refuse BOTH incoherent shapes and accept both coherent ones; `place_pois` cascades to its categories; the two moderation dedupe tables really have no id default | `__tests__/db/coherenceChecks.test.ts` |
| `leases` uses CLOSED range bounds and `reservations`/`exchange_requests` half-open — asserted at the boundary instant, through the expression read out of `pg_get_indexdef` rather than restated in the test | `__tests__/db/tenancyRanges.test.ts` |

Four of these were mutation-tested when they landed: making
`listing_reports_open_reporter_key` total, dropping `'[]'` from
`leases_term_range_gist` (and adding it to `reservations_stay_range_gist`),
transposing `ST_MakePoint`'s arguments on `eviction_cases`, and registering
`conversations.sharing_expires_at` as a sweep target. Each turns its suite red
and names the offending object. The range file's BEHAVIOURAL half only became
able to do that after the mutation exposed it reading a string written in the
test rather than the index — which is the failure mode `~/Oxy/AGENTS.md` calls a
check that cannot distinguish success from failure, found the only way it can be.

And one gate that is NOT a test, because a test of this shape cannot check
itself: `scripts/mutation-test-property-constraints.mjs`
(`bun run test:constraints:mutate`) breaks each of the ten constraints above in
the migration SQL one at a time and requires the suite to go red AND to NAME the
constraint. It takes a green BASELINE first, restores IN PLACE and verifies the
restore by md5. It found a real hole on its first run — `properties_type_check`
survived, because no test covered it — which is why the vocabulary suite exists.
