# ADR 0002 — One location and search contract for Home, Explore, reviews and evictions

- **Status:** Proposed
- **Date:** 2026-08-10
- **Issue:** [#346](https://github.com/OxyHQ/Homiio/issues/346) · **Epic:** [#344](https://github.com/OxyHQ/Homiio/issues/344)
- **Blocks:** #351 (geocoding gateway), #295 (deterministic homonym lookup), #352 (`LocationSelection` in state/URL/API), #353–#356, the geographic half of #358
- **Related ADRs:** `0001-canonical-housing-graph.md` (what a place *is*), `0003-privacy-verification-publication.md` (what may be *published* about a place), `0004-local-explainable-pricing.md` (what a place's prices *mean*)

> Everything measured in this document was re-derived from this repository at
> commit `c4d73a43` on 2026-08-10. Homiio is on PostgreSQL + PostGIS only —
> `models/`, `mongoose` and `db/backfill/` are deleted — so no claim here is
> carried over from the Mongo era. Figures elsewhere that predate that cutover
> should not be trusted for this domain without re-measuring.

---

## 1. Context

Homiio answers "where?" in at least nine incompatible ways today. They disagree
about the shape of a coordinate, about whether a place has an identity, about
what a bounding box means, about which query parameter carries free text, and
about what happens when a lookup fails. The result is a family of bugs that all
look like someone else's fault: a list of Barcelona homes under a map of Madrid,
a home screen headed "Homes in Catalonia" showing a global feed, a saved search
that quietly reopens in a different country, a "Near you" lens that filters
nothing.

None of these is a coding mistake in the file where it surfaces. They are all
consequences of there being no shared answer to "what is a location?".

### 1.1 The measured inventory

The census discipline matters here, so it is recorded rather than summarised.
An inventory whose job is "who represents location today?" cannot tell *I found
less* from *there is less*, so it needs a positive control — and the first two
attempts at this one were both wrong in that exact direction.

**Pass A — vocabulary grep, directory pathspecs.** Note the pathspecs are
directories (`packages/backend/controllers/`), not `dir/**/*.ts`, because the
`**/` form silently excludes top-level files in that directory and returns a
result that reads exactly like a complete inventory:

```bash
git grep -lEi 'SearchLocation|nominatim|boundingbox|bbox|swLat|neLat|onRegionChange|getCurrentPositionAsync|resolveCityId|locationLabel|geocod' -- \
  'packages/frontend/app/' 'packages/frontend/components/' 'packages/frontend/hooks/' \
  'packages/frontend/store/' 'packages/frontend/services/' 'packages/frontend/utils/' \
  'packages/backend/controllers/' 'packages/backend/routes/' 'packages/backend/db/' \
  'packages/backend/services/' 'packages/shared-types/src/'
# → 50 files
```

The positive control (`components/search/SearchResultsView.tsx`, which owns the
map's `onRegionChange` handler) is present, so the traversal ran. But so are the
*negative* controls: `store/locationStore.ts`, `store/getCategoryFilters.ts`,
`app/(tabs)/index.tsx`, `services/cityService.ts` and `components/mapTypes.ts`
are all location representations and **none of them matched**. The vocabulary
was too narrow, not the codebase too small.

**Pass B — widened vocabulary.** Adding `userLocation|currentLocation|cityId|
getCityBy|searchCities|coordinates|latitude|longitude|\blat\b|\blng\b|
radiusMeters|countryCode` takes it to **123 source files** and picks up all five
negative controls above. One further location holder is still absent, and it is
absent for a structural reason rather than a vocabulary one.

**Pass C — type closure.** `store/recentSearchesStore.ts` persists a full
location and names none of that vocabulary, because it holds it *through a
type*. A location carried by a type is invisible to any vocabulary grep, the
same way a type-only importer is invisible to a "who queries this table?"
census:

```bash
git grep -lE 'SearchQuery|SearchLocation|SearchBounds' -- packages/frontend
# → 25 files, of which 17 are absent from pass B
```

So the honest count is: **two passes plus a type closure**, and the third pass
was not optional. Any implementation PR under this ADR should re-run all three
rather than trusting a single grep.

### 1.2 The nine representations, with citations

| # | Representation | Shape | Where |
|---|---|---|---|
| 1 | `SearchLocation` | `{ label, shortLabel, center: [lng,lat], bounds?: {west,south,east,north} }` — no id, no provider, no country, no precision | `packages/frontend/components/search/types.ts:30` |
| 2 | Nominatim autocomplete suggestion | `AddressSuggestion { id, text, lat, lon, address? }`, fetched **from the device** straight to `nominatim.openstreetmap.org` | `packages/frontend/hooks/useAddressSearch.ts:36,84` |
| 3 | A second, duplicated Nominatim client + store | raw `any[]` responses, plus a 20-entry `searchHistory` of query text and raw results | `packages/frontend/hooks/useLocation.ts:24,69,140,168`, `packages/frontend/store/locationStore.ts` |
| 4 | Map viewport | `{ center, zoom, bearing, pitch, bounds:{west,south,east,north}, isFinal }` | `packages/frontend/components/Map.web.tsx:329`, `Map.tsx:58` |
| 5 | Device coordinates | `{ latitude, longitude }`, cached forever | `packages/frontend/hooks/useHomeFeed.ts:50` |
| 6 | City by slug | a hardcoded 14-entry slug→(name, state, country) map, then a name search taking result `[0]` | `packages/frontend/services/cityService.ts:139` |
| 7 | Canonical geo ids | `cities.id` / `regions.id` / `neighborhoods.id`, resolved by `id = $1 OR lower(name) = lower($1)` | `packages/backend/services/geoQueryService.ts:74` |
| 8 | Eviction location | `{ label, coordinates:{type:'Point',coordinates:[lng,lat]}, precision:'exact'\|'approximate', city?, countryCode? }` | `packages/shared-types/src/eviction.ts:35` |
| 9 | Review address | a flat free-text bag: `street`, `city`, `state?`, `country` (a **name**, not a code), `postal_code` **required**, `latitude?`, `longitude?` | `packages/shared-types/src/review.ts:296`, form at `packages/frontend/app/reviews/write.tsx:186` |

Three coordinate encodings coexist inside `@homiio/shared-types` alone:
`Coordinates { lat, lng }` (`common.ts:193`), `GeoJSONPoint.coordinates`
`[lng, lat]` (`common.ts:198`), and `SearchLocation.center` `[lng, lat]`.

### 1.3 The failures those representations actually produce

Each of these was read out of the current code, not inferred from the issue.

**(a) "Search this area" keeps the previous city's name *and* its centre.**
`handleSearchThisArea` adopts the new bounds but re-uses `query.location.label`,
`shortLabel` and `center` whenever they exist
(`packages/frontend/components/search/SearchResultsView.tsx:247`). Pan from
Barcelona to Madrid, press the button, and the selection becomes "Barcelona,
centre Barcelona, bounds Madrid".

**(b) The stale label is then sent as free text.** `buildSearchParams` emits
`params.q = location.label` unconditionally when a label exists
(`packages/frontend/hooks/usePropertySearch.ts:98-100`), *in addition to* the
bounding box. The backend ANDs the two: `matchesText` becomes a predicate over
the listing's `search_vector` OR the resolved city/region id
(`packages/backend/db/properties/propertyFilters.ts:252`), and that whole clause
is ANDed with `ST_Intersects` on the Madrid envelope
(`packages/backend/controllers/property/search.ts:83`, `:164`). The user is
asking for Barcelona-matching listings physically inside Madrid. The honest
answer is zero, and zero looks like "this area is empty".

The coupling is already recognised as a problem in the code: the home screen's
endless feed has to fabricate `label: ''` specifically to stop `q` being emitted
for a pure geo lens (`packages/frontend/app/(tabs)/index.tsx:159-168`). A
workaround written to defeat a field's own semantics is the field being wrong.

**(c) A resolution failure falls through to a global feed.** The deep-link
effect swallows a failed city lookup or geocode with the comment "the results
fall back to the default published feed"
(`packages/frontend/app/explore/index.tsx:201-204`). The store keeps whatever
location it had — usually none — and the query runs unrestricted. There is no
signal anywhere in the UI that the location was dropped.

The backend already distinguishes the two cases correctly for `?city=`: an
unresolvable city returns an empty page rather than an unfiltered one
(`packages/backend/controllers/property/search.ts:63-70`, `:148-152`) — but it
returns it with no machine-readable marker, so a client cannot tell "nothing
here" from "we did not understand where".

And the *transport* failure is worse: `propertyService.getProperties` catches
everything and returns `{ properties: [], total: 0 }`
(`packages/frontend/services/propertyService.ts:53-55`). A network error on the
home feed is indistinguishable from an empty city.

**(d) The home screen names a place it is not querying.** `resolveExplorePlace`
derives a display place from the nearest city's region, else its country, else
the active query label, else the first popular city's country
(`packages/frontend/app/(tabs)/index.tsx:116-134`), and feeds it into
`home.featured.gridLongTerm` ("Homes in {place}"). The feed behind that heading
is `buildHomeFeedFilters` → `getCategoryFilters(null) === {}`
(`packages/frontend/store/getCategoryFilters.ts:32`) — no geographic constraint
at all. A named heading over a global list is exactly the epic's principle 2
("location is never implicit") being violated by construction.

**(e) "Near you" filters nothing, and its unit is wrong.** The lens emits
`{ lat, lng, radius: NEAR_YOU_RADIUS_KM }` where the constant is **25**, in
kilometres (`packages/frontend/store/getCategoryFilters.ts:16`, `:59`). It is
sent to `GET /api/properties`, whose controller never builds a spatial
predicate — `withinCircle` is not imported there; `radius` is used only as a
ranking tiebreak, `preferredRadiusMeters`
(`packages/backend/controllers/property/list.ts:345-366`) — and which reads the
value in **metres** (its own default is `45000`). So "Near you" asks for a 25 km
lens, gets a global page ranked by an "inside 25 metres" flag that is false for
every listing on earth.

Two different endpoints and two different unit conventions are in play at once:
`GET /api/properties/search` clamps `radius` in metres
(`DEFAULT_RADIUS_METERS = 25_000`, `packages/backend/controllers/property/searchQueryBuilder.ts:99`),
and `GET /api/properties/nearby` names the same concept `maxDistance`
(`packages/backend/controllers/property/geospatial.ts:136`).

**(f) Homonyms are resolved by popularity or by array index.**
`cityService.getCityBySlug` tries the slug as an id, then a hardcoded 14-city
map (`barcelona → { name:'Barcelona', state:'Catalonia', country:'Spain' }`,
`packages/frontend/services/cityService.ts:148`), then
`searchCities(name, 1).data[0]`. `getCityByLocation` defaults `country` to
`'USA'` (`cityService.ts:60`). `searchCities` orders by
`propertiesCount DESC, name ASC` (`packages/backend/controllers/cityController.ts:558`),
so whichever Barcelona has more listings wins — deterministically, and
arbitrarily from the user's point of view, and the answer can flip as data
arrives.

**(g) The URL is a write-once seed, and the store is the only authority.**
`/explore` reads `?city`, `?query` and `?offering` once and pushes them into
Zustand (`packages/frontend/app/explore/index.tsx:165-210`). Nothing ever writes
back: the only `setParams` in the app is a saved-folder tab
(`app/(tabs)/saved/index.tsx:86`), and every entry point navigates with a bare
`router.push('/explore')` (`components/SearchBar.tsx:181,189`,
`components/widgets/QuickFiltersWidget.tsx:143,148`, `app/(tabs)/index.tsx:414`).
A search cannot be shared, bookmarked, reloaded or reached by Back.

**(h) A bounding box is validated on latitude only.** `parseBoundingBox` throws
when `swLat > neLat` but says nothing about longitude ordering
(`packages/backend/controllers/property/searchQueryBuilder.ts:251-256`). That
happens to be *correct today* for a reason nobody wrote down, and the reason is
load-bearing — see §9.3.

**(i) Exact coordinates ride in cache keys and logs.** `searchQueryKey` is the
built param object verbatim, including full-precision `lat`/`lng`
(`packages/frontend/hooks/usePropertySearch.ts:154-157`);
`homeFeedQueryKeys.feed` embeds the device fix in a React Query key
(`packages/frontend/hooks/useHomeFeed.ts:17-18`); and a failed search logs
`query: req.query` wholesale
(`packages/backend/controllers/property/search.ts:184-187`). Device coordinates
are cached with `staleTime: Infinity, gcTime: 1h` and are never re-checked
against a revoked permission (`useHomeFeed.ts:66-68`).

**(j) A saved search stores a label and nothing else.** The bookmark sends
`query: location.label` plus the non-geographic filters
(`packages/frontend/components/search/SearchResultsView.tsx:360-385`); the row is
`{ name, query: text, filters: jsonb }`
(`packages/backend/db/schema/saved.ts:106-124`). Re-opening it re-geocodes the
label with `maxResults: 1` and takes the first hit
(`packages/frontend/app/explore/index.tsx:120-131`, `:216-232`). Centre, bounds,
provider and identity are all discarded at save time and guessed at read time.
`recentSearchesStore` is the mirror image: it persists the *whole* query
including exact coordinates to AsyncStorage, and de-dupes entries by **label**,
so two different Barcelonas collapse into one.

**(k) The geocoding gateway exists and is bypassed.** The backend already has
`GET /api/geocoding/forward|reverse` with a shared 24-hour cache and a
rate-limit queue honouring the OSM policy
(`packages/backend/services/geocodingService.ts:77-143`,
`packages/backend/controllers/geocodingController.ts`). The map's
reverse-geocode uses it (`packages/frontend/components/Map.tsx:66`); the search
autocomplete does not. Its DTO, `AddressData`, is declared **twice** with
different fields — the backend copy carries `coordinates` and `bbox`
(`packages/backend/services/geocodingService.ts:19-32`), the frontend copy drops
both (`packages/frontend/components/mapTypes.ts:13-22`) — and neither lives in
`@homiio/shared-types`. The backend computes a bounding box from Nominatim and
the frontend type cannot represent it.

One piece of good news from the same sweep: `resolveGeoFilterAddressIds` has
**zero production callers left** (only `__tests__/integration/geoQueryResolution.test.ts`
and four doc comments). Its own docstring still names three callers that no
longer exist. It should be deleted by #351, not carried forward.

---

## 2. Decision

Homiio adopts **one shared representation of a location**, `LocationSelection`,
and one shared query envelope, `LocationQuery`, used identically by Home,
Explore, reviews and evictions on web, iOS and Android.

The eleven decisions that follow are the substance of this ADR. Everything after
§9 is contract detail and test material.

1. **`location` and `query` are different dimensions.** Free text says *what*;
   the selection says *where*. The label of a place is never sent as free text.
2. **A location has an identity.** Every selection carries a stable, serialisable
   key, and a canonical Homiio place is identified by its id — never by its name.
3. **A selection is atomic.** It is replaced wholesale or not at all. There is no
   API for mutating one field of it, which is what makes "old city + new bounds"
   unrepresentable rather than merely discouraged.
4. **"Search this area" replaces the geographic selection entirely.**
5. **A failed resolution never runs a location-less query.** Not on the client,
   not on the server, not for a legacy saved search.
6. **The URL is authoritative** on every platform (expo-router carries route
   params natively too), and the store is a derived cache with exactly one
   writer.
7. **The server echoes the location it actually used**, so map and list agreement
   is verifiable rather than assumed.
8. **Precision is a declared property of a coordinate**, never an implicit one,
   and exact coordinates never appear in a URL, a cache key, an analytics event
   or a log line.
9. **Public DTOs are Homiio's, not a geocoder's.** Provider identity is retained
   so a label is never geocoded twice, and an external candidate is a different
   thing from a materialised Homiio entity.
10. **Country is explicit and administrative hierarchy is explicit.** Homonyms
    are disambiguated by the user, never by popularity or array index.
11. **A bounding box may cross the antimeridian**, and the representation says so
    unambiguously.

### 2.1 What this ADR does not decide

- Which commercial geocoding provider Homiio buys (out of scope per #346).
- The drawable-polygon map UI. `polygon` exists in the type so the wire format
  need not change later; nothing is required to persist one until a product case
  is approved.
- What may be *published* about a place, and at what precision, for evictions,
  reviews and residence evidence — `0003-privacy-verification-publication.md`
  owns that classification. This ADR owns only how a location is **represented,
  transported, cached and keyed**, and defers to 0003 for which class a given
  field falls into.
- The canonical street/building/unit graph — `0001-canonical-housing-graph.md`.

---

## 3. The shared type (proposed)

Proposed, not shipped: this PR adds **no code**. The type belongs in
`packages/shared-types/src/location.ts` and lands with #352, together with the
codemod of the call sites in §10. The issue asks for a type in proposal form and
explicitly does not require the migration here.

```ts
/** WGS84 point. ONE encoding, named fields — a positional pair is transposable. */
export interface GeoPoint {
  readonly longitude: number;
  readonly latitude: number;
}

/**
 * A rectangle in degrees.
 *
 * `south > north` is an ERROR. `west > east` is LEGAL and means the box crosses
 * the antimeridian (west 170 → east -170 is the 20-degree strip over the
 * Pacific, not the 340-degree rest of the world). See §9.3 — this is the only
 * bounding-box representation that can express that at all, and PostGIS
 * `::geography` already reads it this way.
 */
export interface GeoBounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

/**
 * What a coordinate MEANS. Declared, never inferred.
 *
 *  - `exact`       a building-level point somebody deliberately provided.
 *  - `approximate` an exact point deliberately degraded (rounded or offset).
 *  - `centroid`    the representative point of an AREA. Not anyone's location.
 *  - `area`        the EXTENT is the meaning. Any point is derived framing
 *                  rather than the place's own location, and there may be
 *                  none at all. AMENDED — see §19(C); this line previously
 *                  read "no meaningful point at all", which `map_bounds`
 *                  below contradicts, and two implementers read the two
 *                  statements to opposite conclusions.
 */
export type LocationPrecision = 'exact' | 'approximate' | 'centroid' | 'area';

/**
 * Whether a place HAS a representative point. Added by §19(C).
 *
 * `center` used to be required beside a `precision` that could say `area`, so
 * a country — which Homiio stores no centroid for — had nowhere honest to go,
 * and the gateway emitted `(0, 0)`. `(0, 0)` is a real place, so absence needs
 * its own state. `center?: never` rather than a plain optional: an optional
 * still ACCEPTS `{ precision: 'area', center }`, leaving the contradiction
 * discouraged rather than unrepresentable.
 */
export type PlaceGeometry =
  | {
      readonly precision: 'exact' | 'approximate' | 'centroid';
      readonly center: GeoPoint;
      readonly bounds?: GeoBounds;
    }
  | {
      readonly precision: 'area';
      readonly center?: never;
      readonly bounds?: GeoBounds;
    };

/** A display label, pre-split by whoever knows how. Never `label.split(',')[0]`. */
export interface PlaceLabel {
  /** e.g. "Barcelona", "شارع الحمرا", "千代田区". */
  readonly primary: string;
  /** e.g. "Catalonia, Spain". Optional: some places have no meaningful parent. */
  readonly secondary?: string;
  /**
   * `generated` marks a label Homiio invented ("Map area", "Near you").
   * A generated label is never sent as free text and never re-geocoded.
   */
  readonly kind: 'place' | 'generated';
}

/** Explicit administrative hierarchy. `countryCode` is never optional. */
export interface AdminHierarchy {
  /** ISO-3166-1 alpha-2, uppercase. */
  readonly countryCode: string;
  /** ISO-3166-2 subdivision code where one exists. */
  readonly regionCode?: string;
  readonly regionName?: string;
  readonly cityName?: string;
  readonly neighborhoodName?: string;
}

/**
 * Where a place came from, and whether Homiio owns it.
 *
 * The distinction is the point: `homiio` is a row in this database with a
 * primary key that will still mean the same place after a provider swap;
 * `external` is a candidate a geocoder handed us, whose ref is only as stable
 * as that provider. An `external` place therefore MUST carry its own
 * centre/bounds inline so it survives the provider disappearing.
 */
export type PlaceSource =
  | {
      readonly kind: 'homiio';
      readonly entity: 'country' | 'region' | 'city' | 'neighborhood' | 'address';
      readonly id: string;
    }
  | {
      readonly kind: 'external';
      /** Registered provider id, e.g. `osm`. Never a URL, never a class name. */
      readonly provider: string;
      /** The provider's own stable ref, so a label is never geocoded twice. */
      readonly ref: string;
    };

export type PlaceType = 'country' | 'region' | 'city' | 'district' | 'neighborhood' | 'postcode';

export type LocationSelection =
  /** The device's own position. Coordinates are resolved at request time and NEVER serialised. */
  | {
      readonly kind: 'current_location';
      readonly center: GeoPoint;
      readonly radiusMeters: number;
      /** §19(C): a device fix is a POINT. `centroid`/`area` were never meaningful here. */
      readonly precision: 'exact' | 'approximate';
    }
  /** A named area: a country, region, city, district, neighborhood or postcode. */
  | ({
      readonly kind: 'place';
      readonly source: PlaceSource;
      readonly placeType: PlaceType;
      readonly label: PlaceLabel;
      readonly admin: AdminHierarchy;
    } & PlaceGeometry)
  /** A specific address a geocoder proposed but Homiio has not materialised. */
  | ({
      readonly kind: 'address_candidate';
      readonly source: PlaceSource;
      readonly label: PlaceLabel;
      readonly admin: AdminHierarchy;
    } & PlaceGeometry)
  /**
   * A map viewport the user confirmed. Has no name and never acquires one.
   *
   * `precision: 'area'` with a REQUIRED centre, which is why `PlaceGeometry`
   * is NOT applied here (§19(C)): a viewport's centre is real and is supplied
   * by whoever built the viewport. Deriving it downstream is a trap — the
   * naive midpoint of an antimeridian box is wrong (`west 170, east -170`
   * gives 0, the Gulf of Guinea, when the true centre is 180).
   */
  | {
      readonly kind: 'map_bounds';
      readonly bounds: GeoBounds;
      readonly center: GeoPoint;
      readonly label: PlaceLabel & { readonly kind: 'generated' };
      readonly precision: 'area';
      /** Countries the box overlaps, when known. A box may span several. */
      readonly countryCodes?: readonly string[];
    }
  /** A drawn area. Wire format reserved; nothing is required to persist one yet. */
  | {
      readonly kind: 'polygon';
      // GeoJSON geometry types, from `@types/geojson` or a local mirror.
      readonly polygon: GeoJSON.Polygon | GeoJSON.MultiPolygon;
      readonly bounds: GeoBounds;
      readonly label: PlaceLabel;
      readonly precision: 'area';
    }
  /** Several areas at once. Cannot nest. */
  | {
      readonly kind: 'multi_area';
      readonly areas: readonly Exclude<LocationSelection, { kind: 'multi_area' }>[];
      readonly label: PlaceLabel;
    };

/**
 * The full query. `location` and `text` are separate dimensions and neither is
 * derived from the other.
 */
export interface LocationQuery {
  readonly location: LocationSelection | null;
  /** What the user typed as free text. NEVER a place label. */
  readonly text: string | null;
}

/** Why a resolution failed. The UI must distinguish these; they are not one state. */
export type LocationFailureReason =
  | 'network'
  | 'rate_limited'
  | 'ambiguous'
  | 'no_results'
  | 'permission_denied'
  | 'position_unavailable'
  | 'unsupported';

export type LocationResolution =
  | { readonly status: 'idle' }
  | { readonly status: 'resolving' }
  | { readonly status: 'resolved'; readonly selection: LocationSelection }
  | { readonly status: 'failed'; readonly reason: LocationFailureReason };
```

### 3.1 `locationKey` — the stable identifier

One pure function produces the identifier used for URL serialisation, React
Query keys, saved-search identity and analytics. It is the only place a
coordinate is allowed to become a string, which is what makes the privacy rule
in §8 enforceable by a single test rather than by vigilance at every call site.

```ts
/** Grid for any coordinate that reaches a key: 2 dp ≈ 1.1 km of latitude. */
const KEY_COORD_DECIMALS = 2;
/** Grid for a bbox in a key: 3 dp ≈ 110 m — coarse enough to absorb map jitter. */
const KEY_BOUNDS_DECIMALS = 3;

export function locationKey(selection: LocationSelection | null): string {
  if (!selection) return 'none';
  switch (selection.kind) {
    case 'current_location':
      // NO coordinates. A device fix never reaches a key, a URL or a log.
      return `here:${selection.radiusMeters}`;
    case 'place':
    case 'address_candidate':
      return selection.source.kind === 'homiio'
        ? `${selection.source.kind}:${selection.source.entity}:${selection.source.id}`
        : `ext:${selection.source.provider}:${selection.source.ref}`;
    case 'map_bounds':
    case 'polygon':
      return `bbox:${round(selection.bounds, KEY_BOUNDS_DECIMALS)}`;
    case 'multi_area':
      return `multi:${selection.areas.map(locationKey).sort().join('+')}`;
  }
}
```

The body is illustrative, not shipped code; what is normative is that **one**
function produces the key and that its `current_location` branch has no
coordinate to emit.

`locationKey` and the `loc` URL token of §5.2 are two encodings of the same
identity, deliberately different: the URL form leads with the place type so a
human can read it, the key form leads with the source so keys group by
authority. Both are derived from `PlaceSource`, and there is exactly one
serialiser and one parser for each — four functions in total, all in the shared
package, none re-implemented per screen.

Two properties worth stating because they are what the key is *for*: two
different cities called Barcelona produce two different keys (they have
different ids), and a jittering map viewport produces one key (the 3 dp grid),
which is the same reason the current code rounds its bbox params to 3 dp
(`packages/frontend/hooks/usePropertySearch.ts:61-69`) and is worth keeping.

---

## 4. Query semantics

### 4.1 `location` and `text` are independent

`text` is what the user typed into a free-text box and did not resolve into a
place. It is matched against listing content. It is **never** populated from a
selection's label, and a selection is never derived from `text` without an
explicit user action.

Consequence, and the direct fix for §1.3(b): `buildSearchParams` stops emitting
`q = location.label`. `q` carries `LocationQuery.text` and nothing else. When a
user types "Barcelona" and picks the suggestion, `text` is cleared and
`location` is set — because they told us *where*, not *what*. When a user types
"loft with a terrace" and picks Barcelona, both are set, and both are meant.

### 4.2 "Search this area"

Pressing it performs exactly one state transition:

```
location := { kind: 'map_bounds', bounds: <current viewport>, center: <viewport centre>,
              label: { primary: t('search.summary.mapArea'), kind: 'generated' },
              precision: 'area' }
```

Everything about the previous selection is discarded: its id, its label, its
centre, its bounds, its provider, its country. `text` is untouched, because it
is a different dimension.

Three sub-rules make this enforceable rather than aspirational:

- **There is no `setBounds`.** The store exposes `setLocation(selection | null)`
  and nothing narrower. Today's `setBounds` merges a new box onto an existing
  location (`packages/frontend/store/searchQueryStore.ts:121-128`) and is
  precisely the API that makes the bug expressible; it is deleted rather than
  fixed.
- **The button is armed only by a finalised map movement** (`isFinal`, as today
  at `SearchResultsView.tsx:239-245`) and disarms as soon as it is pressed or the
  selection changes by any other route.
- **A `map_bounds` label is `kind: 'generated'`**, and the serialiser refuses to
  put a generated label anywhere a place label goes — not `q`, not a saved
  search's `name`, not an analytics `place` field.

### 4.3 Failure never degrades into a global search

**Client.** The results query is gated on `resolution.status === 'resolved'`.
In `resolving` the surface shows the previous results explicitly marked as stale
(§6.3). In `failed` it shows an error naming the reason, with a retry and a
"choose a different place" affordance. It does **not** issue a request. This
replaces the swallow-and-continue at `packages/frontend/app/explore/index.tsx:201-204`.

**Server.** `GET /api/properties/search` already answers an unresolvable
`?city=` with an empty page rather than an unfiltered one
(`packages/backend/controllers/property/search.ts:148-152`). Two additions:

- the response carries `location: { status: 'unresolved', requested: <token> }`
  so the client can render "we could not find that place" instead of "no homes
  here";
- a request that names *no* location at all is answered normally, because "no
  location" is a legitimate query — the failure mode this ADR forbids is a
  location that was **requested and lost**, not one never asked for.

**Transport.** `propertyService.getProperties` stops catching into an empty
result (`packages/frontend/services/propertyService.ts:53-55`). A failed fetch
must reach the caller as an error; "zero homes" and "the request failed" are
different answers and the UI needs to render them differently.

### 4.4 Switching offering

Changing between long-term, vacation, buy and exchange **preserves `location`
and `text` unchanged** and clears only the dimensions whose meaning is
offering-specific: the price range (monthly vs nightly vs sale price), dates and
guests. That is what the store already does for price and dates
(`packages/frontend/store/searchQueryStore.ts:84-98`) and it is right; this ADR
adds only that the geographic dimension is explicitly out of scope for that
reset. A person looking at Barcelona who switches to vacation still means
Barcelona.

The offering is part of the query key, so the results refetch; the location does
not need to be re-resolved, because a canonical place id does not depend on what
is being offered there.

---

## 5. URL and deep-link contract

### 5.1 Parameters

| Param | Meaning | Example |
|---|---|---|
| `loc` | the entire location selection, as one atomic token | `loc=city.homiio.01H8X...` |
| `q` | free text, and only free text | `q=loft%20with%20terrace` |
| `offering` | `long_term_rent` \| `short_term_rent` \| `sale` \| `exchange` | `offering=sale` |
| `label` | display-only hint so the pill renders before `loc` resolves | `label=Barcelona` |
| everything else | the non-geographic filters, unchanged | `priceMax=1400` |

`loc` is **one** parameter on purpose. The entire bug class in §1.3(a) is "half
of the previous location survived"; a single atomic token makes a half-update
unrepresentable in the URL as well as in the store.

### 5.2 `loc` grammar

```
loc := "city."   source "." id                  ; and region./country./district./neighborhood./postcode./address.
     | "bbox."   west "," south "," east "," north
     | "here."   radiusMeters                   ; NO coordinates, ever
     | "multi."  loc ( "+" loc )+
source := "homiio" | "<providerId>"
```

> **Amended 2026-08-10.** This grammar previously carried a fifth production,
> `"at." lng "," lat "," radiusMeters`, and it is **withdrawn** — see §19(B).
> A parser must REJECT `at.` rather than read it leniently. No production of
> this grammar puts a coordinate pair in a URL.

Examples:

```
/explore?loc=city.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTA&offering=long_term_rent
/explore?loc=city.osm.R349036&label=Barcelona
/explore?loc=bbox.-3.75,40.38,-3.65,40.45&offering=long_term_rent
/explore?loc=bbox.170,-20,-170,-16                 # crosses the antimeridian, legal
/explore?loc=here.25000&offering=short_term_rent
/explore?loc=city.homiio.01H8X...&q=loft%20with%20terrace
```

Rules:

- **`here.` never carries coordinates.** A shared or bookmarked "near me" link
  means "near *the opener*", which is both the privacy-preserving reading and
  the useful one.
- **`label` is display-only.** It is never sent to the API, never used to
  resolve, never persisted, and is dropped from the URL once `loc` resolves and
  supplies a real label.
- **An unparseable or unresolvable `loc` is a failure, not an absence.** It
  enters `resolution.status = 'failed'` and the screen shows the error. It does
  **not** silently become a global feed.
- **Back must work.** A location change is `router.push`; a filter or sort tweak
  is `router.setParams`/`replace`. Panning the map does not touch the URL at all
  until "Search this area" is confirmed — an un-confirmed viewport is not a
  query.

### 5.3 Legacy inbound params

`?city=<slug|name|id>` and `?query=<text>` (today at
`packages/frontend/app/explore/index.tsx:161-163`) stay accepted for one release
and are normalised on arrival:

- `?city=` resolves through the gateway; **one** unambiguous match becomes
  `loc=city.homiio.<id>` and the URL is rewritten with `replace`. Several
  matches open the disambiguation list (§7) — it never auto-picks.
- `?query=` becomes `q=` verbatim. It is **not** geocoded any more. Today it is
  (`explore/index.tsx:197-200`), which is how a text search silently becomes a
  place search.
- `/search`, `/search/<q>` and `/explore/<q>` keep redirecting as they do
  (`packages/frontend/app/search/index.tsx`, `search/[query].tsx`,
  `explore/[query].tsx`), forwarding into `q=`.

---

## 6. Source of truth

### 6.1 The URL is authoritative; the store is a derived cache

```
URL params ──(parse, one reducer)──> LocationQuery ──> React Query key ──> API
     ▲                                     │
     └────(one writer: commitQuery)────────┘
```

- The **URL** holds the committed query. It is the input on mount, on deep link,
  on Back/Forward, and on reload.
- The **store** holds the same value, parsed, plus the in-flight editing draft
  the `SearchPanel` mutates. A draft is not a query; it becomes one only when
  committed.
- **Exactly one writer** performs `commitQuery(next)`: it serialises to `loc`/`q`
  and calls `router.push`/`setParams`, and the store updates from the resulting
  params. There is no path that writes the store without writing the URL.
- Native has route params too, so this is one mechanism, not a platform fork —
  which matters because a store-only path on native is exactly how the two
  platforms drift.

This is a real change: today the URL is a write-once seed and the store is the
sole authority (§1.3(g)).

### 6.2 Saved-search hydration

1. Read the stored `LocationSelection` (§11 adds the column).
2. If `source.kind === 'homiio'`, re-read the entity by **id**. It may have been
   renamed; the id still means the same place. If the id no longer exists, the
   search is `failed('no_results')` and the user is asked to re-pick — it is not
   silently widened.
3. If `source.kind === 'external'`, use the **inlined** centre/bounds. Do not
   re-geocode: the label may be ambiguous and the provider may be gone.
4. If the row has no selection (a legacy row), follow §11.
5. Only then does the query run. A saved search never executes with a location
   that failed to hydrate.

### 6.3 Showing the previous query's data during a transition

Two mechanisms, and the second is what makes the first trustworthy.

**Client-side**: React Query with `placeholderData: keepPreviousData` is
permitted — it is the reason a results grid does not flash empty — but only when
the surface *says so*. Every results surface renders a stale banner whenever
`locationKey(displayedQuery.location) !== locationKey(activeQuery.location)`.
The map must move to the new selection at the same moment the banner appears, so
the two never silently disagree.

**Server echo**: the search response carries the location the server actually
applied:

```jsonc
{
  "success": true,
  "data": [ /* … */ ],
  "location": {
    "status": "resolved",
    "key": "homiio:city:01H8XQ7C2R9V6WQ2N4M0KJ3ZTA",
    "label": { "primary": "Barcelona", "secondary": "Catalonia, Spain", "kind": "place" },
    "bounds": { "west": 2.05, "south": 41.32, "east": 2.23, "north": 41.47 }
  },
  "total": 812, "page": 1, "limit": 24, "totalPages": 34, "hasMore": true
}
```

The map frames itself from `location.bounds` **in the response**, not from the
client's belief about the request. Under this rule "map in Madrid, list from
Barcelona" is not a bug that can be introduced by a race: the two read the same
field of the same payload.

---

## 7. Location-picker state machine

Three branches reach `resolved`, and only `resolved` may issue a search:

```
typing ──▶ suggesting ──▶ resolving ──▶ resolved            (text branch)
                              └──────▶ disambiguating ──▶ resolved
permission_ask ──▶ locating ──▶ resolved                    (device branch)
map_pending ──"Search this area"──▶ resolved                (map branch)
```

The transitions in full. Every row is a state, an event and the state it lands
in; anything not listed is not a legal transition:

| From | Event | To |
|---|---|---|
| `idle` | input focused | `typing` |
| `idle` | "use my location" | `permission_ask` |
| `idle` | map moved, `isFinal` | `map_pending` |
| `typing` | ≥ 2 characters, debounce elapsed | `suggesting` |
| `typing` | input cleared | `idle` |
| `suggesting` | candidates returned | `suggesting` (list shown) |
| `suggesting` | zero candidates | `failed('no_results')` |
| `suggesting` | request failed / 429 | `failed('network')` / `failed('rate_limited')` |
| `suggesting` | user picks one candidate | `resolving` |
| `suggesting` | user submits raw text without picking | `idle` + `text` set (a text search, not a place) |
| `resolving` | exactly one match | `resolved` |
| `resolving` | ≥ 2 matches | `disambiguating` |
| `resolving` | request failed / 429 | `failed('network')` / `failed('rate_limited')` |
| `disambiguating` | user picks | `resolved` |
| `disambiguating` | user dismisses | `typing` |
| `permission_ask` | granted | `locating` |
| `permission_ask` | denied | `failed('permission_denied')` |
| `locating` | fix obtained | `resolved` |
| `locating` | timeout / no fix | `failed('position_unavailable')` |
| `map_pending` | "Search this area" pressed | `resolved` (`map_bounds`) |
| `map_pending` | selection changed by any other route | `idle` (the pending box is discarded) |
| `failed(*)` | retry | back to the state that failed |
| `failed(*)` | user picks a different place | `typing` |
| any | selection cleared | `idle` |

Invariants:

- **No edge leads from any `failed` state to a query.** `failed` is terminal
  until the user acts. This is the state-machine encoding of decision 5.
- **`disambiguating` is a real state, not a silent choice.** Two or more matches
  never collapse to `[0]` (today: `cityService.ts:173`) nor to
  most-listings-wins (today: `cityController.ts:558`). The list shows each
  candidate's `admin` hierarchy so "Barcelona, Catalonia, Spain" and "Barcelona,
  Anzoátegui, Venezuela" are distinguishable at a glance.
- **A revoked permission returns to `permission_ask`.** Today the device fix is
  `staleTime: Infinity` and survives revocation for the process lifetime
  (`useHomeFeed.ts:66-68`); §8.3 caps it.
- **`map_pending` is not a query.** Panning changes nothing until confirmed.

---

## 8. Precision, privacy and retention

This ADR fixes the *mechanics*; `0003-privacy-verification-publication.md` owns
the *classification* of what is sensitive in evictions, reviews and residence
evidence. Where the two touch, 0003 wins on "what class is this?" and this ADR
supplies "how is a value of that class carried?".

### 8.1 The three kinds of coordinate

`LocationPrecision` is declared on every selection. The distinction that matters
most is **`centroid` is not anybody's location** — a city centre is a framing
device, and code that treats it as a home's position is wrong in a way no type
currently prevents.

Homiio already has one working precedent: an eviction marked `approximate` is
rounded to **3 decimals** server-side *before persisting*
(`packages/backend/controllers/eviction/shared.ts:63,130-133`,
`packages/backend/controllers/eviction/write.ts:103-109`), so the exact building
is never stored at all. That shape — degrade on the way **in**, not on the way
out — is the right one and this ADR generalises it: a value that was never
stored cannot leak from a query, a log, a backup or a future endpoint.

### 8.2 Where an exact coordinate may not go

Never in: a URL, a React Query key, an analytics event, a log line, a saved
search, a persisted client store, a notification payload, or an error report.

Today all six of these are violated:

| Violation | Location |
|---|---|
| exact `lat`/`lng` in a React Query key | `packages/frontend/hooks/usePropertySearch.ts:154-157` |
| device fix in a React Query key | `packages/frontend/hooks/useHomeFeed.ts:17-18` |
| whole query object logged on failure | `packages/backend/controllers/property/search.ts:184-187` |
| exact `center` persisted to AsyncStorage | `packages/frontend/store/recentSearchesStore.ts` (`query: SearchQuery`) |
| raw geocoder responses + 20-query history held in a store | `packages/frontend/store/locationStore.ts:15-20` |
| device fix cached with `staleTime: Infinity` | `packages/frontend/hooks/useHomeFeed.ts:66-68` |

The fix is structural, not a sweep: `locationKey()` (§3.1) is the only function
allowed to turn a selection into a string for any of those purposes, and it
cannot emit a device coordinate because `current_location` has no coordinate
branch. A single test on `locationKey` therefore guards all six.

For request logging: log `locationKey`, never `req.query`.

### 8.3 Rounding, offsetting, dropping

| Situation | Rule |
|---|---|
| Device position used to scope a search | Send at full precision in the request body **only**; round to 2 dp for any key, log or analytics event. |
| Device position at rest | In memory only. Max age 5 minutes; never persisted; cleared on permission change or app background→foreground beyond the max age. |
| A user-picked address on a review | Store as given (it is a building the reviewer chose), publish per 0003. |
| An eviction marked `approximate` | Round to 3 dp **before** persisting — existing behaviour, keep. |
| A city / neighborhood centre | `centroid` precision; safe to log and key by **id**, not by coordinate. |
| A public DTO for a private home | 0003 decides the class; this ADR requires that whatever it decides is expressed as a declared `LocationPrecision` on the wire, so a consumer can never mistake a degraded point for an exact one. |

---

## 9. Providers, portability and internationalisation

### 9.1 The client never talks to a geocoder

All geocoding goes through the backend gateway (#351), which already exists in
usable form: `GET /api/geocoding/forward|reverse`, a 24-hour shared cache and an
OSM-policy rate-limit queue
(`packages/backend/services/geocodingService.ts:77-143`). Three device-side
Nominatim clients are deleted: `useAddressSearch.ts:36,298`, and the four duplicated
ones inside `useLocation.ts:24,69,140,168`. `store/locationStore.ts` goes with
them (its only export path is `hooks/index.ts:2` and nothing consumes it).

Reasons, in order of weight: a per-device call cannot be rate-limited, cached or
attributed and will get Homiio blocked; the client sends a user's typing and
sometimes their position straight to a third party; and a provider swap
currently means editing app code that is already shipped to phones.

### 9.2 Public DTOs are Homiio's

`GeoPlace` — the gateway's response element — is Homiio's shape, defined once in
`@homiio/shared-types`. It is not Nominatim's `address` object flattened, which
is what `AddressData` is today, in two divergent copies
(`packages/backend/services/geocodingService.ts:19-32` versus
`packages/frontend/components/mapTypes.ts:13-22`, the second missing
`coordinates` and `bbox` entirely). Both are replaced by one shared type.

`PlaceSource` retains `{ provider, ref }` so a label is resolved **once**. It
also draws the line the epic needs between an external candidate and a
materialised Homiio entity: `source.kind` is that line, it is on the wire, and
`0001-canonical-housing-graph.md` owns the candidate→canonical transition.
Consequence for portability: an `external` place must always inline its own
centre and bounds, so a provider swap degrades identity, never usability.

### 9.3 The antimeridian, measured

`GeoBounds` says `west > east` means the box crosses the antimeridian. That is
not a convention chosen for elegance; it is what the database already does, and
it was verified rather than assumed. Against PostGIS 3.5 on
`postgis/postgis:17-3.5` (the image `docker-compose.postgres.yml` runs), for the
box `west=170, south=-20, east=-170, north=-16`:

| Probe point (lng, lat) | `::geography` (what Homiio uses) | plain `geometry` |
|---|---|---|
| Fiji `178.44, -18.14` — inside the intended strip | `t` | `f` |
| Samoa `-172, -18` — inside the intended strip | `t` | `f` |
| `170.5, -18` — inside, near the west edge | `t` | `f` |
| `0, -18` — outside (the "long way round") | `f` | `t` |
| `100, -18` — outside | `f` | `t` |
| `-100, -18` — outside | `f` | `t` |

Controls in the same run: a Barcelona point is inside a Barcelona-shaped
envelope (`t`) and outside a Madrid-shaped one (`f`), so the probe distinguishes
success from failure rather than answering `t` to everything.

`withinBoundingBox` casts to `::geography`
(`packages/backend/db/properties/propertyGeo.ts:109`), so **the wrap is already
correct at the SQL layer**, and `parseBoundingBox` validating latitude order but
not longitude order (`searchQueryBuilder.ts:251-256`) is right for a reason
nobody wrote down. Two consequences:

- **Write the reason down and pin it with a test.** Dropping the `::geography`
  cast, or "tidying up" by adding a `swLng <= neLng` validation, silently
  inverts every antimeridian query into its complement. The plain-geometry
  column of the table above is what that regression returns.
- **The real antimeridian gap is upstream, and it is a hard 400.** `WhereStep`
  builds a synthetic ±0.05° box around a picked point
  (`packages/frontend/components/search/steps/WhereStep.tsx:28,42-47`); at
  longitude 179.98 the east edge is 180.03, `isLongitude` rejects it, and the
  whole search fails with `INVALID_GEO_PARAMS`. Normalising longitudes into
  [-180, 180] and allowing `west > east` is the fix, and it belongs in the
  shared serialiser so it happens once. What the map component emits when panned
  across the antimeridian is **not yet measured** — the fixture in §12.3 exists
  to answer that, and it must be answered in a real browser and on a device,
  because a unit test on the serialiser cannot see it.

### 9.4 Homonyms, scripts, postcodes

- **`countryCode` is required on every `place` and `address_candidate`.** No
  default country anywhere. `cityService.getCityByLocation`'s
  `country = 'USA'` default (`packages/frontend/services/cityService.ts:60`) is
  deleted along with the 14-entry slug map above it.
- **Resolution is by id.** A name query returns *candidates*; the user picks. See
  the `disambiguating` state in §7. #295 implements the deterministic backend
  half.
- **Labels are provider-verbatim and pre-split.** `PlaceLabel.primary`/
  `secondary` replace `label.split(',')[0]`
  (`WhereStep.tsx:36`, `explore/index.tsx:125`), which assumes a comma-separated
  Western ordering and mangles scripts and address formats that do not use it.
  No re-casing, no transliteration, no title-casing — today `getCityBySlug`
  title-cases a slug (`cityService.ts:145`), which is wrong for every locale
  where case is not decorative.
- **Postcodes are optional everywhere.** The review form currently requires one
  to advance (`packages/frontend/app/reviews/write.tsx:240`, type at
  `packages/shared-types/src/review.ts:302`). Large parts of Ireland, and many
  areas elsewhere, have none; requiring it makes a whole country unreviewable.
- **The administrative hierarchy is explicit** rather than a comma-joined string,
  so a UI can render it in whatever order a locale expects.

---

## 10. Translation table

Every representation in §1.2, mapped. This is the work list for #352.

| # | Today | File:line | Becomes | Notes |
|---|---|---|---|---|
| 1 | `SearchLocation { label, shortLabel, center, bounds? }` | `frontend/components/search/types.ts:30` | `LocationSelection` (`place` \| `address_candidate` \| `map_bounds`) | `label`→`PlaceLabel.secondary`, `shortLabel`→`primary`; `center` tuple→`GeoPoint`; gains `source`, `admin`, `precision` |
| 2 | `SearchQuery.location` | `types.ts:71` | `LocationQuery.location` | `SearchQuery` keeps only the non-geographic filters |
| 3 | `searchQueryStore.setBounds` | `frontend/store/searchQueryStore.ts:68,121-128` | **deleted** | replaced by `setLocation(map_bounds)`; the merge is the bug |
| 4 | `searchQueryStore.setLocation` | `searchQueryStore.ts:81` | `commitQuery` (URL writer) | store stops being the authority |
| 5 | `toSearchLocation` + `LOCATION_BOUNDS_DELTA_DEG` | `frontend/components/search/steps/WhereStep.tsx:28,34-49` | gateway-supplied `bounds` | the ±0.05° synthetic box is deleted; the gateway already computes a real bbox (`backend/services/geocodingService.ts:167-179`) |
| 6 | `useAddressSearch` / `geocodeAddress` | `frontend/hooks/useAddressSearch.ts:36,84` | `useGeoSearch()` → `GET /api/geo/search` | device→Nominatim call removed |
| 7 | `useLocation*` + `locationStore` | `frontend/hooks/useLocation.ts:24,69,140,168`, `frontend/store/locationStore.ts` | **deleted** | duplicate clients, `any[]` state, 20-query history; unreferenced beyond `hooks/index.ts:2` |
| 8 | `AddressSuggestion` | `useAddressSearch.ts:4-17` | `GeoPlace` | carries `source`, `admin`, `bounds`, `precision` |
| 9 | `AddressData` ×2 | `backend/services/geocodingService.ts:19`, `frontend/components/mapTypes.ts:13` | one `GeoPlace` in `@homiio/shared-types` | frontend copy currently drops `coordinates` and `bbox` |
| 10 | `onRegionChange` payload | `frontend/components/Map.web.tsx:329-336`, `Map.tsx:58` | unchanged upward; consumers build `map_bounds` | add longitude normalisation in the shared serialiser (§9.3) |
| 11 | `handleSearchThisArea` | `frontend/components/search/SearchResultsView.tsx:247-267` | wholesale replace (§4.2) | stops re-using the old label/centre |
| 12 | `params.q = location.label` | `frontend/hooks/usePropertySearch.ts:98-100` | `q` = `LocationQuery.text` only | pinned today by `frontend/__tests__/buildSearchParams.test.ts:53` — that assertion must be inverted |
| 13 | `searchQueryKey` (raw params) | `usePropertySearch.ts:154-157` | `['propertySearch', locationKey(loc), textKey, filterKey]` | removes exact coordinates from the key |
| 14 | `useUserCoordinates` | `frontend/hooks/useHomeFeed.ts:50-69` | `current_location` selection + 5-min max age | `staleTime: Infinity` → bounded; permission re-checked |
| 15 | `getCategoryFilters('near_you')` | `frontend/store/getCategoryFilters.ts:16,59` | `{ kind:'current_location', radiusMeters: 25000 }` | fixes the km/metres mismatch (§1.3(e)) |
| 16 | `resolveExplorePlace` | `frontend/app/(tabs)/index.tsx:116-134` | deleted; the heading names `location.label` **or** says "everywhere" | a heading may only name the place the query actually used |
| 17 | `cityService.getCityBySlug` + slug map | `frontend/services/cityService.ts:139-176` | `GET /api/geo/resolve?loc=` | 14 hardcoded cities and `data[0]` both go |
| 18 | `getCityByLocation(name, state, country='USA')` | `cityService.ts:57` | `GET /api/geo/search?q=&countryCode=` | no default country |
| 19 | `searchCities` ordering by `propertiesCount` | `backend/controllers/cityController.ts:558` | candidate list + explicit disambiguation | #295 |
| 20 | `resolveCityId/RegionId/NeighborhoodId` | `backend/services/geoQueryService.ts:74,89,110` | kept, but id-only at the API edge | name matching stays for legacy inbound params only |
| 21 | `resolveGeoFilterAddressIds` | `geoQueryService.ts:179` | **deleted** | zero production callers; its docstring names three that no longer exist |
| 22 | `EvictionLocation` | `shared-types/src/eviction.ts:35` | `LocationSelection` (`address_candidate` \| `place`) + existing `precision` | rounding at `backend/controllers/eviction/shared.ts:130` is kept as-is |
| 23 | Eviction board `?city=` name match | `backend/db/evictions/evictionRepository.ts:95-96` | `?loc=` (id or bbox), name accepted for one release | |
| 24 | `CreateReviewAddressInput` | `shared-types/src/review.ts:296-310` | keeps its street fields; gains `LocationSelection`; `postal_code` optional; `countryCode` required | §9.4 |
| 25 | Reviews explore `:cityId` / `:neighborhoodId` | `backend/routes/public.ts:82-83` | unchanged | already canonical ids — the shape everything else is converging on |
| 26 | Saved search `query: text` | `backend/db/schema/saved.ts:113` | `+ location jsonb` | §11 |
| 27 | `recentSearchesStore` | `frontend/store/recentSearchesStore.ts` | stores `locationKey` + label; de-dupes by **key** | today it persists exact coordinates and de-dupes by label |
| 28 | `?city=` / `?query=` deep links | `frontend/app/explore/index.tsx:161-163` | `?loc=` / `?q=` | legacy accepted one release (§5.3) |

---

## 11. Compatibility plan for existing saved searches

Current row: `{ name, query: text, filters: jsonb, notificationsEnabled }`
(`packages/backend/db/schema/saved.ts:106-124`), where `query` is the location
**label** and `filters` holds the non-geographic filters
(`packages/frontend/components/search/SearchResultsView.tsx:360-385`).

1. **Add a nullable `location jsonb` column.** Do not touch `query` or
   `filters`. Existing rows stay valid and readable.
2. **New saves write both**: `location` = the serialised selection, `query` =
   `LocationQuery.text` (usually empty). `name` keeps its user-facing meaning.
3. **No bulk backfill.** Geocoding every stored label and taking the first hit
   would apply the homonym bug (§1.3(f)) to every user's saved searches at once,
   silently, in one migration. It is exactly the move this ADR exists to
   prevent.
4. **Lazy, confirmed migration.** On read, a row with `location IS NULL` is
   resolved through the gateway:
   - **exactly one candidate** → materialise the selection, write it back, mark
     `locationSource: 'migrated'`, and run normally;
   - **several candidates or none** → return the row with `location: null` and
     `locationStatus: 'needs_confirmation'`. The UI shows it with a "confirm
     where" affordance and **does not run it**. Decision 5 applies to legacy
     rows too.
5. **Alerts follow the same rule.** A saved search with
   `notificationsEnabled` and an unconfirmed location does not fire; it produces
   one prompt to confirm. An alert that quietly widened to "everywhere" would be
   worse than no alert.
6. **Watch the unique key.** `saved_searches_owner_name_key` is
   `(oxy_user_id, name)` (`saved.ts:131`), and the default name is
   `location.shortLabel` (`SearchResultsView.tsx:368`). Two different Barcelonas
   collide on that key today. The default name becomes
   `label.primary + " · " + label.secondary`, and a collision surfaces as a
   prompt to rename, never as an overwrite.
7. **`recentSearchesStore` needs no migration** — it is a device-local
   convenience. Bump the persist key to `@homiio/recent-searches-v2` and let the
   old entries expire; that also drops the exact coordinates it has been storing.

---

## 12. Discriminating fixtures

Each fixture states what a *wrong* implementation produces, so the fixture can
tell correct from incorrect rather than merely passing.

### 12.1 Barcelona → Madrid ("Search this area")

**Setup.** Resolve Barcelona (`loc=city.homiio.<bcn>`); confirm results. Pan the
map to Madrid; press "Search this area".

**Correct.** `location` becomes `{ kind: 'map_bounds', bounds: <Madrid> }`;
`locationKey` is `bbox:-3.75,40.38,-3.65,40.45`; the request carries the Madrid
box and **no** `q`; the response echoes the Madrid bounds; the pill reads "Map
area"; results are in Madrid.

**A wrong implementation produces**, and each is a distinct present-day bug:

| Wrong behaviour | Observable |
|---|---|
| merges bounds onto the old place (today, `SearchResultsView.tsx:247`) | `locationKey` still `homiio:city:<bcn>`; pill still reads "Barcelona" |
| keeps the old centre | response `location.center` is Barcelona's while `bounds` are Madrid's |
| still emits the label as `q` (today, `usePropertySearch.ts:99`) | request has `q=Barcelona…` **and** the Madrid box; **`total` is 0** — and note that zero is the *plausible-looking* failure, which is why the assertion must be on the request, not only on the result count |
| map frames from client state rather than the echo | map shows Madrid, list shows Barcelona, no banner |

### 12.2 Two cities called Barcelona

**Setup.** Barcelona, Catalonia, **ES** and Barcelona, Anzoátegui, **VE**. Type
"Barcelona".

**Correct.** The picker enters `disambiguating` and lists both with their
`admin` hierarchies. Nothing is queried until one is chosen. Choosing VE yields
`loc=city.homiio.<ve>`, `countryCode: 'VE'`, and a URL that reopens in Venezuela
on any device.

**A wrong implementation produces:**

| Wrong behaviour | Observable |
|---|---|
| takes `results[0]` (today, `cityService.ts:173`) | ES silently, always |
| orders by listing count (today, `cityController.ts:558`) | whichever has more listings — and the answer **changes as data arrives**, so a test that pins "ES" passes today and fails next month for no code reason |
| defaults country (today, `cityService.ts:57` defaults `'USA'`) | neither Barcelona; a 404 or a third city |
| serialises the label instead of the id | the saved search reopens in the other country |
| de-dupes recents by label (today, `recentSearchesStore.ts`) | the two Barcelonas overwrite each other in history |

**Fixture-shape warning.** Both rows must have genuinely different
`countryCode`, `regionName` **and** id, and the test must select the *second*
one — a fixture where the intended answer is also the first, the most popular,
or the default-country match cannot distinguish a correct implementation from
any of the four wrong ones.

### 12.3 A bounding box crossing the antimeridian

**Setup.** `loc=bbox.170,-20,-170,-16`. Listings seeded at Fiji
`(178.44, -18.14)` and Samoa `(-172, -18)` (both intended-inside) and at
`(0, -18)`, `(100, -18)`, `(-100, -18)` (all intended-outside, same latitude
band — a probe at a different latitude proves nothing, which is a mistake made
once while measuring §9.3).

**Correct.** Fiji and Samoa returned; the other three not. Verified against a
real PostGIS in §9.3.

**A wrong implementation produces:**

| Wrong behaviour | Observable |
|---|---|
| adds a `swLng <= neLng` validation | HTTP 400 — the safest wrong answer, and the only loud one |
| normalises by swapping west/east | the three far points return, Fiji and Samoa do not — **the exact complement** |
| drops the `::geography` cast on the envelope | same complement, from one deleted token (`propertyGeo.ts:109`) |
| lets a ±0.05° box exceed ±180 (today, `WhereStep.tsx:28`) | `INVALID_GEO_PARAMS` for any place within 0.05° of the antimeridian |
| splits into two boxes and ORs them | correct results, but `locationKey` differs from the single-box form, so the cache misses and the URL does not round-trip |

---

## 13. Complete example queries

### 13.1 Home — first load, permission granted

```
URL   /?loc=here.25000&offering=long_term_rent
GET   /api/properties/search?lat=41.3851&lng=2.1734&radius=25000
      &offering=long_term_rent&sortBy=createdAt&sortOrder=desc&page=1&limit=16
key   ['propertySearch','here:25000','','offering=long_term_rent|sort=createdAt:desc']
head  "Homes near you"
```

The coordinates are in the request and in **no** key. The heading says "near
you" because that is what was queried. Today this path sends `radius=25` to an
endpoint that reads metres and applies no spatial filter at all (§1.3(e)).

### 13.2 Home — permission denied

```
URL   /?offering=long_term_rent
GET   /api/properties/search?offering=long_term_rent&sortBy=createdAt&sortOrder=desc
head  "Homes everywhere"   +  a "choose a place" affordance
```

No location was requested, so a global feed is legitimate — and the heading says
so. What is forbidden is a heading that names a place the query did not use
(today, §1.3(d)).

### 13.3 Explore — a place plus free text

```
URL   /explore?loc=city.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTA&q=loft%20with%20terrace
      &offering=long_term_rent&priceMax=1400
GET   /api/properties/search?cityId=01H8XQ7C2R9V6WQ2N4M0KJ3ZTA&q=loft+with+terrace
      &offering=long_term_rent&priceMax=1400&page=1&limit=24
resp  location: { status:'resolved', key:'homiio:city:01H8X…',
                  label:{ primary:'Barcelona', secondary:'Catalonia, Spain', kind:'place' },
                  bounds:{ west:2.05, south:41.32, east:2.23, north:41.47 } }
```

`cityId` — not `q=Barcelona`. Free text is the user's own words. The map frames
from `resp.location.bounds`.

### 13.4 Explore — after "Search this area"

```
URL   /explore?loc=bbox.-3.75,40.38,-3.65,40.45&q=loft%20with%20terrace&offering=long_term_rent
GET   /api/properties/search?swLng=-3.75&swLat=40.38&neLng=-3.65&neLat=40.45
      &q=loft+with+terrace&offering=long_term_rent
```

`q` survives because the user typed it; the Barcelona identity does not, because
they moved the map.

### 13.5 Reviews — same selection, different resource

```
URL   /reviews?loc=city.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTA
GET   /api/reviews/explore/city/01H8XQ7C2R9V6WQ2N4M0KJ3ZTA
```

Reviews are already addressed by canonical id
(`packages/backend/routes/public.ts:82-83`) — this is the shape everything else
converges on. Handing the *same* `loc` token from Explore to reviews and back is
acceptance criterion 1, and it works precisely because the token carries an
identity rather than a label.

### 13.6 Evictions — bbox, and the same selection again

```
URL   /evictions?loc=bbox.2.05,41.32,2.23,41.47&status=upcoming
GET   /api/evictions?swLat=41.32&swLng=2.05&neLat=41.47&neLng=2.23&status=upcoming

URL   /evictions?loc=city.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTA&status=upcoming
GET   /api/evictions?cityId=01H8XQ7C2R9V6WQ2N4M0KJ3ZTA&status=upcoming
```

The board already accepts a bbox in exactly these four named params
(`packages/backend/controllers/eviction/browse.ts:69-76`); it gains `cityId`
beside its current name-matched `?city=`
(`packages/backend/db/evictions/evictionRepository.ts:95-96`).

---

## 14. HTTP contract

### 14.1 Geo (new, #351)

| Endpoint | Params | Returns |
|---|---|---|
| `GET /api/geo/search` | `q` (required), `countryCode?`, `types?` (`city,neighborhood,address`), `near?` (`lng,lat`), `limit?` (≤10) | `{ candidates: GeoPlace[] }` — **always a list**, never one auto-picked result |
| `GET /api/geo/resolve` | `loc` (a `loc` token) | `{ place: GeoPlace }` or `404` — never a fallback |
| `GET /api/geo/reverse` | `lng`, `lat` | `{ place: GeoPlace }` |

`GeoPlace` is the `place`/`address_candidate` payload of §3. The existing
`/api/geocoding/*` handlers are the implementation seed: keep the 24-hour cache
and the rate-limit queue (`geocodingService.ts:77-143`), change the DTO.

### 14.2 Property search — every parameter it accepts today

Read from `packages/backend/controllers/property/searchQueryBuilder.ts:352-489`
and `packages/backend/controllers/property/search.ts:80-165`, not from the
frontend's belief about it.

| Today | Read at | Under this ADR |
|---|---|---|
| `q` / `query` / `search` (three aliases, first wins) | `searchQueryBuilder.ts:475` | `q` only; carries `LocationQuery.text` |
| `city`, `state` (id **or** name) | `:476-477`, resolved `search.ts:93-102` | `cityId`, `regionId`, `neighborhoodId` (ids); names kept one release |
| `swLat`, `swLng`, `neLat`, `neLng` | `parseBoundingBox`, `:223-259` | unchanged; `swLng > neLng` documented as antimeridian-crossing |
| `bounds=west,south,east,north` | `:231-243` | unchanged (legacy) |
| `lat`, `lng`, `radius` (metres, default 25 000, max 200 000) | `parseCenterRadius`, `:265-282` | unchanged; **units documented as metres at every call site** |
| `propertyType` / `type`, `offering`, `exchangeMode` | `:366,371,442` | unchanged |
| `priceMin`/`priceMax` (aliases `minRent`/`maxRent`), `minSalePrice`/`maxSalePrice` | `:385-386,431` | unchanged |
| `bedrooms`/`minBedrooms`, `bathrooms`/`minBathrooms`, `amenities`, `guests`/`minGuests` | `:393,398,405,422` | unchanged |
| `verified`, `eco`, `instantBook`, `petFriendly`, `hasPhotos`, `fairPrice` | `:409-419` | unchanged |
| `status` (`available` alias) | `statusConditions`, `:305-317` | unchanged |
| `excludeIds`, `page`, `limit` (≤50), `sortBy`, `sortOrder` | `:452-464` | unchanged |
| — | — | **new** `location` echo in the response (§6.3) |
| — | — | **new** `location.status: 'unresolved'` on an unresolvable place (§4.3) |

Naming drift this exposes, worth fixing while the contract is open: the text
parameter is `q`/`query`/`search` on property search
(`searchQueryBuilder.ts:475`), `query` on address search
(`packages/backend/controllers/addressController.ts:111`), `q` on city search
(`cityController.ts:552`), `search` on the city list (`cityController.ts:207`)
and `name` on city lookup (`cityController.ts:315`). Coordinates are
`lat`/`lng` on search and list but `longitude`/`latitude` on the proximity feeds
(`packages/backend/controllers/property/geospatial.ts:72-73`) and on geocoding
(`geocodingController.ts:17`). The radius is `radius` on one proximity feed and
`maxDistance` on the other (`geospatial.ts:136,146`).

### 14.3 Property list — `GET /api/properties`

`lat`/`lng`/`radius` there are **ranking only**; there is no spatial predicate
(`packages/backend/controllers/property/list.ts:345-366`). Either it gains a
real `withinCircle` filter or callers wanting a geographic scope use
`/api/properties/search`. Today `useHomeFeed` uses the list endpoint and expects
a filter it does not get (§1.3(e)). This ADR requires the ambiguity be resolved
explicitly in #353, not left as a comment.

---

## 15. Cache and expiry

| Thing | Where | TTL | Invalidation |
|---|---|---|---|
| Canonical Homiio place, by id | server + client | indefinite | on the entity's own write |
| External geocoder candidate | **server only** | 24 h (existing, `geocodingService.ts:79`) | TTL |
| Autocomplete suggestion list | client memory | 5 min | on unmount; never persisted |
| Reverse geocode | server | 24 h (existing) | TTL |
| Device position | client memory | **5 min** | permission change; foreground beyond max age |
| Search results | client, keyed by `locationKey` | 30 s stale, 10 min gc (as today) | offering / filter / location change |
| `map_bounds` results | client | as above, key rounded to 3 dp | absorbs map jitter |
| Saved search selection | Postgres | permanent | user edit; re-resolved by id on hydration |
| Recent searches | device | 8 entries (as today) | de-duped by `locationKey`, not label |

Rules that are not TTLs:

- **A failed resolution is never cached.** Today's backend cache already only
  stores successes (`geocodingService.ts:100-102`) — keep that, and extend it to
  the client.
- **A geocoder result is cached server-side only.** A per-device cache cannot be
  invalidated, cannot be rate-limited and multiplies the calls the OSM policy
  counts.
- **A device position is never written to disk.** Not AsyncStorage, not
  SecureStore, not a query-cache persister.

---

## 16. Tests required of the implementation

Directly from #346, mapped onto the fixtures above.

1. **Round trip** URL → store → API request → URL, for each `loc` kind. The
   emitted URL must equal the input character-for-character.
2. **City → map bounds** drops every geographic remnant: assert on the **request
   params**, not only on the result count (§12.1 — zero results is the
   plausible-looking failure).
3. **Location permission** granted / denied / revoked-after-grant, on all three
   platforms. Revocation must return the picker to `permission_ask` rather than
   serving a cached fix.
4. **Geocoder** unreachable, rate-limited (429) and ambiguous. Each must produce
   a distinct `LocationFailureReason` and **zero** search requests.
5. **Homonyms**: §12.2, selecting the *second* candidate.
6. **Antimeridian**: §12.3, against a real PostGIS — the `::geography` semantics
   are not reproducible against a mock.
7. **`locationKey` never emits a coordinate for `current_location`**, and never
   emits more than 3 dp for a bbox. Mutation-test it: change `here:` to include
   the fix and confirm the test goes red.
8. **Saved-search hydration**: a legacy label row that resolves ambiguously must
   yield `needs_confirmation` and issue no search.
9. **Server echo**: the response's `location.key` equals the request's, and the
   map frames from the echo.

A note on (7) and (9): a test asserting only that "results came back" cannot
distinguish any of the failures in this document, because in almost every case
results do come back — just the wrong ones, or none, from a query nobody
intended. Every assertion here is on the **request** or on the **echo**, not on
the result set alone.

---

## 17. Consequences

**Good.**

- One selection works unchanged in Home, Explore, reviews and evictions,
  because all four address a place by identity.
- "Old city + new bounds" becomes unrepresentable rather than discouraged: the
  selection is atomic and `setBounds` no longer exists.
- A search is shareable, bookmarkable and reachable by Back.
- A resolution failure is visible everywhere it happens, including for saved
  searches written years earlier.
- The device's position stops appearing in cache keys, logs and disk.
- Swapping geocoder is a backend change; no shipped app binary is involved.
- Two same-named cities are two different things at every layer.

**Costs, stated plainly.**

- `SearchQuery` changes shape, so every consumer in the type closure of §1.1 is
  touched. `frontend/__tests__/buildSearchParams.test.ts:53` currently *asserts*
  the `q = label` behaviour this ADR removes; that assertion is inverted, not
  deleted.
- Adding a URL writer to a store-driven app risks navigation loops. One writer,
  and a test that a commit produces exactly one history entry.
- Server-side-only geocoder caching moves load from devices to Homiio. The
  existing 24-hour cache and rate-limit queue are sized for it; measure before
  widening.
- The lazy saved-search migration means some users see "confirm where" on an old
  search. That is the correct outcome — the alternative is silently running
  someone's alert against a city they never chose.

**Rejected alternatives.**

- *Keep `SearchLocation`, add fields.* It has no identity and no discriminant, so
  "a city" and "a rectangle" stay the same type and the merge bug stays
  expressible.
- *Send the label as `q` and let the backend disambiguate.* This is today's
  behaviour; it makes a text search and a place search the same request and is
  the direct cause of §1.3(b).
- *Store bbox and place side by side.* Two geographic fields is two sources of
  truth, and the bug is precisely that they disagree.
- *Bulk-backfill saved searches by geocoding the label.* Applies the homonym bug
  to every user at once, silently, in a migration.
- *Client-side geocoder caching.* Cannot be invalidated, cannot be rate-limited,
  and puts user typing on a third-party network path.

---

## 18. Acceptance criteria (#346)

| Criterion | Where |
|---|---|
| The same geographic selection works in Home, Explore, reviews and evictions | §3, §13.1–13.6 |
| "Search this area" is unambiguously defined | §4.2 |
| A map movement never combines the previous city with the new bounds | §4.2 (atomic replace, `setBounds` deleted), §12.1 |
| A query never falls back to a global feed when resolution fails | §4.3, §6.2, §11.4 |
| Free text, canonical place, address candidate and map bounds are distinguished | §3 (`LocationSelection` discriminant), §4.1 |
| Homonyms and multi-country results are documented | §7 (`disambiguating`), §9.4, §12.2 |
| A precision and retention policy for the user's location | §8 |
| A compatibility plan for existing saved searches | §11 |
| Discriminating fixtures for Barcelona/Madrid, two Barcelonas and an antimeridian bbox | §12.1, §12.2, §12.3 |

---

## 19. Amendments

Changes made to this ADR after it was written, each dated and with the reason
that forced it. Both of the entries below were found while IMPLEMENTING the
contract in `packages/shared-types/src/location.ts` (#352's foundation half),
which is the point of recording them here rather than in a commit message: a
grammar nobody amends is one somebody implements again from the original text.

### A. §3's `LocationSelection` union is SIX kinds (2026-08-10, clarification)

`current_location`, `place`, `address_candidate`, `map_bounds`, `polygon`,
`multi_area`. §3 has always listed exactly these; the count is recorded because
an implementation brief derived from this document miscounted it as seven, and
a phantom seventh kind is the sort of thing an implementer looks for, fails to
find, and then invents. Nothing in §3 changes.

### B. §5.2's `at.` production is WITHDRAWN, and a parser must REJECT it (2026-08-10)

The grammar carried `at. lng "," lat "," radiusMeters` for a pin the user
dropped. It is removed, and `parseLocationToken` returns a typed failure
(`coordinates_in_url`) for any token in that form.

**Why, and it is decision 8 rather than a matter of taste.** "Exact coordinates
never appear in a URL, a cache key, an analytics event or a log line" (§2.8,
§8.2) — and `here. radiusMeters` exists precisely so the device case carries
none. `at.` put a raw coordinate pair straight back into the URL, which is the
one place §8.2 names first.

**What made it worth fixing rather than leaving inert.** No `LocationSelection`
kind mapped to `at.`, so nothing could ever produce one — it was a production
the parser accepted and the serialiser could not emit. That asymmetry is not
harmless: a grammar that blesses a form is how the form gets used, and the
predictable route in is somebody wiring "search around this pin" to it because
§5.2 appeared to permit it. A lenient parser keeps that door open; a typed
rejection closes it, and names the rule in the failure reason so whoever meets
it learns why rather than assuming a typo.

**If the case is genuinely needed later** — a point somebody else chose, as
opposed to the opener's own device — it needs its own `LocationSelection` kind
with a declared `LocationPrecision`, added by amending §3 deliberately. It does
not come back as a grammar leftover rediscovered by the next implementer.

### C. A place may have NO centre, and §3 made that unsayable (2026-08-10)

§3 declared `center: GeoPoint` as REQUIRED on `place`, on `address_candidate`
and on `GeoPlace`, while `LocationPrecision` offered `area` — which the same
section described as *"no meaningful point at all"*. **The type therefore said a
place could have no meaningful point and simultaneously demanded one.**

**What it produced, measured rather than imagined.** Homiio's schema stores no
centroid for a country or a region, so the geocoding gateway had nowhere honest
to put that fact and emitted `{ longitude: 0, latitude: 0 }` for every one of
them. The search screen's fallback then drew a ±0.05° box around that point, so
choosing "Spain" issued a query over an 11 km square in the Gulf of Guinea and
returned **zero listings**, under a map of open ocean. Nothing threw. Zero
results is the plausible-looking failure — it reads as "no homes in Spain", not
as "we invented a centre" — which is why it survived into review.

**`(0, 0)` is a real coordinate.** It is a point in the Atlantic, and longitude
zero runs through Greenwich, Accra and Tema. A type that forces it as the "no
centre" value cannot distinguish ABSENT from THERE — the same family as a check
that cannot distinguish success from failure. Absence needs its own state.

**The fix, and why it is structural rather than an optional field.** §3 gains
`PlaceGeometry`, a two-member union carried by `place`, `address_candidate` and
`GeoPlace`: either a real point (`exact` / `approximate` / `centroid`, with
`center` required) or an extent (`area`, with `center?: never`). A plain
`center?: GeoPoint` was tried against the compiler first and **still accepts**
`{ precision: 'area', center }`, which would have left the contradiction
discouraged rather than unrepresentable; `never` refuses it as an object literal
AND through a variable, which is the form the gateway writes. It also makes the
mirror unrepresentable for free — a `centroid` with no centre no longer
compiles — and a one-directional guard here would have been half a guard.

`bounds` stays optional on the `area` branch deliberately: requiring it would
move the fabrication one field across, forcing a country with no stored bbox to
invent a rectangle instead of a point.

**Two things that did NOT change, and the reasons are the interesting part.**

- **`map_bounds` keeps `precision: 'area'` with a REQUIRED centre**, which is
  why `PlaceGeometry` is not applied to it. A viewport's centre is real and is
  supplied by whoever built the viewport. Deriving it downstream instead is a
  trap: the naive midpoint of an antimeridian box is wrong — for
  `west 170, east -170` it computes `(170 + -170) / 2 = 0` and lands in the Gulf
  of Guinea, when the true centre is 180. The field prevents exactly the bug
  this amendment is about, arrived at from the other direction.
- **`current_location.precision` narrows to `'exact' | 'approximate'`.** A
  device fix is a point; `centroid` and `area` are properties of an area and
  were never meaningful there, so the same lie was expressible in a second
  place.

**The root cause was prose, not structure.** `area` was documented as "no
meaningful point at all" while `map_bounds`, forty lines below, carried `area`
AND a required centre. Two implementers read that sentence and reached opposite
conclusions — one made its own `center` optional and said so; the other emitted
Null Island — which is the measurable cost of a definition contradicted by a
declaration in the same section. `area` now says what it actually distinguishes:
whether the point IS the place or merely a way to FRAME it.

**The follow-on hole, and why it is a PREDICATE rather than a constraint.** With
`center` and `bounds` both optional, a place with NEITHER became expressible — a
place nothing can frame — and closing a hole that produced a wrong point by
opening one that produces no point at all would be a poor trade, because the
second failure is quieter: a map handed such a place renders nothing and reports
no error, which looks exactly like a map still loading.

It is nevertheless **not forbiddable on the type**, and the reason is measured
rather than argued. A city Homiio knows by id and name but holds no coordinates
for is a legitimate **disambiguation candidate**: `/api/cities/lookup` returns
one today, deliberately, and asserts it carries no `center` and
`precision: 'area'`. A user choosing between two cities called Riverside can
pick that one, and the search that follows scopes by `cityId`, which needs no
geometry whatsoever. Requiring geometry on the DTO would force that candidate to
be dropped from the list — putting back a homonym the user can no longer reach,
which is the defect §12.2 exists to prevent — or to have geometry invented for
it, which is the defect this amendment just removed.

So the invariant binds at a narrower boundary than the type: **a place being
RESOLVED for display must be framable; a place being OFFERED for selection need
not be.** `GET /api/geo/resolve` answers 404 rather than returning an unframable
place; `GET /api/geo/search` may list one. §3 gains `isFramablePlace` so both
sides read one predicate instead of each spelling the condition out, and it is
mutation-tested: making it answer `true` unconditionally — the shape that lets an
unframable place reach a map — turns its test red.
