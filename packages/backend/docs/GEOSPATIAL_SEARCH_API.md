# Geospatial search

Location-based listing queries run on **PostGIS**, against a generated
`geography` column on `addresses`. All three endpoints are public — no session
required.

This page covers only what is specific to proximity. The full route table and
response envelope are in [`docs/routes.mdx`](../../../docs/routes.mdx), the
filter vocabulary is in [`docs/listings.mdx`](../../../docs/listings.mdx), and
the schema-level reasoning is in
[`docs/architecture.mdx`](../../../docs/architecture.mdx). Do not restate any of
them here; a search contract described in four places is a contract that
disagrees with itself.

## The three endpoints

| Endpoint | Coordinate params | Radius param | Missing radius |
|---|---|---|---|
| `GET /api/properties/search` | `lat`, `lng` | `radius` | ignored — plain filtered search |
| `GET /api/properties/nearby` | `longitude`, `latitude` | `maxDistance` | defaults to 10 000 m |
| `GET /api/properties/radius` | `longitude`, `latitude` | `radius` | **400** |

**Note the two coordinate spellings.** `/search` takes `lat` / `lng`; the two
proximity feeds take `longitude` / `latitude` spelled out. That inconsistency is
real and predates this document — if it is ever unified, it has to be unified on
both sides of the wire at once.

`nearby` and `radius` are two thin handlers over **one** reader. They differ in
exactly three things — which parameter carries the radius, whether a missing
radius is an error or a default, and the success message. Adding a third
proximity feed means adding a descriptor, not another implementation.

### Common parameters

| Parameter | Default | Notes |
|---|---|---|
| `page` | 1 | |
| `limit` | 10 | |

Every filter in `PropertyFilters` also applies — `type`, `minRent`, `maxRent`,
`bedrooms`, `bathrooms`, `amenities`, `available`, `offering` and the rest — via
the shared filter builder, so a proximity feed and a plain search cannot disagree
about what a filter means.

## How it is queried

| Question | PostGIS |
|---|---|
| Within N metres of a point | `ST_DWithin(geo, ST_MakePoint(lng, lat)::geography, metres)` |
| Within a map viewport | `ST_MakeEnvelope(…)` with `ST_Intersects` |
| How far away is it | `ST_Distance(…)` |

`addresses.geo` is a **generated** column:

```sql
ST_MakePoint(longitude, latitude)::geography
```

A generated column requires an `IMMUTABLE` expression, which `ST_MakePoint` and
the `geometry → geography` cast both are. It carries a GiST index, which is what
makes `ST_DWithin` a range scan rather than a full sweep.

`cities` and `neighborhoods` deliberately have **plain** latitude/longitude
columns, with no `geography` and no GiST index: they are used for map framing,
not for proximity search. Adding one later is a one-line additive migration;
adding one now would be an index nothing queries.

## Coordinate validation

**`geography` does not validate its input.** Measured on PostGIS 3.5,
`ST_MakePoint(0, 100)::geography` emits a notice and coerces latitude 100 rather
than refusing it. Ranges are enforced by `CHECK` constraints in the schema, not
by the column type:

- latitude ∈ [-90, 90]
- longitude ∈ [-180, 180]

Do not assume a bad coordinate will be rejected by the type. It will not.

## Distances

Metres throughout — parameters, `ST_DWithin` and `ST_Distance`. PostGIS computes
distance on the spheroid; nothing here re-implements Haversine.

| Metres | Roughly |
|---|---|
| 1 000 | a few streets |
| 5 000 | a district |
| 10 000 | the `nearby` default |
| 25 000 | a metropolitan area |

## Responses and errors

Paginated through `paginationResponse` — shape in
[`docs/routes.mdx`](../../../docs/routes.mdx).

<!-- vocabulary-exempt:start states the wire contract by naming the token it forbids -->
**Every identity on the wire is `id`**; nothing this API returns is named `_id`,
and `__tests__/integration/wireIdContract.test.ts` fails if one appears anywhere
in any body.
<!-- vocabulary-exempt:end -->

| Code | Status | Raised when |
|---|---|---|
| `MISSING_COORDINATES` | 400 | `longitude`/`latitude` absent on `/nearby` |
| `MISSING_PARAMETERS` | 400 | `longitude`, `latitude` or `radius` absent on `/radius` |
| `INVALID_COORDINATES` | 400 | present but not parseable as numbers |

The two "missing" codes are genuinely different codes on the two feeds, because
the required set differs. A client should treat both as "fix your parameters".

**A geographic failure is an error the caller can see.** It must never fall back
to an unscoped result set — that is invariant 4 of
[ADR 0002](../../../docs/adr/0002-location-and-search-contract.md), and the bug
it prevents is a list of homes in one city under a map of another.

## Examples

```bash
# Within 2 km of a point, apartments only
curl "http://localhost:4000/api/properties/search?lat=41.3874&lng=2.1686&radius=2000&type=apartment"

# Nearest listings, default 10 km
curl "http://localhost:4000/api/properties/nearby?longitude=2.1686&latitude=41.3874"

# Explicit 3 km circle with a rent band
curl "http://localhost:4000/api/properties/radius?longitude=2.1686&latitude=41.3874&radius=3000&minRent=800&maxRent=1600"
```

## A trap already paid for once

An earlier version of the proximity reader selected **every** matching id inside
the radius — uncapped — and fed that list into a second query. On a dense city
that is an unbounded intermediate result: the endpoint's cost grew with the size
of the city rather than with the size of the page, and it looked fine on a small
dataset.

The current reader paginates in the database. Keep it there: `LIMIT` / `OFFSET`
belong in the query, never in JavaScript.
