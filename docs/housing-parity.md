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
| Type of place (room / entire home) | **live** | A segment above the type tiles, and a PROJECTION of the same field rather than a second one — `placeKindOf` / `propertyTypesForPlaceKind` in `shared-types/placeKind.ts`. A mixed selection reads as "Any" rather than lighting up a side nobody chose. The seven stay types (hostel, couch, campsite, boat, treehouse, yurt, other) are on neither side on purpose and stay reachable through the tiles |
| Nightly price | **live** | `priceColumnForOffering` selects the nightly rate |
| Beds | **open** | No `beds` column; `max_guests` is a different fact |
| Amenities | **live** | |
| Instant booking | **live** | `properties.short_term_rent_instant_book` |
| Dates / guests | **partial** | In `SearchQuery` and the URL; availability is filtered on `/properties`, not on `/properties/search`. A dated feed now excludes confirmed exchanges too, so it stops advertising homes the booking path would refuse |

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
| Kind of exchange | **live** | Both: Homiio has `swap \| host \| both` AND guest points, as an explicit opt-in on the REQUEST rather than a fourth mode. `__tests__/integration/guestPoints.test.ts`; §7 |
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
| Contact / visit | `LandlordSection`, `book-viewing.tsx` | **partial** | Requesting a viewing reaches the server at last — `POST /api/properties/:id/viewings` was mounted nowhere and answered 404 in production. The slots on the form are still a hardcoded list: real ones need an owner availability model, #518 §7.5. External listings keep their source CTA |
| Apply | `app/properties/[id]/apply.tsx` | **live** | |
| Place reviews | `ReviewsSection`, `CommunityNotesSection` | **live** | Building/unit reviews, kept distinct from stay reviews |
| Floor plans | — | **open** | No column, no upload, no render |
| Energy label | — | **open** | No column |
| Price history chart | — | **open** | `areaPriceComparison` is an AREA fact, not this listing's history |
| **Sale:** price per m², mortgage calculator | `SaleDetailsSection`, `MortgageCalculatorSection` | **live** | Explicitly a simulation, not an offer |
| **Stays:** calendar, guests, price breakdown, booking | `AvailabilitySection`, `BookingCard`, `useStayBooking` | **live** | The calendar is public (#518 §7.5): `{ start, end, status }` per span, no guest, no price, no reservation id — so a signed-out visitor sees the blocked nights instead of an empty diary. Creating and confirming a stay run in one transaction with the listing locked, re-verifying dates, capacity, price and availability |
| **Swap:** propose, accept, track | `ExchangeSection`, `useExchangeQueries` | **partial** | Proposals persist and now conflict with paid stays and blocked calendars in both directions, on BOTH homes of a swap. An external listing keeps its terms on show and loses the request CTA. Points do not exist — §7 |

---

## 5. My home, Saved, Publish, Evictions, widgets

| Bloom | Homiio | Status | Gap |
|---|---|---|---|
| `LeaseSummaryCard` | `app/my-home.tsx` | **live** | |
| `RentPaymentList` | `LeasePaymentsSection`, `LeaseLedgerSection` | **partial** | The **ledger** exists (`lease_payment_movements`): obligation, attempt, confirmed payment, manual declaration, partial, refund and a DERIVED balance, with idempotency on every write. A tenant declares a transfer and a landlord confirms it. **Receipts are open**; the processor is blocked — see below |
| "Pay rent" (a checkout) | — | **blocked** | The processor is chosen — **Peable** — and the seam is built: status mapping and webhook signature verification are live and tested (`services/payments/peableContract.ts`). It is not connected because rent in euros needs Peable's card rail, which its own roadmap marks as never exercised against Stripe's sandbox and not deployed, and Peable performs no FX, so a euro amount cannot settle over its working FairCoin rail. [`docs/peable-rent-payments.md`](./peable-rent-payments) has the four blockers and the exact wiring |
| `MaintenanceRequestCard` / repairs | `MaintenanceSection`, `/maintenance/*` | **live** | `maintenance_requests` + comments + events + attachments, a declared state machine under a row lock, authorization in the repository query, notifications through the dispatcher. Photos go through the private path — stored under `private/`, re-encoded so the phone's GPS does not travel with them, delivered only to the two sides of the lease |
| "Message landlord" | — | **blocked** | The ecosystem audit §7.3 asks for is done: [`docs/messaging-audit.md`](./messaging-audit). Allo IS the platform and is explicitly multi-product, but its SDK is unpublished, its server cannot open a conversation, and enrolling Homiio enrols a device on the person's whole Allo account. Three decisions named there, none of them an implementer's. No button is drawn meanwhile — the Inbox tab is a notification list |
| `DocumentList`, signatures | `LeaseDocumentsSection`, `/contracts/[id]` | **partial** | Upload/list/view exist, and **a lease document can now be a PDF** — it goes to the lease's own multipart endpoint, is stored under `private/leases/<lease>/`, and is delivered only to the landlord, the tenant and the co-tenants. Neither an application's nor a lease's documents come off the public image route any more — see below. Still partial: "uploaded" is not "verified" and the checklist is not yet server state |
| `TenancyTimeline` | `LeaseHistorySection` | **live** | Real lease events |
| `ApplicationChecklist` | `useApplicationQueries` | **partial** | Applications persist; the checklist's per-requirement state does not |
| `SavedSearchCard` + alerts | `useSavedSearches`, `useHousingAlerts` | **live** | `housing_watch_rules` / `housing_alerts`, with a connected job — not a local toggle |
| Wishlists / collections | `savedPropertyFolders` | **live** | Owner-scoped |
| Trips and swaps | `useReservationQueries`, `useExchangeQueries` | **partial** | Real rows, and one occupancy rule behind them (`db/availability/occupancy.ts`): a reservation, a confirmed exchange and a blocked window each block the other two. Still not surfaced as the template's trip cards |
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

**And so is the tenancy contract itself.** `lease_documents` had exactly the
same defect one table over, and a worse one: the frontend uploaded through the
ordinary image pipeline and POSTed the resulting `/api/images/file/<key>` string
back, so the signed agreement, the inspection report that photographs the inside
of somebody's home and the insurance certificate were each a permanent,
cacheable link — and the endpoint stored whatever `url` a client sent, so a
party could also point a lease row at any address at all. `leases/documents/` is
now a refused prefix (which closes the door on the objects already stored, with
no migration — the bytes never move), `GET /api/leases/:id/documents/:documentId`
serves them after proving the viewer is a party, and a non-party gets 404 rather
than 403, because "there is a tenancy here and you may not read it" is itself a
fact about two named people and an address.

**A tenancy document is usually a PDF, and now it can be one.** The old path
could not accept one: the picker was `MediaTypeOptions.Images` and the upload
Sharp-processed the buffer, so a contract had to be a photograph of one. Uploads
go to `POST /api/leases/:id/documents` as multipart, and the handler splits on
the type — an image is re-encoded (the EXIF measure below), a PDF is stored byte
for byte, because Sharp would either throw on it or quietly return page one as a
picture. The client supplies bytes and a label; it no longer names a location.

**One thing deliberately left undone:** `lease_documents` still records the
object as a URL in its `url` column, parsed back by `utils/storedDocumentKey.ts`.
A `storage_key` / `content_type` / `bytes` triple, as
`maintenance_request_attachments` carries, is the better model and the CHECK
constraint that goes with it (`like 'private/%'`) would refuse a public key at
the INSERT. That is a migration, and this change carries none.

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

**Blocked: the processor — now by name.** Peable is the choice, and
[`docs/peable-rent-payments.md`](./peable-rent-payments) records what is
already in place (the ledger needs no migration; the status mapping and the
webhook signature verifier are written and tested) and the four things that
stop it being connected: the card rail is not live, there is no FX so a euro
amount cannot settle over the FairCoin rail, the published SDK cannot be
installed, and nothing in Peable is a subscription engine.

There is still no "Pay rent" checkout, because Homiio cannot settle one. A button that opened a checkout it could not confirm is the
simulated success both epics forbid. The model carries `kind: 'processor'` and a
`processor_reference` with its own partial unique index — which is how a
replayed webhook will find the row it already created — so adding a provider is
wiring rather than a migration of live money.

**Open: receipts.** A receipt is a tenancy document and may not go through the
public image endpoint — but the authorizing path it needs now exists and carries
lease documents already (see the private document path above), so this is work
rather than a dependency.

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

## 7. Guest points: a ledger of nights, not a currency

Bloom's swap filter offers **guest points**. Homiio now has them, and they are
not Bloom's: the decision the row was blocked on has been made, and it is the
smallest one that could be made honestly.

**One point per night, in both directions.** Hosting a guest for one night earns
1 point; staying one night costs 1. Guests do not multiply it — a night is a
night. The symmetry is the whole design: the system can neither inflate nor
deflate, because every point in existence is a night somebody hosted, and it
needs no per-home valuation, because one night is worth one night everywhere.
Bloom's "120 per night" is exactly the number #518 §7.5 forbids copying, and the
reason is that a price per night implies a price per home that nothing in Homiio
could justify — ADR 0004 forbids the universal score it would take.

**A new member starts at zero.** No welcome grant: #518 §7.5 calls that the
*saldo ficticio*, and the surface is built to say the honest sentence instead —
"you need to host before you can stay".

**Reserve, then settle or release.** Asking for a points stay RESERVES its cost;
the host accepting SETTLES it and credits them the same number; declining,
cancelling or letting the dates pass RELEASES it. A reserved point is not
spendable, so the balance a screen offers is `earned − spent − reserved` and
never the raw total.

**Nothing else moves a point.** `guest_point_movements.exchange_request_id` is
`NOT NULL`, so a purchase, a gift, a transfer, a promotional grant, a conversion
from money and a marketplace trade are all unrepresentable rather than merely
unimplemented — none of them has a stay behind it. There is no write endpoint on
`/api/guest-points` at all; the whole write path is the exchange lifecycle.

The balance is DERIVED from the movements (`guestPointStanding`, shared by both
sides) and double-spend is prevented in the transaction: `reserveStayPoints`
locks the account's rows `FOR UPDATE` and then recounts in a SEPARATE statement,
because a blocked `SELECT … FOR UPDATE` re-checks the rows it waited on and
never sees one the winner INSERTED. Mutation-tested — removing the lock turns
the interleaved case in `__tests__/integration/guestPoints.test.ts` red.

### What was deliberately NOT decided

**Cancelling a stay the host already accepted does not return the points.** By
then the guest's points have settled and the host has been credited for holding
the dates; releasing would refund one side while the other kept the credit, and
reversing the host's credit would take back something they earned. Any other
answer is a refund policy — a window, a proportion, a penalty — and that is a
product decision nobody has made. It is the one open question this domain leaves
behind, and it is an **open** row rather than a silent behaviour.

Points also do not expire, do not appear in a filter on `/explore`, and have no
relationship to reputation, reviews or product credits. Each of those is a
separate decision, and none of them is implied by this one.

### What §7.5 still leaves open, and why each one needs a column

The viewings/stays/exchange work landed everything that could be built without a
schema change. These could not, and none of them is an oversight:

 - **Owner-defined viewing slots**, and with them a real replacement for
   `book-viewing.tsx`'s hardcoded `TIME_SLOTS`. Needs a table of the windows an
   owner offers; inventing slots on the client is worse than admitting there are
   none.
 - **Viewing modality** (in person / video) and **duration** — two columns on
   `viewing_requests`, plus the owner's **response text**, which today has
   nowhere to go: a decline carries a status and no words.
 - **A property-local timezone.** A viewing instant is built in the SERVER's
   zone from `YYYY-MM-DD` + `HH:mm`, so an owner in Madrid and a server in
   another zone disagree about what 10:00 means. The fix is a column on the
   listing, not arithmetic at the boundary.
 - **`EXCLUDE USING gist` on `reservations`.** The double-booking rule is
   enforced by a row lock plus a re-read, which is correct and is enforced by
   the application. A constraint would make it the DATABASE's rule and hold for
   any writer, including a future importer or a manual fix.

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

1. **Filters end to end** — energy rating and beds remain, and each needs a
   column AND an ingest source before a filter over it means anything. Area,
   availability, currency, floor and the room-vs-whole-home segment are live.
2. **Payment receipts and the processor** — the ledger is live; receipts are
   ordinary work on the private document path repair photos now use. The
   checkout is blocked on Peable's card rail going live, not on a decision
   (§ [`docs/peable-rent-payments.md`](./peable-rent-payments)).
3. **Messaging** — the audit is done ([`docs/messaging-audit.md`](./messaging-audit)); now blocked on
   three decisions it names, not on work.
4. **Listing facts** — floor plans, energy, price history: each needs a source
   before it needs a component.
5. **Guest points** — the ledger is live (§7). What remains is one product
   decision: what a cancellation after acceptance should do.
6. **Visual and multiplatform QA** — not started, and not implied by any row.

Keep this file current in the same change that moves a row. A matrix that lags
the code is worse than none: it is a claim somebody will trust.
