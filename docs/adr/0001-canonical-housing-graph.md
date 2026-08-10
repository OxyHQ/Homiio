# ADR 0001 — The canonical housing graph: street, building, unit and listing

- **Status:** Proposed
- **Date:** 2026-08-10
- **Issue:** [#345](https://github.com/OxyHQ/Homiio/issues/345) · **Epic:** [#344](https://github.com/OxyHQ/Homiio/issues/344)
- **Supersedes:** nothing. This is the first ADR in the repository.
- **Related, landing separately:** `0002-location-and-search-contract.md` (#346),
  `0003-privacy-verification-publication.md` (#347),
  `0004-local-explainable-pricing.md` (#348). Where this ADR defers a decision to
  one of those, it says so by number; a forward reference to a file that has not
  merged yet is expected.

---

## 0. The one-sentence decision

**A listing is not the identity of a dwelling.** The permanent identity of a
place is a row in `addresses` at a declared level (`STREET` / `BUILDING` /
`UNIT`); a listing (`properties`) is a temporary, sourced advertisement that
*points at* a place, may exist several times over for one place, may disappear,
and may come back. Every domain in Homiio references one, the other, or both —
explicitly, and this ADR fixes which.

---

## 1. Context

### 1.1 The store, re-derived in this checkout rather than remembered

Every claim below was re-measured on branch `adr/345-housing-graph`, base
`c4d73a43`, on 2026-08-10. Do not carry any of it to a sibling Oxy repo without
re-deriving it there.

PostgreSQL + PostGIS is the only store. The Mongo→Postgres migration is
finished:

```bash
$ git grep -n "from 'mongoose'\|require('mongoose')\|from \"mongoose\"" -- 'packages/**'
packages/backend/__tests__/integration/reviewSystem.test.ts:710:    expect(source).not.toMatch(/from 'mongoose'/);
packages/backend/__tests__/unit/mongoUnreachable.test.ts:59: ...
packages/backend/scripts/test-telegram-topics.js:7:// const mongoose = require('mongoose');
```

Every hit is a reintroduction gate or a commented-out line; there is no live
import. `packages/backend/models/` and `packages/backend/database/` do not
exist. No `package.json` in the repository names a mongo package
(`git grep -n 'mongo' -- 'packages/*/package.json' 'package.json'` exits 1).

The infrastructure agrees. Read live, 2026-08-10:

```bash
$ aws ecs describe-task-definition --task-definition oxy-homiio-worker \
    --profile oxy --region us-west-2 \
    --query 'taskDefinition.containerDefinitions[0].secrets[].name'
["REDIS_URL","AWS_ACCESS_KEY_ID","AWS_SECRET_ACCESS_KEY","LISTING_RESIDENTIAL_PROXY_URL","DATABASE_URL"]
```

`DATABASE_URL` and no `MONGODB_URI`.

The schema is 61 tables:

```bash
$ grep -rhn "= pgTable(" packages/backend/db/schema/*.ts | wc -l
61
```

**One caution for anyone reading the files this ADR cites.**
`packages/backend/services/addressService.ts` still carries a header section
titled *"`models/Address.ts` and `geoResolutionService.ts` are deliberately still
alive"*, and line 324 says *"ingest is still Mongo (batch 3)"*. Both statements
are now false — `models/Address.ts` does not exist and ingest writes Postgres —
and they are the exact failure mode `~/Oxy/AGENTS.md` records: a comment
asserting live behaviour that has been removed, which nothing recomputes. The
same drift exists in the repository's own `AGENTS.md`, whose "Data storage"
section correctly says the migration is finished and whose bullet list still says
"Still Mongoose, around three dozen backend files". Fixing both is
[#349](https://github.com/OxyHQ/Homiio/issues/349); this ADR does not touch those
files, and every claim it makes was re-derived from code and from a running
database rather than from a comment.

### 1.2 What already exists, and is good

Three things are already right and this ADR builds on them rather than
replacing them:

- **Administrative geo is relational, not free text.** `addresses` references
  `countries` / `regions` / `cities` / `neighborhoods` by id. The only
  denormalized geo field is `country_code`
  (`packages/backend/db/schema/addresses.ts:45-64`).
- **`addresses.address_level` is a `GENERATED ALWAYS … STORED` column**, not a
  method, so a lean read and a hydrated read cannot disagree about what level an
  address is (`addresses.ts:156-164`).
- **`reviews` already carries the rollup keys** `street_level_id`,
  `building_level_id`, `unit_level_id`, plus a CHECK tying `unit_level_id` to
  `address_level = 'UNIT'` (`reviews.ts:211-222`, `396-399`).

### 1.3 What is broken, measured

The identity key and the level derivation **read different fields**, and the
consequences are not theoretical. `computeAddressNormalizedKey`
(`packages/backend/services/addressService.ts:387-400`) hashes:

```
street | number | unit | building_name | block | postal_code | city_id | country_code
```

`address_level` (`addresses.ts:156-164`) derives from:

```
UNIT     when floor, unit or subunit is non-empty
BUILDING when number, building_name, block or entrance is non-empty
STREET   otherwise
```

`floor`, `entrance` and `subunit` decide the LEVEL and are absent from the KEY.
Running the real function over discriminating fixtures (script:
`scratchpad/adr-345/keyprobe.ts`, importing `computeAddressNormalizedKey`
directly from this worktree):

```
686cfe48…  <- building 42 (no unit)
686cfe48…  <- flat 42, 3r  (floor only)
686cfe48…  <- flat 42, 4t  (floor only)
b4f268f7…  <- flat 42, unit 1a
6ac25df9…  <- flat 42, unit 2a
b4f268f7…  <- flat 42, unit 1A (uppercase)
b4f268f7…  <- flat 42 unit 1a, entrance B
ac48f8f7…  <- bldg "Torre Mapfre"
1621fcbd…  <- bldg "Torre  Mapfre" (two spaces)
ac48f8f7…  <- bldg "torre mapfre" (lowercase)
ac48f8f7…  <- bldg "Torre Mapfre " (trailing space)
8f70d5c9…  <- rural: street only, no number
8f70d5c9…  <- rural: same street, other house

distinct keys: 7 / 14 fixtures; colliding groups: 4
positive control (42 vs 43 differ): true
```

The positive control is there because a hash function that returned a constant
would produce a more alarming version of the same output and read as a finding.

Then end to end, against a **real, freshly migrated PostGIS 17 / PostGIS 3.5
database** (`docker-compose.postgres.yml`, 10 migrations applied by the real
`db/migrate.ts`), calling the real `findOrCreateCanonicalAddress` and
`resolveAddressHierarchy` (script: `scratchpad/adr-345/e2e.ts`):

```
floor 3r                 ROW-A level=UNIT     floor=3r unit=- ent=-
floor 4t                 ROW-A level=UNIT     floor=3r unit=- ent=-
no floor (the building)  ROW-A level=UNIT     floor=3r unit=- ent=-
unit 1a                  ROW-B level=UNIT     floor=-  unit=1a ent=-
unit 2a                  ROW-C level=UNIT     floor=-  unit=2a ent=-
entrance B               ROW-A level=UNIT     floor=3r unit=- ent=-

distinct ids: 3 of 6
3r and 4t are the SAME row: true
the building and 3r are the SAME row: true
entrance B and the building are the SAME row: true
unit 1a and unit 2a are DISTINCT rows: true   <- positive control

hierarchy of the floor-only flat: street=ROW-D building=ROW-A unit=ROW-A
buildingLevelId === the flat itself: true
hierarchy of unit 1a:             street=ROW-D building=ROW-A unit=ROW-B
unit 1a rolls up to the shared building row: true
```

**ROW-A is simultaneously the building, flat 3r, flat 4t and entrance B, stored
at `address_level = 'UNIT'` with `floor = '3r'`.** So:

- Two households on two floors of one building share one identity row, and the
  second one's reviews are published under the first one's floor label.
- `loadHierarchy` (`controllers/reviewController.ts:237-270`) dispatches on
  `address_level`, so the *building* page for Carrer de Provença 42 renders the
  **unit** view of flat 3r.
- `reviews_author_address_key` (`oxyUserId, addressId`) means one person who
  lived in 3r and later in 4t of the same block can file exactly one review.

**And the identity is order-dependent.** Same six inputs, building written
first (`scratchpad/adr-345/order.ts`, its own fresh database):

```
building-first: level=BUILDING floor=-
  3r resolved to the same row: true  (level now BUILDING)
  4t resolved to the same row: true

VERDICT: with the building written first the shared row is BUILDING;
         with a floor-only flat written first it is UNIT.
```

The level of a place — which decides which page renders, which aggregate counts
it, and what a review is attached to — depends on which advertisement Homiio
happened to ingest first. That is the defect this ADR exists to close.

Three further measurements from the same real database
(`scratchpad/adr-345/probe2.sql`):

- Two `addresses` rows with `normalized_key IS NULL` coexist; a duplicate
  non-null key is refused with `addresses_normalized_key_key` (both directions
  confirmed, so the partial unique index does what its comment says).
- `cities_region_name_key` is **case-sensitive**: `Barcelona` and `barcelona`
  both stored, 2 rows.
- Two cities named `Valencia` under two different regions coexist correctly; two
  under the *same* region are refused. But `addressService.ts:81` falls back to a
  literal region named `Unknown` when a geocode yields no state — measured: two
  genuinely different `Santiago`s both resolve into that one bucket and collapse
  to a single city row.

### 1.4 One-dwelling-on-three-portals, today

`services/ingestion/dedupeFingerprint.ts` is a careful, conservative
cross-portal fingerprint whose header records real measurements against ~5.6k
live external listings — including that **coordinates are useless for dedup,
because habitaclia/fotocasa geocode 94–100% of listings to the city centroid.**
It is wired into `IngestionService.findDuplicate`, and when it fires the incoming
listing is **skipped** — the second portal's advertisement is discarded, not
recorded (`IngestionService.ts:164-183`).

It is also off. `this.dedupeEnabled = options.dedupeEnabled ?? process.env.LISTING_DEDUP_ENABLED === 'true'`,
and `LISTING_DEDUP_ENABLED` is absent from the live worker task definition
(measured 2026-08-10, query above returned `[]`). So production today produces
**three separate listings and three separate histories** for one dwelling.

### 1.5 Privacy, today

`serializeAddressRow` (`db/addresses/addressSerializer.ts:121-167`) is the single
address wire shape, used by the address endpoints, the property read path and the
review serializer. It emits `number`, `floor`, `unit`, `subunit`, `entrance`,
exact `coordinates` **and `normalizedKey`** — the internal dedup hash — on every
public response.

`properties.show_address_number` exists (`properties.ts:539`, default `true`).
Its only enforcement site in the whole repository is the moderation subject
label:

```bash
$ git grep -n "showAddressNumber\|show_address_number" -- packages | grep -v drizzle/
… services/moderation/subjects/propertySubject.ts:144:  property.showAddressNumber && number ? `${street} ${number}` : street,
… db/properties/propertySerializer.ts:274:    showAddressNumber: row.showAddressNumber,
```

The property serializer *publishes the flag* and then publishes the number
anyway, because the number comes from `serializeAddressRow`, which never sees the
flag. Detail in `0003-privacy-verification-publication.md` (#347); the structural
half is decided here.

---

## 2. Decision

### 2.1 The invariants

1. **A listing is not the permanent identity of a dwelling.** `properties` is the
   *Listing* table. It is temporary, sourced, and may be many-per-place and
   zero-per-place.
2. **The permanent identity of a place is an `addresses` row at a declared
   level.** Street, building and unit are three levels of *one* table, not three
   tables.
3. **The `addresses` hierarchy EVOLVES; no second hierarchy is created.** §7
   justifies this against the alternative, as the issue requires.
4. **Identity is what the key hashes. Everything else is a correctable
   attribute.** A field that discriminates a level must be in the key or must not
   decide the level.
5. **Internal precision may exceed public precision.** Precision is a property of
   the *serializer*, never of the row: a row is stored as precisely as it is
   known.
6. **Geographic reference data is referenced by id, never copied as text.** The
   one sanctioned denormalization is `addresses.country_code`; no new one is
   added.
7. **A duplicate is recorded, never discarded.** Merging is reversible; deleting
   is not.
8. **No public URL exposes a key, a hash, a coordinate or free text.** A public
   URL carries an opaque entity id (or a slug, for agencies).

### 2.2 The entity table

Visibility legend: **Public** = readable unauthenticated; **Scoped** = readable
by named participants; **Internal** = never leaves the server.

| Entity | Table | Means | Responsible for | Visibility | Natural key | Stable public URL |
|---|---|---|---|---|---|---|
| Country | `countries` | A sovereign jurisdiction | Currency and locale defaults, the root of the geo chain | Public | `code` (ISO-3166-1 alpha-2, upper) | no (reached through city) |
| Region | `regions` | A first-level subdivision | Disambiguating homonymous cities | Public | `(country_id, name)` | no |
| City | `cities` | A municipality | The unit of search scope and of local price methodology (#348) | Public | `(region_id, name)` **→ must become `(region_id, lower(name))`, §5.2** | `/cities/:id` (exists) |
| Neighborhood | `neighborhoods` | A named area inside a city | Area aggregates, coarse publication of sensitive events | Public | `(city_id, name)` → `(city_id, lower(name))` | `/reviews/neighborhood/:id` (exists) |
| Street | `addresses` @ `STREET` | A named way inside a city | The coarsest reviewable place; the roll-up ceiling | Public | `identity_key` over `(street, postal_code, city_id, country_code)` | **new** `/places/:addressId` |
| Building | `addresses` @ `BUILDING` | One postal building or block entrance | The primary permanent housing identity; the default review target | Public | `identity_key` adding `number, building_name, block, entrance` | **new** `/places/:addressId` |
| Unit | `addresses` @ `UNIT` | One dwelling inside a building | The finest identity Homiio stores; occupancy, unit reviews | Public **at building precision by default** (§6) | `identity_key` adding `floor, unit, subunit` | `/places/:addressId`, published at the precision §6 allows |
| AddressCandidate | **new** `address_candidates` | What somebody typed or a geocoder returned, before materialization | Keeping free text out of identity | Internal (the submitter may see their own) | `(submitted_by, raw_text_hash, created_at)` — deliberately NOT deduped globally | none |
| Listing | `properties` | A temporary advertisement of a place | Price, availability, media, provenance, CTA | Public | `(source, source_id)` where `source_id is not null` (exists) | `/properties/:id`, explicitly impermanent |
| ListingSnapshot | **new** `listing_snapshots` | The observed state of a listing at one instant | Price/condition/provenance history (#367) | Public, aggregated | `(listing_id, observed_at)` | none (rendered inside the place page) |
| ListingGroup | **new** `listing_groups` + `properties.listing_group_id` | "These advertisements are the same dwelling" | Not counting one offer three times (#368) | Public, as a single card | surrogate; membership is the fact | none |
| Agency | `agencies` | A managing company | Management history and agency-level reviews | Public | `normalized_name`; `slug` is the public handle | `/agencies/:slug` (exists) |
| Occupancy | **new** `occupancies` | A private claim that a person lived/stayed at a UNIT over an interval | Review eligibility and verification evidence (#364) | **Internal**; the *derived boolean* `verified` is public | `(oxy_user_id, address_id, lived_from)` | none, ever |
| Review | `reviews` | One resident's account of one place | The trust layer | Public (unless `removed`) | `(oxy_user_id, address_id)` (exists) | `/reviews/:id` (exists) |
| EvictionCase | `eviction_cases` | A public notice that an eviction is scheduled | Solidarity turnout | Public at **declared precision** | surrogate | `/evictions/:id` (exists) |
| Lease | `leases` | A contract between named parties | Money, signatures, obligations | Scoped (landlord + tenant) | surrogate | none |
| Reservation | `reservations` | A short-stay booking | Dates, payment | Scoped | surrogate | none |
| ExchangeRequest | `exchange_requests` | A swap/host proposal between two listings | Reciprocity | Scoped | surrogate | none |

Two entries above are new **tables**; the rest are new *meanings* for rows that
already exist, which is the point.

### 2.3 Which domain references what

Measured — every foreign key into `properties` / `addresses` / `agencies` in the
schema today (`grep -rn "references(() => properties.id\|…addresses.id\|…agencies.id" db/schema/*.ts`):

| Domain | Column today | References today | **References after this ADR** |
|---|---|---|---|
| Listing | `properties.address_id` | `addresses` | `addresses` (BUILDING or UNIT) — unchanged, plus `listing_group_id` |
| Room listing | `properties.parent_property_id` | `properties` (self) | **`addresses`**: a room is a place inside a UNIT. §4.3 |
| Review | `reviews.address_id` + three level ids | `addresses` ×4 | unchanged |
| Lease | `leases.property_id`, `leases.room_id` | `properties` ×2 | `properties` **and** a resolved `address_id`, §4.6 |
| Application | `tenant_applications.property_id` | `properties` | `properties` — an application is *about an advertisement* |
| Viewing | `viewing_requests.property_id` | `properties` | `properties` |
| Reservation | `reservations.property_id` | `properties` | `properties` |
| Exchange | `exchange_requests.property_id`, `offered_property_id` | `properties` ×2 | `properties` |
| Saved | `saved_items.target_id`, `saved_property_folder_items.property_id`, `recently_viewed.property_id` | `properties` ×3 | `properties`, plus an optional place save, §4.7 |
| Commission | `commissions.property_id` | `properties` | `properties` |
| Listing report | `listing_reports.property_id` | `properties` | `properties` |
| Eviction | *(none)* — own `location_*` columns | — | **optionally** `address_id`, stored precisely, published coarsely, §6.3 |
| Occupancy | *(does not exist)* | — | `addresses` @ UNIT |

The rule that produces this table, and which any new domain must apply:

> **If the fact would still be true after the advertisement is taken down, it
> belongs to the place. If it is a fact about the offer, it belongs to the
> listing.**

A review of a flat survives the ad; a viewing request does not.

---

## 3. Identity and natural keys

### 3.1 The identity fields, per level

| Level | Identity fields (hashed) | Correctable attributes (not hashed) |
|---|---|---|
| STREET | `street`, `postal_code`, `city_id`, `country_code` | `district`, coordinates, `neighborhood_id` |
| BUILDING | the above **+** `number`, `building_name`, `block`, `entrance` | `address_lines`, `po_box`, `reference`, `land_plot_*`, `extras`, coordinates |
| UNIT | the above **+** `floor`, `unit`, `subunit` | everything above |

Plus, in every level's hash, the level itself — so a BUILDING and the UNIT that
happens to carry no distinguishing sub-field are two keys, not one.

Normalization applied before hashing (and this is a change, see §5.2):
lowercase, trim, **collapse internal whitespace**, strip diacritics. The
measurement above shows the current function already lowercases and trims but
does **not** collapse internal whitespace, which is why `Torre  Mapfre` and
`Torre Mapfre` are two buildings today.

### 3.2 What may be missing without creating a duplicate

- **A building with no number** (rural, `diseminado`, a named finca): identity is
  `street + postal_code + city_id`, plus `building_name` when the portal gave
  one. Two different houses on one rural road with no number and no name are
  **not distinguishable and must not be pretended to be**: they resolve to one
  STREET-level row, and a listing at that row is published as "on this road",
  never as a building. Measured today: they already collide
  (`8f70d5c9…` twice in §1.3) — the change is that they will be honestly
  *labelled* STREET rather than silently treated as a building.
- **A unit with no floor and no door**: it is a UNIT with a NULL discriminator,
  which under `NULLS DISTINCT` would let unlimited such rows exist. Decision:
  a UNIT-level row **must** carry at least one of `floor` / `unit` / `subunit`
  non-empty, enforced by CHECK. An advertisement that names none of them attaches
  to the BUILDING, which is the truthful answer.
- **A postcode**: `''` is written today when a portal supplies none
  (`addressService.ts:482`), and ingest substitutes the literal `'00000'`
  (`IngestionService.ts:66`). Both are *values* and both enter the key. Decision:
  a missing postcode is `NULL`, and `NULL` in the key hash is the empty
  contribution — so a later corrected postcode changes the key, which is a
  **merge** (§8), not a silent second row.
- **A neighborhood**: genuinely optional, already `NULL`-able with
  `ON DELETE SET NULL`, and never part of identity.

### 3.3 A complex with several buildings under one postal address

`entrance` and `block` join the key at BUILDING level, which is exactly this
case: `Carrer X 42, Esc. A` and `Carrer X 42, Esc. B` become two BUILDING rows
under one STREET row. Where a development has genuinely distinct buildings that
share a number and have no letter, `building_name` carries the developer's block
name. If none of the three exists, they are one building — and, again, that is
the truthful answer rather than an invented one.

### 3.4 External provider identifiers

- **On the LISTING**, unchanged: `properties.source` + `source_id` (unique,
  partial on `source_id is not null`) + `source_url`. Census 2026-08-06 recorded
  17,644 distinct `source_id` over 17,644 rows.
  `source_url` is deliberately not unique — two habitaclia rows share a
  search-results URL from a parser fallback (`properties.ts:404-411`).
- **On the PLACE**, new: `address_external_refs (address_id, source, external_id,
  first_seen_at, last_seen_at)`, unique on `(source, external_id)`. Portals that
  expose a stable *building* id (rather than an ad id) are how cross-portal place
  matching gets a hard signal instead of a fuzzy one. Populate opportunistically;
  never invent.

### 3.5 Cadastral and other official references

`land_plot_block` / `land_plot_lot` / `land_plot_parcel` exist on `addresses`
today. Decision: **official identifiers are attributes, never identity.** A
cadastral reference can be wrong, can change on a subdivision, and one building
can carry several. Move them to `address_official_refs (address_id, scheme,
value, jurisdiction, observed_at, source)`, and leave the three existing columns
in place until #370 populates the new table (§9, phase 3). Nothing in the key
hash ever reads them.

### 3.6 Which entity gets a stable public URL

New: `/places/:addressId`, serving STREET, BUILDING and UNIT — one route, the
level decided by the row, which is what makes the building page stop depending on
ingest order. `/properties/:id` stays and is **explicitly impermanent**: when a
listing expires it redirects to its place.

`:addressId` is an opaque id. Ids in this schema are dual-shaped, permanently: a
24-character ObjectId hex for rows that predate the cutover and a uuid v7 for
rows created after it (`packages/backend/db/ids.ts:1-10`). Neither encodes a
location. Note for #362 and for anything that sorts: **uuid v7 is not monotonic
within a millisecond in `@oxyhq/db`**, so id order is not creation order.

---

## 4. Hierarchy and aggregation

### 4.1 The shape

```
country → region → city → neighborhood?          (administrative, referenced by id)
                     ↓
                  STREET  → BUILDING → UNIT      (addresses.parent_address_id)
                                ↑         ↑
                             listings   listings, reviews, occupancies
```

`addresses` gains `parent_address_id` (self-reference, `ON DELETE RESTRICT`,
NULL only for a STREET row). It is the materialization of the projection
`resolveAddressHierarchy` computes today — stored once instead of recomputed per
review, and readable by every other domain, not just reviews.

`reviews.street_level_id` / `building_level_id` / `unit_level_id` **stay**. They
are not redundant with `parent_address_id`: they are the GROUP BY keys of seven
aggregations (`db/reviews/reviewAggregates.ts`), and replacing them with a
recursive walk would put a CTE inside a `GROUP BY`. They become *derived from*
`parent_address_id` at write time rather than from an ad-hoc projection.

### 4.2 Review hierarchy — write, read, aggregate

**Write.** A review is attached at `BUILDING` or `UNIT` only — never `STREET`
(`REVIEW_ADDRESS_LEVELS`, `reviews.ts:75`). The level and the three level ids are
resolved **server-side** from the address row and are **immutable** after insert:
a correction to the place (§8) may move a review to another address, but no
request body may set a level id. Today's CHECK
(`(address_level = 'UNIT') = (unit_level_id is not null)`) stays; add the mirror
that `building_level_id` must name a row whose level is `BUILDING`, which is the
constraint the order-dependence bug in §1.3 violates.

**Read.** The level of the address decides the view
(`controllers/reviewController.ts:237-270`):

| Address level | Shows |
|---|---|
| UNIT | this unit's reviews + a summary of the building's own BUILDING-level reviews |
| BUILDING | the building's own reviews **and** the units' reviews, separately, plus a combined aggregate |
| STREET | per-building summaries + a street aggregate + a distinct-building count |

**Aggregate.** Rolling up is by the stored level id, always filtered
`moderation_status <> 'removed'`:

| Aggregate | Predicate today | Verdict |
|---|---|---|
| unit stats | `unit_level_id = ?` | keep |
| building "own" stats | `building_level_id = ? AND address_level = 'BUILDING'` | keep — this is why it differs from the combined figure |
| building combined | `building_level_id = ?` (both levels) | keep |
| street | `street_level_id = ?` | keep |
| buildings on a street | `count(distinct building_level_id)` | keep |
| neighborhood / city | join through `addresses` | keep |

**One rule the current code does not state and this ADR adds:** a review must
never be counted twice in one number. With `building_level_id = address_id` (the
collapsed case measured in §1.3) a UNIT review of ROW-A is simultaneously "the
building's own review" and "a unit review in that building". The `building_level_id → BUILDING`
CHECK above makes that unrepresentable.

**Aggregate publication floor.** No aggregate is published from fewer than **3**
contributing reviews at UNIT level; below that it rolls up to the building. This
is a privacy rule with a hierarchy consequence, so it is stated here and detailed
in #347.

### 4.3 Rooms

`properties.parent_property_id` is the schema's only self-reference and was
measured **absent on all 17,644 production rows** — there is not one room in
production (`properties.ts:846-857`). That is what makes changing it cheap.

Decision: a room is a **place inside a UNIT**, not a listing inside a listing.
A room listing's `address_id` names a UNIT-level address; the room itself, when
it needs identity (a review of a room, a roommate relationship), is an
`addresses` row at UNIT level with `subunit` carrying the room label and
`parent_address_id` naming the flat. `parent_property_id` is retired once
`leases.room_id` is re-pointed (§9, phase 3).

### 4.4 Several units in one building

The ordinary case, and the one the key change fixes. Two units are two rows with
one `parent_address_id`. See the worked example in §10.1.

### 4.5 Addresses that are renamed or renumbered

A rename changes `street`, which changes the key. Decision: this is a **merge
event**, not a new place. §8 defines the mechanism; the point here is that the
old row is never deleted and never silently rewritten, because reviews, leases
and occupancies point at it.

### 4.6 Leases

`leases.property_id` names the advertisement the tenancy came from, which is
correct and stays — but a tenancy is a fact about a *place* that outlives the ad.
Add `leases.address_id`, resolved server-side from the property at creation and
then immutable. It is what lets a lease produce an `Occupancy` (§4.8) and
therefore a verified review, without the review path depending on a listing that
may be gone.

### 4.7 Saved items

`saved_items.target_id` references `properties` with a discriminator that has
exactly one value today. Saving a *place* (a building you are watching, with no
active listing) is #356's requirement and needs the discriminator to acquire a
second value plus a nullable `address_id`. Decided here only so that nobody
"cleans up" the polymorphic column in the meantime.

### 4.8 Occupancy

New, private: `(oxy_user_id, address_id @ UNIT, lived_from, lived_to, source)`
where `source ∈ {lease, self_declared, evidence}`. It is the join between a
person and a place that review verification (#364) needs. It is never public and
never exposed as a list; only the derived boolean `reviews.verified` is.

### 4.9 City, region and country are never copied as text

Already true and this ADR forbids re-introducing it. The one denormalization is
`addresses.country_code`. Display names are resolved by join in exactly one place
(`ADDRESS_GEO_NAME_COLUMNS`, `db/addresses/addressSerializer.ts:58-64`), and any
new reader uses that rather than adding a `city_name` column.

---

## 5. What has to change in the identity mechanism

### 5.1 `identity_key`, added beside `normalized_key` — never overwriting it

`addresses.normalized_key` is copied **verbatim** by the (now-retired) backfill
and must not be recomputed; the schema says so at `addresses.ts:166-179` and the
service repeats it at `addressService.ts:376-386`. Recomputing it would re-key
11,734 existing buildings.

So: **add** `identity_key`, computed by a v2 function that hashes the fields in
§3.1 plus the level, with whitespace collapsed and diacritics stripped. Both
columns exist. `normalized_key` keeps its partial unique index and keeps serving
existing rows; `identity_key` gets its own partial unique index and becomes the
key **writes** dedupe on, only after the census in §11 shows what it partitions
the existing rows into.

The information lost to the v1 collapse cannot be recovered — if 3r and 4t are
one row today, nothing in the database records that 4t was ever seen. The plan is
therefore **forward-only**: existing collapsed rows keep their identity and are
flagged; new writes stop collapsing.

**This is cheap right now and gets expensive later, which is the argument for
doing it in the next phase rather than after the review redesign.** `reviews` was
**empty in production at the 2026-08-06 census**
(`db/schema/reviews.ts:5-8`; `assertPostgresPopulated.ts` records the other ~45
tables as empty too). Nothing is misfiled yet. Every review written between now
and the key change is a row that #366 will have to audit.

### 5.2 Six smaller changes, each with its measured reason

| # | Change | Measured reason |
|---|---|---|
| 1 | `addresses.parent_address_id` self-FK, RESTRICT | The hierarchy is recomputed per review today and invisible to every other domain |
| 2 | CHECK: a `UNIT` row has a non-empty `floor`/`unit`/`subunit`; a `BUILDING` row has a non-empty `number`/`building_name`/`block`/`entrance` | Keeps the level and the key reading the same fields — the root cause in §1.3 |
| 3 | CHECK: `reviews.building_level_id` names a `BUILDING`-level row (deferred/trigger; a CHECK cannot subquery) | ROW-A is a `UNIT` row acting as a building today |
| 4 | `cities`/`neighborhoods` unique key on `lower(name)` | Measured: `Barcelona` and `barcelona` both stored |
| 5 | Retire the `'Unknown'` region fallback: an unresolved region makes the address a **candidate** (§5.3), not a row under a bucket | Measured: two different `Santiago`s collapse into one city |
| 6 | Missing postcode is `NULL`, not `''` and not `'00000'` | Both are values and both enter the key |

Change 5 has a consequence worth stating: today ingest *never* drops a listing —
it falls back to the city centroid and, failing that, `'00000'`
(`IngestionService.ts:490-525`). That resilience is deliberate and must survive.
The candidate table is how: a listing whose place cannot be resolved is still
ingested and still shown, attached to a candidate, and appears in search at
**city** scope only — never pinned to a building it might not be at.

### 5.3 `address_candidates`

What a user typed, or a geocoder returned, before anybody decided it is a place.
Never deduped globally (two people typing the same wrong thing is two events).
It is what `POST /api/addresses` writes now that it materializes immediately, and
it is the input to the merge/split workflows of #360.

---

## 6. Privacy by design: internal identity vs public representation

### 6.1 The rule

**A row is stored at the precision it is known. A response is built at the
precision the viewer is entitled to.** Precision is decided in the serializer,
per audience, per level. There is exactly one address serializer today
(`serializeAddressRow`), which is the right shape — it just does not take an
audience.

### 6.2 The four cases the issue names, decided

| Case | Decision |
|---|---|
| A unit is identified internally but shown at building level | `serializeAddressRow` takes a `precision` argument. At `BUILDING` precision it omits `floor`, `unit`, `subunit` and returns the *building's* id as the place id. Internal code keeps the unit id. |
| A listing hides the number although Homiio knows it | `show_address_number` moves from decoration to enforcement: it is an input to the serializer, and at `false` the number and the exact point are withheld. Today it is published beside the number it was meant to withhold. |
| A review or eviction publishes approximate coordinates | `eviction_cases` already does exactly this, by *rounding before persisting* when the reporter marks the location approximate (`evictions.ts:1-10`, `location_precision` default `'approximate'`). This ADR keeps that behaviour for evictions and **does not generalize it**: for places, degrade at read, because the precise value is needed for dedup and search. The two mechanisms coexist deliberately and #347 owns the boundary. |
| No public URL leaks a sensitive identifier | `normalizedKey` **must be removed from `serializeAddressRow`** — it is an internal dedup hash on every public response today. `identity_key` must never be added to a DTO. `/places/:addressId` carries an opaque id; the free-text-plus-coordinates URL that `app/properties/address-detail.tsx` demonstrates (`street`, `city`, `lat`, `lng` as query parameters) is the anti-pattern and must not become a real route. |

### 6.3 Evictions

`eviction_cases` is the only place-ish entity that deliberately does **not**
reference `addresses` — it has its own `location_latitude` / `location_longitude`
/ generated `location_geo` / `location_precision`. Decision: it **may**
optionally gain a nullable `address_id` so a case can be found from a place page,
but only under #347's precision rules, and the coarse published point stays the
published point. Storing "which building" internally while publishing "which
block" is exactly what §6.1 permits — but for a domain this sensitive it is #347
that says whether we take it, not this ADR.

---

## 7. Why `addresses` evolves and no parallel hierarchy is created

The issue requires this to be justified rather than assumed. Five reasons, four
of them measured:

1. **Every existing reference into "place" already goes through `addresses`.**
   Measured: exactly **5 foreign-key columns in 2 tables**
   (`grep -rn "references(() => addresses.id" db/schema/*.ts | wc -l` → 5) —
   `properties.address_id` (NOT NULL, RESTRICT) and `reviews`' four. A parallel
   `buildings`/`units` pair would require re-pointing 17,644 listings and every
   one of those review columns, which is precisely the destructive migration the
   issue forbids without a census.
2. **The level derivation is already in the database**, as a generated column
   whose predicate deliberately preserves Mongo truthiness semantics
   (`coalesce(x,'') <> ''` rather than `is not null`). We measured that it still
   behaves: an empty-string `floor` yields `BUILDING`, not `UNIT`. A new table
   would have to reproduce this and could disagree with it.
3. **The dedup key, the spatial index and the trigram typeahead index all live on
   `addresses`.** `addresses_geo_gist` is the index "the whole search surface
   stands on" (`addresses.ts:195-198`). Splitting the table splits the index, and
   a search would have to union two spatial indexes.
4. **The geo chain is referenced from `addresses` by id.** A second hierarchy
   either re-references the same four tables — in which case it is the same
   hierarchy with more joins — or copies names as text, which invariant 6
   forbids.
5. **What is actually missing is not a table.** It is a self-reference, a key
   that discriminates the level it declares, and a CHECK. All three are additive.

The honest cost of not splitting: `addresses` carries columns that are
meaningless at some levels (a STREET row has no `floor`). That is already true
and is what the level CHECKs in §5.2 make explicit rather than implicit.

---

## 8. Deduplication, merging and community correction

Two different problems that get conflated, and this ADR separates them.

### 8.1 Place dedup — "these two rows are one building"

Automatic: identical `identity_key`. Nothing else is automatic.

Assisted: `address_merge_proposals (from_address_id, to_address_id, reason,
evidence, proposed_by, status)`. A merge **never deletes** the losing row; it
sets `merged_into_address_id` and every read follows the pointer. Reviews,
leases, occupancies and listings keep their original references, which is what
makes a merge reversible — and reversibility is the requirement, because a wrong
merge publishes one household's reviews under another's address.

Correction of *attributes* (a misspelled street, a missing postcode) is an
ordinary edit and does not change identity **unless** it changes a key field, in
which case it is a merge proposal.

Community correction, per the epic's principle 9: proposals are visible and
appealable, resolved by the community. **No admin queue, no privileged moderator
surface** — that is a standing product veto in `AGENTS.md` and this ADR does not
re-open it.

### 8.2 Listing grouping — "these three advertisements are one dwelling"

Distinct from place dedup, because two portals can advertise the same flat with
two different address strings that legitimately produce two candidate places.

Decision: `properties.listing_group_id` → `listing_groups`. Grouping is a
**recorded relation**, never a skipped ingest. The existing
`dedupeFingerprint.ts` becomes the *proposer* of a group rather than the reason
to discard: its seven conjunctive conditions and its 0.95 Jaccard threshold are
well-evidenced and are kept as-is. `IngestionService.findDuplicate`'s
`status: 'skipped'` return becomes `status: 'grouped'`, and the second portal's
advertisement is stored with its own provenance.

A group's canonical member is the one with the most images, which is what the
current code already prefers — and the place page renders the group once, with
all three sources attributed (#368).

---

## 9. Compatibility and phased migration

**No destructive step appears before its census.** Phases 1 and 2 are additive
and reversible; phase 3 is the only one that removes anything, and it is gated.

### Phase 0 — census (blocking, nothing else starts)

Run §11's queries against production. Their output is a required attachment to
the PR that opens phase 1. No schema change in this phase.

### Phase 1 — additive structure (a `pre` migration)

- `addresses.parent_address_id`, `addresses.identity_key`, `addresses.merged_into_address_id`
  (all nullable, no backfill yet).
- `address_candidates`, `address_external_refs`, `address_official_refs`,
  `listing_groups`, `occupancies`, `listing_snapshots`.
- `properties.listing_group_id`, `leases.address_id` (nullable).
- Nothing reads any of them yet. Rollback = drop.

### Phase 2 — populate and dual-run

- Compute `identity_key` for every existing row. **Collisions are recorded, not
  merged** — into `address_merge_proposals` with `reason = 'v2_key_collision'`.
- Populate `parent_address_id` by projection, using the same rules
  `resolveAddressHierarchy` uses today, so no row moves.
- Writes start deduping on `identity_key`; reads keep working off both columns.
- Backfill `leases.address_id` from the listing.
- New CHECKs are added **NOT VALID** first, then validated once the census
  confirms zero violations. A CHECK that fails validation is a finding, not a
  reason to weaken the CHECK.

### Phase 3 — cut over (a `post` migration, gated on phase 2's report)

- `/places/:addressId` ships; `/properties/:id` starts redirecting on expiry.
- `serializeAddressRow` takes a precision argument; `normalizedKey` leaves the
  wire; `show_address_number` is enforced.
- `properties.parent_property_id` retired after `leases.room_id` is re-pointed.
- `land_plot_*` retired after `address_official_refs` is populated.
- `normalized_key` is retired **only** when no code path reads it and the census
  shows `identity_key` is unique and total.

### Rows that may have been created under a wrong hierarchy

Measured: **reviews were empty in production at the 2026-08-06 census**, so there
is no misfiled review to repair *as of that date* — which is the whole reason
this is cheap now. That fact must be re-verified at phase 0 (query R1 in §11)
because it is exactly the kind of fact that stops being true quietly. Listings
are unaffected: a listing's `address_id` is a pointer, and phase 2 moves no row.

---

## 10. Worked examples

Each names what a **wrong** implementation produces, so the example can tell
right from wrong.

### 10.1 Urban apartment block — two units, one building

Carrer de Provença 42, flats 1r 1a and 2n 2a.

```
STREET   Carrer de Provença, 08008, Barcelona          A₀
BUILDING Carrer de Provença 42                          A₁  parent A₀
UNIT     … 1r 1a                                        A₂  parent A₁
UNIT     … 2n 2a                                        A₃  parent A₁
LISTING  idealista/98765 → A₂
REVIEW   by U1 at UNIT     → address A₂, unit A₂, building A₁, street A₀
REVIEW   by U2 at BUILDING → address A₁, unit NULL,  building A₁, street A₀
```

The building page shows both, in separate blocks, plus a combined aggregate.

**Wrong implementation:** A₂ and A₃ are the same row (today's behaviour when the
flats are identified by floor alone — measured, §1.3), so U2's review of 2n 2a
appears under 1r 1a, and the building page renders the *unit* view.
**Discriminating fixture:** two units of one building must produce
`count(distinct address_id) = 2` and one shared `parent_address_id`.

### 10.2 Single-family home

Camí del Mas 7, one house.

```
STREET   Camí del Mas, 08911, Badalona     B₀
BUILDING Camí del Mas 7                    B₁  parent B₀
```

No UNIT row. A review is filed at BUILDING; a listing points at B₁.

**Wrong implementation:** minting a UNIT row "for symmetry" — it would carry no
`floor`/`unit`/`subunit`, violate the §5.2 CHECK, and split one house's reviews
across two rows.

### 10.3 A room inside a dwelling

A room let inside flat A₂ above.

```
UNIT   … 1r 1a               A₂
UNIT   … 1r 1a, room "B"     A₄  parent A₂, subunit = 'B'
LISTING room listing → A₄, type = 'room'
```

**Wrong implementation:** `parent_property_id` pointing at the flat's *listing*
(today's model) — measured absent on all 17,644 production rows, so nothing
breaks by changing it. Under the old model, when the flat's listing expires the
room's parent evaporates and the room loses its place entirely.
**Discriminating fixture:** delete the flat's listing; the room must still
resolve to a building and a street.

### 10.4 A complex with several buildings

Residencial Els Pins, Avinguda del Mar 100, blocks A/B/C.

```
STREET   Avinguda del Mar               C₀
BUILDING … 100, entrance A              C₁  parent C₀
BUILDING … 100, entrance B              C₂  parent C₀
BUILDING … 100, entrance C              C₃  parent C₀
```

`entrance` (or `block`, or `building_name`) is in the BUILDING key, so these are
three rows.

**Wrong implementation:** today's key omits `entrance` — measured, "entrance B
and the building are the SAME row: true" — so all three blocks are one building
and a review of block C is published against block A.

### 10.5 A temporary stay

A 3-night booking in flat A₂.

```
PLACE     A₂ (unchanged, permanent)
LISTING   properties row, offering short_term_rent
RESERVATION → properties.id
OCCUPANCY   → A₂, lived_from/lived_to, source = 'reservation'
```

The reservation belongs to the offer; the occupancy belongs to the place.

**Wrong implementation:** deriving review eligibility from the reservation's
`property_id` — when the listing is deleted, a real guest's right to review
disappears with it.

### 10.6 A dwelling published without an exact address

A portal gives "Eixample, Barcelona" and a city-centroid point (measured: 94–100%
of habitaclia/fotocasa listings carry the centroid).

```
ADDRESS_CANDIDATE  raw text + centroid + confidence = 'city'
LISTING            → candidate, NOT a building
```

The listing is shown, searchable at **city** scope, labelled as
approximately located, and never pinned to a building.

**Wrong implementation:** materializing a BUILDING row from the centroid — which
is what `'00000'` + centroid does today. Every such listing in one city collapses
onto one fabricated "building" that then accumulates reviews about unrelated
flats. **Discriminating fixture:** two listings in one city with no street number
must not share an `address_id` at BUILDING level.

### 10.7 One dwelling listed on three portals

Idealista, Fotocasa and Habitaclia all advertise flat A₂.

```
PLACE    A₂
GROUP    G₁
LISTING  idealista/98765  → A₂, group G₁
LISTING  fotocasa/11223   → A₂, group G₁
LISTING  habitaclia/44556 → A₂, group G₁
SNAPSHOTS per listing, so three price histories roll into one place history
```

The place page shows one card, three attributed sources, and the price history of
all three.

**Wrong implementation, both of today's:** with `LISTING_DEDUP_ENABLED` unset
(measured: absent from the live worker task definition) it is three separate
listings and three separate histories; with it set, `findDuplicate` returns
`status: 'skipped'` and portals 2 and 3 are **discarded**, so Homiio loses the
evidence that the flat is multi-listed — which is itself a signal a tenant wants.
**Discriminating fixture:** ingest three portals' versions of one flat and assert
one group, three listings, three retained `source_url`s.

### 10.8 A rural address

Mas Pere, Diseminado s/n, 17246 Santa Cristina d'Aro.

```
STREET   Diseminado, 17246, Santa Cristina d'Aro   D₀
BUILDING Mas Pere                                   D₁  parent D₀  (building_name, no number)
```

With a name, it is a building. **Without** a name and without a number it stays
at D₀ and is published as "on this road" — measured today as a silent collision
(`8f70d5c9…` twice, §1.3); the change is that it is labelled STREET instead of
being treated as a building.

**Wrong implementation:** using coordinates as the discriminator. Rural geocodes
routinely differ by tens of metres between portals, so it produces a new
"building" per ingest.

### 10.9 Two same-named cities (a discriminating fixture, not a scenario)

`Valencia` (Valencian Community) and `Valencia` (Carabobo, Venezuela); and, in
one country, two `Santiago`s in two regions.

- Measured: two `Valencia`s under two regions coexist correctly.
- Measured: two `Santiago`s both fall into the literal `'Unknown'` region when
  the geocoder returns no state, and collapse to one city row.
- Measured: `Barcelona` and `barcelona` are two rows.

**Wrong implementation:** resolving a city by name alone. The fixture is three
cities — two homonyms in different regions, one case variant — asserting 2 rows,
not 1 and not 3.

### 10.10 Two buildings with near-identical names (a discriminating fixture)

`Torre Mapfre`, `torre mapfre`, `Torre Mapfre ` (trailing space) and
`Torre  Mapfre` (two internal spaces), all at the same street, postcode and city.

Measured today (§1.3): the first three hash to one key — case folding and
trimming already work — and the **fourth hashes to a different key**, so
`Torre  Mapfre` becomes a second building.

This is the opposite failure direction from the floor/entrance collapse, and both
being present is the point: the current key is simultaneously too coarse (it
merges genuinely different places) and too fine (it splits one place on a typo).
§3.1's whitespace collapsing plus diacritic stripping fixes the second half.

**Wrong implementation, either direction:** normalizing so aggressively that
`Torre Mapfre I` and `Torre Mapfre II` merge — two real buildings in one
development. **Assert both:** the four variants above collapse to 1 row; the
roman-numeral pair stays 2 rows.

---

## 11. Validation — what was measured, and what is pending

### 11.1 Measured in this checkout (2026-08-10)

| Claim | How |
|---|---|
| No live mongoose import; `models/`, `database/` gone; no mongo dependency | `git grep`, `ls`, `git grep -- '*/package.json'` |
| 61 tables | `grep -rhn "= pgTable(" db/schema/*.ts \| wc -l` |
| `identity` key omits `floor`/`entrance`/`subunit`; 4 collision classes over 14 fixtures, positive control passes | `scratchpad/adr-345/keyprobe.ts` against the real function |
| One row is the building, 3r, 4t and entrance B at once; units 1a/2a stay distinct | `scratchpad/adr-345/e2e.ts` against a real migrated PostGIS database |
| The shared row's level is order-dependent (UNIT vs BUILDING) | `scratchpad/adr-345/order.ts`, two fresh databases |
| `address_level` generation, including empty-string `floor` → BUILDING | `scratchpad/adr-345/probe2.sql` |
| Partial unique on `normalized_key` permits multiple NULLs, refuses a duplicate | same |
| `cities_region_name_key` is case-sensitive | same |
| The `'Unknown'` region collapses homonymous cities | same |
| `show_address_number` enforced in exactly one place, and not in the serializer | `git grep` |
| `normalizedKey` is on the public wire | `db/addresses/addressSerializer.ts:158` |
| `LISTING_DEDUP_ENABLED` absent from the live worker task definition | `aws ecs describe-task-definition` |
| `DATABASE_URL` is the only DB secret in production | same |

### 11.2 Production census — **PENDING, 2026-08-10**

**Production is unreachable from this machine and no figure below was invented.**

```bash
$ aws ssm get-parameter --name /oxy/homiio/DATABASE_URL --with-decryption --profile oxy --region us-west-2
postgresql://homiio:***@postgres.internal.oxy.so:5432/homiio?sslmode=require   # SSM exit 0
$ getent hosts postgres.internal.oxy.so
(no A record)
```

The host resolves only inside the VPC. Run the queries below as a **read-only
one-shot ECS task** on the `oxy-cluster`, with the API task definition's network
configuration — the pattern `assertPostgresPopulated.ts` documents. Attach the
output to the phase-1 PR.

```sql
-- A1  the real distribution of address shapes
select address_level, count(*) from addresses group by 1 order by 2 desc;

-- A2  how many rows the v1 key has already collapsed: UNIT rows whose only
--     discriminator is a field the key never hashed
select count(*) as unit_rows_keyed_only_by_floor_or_subunit
from addresses
where address_level = 'UNIT'
  and coalesce(unit, '') = ''
  and (coalesce(floor, '') <> '' or coalesce(subunit, '') <> '');

-- A3  buildings distinguished only by entrance (invisible to the v1 key)
select count(*) from addresses
where address_level = 'BUILDING' and coalesce(entrance, '') <> '';

-- A4  what the v2 key would partition into: how many rows share a v1 key
--     (must be 0 — the unique index says so; a non-zero answer is a finding)
select count(*) from (
  select normalized_key from addresses
  where normalized_key is not null group by 1 having count(*) > 1
) t;

-- A5  unkeyed addresses (the partial index permits any number)
select count(*) from addresses where normalized_key is null;

-- A6  the fabricated-postcode population
select count(*) from addresses where postal_code in ('', '00000');

-- A7  listings per address — the multi-listing reality
select n_listings, count(*) as n_addresses from (
  select address_id, count(*) as n_listings from properties
  where deleted_at is null group by 1
) t group by 1 order by 1;

-- A8  places whose listings come from more than one portal (the §10.7 case)
select count(*) from (
  select address_id from properties where deleted_at is null
  group by 1 having count(distinct source) > 1
) t;

-- A9  homonymous cities that a case-sensitive key kept apart
select lower(name), region_id, count(*) from cities
group by 1, 2 having count(*) > 1;

-- A10 cities parked under the 'Unknown' region
select count(*) from cities c join regions r on r.id = c.region_id
where r.name = 'Unknown';

-- R1  RE-VERIFY: reviews were empty at the 2026-08-06 census. Still?
select count(*) as reviews,
       count(*) filter (where building_level_id = address_id) as building_is_self,
       count(*) filter (where street_level_id = building_level_id) as street_is_building
from reviews;

-- R2  reviews attached to an address whose level disagrees (the §5.2 CHECK #3)
select count(*) from reviews r
join addresses b on b.id = r.building_level_id
where b.address_level <> 'BUILDING';
```

**Acceptance box "El ADR es revisado contra datos reales y no solo contra
fixtures ideales" is PENDING as of 2026-08-10**, and is satisfied when A1–A10 and
R1–R2 have run against production and their output is attached. Every *other*
acceptance box is satisfied by §11.1's measurements against the real schema, the
real functions and a real PostGIS server.

### 11.3 Figures carried from an earlier census (dated, not re-measured here)

Recorded in `packages/backend/db/assertPostgresPopulated.ts` and in the schema
files; **source: production Mongo census, 2026-08-06, issue #281 Fase 0.** They
describe the source at that date, not the database today, and external listings
carry a TTL that reaps continuously.

| Figure | Value |
|---|---|
| properties | 17,644 (→ ~1.50 listings per address) |
| addresses | 11,734, `normalized_key` "impeccable across all of them" |
| images / property image refs | 171,976 / 169,223 |
| cities / agencies / countries / profiles | 1,660 / 2,627 / 7 / 5 |
| all other ~45 tables, `reviews` included | empty |
| `oxy_user_id` on properties | absent on all 17,644 |
| `source_url` present, `expires_at` present | 17,644 / 17,644 each |
| `parent_property_id`, `sourced_by_partner_id` | absent on all 17,644 |
| `agency_id` | 8,374 set, 9,270 null |
| distinct `source_id` | 17,644 of 17,644 |

---

## 12. Inventory of affected tables and DTOs

### 12.1 Tables

**New (7):** `address_candidates`, `address_external_refs`,
`address_official_refs`, `address_merge_proposals`, `listing_groups`,
`listing_snapshots`, `occupancies`.

**Altered (6):**

| Table | Change |
|---|---|
| `addresses` | `+ parent_address_id`, `+ identity_key` (+ partial unique), `+ merged_into_address_id`, level CHECKs, `postal_code` nullable |
| `properties` | `+ listing_group_id`; `parent_property_id` retired (phase 3); `land_plot_*` reads move to `address_official_refs` |
| `reviews` | `building_level_id → BUILDING` constraint; level ids become derived-and-immutable |
| `leases` | `+ address_id`; `room_id` re-pointed |
| `cities`, `neighborhoods` | unique key on `lower(name)` |
| `saved_items` | second discriminator value + nullable `address_id` |

**Unchanged and confirmed correct:** `countries`, `regions`, `agencies`,
`images`, `eviction_cases` and its four children (§6.3), everything under
`moderation`, `partners`, `billing`, `notifications`, `roommates`, `profiles`,
`conversations`, `bookings`, `applications`, `exchanges`, `place_pois`.

### 12.2 Backend DTO / serializer changes

| File | Change |
|---|---|
| `db/addresses/addressSerializer.ts` | `serializeAddressRow(row, { precision, showNumber })`; **drop `normalizedKey`**; expose `parentAddressId` and `addressLevel` |
| `db/properties/propertySerializer.ts` | pass the property's `show_address_number` into the address serializer; emit `listingGroupId`, `isCanonicalInGroup` |
| `db/reviews/reviewSerializer.ts` | `populatedAddress` at the review's own precision, not the row's |
| `services/addressService.ts` | v2 key function beside the v1 one (v1 stays byte-identical); `resolveAddressHierarchy` reads `parent_address_id` |
| `services/ingestion/IngestionService.ts` | candidate path when the place is unresolved; `status: 'grouped'` instead of `'skipped'` |
| `controllers/addressController.ts` | `POST /api/addresses` writes a candidate; materialization is a separate, deliberate step |
| new `controllers/placeController.ts` | `GET /api/places/:addressId` — the persistent place read (#361, #362) |

### 12.3 `@homiio/shared-types` — required changes

Measured gaps:

- **`AddressLevel` does not exist in the package at all.**
  `grep -rn "addressLevel\|AddressLevel" packages/shared-types/src` returns only
  two hits inside `review.ts`, an inline `'BUILDING' | 'UNIT'`. The wire has
  carried `addressLevel` since the port (`addressSerializer.ts:157`) and no
  consumer can type it. **Add** `export type AddressLevel = 'STREET' | 'BUILDING' | 'UNIT'`
  and re-use it in `review.ts` as `Extract<AddressLevel, 'BUILDING' | 'UNIT'>`.
- **`AddressDocument.normalizedKey: string` is required in the type and nullable
  in the column** (`addresses.normalized_key` is `text()`, no `.notNull()`).
  Since §6.2 removes it from the wire entirely, **delete the field** rather than
  making it optional.
- **`Address` has no parent and no level.** Add `id`, `addressLevel`,
  `parentAddressId?`.
- **New types:** `Place` (the level-aware read model behind `/places/:id`),
  `PlaceSummary`, `ListingGroup`, `ListingSnapshot`, `AddressCandidate`,
  `AddressPrecision = 'street' | 'building' | 'unit'`.
- **`PropertyAddress`** gains `addressLevel` and drops nothing (it never carried
  the key), and `Property` gains `listingGroupId?`.
- **No new type may carry `cityName`/`regionName`/`countryName` as an input.**
  They are output-only display strings, already correctly typed that way in
  `AddressGeoNames`.

Frontend: nothing reads `addressLevel` today
(`grep -rn "addressLevel" packages/frontend` → no matches), so adding the type is
purely additive. `app/properties/address-detail.tsx` is a demo screen that
composes a URL from free-text street/city/state/zip plus `lat`/`lng` and
navigates to itself; it must not be the basis of the real place route (§6.2).

---

## 13. Diagram

```mermaid
erDiagram
    COUNTRIES     ||--o{ REGIONS        : "has"
    REGIONS       ||--o{ CITIES         : "has"
    CITIES        ||--o{ NEIGHBORHOODS  : "has"

    COUNTRIES     ||--o{ ADDRESSES      : "country_id (1..N, RESTRICT)"
    REGIONS       ||--o{ ADDRESSES      : "region_id (1..N, RESTRICT)"
    CITIES        ||--o{ ADDRESSES      : "city_id (1..N, RESTRICT)"
    NEIGHBORHOODS ||--o{ ADDRESSES      : "neighborhood_id (0..N, SET NULL)"

    ADDRESSES     ||--o{ ADDRESSES      : "parent_address_id (STREET 1..N BUILDING 1..N UNIT)"
    ADDRESSES     ||--o{ ADDRESS_EXTERNAL_REFS : "0..N"
    ADDRESSES     ||--o{ ADDRESS_OFFICIAL_REFS : "0..N"
    ADDRESS_CANDIDATES }o--o| ADDRESSES : "materializes_into (0..1)"

    ADDRESSES     ||--o{ PROPERTIES     : "address_id (0..N listings per place)"
    LISTING_GROUPS ||--o{ PROPERTIES    : "listing_group_id (1..N, one dwelling many portals)"
    PROPERTIES    ||--o{ LISTING_SNAPSHOTS : "1..N over time"

    ADDRESSES     ||--o{ REVIEWS        : "address_id + street/building/unit level ids"
    ADDRESSES     ||--o{ OCCUPANCIES    : "UNIT only, 0..N, PRIVATE"
    AGENCIES      ||--o{ REVIEWS        : "agency_id (0..N, SET NULL)"
    AGENCIES      ||--o{ PROPERTIES     : "agency_id (0..N, SET NULL)"

    PROPERTIES    ||--o{ LEASES         : "property_id"
    ADDRESSES     ||--o{ LEASES         : "address_id (the durable half)"
    PROPERTIES    ||--o{ RESERVATIONS   : "property_id"
    PROPERTIES    ||--o{ EXCHANGE_REQUESTS : "property_id / offered_property_id"
    PROPERTIES    ||--o{ TENANT_APPLICATIONS : "property_id"
    PROPERTIES    ||--o{ VIEWING_REQUESTS    : "property_id"
    PROPERTIES    ||--o{ SAVED_ITEMS         : "target_id"

    EVICTION_CASES }o--o| ADDRESSES     : "address_id (optional, #347 decides)"
```

Cardinality summary: one place has **0..N** listings (0 is the normal state for a
building nobody is currently advertising — which is the whole point of the
persistent place page); one listing has **exactly one** place; one dwelling
advertised on three portals is **three listings, one group, one place**.

---

## 14. Consequences

**Good.** The building page stops depending on ingest order. A place survives its
advertisements. Two flats on two floors stop sharing an identity. Price history
becomes attributable to a dwelling rather than to an ad that vanishes. The
internal/public precision split gets a mechanism instead of a flag nobody reads.
`normalizedKey` leaves the public wire.

**Costs, stated rather than minimised.** `addresses` carries more nullable
columns and three level-dependent CHECKs. Two key columns coexist for at least
one release. Seven new tables. The `'Unknown'` region fallback goes away and
something has to catch what it was catching, which is the candidate table —
extra machinery on the ingest path that is currently one line.

**Accepted and irreversible.** Rows that the v1 key already collapsed cannot be
split; the information that a second flat was ever seen is not in the database.
The plan is forward-only and says so.

**Risk if deferred.** Every review written before the key change is a row #366
must audit. As of 2026-08-06 there were none. That is the cheapest this gets.

---

## 15. Open decisions

Explicit, so that no downstream feature invents an answer (epic Gate A).

1. **Does `properties` get physically renamed to `listings`?** The concept is
   decided; the rename is not scheduled. Measured: **16 foreign-key columns
   across 8 schema files reference `properties.id`**
   (`grep -rn "references(() => properties.id\|references((): AnyPgColumn => properties.id" db/schema/*.ts | wc -l`),
   plus the whole frontend. Recommendation: rename in the DTO first (`Listing` in
   `@homiio/shared-types`), keep the table name, and revisit after #368.
2. **Does a UNIT-level place get a public URL at all, or only a building URL with
   an anchor?** §6.2 makes either implementable. #347 decides.
3. **Aggregate publication floor: 3 reviews.** Chosen as a starting point, not
   derived from data. #347 owns the number.
4. **Does `eviction_cases` gain `address_id`?** §6.3 permits it; #347 decides.
5. **Who may propose a merge, and what resolves it?** Community, per the epic's
   principle 9 and the standing no-admin veto — but the exact quorum is #365's.
6. **Do we keep `properties.floor` (a listing attribute) once `addresses.floor`
   is authoritative?** They can disagree today. Recommendation: the address wins
   and the property column is retired; needs a census (A-series) first.
7. **Cross-border homonyms in the URL.** `/places/:id` is opaque, so this is a
   search-and-disambiguation question, not an identity one — #295 and #346.
8. **Where does `ListingSnapshot` capture happen** — inside `IngestionService`, or
   as an outbox consumer? Affects worker throughput. #367.
