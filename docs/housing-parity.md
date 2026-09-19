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
| Price range | ✓ | `priceMin`/`priceMax` | per-offering price column | **partial** — one implicit currency, see §6 |
| Price histogram | ✓ real | — | `GET /properties/search/price-histogram` | **live** — not the demo's fake timer |
| Property type | ✓ | `propertyType` | `typeIn` | **live** |
| Bedrooms / bathrooms | ✓ | `bedrooms`/`bathrooms` | minimum, `inRange` | **live** |
| Floor area | ✓ | `sizeMin`/`sizeMax` | `areaInRange` | **live** — m², and an unmeasured listing is excluded from a maximum rather than matching it |
| Availability (now / from date) | ✓ | `availableNow`/`availableBy` | `availableBy` | **live** — long-term and exchange only; a stay is booked for a range and a sale completes |
| Features | partial | `amenities` | `hasAllAmenities` | **partial** — Bloom's `features` and Homiio's amenities are not the same vocabulary; unmapped |
| Floor | ✗ | ✗ | ✗ | **blocked** — `properties.floor` is `NOT NULL DEFAULT 0`, so "ground floor" and "not stated" are the same value; see below |

### Buy

| Control | Status | Note |
|---|---|---|
| Price (log scale, "asking price") | **partial** | The range works; the scale and the per-mode bounds are Bloom's, not adopted |
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

### Why the floor filter is blocked rather than open

`properties.floor` is `doublePrecision NOT NULL DEFAULT 0`. Ground floor is a
real, common answer and it is stored as `0` — the same value a listing nobody
filled in gets. The two are **indistinguishable in the data**.

So a floor filter cannot be written honestly. "Floor 2 or above" would exclude
every unstated listing, which is defensible; "up to floor 1" would include every
one of them, which is the same silent widening the area filter's `> 0` guard
exists to prevent — and here there is no guard to write, because zero is a
legitimate answer.

Making the column nullable is the fix, and it needs a decision nobody has made:
the existing `0` rows cannot be backfilled to `NULL` without erasing real
ground-floor data, and cannot be left as `0` without keeping the ambiguity. That
is a product call about historical rows, not a migration.

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
| `MaintenanceRequestCard` / repairs | `MaintenanceSection`, `/maintenance/*` | **partial** | The domain exists: `maintenance_requests` + comments + events, a declared state machine under a row lock, authorization in the repository query, notifications through the dispatcher. **Photos are open** — see below |
| "Message landlord" | — | **blocked** | The ecosystem audit §7.3 asks for is done: [`docs/messaging-audit.md`](./messaging-audit). Allo IS the platform and is explicitly multi-product, but its SDK is unpublished, its server cannot open a conversation, and enrolling Homiio enrols a device on the person's whole Allo account. Three decisions named there, none of them an implementer's. No button is drawn meanwhile — the Inbox tab is a notification list |
| `DocumentList`, signatures | `LeaseDocumentsSection`, `/contracts/[id]` | **partial** | Upload/list/view exist; "uploaded" is not "verified" and the checklist is not yet server state |
| `TenancyTimeline` | `LeaseHistorySection` | **live** | Real lease events |
| `ApplicationChecklist` | `useApplicationQueries` | **partial** | Applications persist; the checklist's per-requirement state does not |
| `SavedSearchCard` + alerts | `useSavedSearches`, `useHousingAlerts` | **live** | `housing_watch_rules` / `housing_alerts`, with a connected job — not a local toggle |
| Wishlists / collections | `savedPropertyFolders` | **live** | Owner-scoped |
| Trips and swaps | `useReservationQueries`, `useExchangeQueries` | **partial** | Real rows; not surfaced as the template's trip cards |
| `PublishPage` wizard | `useCreatePropertyWizard`, `properties/create.tsx` | **partial** | Real uploads, `status: 'draft'`, server validation. Photo **order** and full draft resumption unverified; no `setTimeout` success anywhere |
| `EvictionsPage` | `app/evictions/*` | **live** | Board, detail, timeline, resources, RSVP — a Homiio domain the template only sketches |
| `HousingWidgets` | `components/widgets/*` | **partial** | Saved searches and featured are real; the area-price and neighbourhood widgets are gated off by default and show nothing invented |

---

### Repair photos, and why they are not shipped

Both epics ask for attachments on a repair, and both also say a tenancy's
evidence may not go through the **public** image endpoint. Homiio's image
pipeline is public delivery by construction — `imageUploadService` writes
`Cache-Control: public, max-age=31536000` and serves through the CDN — so there
is no private object path to attach to.

Shipping "attach a photo" onto that bucket would put a picture of somebody's
bathroom on a guessable URL. A private store is its own change with its own
access model, and no affordance is drawn for something that cannot work yet.

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

**Open: receipts.** A downloadable receipt needs the same private object store
repair photos need, for the same reason: it is a tenancy document and may not go
through the public image endpoint.

## 6. The currency gap

`SEARCH_PRICE_CURRENCY = 'EUR'` is the whole of it: a price filter has no
listing to take a currency from, and the backend compares the number against
listing amounts **without converting**. So a 1,000 filter is compared to 1,000
RON and 1,000 USD as if they were the same amount.

Closing it is an end-to-end change — contract, URL token, saved search, the
Sindi action patch, validation, SQL and the histogram — and **it is open**.
#523 deliberately left `SindiSearchPatch` with no currency field rather than
adding one the server ignores.

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

1. **Filters end to end** — floor (blocked), energy, beds, and the room-vs-whole-home
   segment — plus the currency contract. Area and availability are now live in all
   four columns, including the histogram.
2. **Repair photos** — the one open half of maintenance, blocked behind a
   private object store that does not exist.
3. **Payment receipts and the processor** — the ledger is live; receipts need a
   private object store and the checkout needs a provider decision.
4. **Messaging** — the audit is done ([`docs/messaging-audit.md`](./messaging-audit)); now blocked on
   three decisions it names, not on work.
5. **Listing facts** — floor plans, energy, price history: each needs a source
   before it needs a component.
6. **Guest points** — blocked on a product decision.
7. **Visual and multiplatform QA** — not started, and not implied by any row.

Keep this file current in the same change that moves a row. A matrix that lags
the code is worse than none: it is a claim somebody will trust.
