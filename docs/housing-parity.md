---
title: Bloom Housing parity matrix
---

# Housing parity matrix

The durable inventory #518 §6 and #519 §6 require: every Bloom Housing surface,
control and action, against what Homiio actually has — screen, hook, endpoint,
persistence, and the test that proves it.

**Status vocabulary**, used exactly as the issues define it:

| | Meaning |
|---|---|
| **live** | Implemented end to end and covered by a test that would fail if it broke. |
| **partial** | Reachable, with a named gap — not "mostly done". |
| **open** | Not implemented. |
| **blocked** | Waiting on a decision or a dependency, named in the row. |
| **divergent** | Homiio's domain deliberately differs from the template's. |

**Neither "we shipped JSX" nor "an endpoint exists" is `live`.** The issues are
explicit about both, and every `live` below names the test.

---

## How this was derived, and what it is not

Read on **2026-09-19** from Homiio `main` and Bloom `origin/main`
(`2d6f36f`). Every row was checked against the code — the schema column, the
route, the query builder, the component — and not against a plan.

**Nothing here was verified by running the app.** These are static claims about
what exists, not about how it looks or behaves on a device. #518 §10.3 and
#519 §11.4 require visual and multiplatform evidence; that is a separate,
unstarted column and is not implied by any `live` below.

Two PRs closed rows since this was written and are marked: **#522** (GeoIP and
the unblocked start) and **#523** (Sindi contextual actions).

---

## 1. Entry and location

| Bloom reference | Homiio | Status | Evidence / gap |
|---|---|---|---|
| App opens straight into housing | `app/(tabs)/index.tsx` | **live** | #522. The mandatory picker is gone; `locationScopeLadder.ts` ends in `discovery`, and two sweeps fail if a barrier returns. |
| — (Homiio-only) | `GET /api/geo/approximate-location` | **partial** | #522. Endpoint, matcher, trust boundary and client are live and tested; **the DB-IP City Lite file is not installed yet** (it will be served from GoWay), so production answers `not_configured` and falls back to discovery. `docs/geoip.md`. |
| `HousingHeader` search | `components/search/HomeSearch.tsx` | **live** | States the area it queries; inferred areas read "· approximate area". `__tests__/location/scopeWhere.test.ts`. |
| Destinations when unplaced | `components/home/HomeDiscoveryBoard.tsx` | **live** | #522. Real cities with inventory, each declaring its scope; never `global=true`. |
| No permission prompt on mount | maps, `useUserCoordinates` | **live** | #522. `__tests__/location/noPermissionOnMount.test.ts` — two allow-listed files may prompt, each answering a press. |

---

## 2. `HousingFilters` — control by control

The template's filter dialog, per mode. Homiio's is
`components/search/SearchFiltersDialog.tsx`; the URL is
`utils/searchUrl.ts`; the SQL is
`controllers/property/searchQueryBuilder.ts`.

A control is `live` only when it survives **all four**: UI → URL → SQL → result
count.

### Rent

| Control | UI | URL | SQL | Status |
|---|---|---|---|---|
| Price range | ✓ | `priceMin`/`priceMax`, `priceCurrency` | per-offering price column, narrowed to one currency | **live** — the unit travels with the bound, the response names it, and a mixed-currency area offers the choice; §6 |
| Price histogram | ✓ real | — | `GET /properties/search/price-histogram` | **live** — not the demo's fake timer |
| Property type | ✓ | `propertyType` | `typeIn` | **live** |
| Bedrooms / bathrooms | ✓ | `bedrooms`/`bathrooms` | minimum, `inRange` | **live** |
| Floor area | ✓ | `sizeMin`/`sizeMax` | `areaInRange` | **live** — m², and an unmeasured listing is excluded from a maximum rather than matching it |
| Availability (now / from date) | ✓ | `availableNow`/`availableBy` | `availableBy` | **live** — long-term and exchange only; a stay is booked for a range and a sale completes |
| Features | partial | `amenities` | `hasAllAmenities` | **partial** — Bloom's `features` and Homiio's amenities are not the same vocabulary; unmapped |
| Floor | ✓ | `groundFloor`, `hasElevator` | `floor = 0` over listings that PUBLISH a floor; `has_elevator` | **partial** — ground floor and lift are live; "top" and "middle" are not offered, see below |

### Buy

| Control | Status | Note |
|---|---|---|
| Price (log scale, "asking price") | **partial** | The range works and carries its currency (§6); the scale and the per-mode bounds are Bloom's, not adopted |
| Property type, rooms | **live** | Shared with rent |
| Floor area (slider) | **partial** | The filter is live and shared with rent; Bloom's slider variant is not adopted |
| Energy rating | **open** | **No column at all.** Needs schema, ingest and a source before a filter means anything |
| Features, floor | **open** | As above |

### Stays

| Control | Status | Note |
|---|---|---|
| Type of place (room / entire home) | **partial** | `PropertyType.ROOM` exists; the segmented room-vs-whole-home control does not |
| Nightly price | **live** | `priceColumnForOffering` selects the nightly rate |
| Beds | **open** | No `beds` column; `max_guests` is a different fact |
| Amenities | **live** | |
| Instant booking | **live** | `properties.short_term_rent_instant_book` |
| Dates / guests | **partial** | In `SearchQuery` and the URL; availability is filtered on `/properties`, not on `/properties/search` |

### The floor filter: what it took, and what it still will not claim

`properties.floor` was `doublePrecision NOT NULL DEFAULT 0`, so "ground floor"
and "nobody said" were the same bytes and a ground-floor filter matched the
catalogue. Migration `0024` makes the column nullable and clears the defaulted
zeros, so `0` is now a real answer and the only one that means the ground floor.
Negative floors — a basement is a floor somebody can be asked to live on — are
representable for the first time.

**The backfill is lossy and says so.** At rest a deliberate `0` and a defaulted
`0` are indistinguishable, so nothing can preserve the first while clearing the
second. Clearing both is the reading that cannot assert something false: "we do
not know" is true of every one of those rows today. The few genuine ground
floors are not lost for long — external listings are re-ingested continuously,
and the provider layer has always parsed Otodom's `ground_floor` as a real `0`
(`providers/pl/otodom/parse.ts`).

**A floor that is not published is not filtered on either.** The serializer
withholds `floor` below `exact` precision because the floor is part of the
address (ADR 0003). A filter with no matching rule would hand the same fact back
through a different door: ask for the ground floor inside a small enough area
and the result set tells you the floor of a listing whose payload refused to. So
the predicate is narrowed to what the row publishes — both columns that decide
it, since `show_address_number = false` caps the ceiling at `street`. The chip
carries a note saying the filter reaches only listings that publish a floor, so
an empty result reads as "most listings here do not say" rather than "there are
none".

**Two chips, not Bloom's four.** Bloom's `FloorFilter` offers Ground / Middle /
Top / With elevator. Homiio can answer half of it: there is **no column for how
many floors a building has**, so "top" and "middle" have nothing to resolve
against and are not drawn. "With a lift" is new and needs no precision gate —
a lift is not part of the address.

### Swap

| Control | Status | Note |
|---|---|---|
| Kind of exchange | **divergent** | Bloom offers swap / **guest points**; Homiio has `swap \| host \| both`. Not equivalent — see §7 |
| Rooms, features | **live** / **partial** | As rent |
| Verified members only | **partial** | `verified` filters `properties.is_verified` — a LISTING check, not the identity check Bloom's copy describes. Corrected on re-reading: the first draft of this matrix said "open", which was wrong |

---

## 3. Explore and the map

| Bloom reference | Homiio | Status | Evidence / gap |
|---|---|---|---|
| `ExplorePage` grid, favourites | `components/search/SearchResultsView.tsx` | **live** | Real results, saving, infinite list |
| Categories | `PropertyTypeCategoryBar.tsx` | **live** | |
| Result count | `FilterFooter` | **live** | From the real query |
| Save this search | `useSavedSearches` | **live** | `saved_searches` table |
| List / map switch | `store/exploreViewStore.ts` | **live** | #523 lifted it out of local state so it is reachable |
| Map, price markers, selection | `components/Map.tsx` / `.web.tsx` | **live** | WebView + MapLibre; **not** the template's `MockMap` |
| "Search this area" | `pendingViewport` + `commitPendingViewport` | **live** | Panning changes nothing until confirmed |
| Marker clustering | `cluster` prop | **partial** | Present; unverified against a large result set |

---

## 4. Listing pages

| Bloom | Homiio | Status | Gap |
|---|---|---|---|
| Gallery, facts, amenities | `PropertyOverview`, `AmenitiesGrid`, `DetailIconGrid` | **live** | |
| Save / share / report | `PropertyActionBar`, `app/properties/[id]/report.tsx` | **live** | |
| Contact / visit | `LandlordSection`, `book-viewing.tsx` | **live** | External listings keep their source CTA |
| Apply | `app/properties/[id]/apply.tsx` | **live** | |
| Place reviews | `ReviewsSection`, `CommunityNotesSection` | **live** | Building/unit reviews, kept distinct from stay reviews |
| Floor plans | — | **open** | No column, no upload, no render |
| Energy label | — | **open** | No column |
| Price history chart | — | **open** | `areaPriceComparison` is an AREA fact, not this listing's history |
| **Sale:** price per m², mortgage calculator | `SaleDetailsSection`, `MortgageCalculatorSection` | **live** | Explicitly a simulation, not an offer |
| **Stays:** calendar, guests, price breakdown, booking | `AvailabilitySection`, `BookingCard`, `useStayBooking` | **partial** | Reservations exist; the public availability projection #518 §7.5 asks for does not |
| **Swap:** propose, accept, track | `ExchangeSection`, `useExchangeQueries` | **partial** | Proposals persist; points do not exist — §7 |

---

## 5. My home, Saved, Publish, Evictions, widgets

| Bloom | Homiio | Status | Gap |
|---|---|---|---|
| `LeaseSummaryCard` | `app/my-home.tsx` | **live** | |
| `RentPaymentList` | `LeasePaymentsSection`, `LeaseLedgerSection` | **partial** | The **ledger** exists (`lease_payment_movements`): obligation, attempt, confirmed payment, manual declaration, partial, refund and a DERIVED balance, with idempotency on every write. A tenant declares a transfer and a landlord confirms it. **Receipts are open**; the processor is blocked — see below |
| "Pay rent" (a checkout) | — | **blocked** | Needs a processor decision. `kind: 'processor'` is in the model so adding one later does not migrate a live ledger, but no route creates one and no card or bank detail is stored anywhere. #518 §7.2 is explicit that its absence is a documented delivery block, not licence to drop the row |
| `MaintenanceRequestCard` / repairs | `MaintenanceSection`, `/maintenance/*` | **live** | `maintenance_requests` + comments + events + attachments, a declared state machine under a row lock, authorization in the repository query, notifications through the dispatcher. Photos go through the private path — stored under `private/`, re-encoded so the phone's GPS does not travel with them, delivered only to the two sides of the lease |
| "Message landlord" | — | **blocked** | The ecosystem audit §7.3 asks for is done: [`docs/messaging-audit.md`](./messaging-audit). Allo IS the platform and is explicitly multi-product, but its SDK is unpublished, its server cannot open a conversation, and enrolling Homiio enrols a device on the person's whole Allo account. Three decisions named there, none of them an implementer's. No button is drawn meanwhile — the Inbox tab is a notification list |
| `DocumentList`, signatures | `LeaseDocumentsSection`, `/contracts/[id]` | **partial** | Upload/list/view exist; "uploaded" is not "verified" and the checklist is not yet server state. An application's documents are no longer delivered by the public image route — see below |
| `TenancyTimeline` | `LeaseHistorySection` | **live** | Real lease events |
| `ApplicationChecklist` | `useApplicationQueries` | **partial** | Applications persist; the checklist's per-requirement state does not |
| `SavedSearchCard` + alerts | `useSavedSearches`, `useHousingAlerts` | **live** | `housing_watch_rules` / `housing_alerts`, with a connected job — not a local toggle |
| Wishlists / collections | `savedPropertyFolders` | **live** | Owner-scoped |
| Trips and swaps | `useReservationQueries`, `useExchangeQueries` | **partial** | Real rows; not surfaced as the template's trip cards |
| `PublishPage` wizard | `useCreatePropertyWizard`, `properties/create.tsx` | **partial** | Real uploads, `status: 'draft'`, server validation. Photo **order** and full draft resumption unverified; no `setTimeout` success anywhere |
| `EvictionsPage` | `app/evictions/*` | **live** | Board, detail, timeline, resources, RSVP — a Homiio domain the template only sketches |
| `HousingWidgets` | `components/widgets/*` | **partial** | Saved searches and featured are real; the area-price and neighbourhood widgets are gated off by default and show nothing invented |

---

### The private document path — and the correction this row needed

This section previously said repair photos were blocked because "there is no
private object path to attach to". **That was wrong, and it was wrong in the
direction that mattered.**

The bucket has never been public. `oxy-infra/terraform-uswest2/s3-apps.tf`
creates every app's media bucket with `block_public_acls`,
`block_public_policy`, `ignore_public_acls` and `restrict_public_buckets` all
on, and only oxy-api's bucket sits behind the CDN. What made objects reachable
was Homiio's own `GET /api/images/file/*`, mounted on `routes/public.ts`: it
takes a key and returns bytes, with no session and no viewer. Correct for a
listing photo, which is published on purpose.

It was also how a **tenant's application documents** were delivered — identity,
payslips, employment letters — because `imageUploadService.getImageUrl()` points
at that route and the URL went straight into the application's wire shape, with
a year of `public` cache on the response. Anyone who ever saw one held a
permanent, shareable link.

**That is fixed.** `utils/imageStoreKey.ts` refuses a private key prefix on the
public route — which closes the door for the objects already stored, with no
data migration, because the bytes never move — and
`GET /api/applications/:id/documents/:documentId` serves them to the applicant
and the landlord after proving the viewer, a stranger getting 404 rather than
403. The two validators are deliberate mirror images and a test asserts that
exactly one of them accepts any given key.

**And repair photos are shipped on it.**
`maintenance_request_attachments` stores under `private/maintenance/<request>/`,
with a `like 'private/%'` CHECK so a row written with a public key is refused at
the INSERT rather than 404ing when a tenant taps a thumbnail.

The bytes are **re-encoded on the way in**, and that is a privacy measure rather
than a size one. A phone writes GPS into the EXIF of a photo taken indoors, so
storing the upload verbatim would publish the home's exact coordinates to
everyone who can read the request — the precision leak ADR 0003 exists to stop,
arriving through a door nobody was watching. A test uploads a photo carrying a
GPS tag and asserts the stored object has none, with a floor that asserts the
fixture really had one.

**The client cost, stated:** the bytes come back base64 inside the ordinary
envelope, because the Oxy linked client is JSON-only and `AGENTS.md` forbids a
second manual token path. A signed short-lived URL is the usual answer and needs
a signing secret and a decision about where it comes from; that is a separate
change, and it was not a reason to leave a payslip on the public route in the
meantime.

### Payments: what landed, and what is still blocked

**Landed.** `lease_payment_movements` is the ledger both epics ask for. A
declaration is stored `pending` and moves nothing; only a landlord's
confirmation settles. Partials, refunds and failures are each their own row, the
balance is derived rather than stored, and every write carries an idempotency
key unique per lease — so a double tap, a retry and a checkout return all
resolve to the row that already exists. `recordPayment`, the dead writer that
could mark an obligation paid with no evidence of who confirmed it, is deleted,
so the balance has exactly one source.

**Blocked: the processor.** There is no "Pay rent" checkout, because Homiio
cannot settle one. A button that opened a checkout it could not confirm is the
simulated success both epics forbid. The model carries `kind: 'processor'` and a
`processor_reference` with its own partial unique index — which is how a
replayed webhook will find the row it already created — so adding a provider is
wiring rather than a migration of live money.

**Open: receipts.** A receipt is a tenancy document and may not go through the
public image endpoint — but the authorizing path it needs now exists (see the
private document path above), so this is work rather than a dependency.

## 6. The currency gap, closed

`SEARCH_PRICE_CURRENCY = 'EUR'` used to be the whole of it: a price filter had
no listing to take a currency from, so the backend compared the number against
every listing's own amount **without converting**. `priceMax=1200` returned a
£1,100 home — about €1,290 — on a page whose maximum was 1,200. Nothing threw;
the page answered a different question from the one asked.

**A bound now carries its unit end to end.** `priceCurrency` travels through the
contract, the URL, the saved search and the SQL; the range is narrowed to
listings priced in that currency; and the **response says which unit was used**,
because the server may have chosen it.

- **Nothing is converted, and nothing will be.** There is no rate Homiio can
  cite or version, and an invented one is an invented price (ADR 0004). The
  histogram has refused to mix currencies since it shipped — this is the same
  rule reaching the thumbs, from the same census
  (`db/properties/priceCurrency.ts`), so the bars and the filter can no longer
  describe different homes.
- **A caller who names no currency still gets a correct answer.** The server
  censuses the resolved scope and applies the bound in the currency that scope
  is mostly priced in. There is no country → currency table and there must not
  be: Romania carries both `RON` and `EUR` on real listings, so any such table
  would filter half that market away with confidence.
- **The honest cost is stated, not hidden.** A 1,000 zł home genuinely cheaper
  than a €1,200 bound is left out, and the slider's note counts it
  (`otherCurrencyCount`).
- **Where nothing names a currency, the bound matches nothing** rather than
  everything — "unknown" is not an answer to "under 1,200", the same rule
  `areaInRange` gives an area stored as `0`.
- **Stale units are cleared, not carried.** Changing the location, the offering
  or the price through Sindi drops the unit and hands the question back to the
  server. A bound of 1,200 set over a euro city would otherwise narrow Kraków to
  euro listings — an empty page with nothing on screen to explain it.

`SEARCH_PRICE_CURRENCY` survives as a **rendering fallback only**, for the
surfaces with no scope to ask (a saved-search row, the room filters, the moments
before an answer arrives). It is never the unit a bound is sent in.

**Choosing a non-dominant currency works too.** The histogram reports every
currency the scope's prices are in, and the slider draws a switch when there is
more than one — which is the whole of what a mixed market needed, because the
filter narrows rather than converting and a searcher offered only the dominant
currency could not reach the other half at all. The switch is drawn ONLY when
there is a choice: one with a single option in it would appear on every search
and mean nothing on almost all of them. Switching re-reads the same bound in the
new unit; it never converts it.

---

## 7. Guest points: a domain divergence, not a missing feature

Bloom's swap filter offers **guest points**. Homiio models
`swap | host | both`. These are not the same thing, and #518 §7.5 and #519 §7.5
both forbid the two shortcuts: renaming `host` as points, and showing a
fabricated balance.

Implementing points means a product decision first — how they are earned, held,
reserved, spent, refunded and expired, and whether they are convertible — then a
ledger with idempotency and double-spend prevention. **The decision is not
made**, so the row is `blocked` and stays visible rather than disappearing.

---

## 8. Sindi

| #519 §8 | Status | Where |
|---|---|---|
| Typed, closed action contract | **live** | `shared-types/sindiAction.ts` |
| Capability from the effective layout | **live** | `controlCapabilityOf`; overlay is chat-only |
| Executor, dedupe, staleness, turn binding | **live** | `hooks/sindiActionRules.ts` |
| Side-panel navigation keeps the chat | **live** | #523 |
| Full-screen answers inline | **partial** | Property cards already render; `show_saved` offers navigation rather than inline saved homes |
| Conversation-id promotion | **live** | #523; the hook holds no router |
| Alia tool results | **blocked** | `alia.tool_result` exists in `@alia.onl/server@1.0.1`; Homiio's tools are not known to be provisioned on Sindi's agent |

Detail: `docs/sindi-actions.md`.

---

## 9. What this matrix says about the epics

Closed so far: #518 §11 B and #519 §10 B in full (entry, GeoIP, permissions),
and most of #519 §8 (Sindi).

Open, in rough order of how much they unblock:

1. **Filters end to end** — energy, beds, and the room-vs-whole-home segment
   remain; each of the first two needs a column and a source before a filter
   means anything. Area, availability, currency and floor are live.
2. **Payment receipts and the processor** — the ledger is live; receipts are
   ordinary work on the private document path repair photos now use, and only
   the checkout is blocked, on a provider decision.
3. **Messaging** — the audit is done ([`docs/messaging-audit.md`](./messaging-audit)); now blocked on
   three decisions it names, not on work.
4. **Listing facts** — floor plans, energy, price history: each needs a source
   before it needs a component.
5. **Guest points** — blocked on a product decision.
6. **Visual and multiplatform QA** — not started, and not implied by any row.

Keep this file current in the same change that moves a row. A matrix that lags
the code is worse than none: it is a claim somebody will trust.
