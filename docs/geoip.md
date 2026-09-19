---
title: Approximate location from the visitor's network
---

# GeoIP: `GET /api/geo/approximate-location`

How Homiio answers "roughly where is this person?" without a permission prompt,
without a third-party request per visitor, and without ever claiming to know an
address.

Delivered for #518 §4 and #519 §4, which removed the mandatory place picker from
Home. The picker's replacement is this endpoint plus a neutral discovery board;
see `docs/adr/0002-location-and-search-contract.md` §19(D) for the contract
amendment and `packages/frontend/hooks/locationScopeLadder.ts` for the rung
order.

## The shape, in one paragraph

An unauthenticated GET. The server takes the requester's own address from
`req.ip`, refuses it if it is private or reserved, looks it up in a **local
database file**, matches the result to a country/region/city row **Homiio already
owns**, and answers a discriminated union: `resolved` with a `LocationSelection`
the app can query, or `unavailable` with a reason. It answers `200` either way,
because "we could not guess your area" is a normal outcome on a first paint and
not an error state. The response is `Cache-Control: private, no-store`.

## The database

**Chosen dataset: DB-IP City Lite.** Free, no account, no API key, published
monthly in MaxMind's `.mmdb` format under **CC BY 4.0**.

CC BY means **attribution is a licence obligation**, not a nicety. The credit is
rendered by `components/home/ApproximateAreaNotice.tsx` (the
`location.scope.provenance.attribution` key, translated in all twelve locales).
Shipping the database without that line is a licence breach, which is why the
credit lives in the same component as the disclosure rather than in a settings
page nobody opens.

**Distribution: GoWay**, once it is available. The file is not baked into the
container image and not downloaded at build time; the backend reads whatever
path `GEOIP_DATABASE_PATH` names, so mounting it from GoWay is a configuration
change and not a code change.

**Until then the endpoint answers `unavailable: 'not_configured'`** and the app
falls back to the destinations board. That path is not a stub — it is a
first-class, tested outcome (`__tests__/integration/approximateLocation.test.ts`)
and the same one a provider outage produces.

### Why a local file rather than an API

Both epics ask for it in those words ("una base de datos local actualizada para
evitar enviar IPs de usuarios a terceros"). The consequences, in order of how
much they matter:

| | Local `.mmdb` | Per-request API |
|---|---|---|
| Whose address leaves the task | nobody's | every visitor's |
| Latency on the first paint | microseconds, memory-mapped | a network round trip |
| Credential to leak | none | an API key |
| Third-party outage | impossible | makes Home slow |
| Provider terms over user traffic | none | theirs |

The cost is staleness — an address reassigned between monthly publications
resolves to the old city — which is acceptable for a value that is explicitly
labelled approximate and one tap away from being changed.

### Alternatives considered

- **MaxMind GeoLite2 City.** Weekly, better urban precision, no visible
  attribution requirement — but it needs a MaxMind account and a licence key in
  SSM. Rejected for now because the account is a human step and DB-IP's accuracy
  is sufficient for a city-level, user-correctable hint. Switching is a
  configuration change: the adapter reads any `.mmdb`.
- **A hosted lookup API.** Rejected on the first row of the table above.

## Trust boundary: which address is looked up

**`req.ip`, and nothing else.** `services/geoip/clientIp.ts` never parses
`X-Forwarded-For`, and `__tests__/unit/geoipTrustBoundary.test.ts` fails if any
file in `services/geoip/` starts reading a forwarding header, `req.query` or
`req.body` — so "accept `?ip=` so support can reproduce a user's result" is a
red test rather than a reasonable-sounding commit.

The topology makes `req.ip` the right answer. `api.homiio.com` is an ALB host
rule pointing straight at the ECS task
(`oxy-infra/terraform-uswest2/app-services.tf`), and the CloudFront distribution
in `cdn.tf` fronts only the media bucket — **there is no CDN hop in front of the
API**. One trusted hop, so `server.ts` sets `trust proxy: 1`, and Express walks
the forwarding chain from the right:

| The client sends | ALB forwards | `req.ip` |
|---|---|---|
| nothing | `XFF: <client>` | `<client>` |
| `XFF: 8.8.8.8` | `XFF: 8.8.8.8, <client>` | `<client>` — the forgery is to the LEFT |

Raising `trust proxy` above `1` behind a one-hop ingress would make `req.ip` the
last value a *client* supplied, so the number is pinned by a test.

Private, loopback, link-local, CGNAT (`100.64/10`) and other reserved ranges are
refused before the lookup: a server-side render or a health probe must not be
handed the datacentre's own city.

## What the answer may and may not contain

The contract is `packages/shared-types/src/approximateLocation.ts`. The rules it
encodes:

- **`source: 'ip'` is the inference, not the place's authority.** The selection
  carries its own `PlaceSource`, which is always `homiio`.
- **The selection is always a Homiio-owned country, region or city.** A
  provider's own id would serialise to a `loc` token the geo gateway cannot
  resolve, so Home would show a city name and query nothing.
- **Never `current_location`, never `exact`/`approximate` precision.** ADR 0002
  §8.1 reserves those for a point a device produced. An inferred city is a
  `centroid` — a framing device, explicitly not anybody's location.
- **`granularity` says how far it actually got.** A region-level answer is
  labelled as one; no city is invented from a country.
- **`accuracyRadiusKm` only when the provider published one**, and only on a
  city answer.
- **Never** the address, the provider's raw payload, or a confidence number
  nobody measured.

## Matching a record to a Homiio place

`services/geoip/placeMatch.ts`. Always constrained to the reported country, so
cross-border homonyms (there is a Barcelona in Venezuela) are unreachable rather
than unlikely.

1. **City**, by name within the country, tie-broken by distance to the
   provider's point; failing that, the nearest city within 50 km — but **only if
   the provider actually named a city.** A bare coordinate descends to the
   region instead of snapping to whatever is closest.
2. **Region**, by ISO-3166-2 code (both `CT` and `ES-CT` spellings) then by name.
3. **Country**, by ISO-3166-1 alpha-2.
4. Otherwise `unavailable: 'no_homiio_place'` — a *coverage* gap, deliberately
   distinct from `no_match`, which is a *provider* gap. The two are closed by
   different work.

Nothing is ever created. A public read that inserted a city as a side effect of
each visit is forbidden by both epics and by ADR 0001.

The distance query is `ST_DistanceSphere` over `cities.latitude/longitude`, which
carry no GiST index by the decision recorded in `db/schema/geo.ts`. The scan is
constrained to one country — hundreds of rows — and the answer is cached per
network, so it does not yet justify one. If city proximity becomes a hot path,
that note already says the honest trigger is a query like this becoming frequent.

## Caching and privacy

- **HTTP**: `Cache-Control: private, no-store`, plus `Vary: Accept-Language`. A
  shared cache anywhere on the path would hand one person's city to the next
  visitor.
- **Server**: an in-process `Map`, capped at 5 000 entries, evicted in insertion
  order, holding the normalised address for at most the contract's 30-minute
  TTL. It is never Redis and never a table — it dies with the task and cannot be
  queried, exported or subpoenaed as a history. A provider *error* is never
  cached, so one blip is not half an hour of neutral discovery for that network.
- **Client**: React Query, in memory, one shared key for every surface
  (`APPROXIMATE_LOCATION_QUERY_KEY`). Never persisted to disk.
- **Logs**: `services/geocoding/telemetry.ts` records the operation, the outcome,
  the duration and the `granularity`. Not the address, not the country, not a
  coordinate. A country code beside a timestamp is a weak locator for a single
  request, and the aggregate question ("is the database matching?") is answered
  without it.

An inferred position never becomes a residence, a listing address, a proof of
identity, a tax country or a saved primary area. Saving a permanent area still
requires a decision by the user.

## Configuration

| Variable | Where | Meaning |
|---|---|---|
| `GEOIP_DATABASE_PATH` | backend env | Filesystem path of the `.mmdb`. Empty ⇒ `not_configured`. |

**It is not yet set in production.** Switching it on is one line in the `homiio`
module's `environment` list in `oxy-infra/terraform-uswest2/app-services.tf`,
pointing at wherever GoWay makes the file available to the task, plus whatever
GoWay needs to mount it. That is deliberately not pre-added as an empty string:
an env var set to `""` is indistinguishable from an unset one to this code, so
the line would be inert configuration claiming a capability the deployment does
not have.

There is no secret, so nothing needs adding to `deploy-aws.yml`'s SSM sync
allowlist. If the dataset is ever switched to one requiring a licence key (a
MaxMind move, say), that key **is** a secret and the allowlist entry must land in
the same change — see `AGENTS.md`, and
`packages/backend/__tests__/unit/deploySecretSync.test.ts`, which is the gate.

## Operating it

- **Is it on?** `GET /api/geo/approximate-location` from outside the VPC. A
  `not_configured` reason means the path is unset or the file is unreadable; the
  backend logs the path once, at `warn`, on the first failed open.
- **Is it matching?** The `geo.request` metric with
  `operation: 'approximate_location'`. `outcome: 'empty'` with no `granularity`
  is every unavailable reason at once; the server log line beside it
  distinguishes them.
- **Updating the file** is replacing it and restarting the task. The reader is
  opened once per process and held for its lifetime.
