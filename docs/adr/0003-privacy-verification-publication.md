# 3. Privacy, verification and publication rules for addresses, reviews and evictions

- **Status:** Proposed
- **Date:** 2026-08-10
- **Issue:** [#347](https://github.com/OxyHQ/Homiio/issues/347)
- **Epic:** [#344](https://github.com/OxyHQ/Homiio/issues/344)
- **Related:** `0001-canonical-housing-graph.md` (#345), `0002-location-and-search-contract.md`
  (#346), `0004-local-explainable-pricing.md` (#348)

---

## 1. Context

Homiio stores the kinds of facts that get people evicted, harassed, discriminated
against or found: where a person lives now, where they lived before, what they
paid, who their landlord was, what they said about that landlord, and — on the
solidarity board — where and when a bailiff is expected.

The codebase already contains real protections, and they are good ones. What it
does not contain is a single authority that says which class a field belongs to,
who may see it at what precision, how long it is kept, and what happens when
somebody asks for it back. Consequently the protections are uneven: they are
strong where the person porting a table happened to think about it and absent one
serializer over.

This ADR is that authority. Every feature under #344 that reads, writes,
aggregates or publishes anything about a dwelling or a person is bound by it.

### 1.1 What is already true in this repository (measured, 2026-08-10)

Re-derived from this checkout at `c4d73a43`, not carried from another repo or an
earlier note. Cited so the decisions below extend real mechanisms rather than
inventing parallel ones.

| Mechanism | Where | What it does |
|---|---|---|
| Protected-column registry | `packages/backend/db/schema/protectedColumns.ts:92-103` | 9 columns over 4 tables, excluded from `publicColumns(table)` at the TYPE level (`Omit`), so reading one is a `tsc` error rather than a runtime leak |
| Sanctioned selection helper | `packages/backend/db/schema/protectedColumns.ts:210-212` | `publicColumns(table)`; used by exactly three modules today (leases, profiles, properties serializers) |
| Eviction coordinate rounding | `packages/backend/controllers/eviction/shared.ts:63,131-134` | `APPROX_COORD_DECIMALS = 3` (~110 m), applied on the way IN at `controllers/eviction/write.ts:104-115`, so the exact point is never stored for an `approximate` case |
| Approximate-by-default | `packages/backend/db/schema/evictions.ts:100-102` | `location_precision` column defaults to `'approximate'` |
| Eviction contact gating | `packages/backend/controllers/eviction/toEvictionDTO.ts:147-160`, `controllers/eviction/browse.ts:29-30` | Organiser contact is detail-only and never appears in any list response, for any viewer |
| Roster as a child table | `packages/backend/db/schema/evictions.ts:234-256` | `eviction_case_attendees` cannot be returned by an accidental whole-row read at all; getting it requires writing a join |
| Per-viewer profile disclosure | `packages/backend/db/profiles/profileSerializer.ts:297-336` | The strongest existing example of what this ADR generalises: `owner` vs `public` scope, three independent privacy flags, and an **absent** key rather than `null` when undisclosed |
| Coarse coordinates for an outbound snapshot | `packages/backend/services/moderation/subjects/propertySubject.ts:86-91` | `COARSE_COORDINATE_DECIMALS = 2` (~1.1 km) before anything leaves for CrowdSource |
| Publication-choice flag | `packages/backend/db/schema/properties.ts:539`, honoured at `services/moderation/subjects/propertySubject.ts:144` | `show_address_number` — the advertiser's own decision about the building number |
| Retention sweep registry | `packages/backend/db/expiry.ts` | Replaces Mongo's TTL indexes; the module itself records that a registered target is only half a port until `services/cron.ts` runs it |

Two things that are **not** there and that shape the decisions below:

- **The backend sends nothing to an external error or telemetry service.**
  `git grep -niE "sentry|posthog|datadog|bugsnag|newrelic|opentelemetry" -- packages/backend`
  returns nothing. Logs go to a file or stdout (`middlewares/logging.ts:100-120`).
- **There is no analytics event pipeline.** `controllers/analyticsController` and
  `routes/analytics.ts` serve aggregates only; nothing ingests per-user events.

So the log-redaction and analytics rules in §8 are being written *before* the
pipeline exists, which is the cheapest moment they will ever be written.

### 1.2 What is measurably wrong today

These are findings, not hypotheticals, and each is filed as a follow-up in §14.
They are stated here because an ADR that describes only the target state lets the
present state persist unnoticed.

**F1 — Unit-level addresses and exact coordinates are published to
unauthenticated callers.** `db/addresses/addressSerializer.ts:143-156` emits
`number`, `block`, `entrance`, `floor`, `unit`, `subunit` and an exact
`coordinates` pair, with no viewer and no precision parameter. It is reached from
`db/reviews/reviewSerializer.ts:177` (as `populatedAddress`) and from
`db/properties/propertySerializer.ts:273`. `GET /api/reviews/address/:addressId`
is declared on the public router (`routes/public.ts:75`) which is mounted at
`server.ts:309`, **before** the auth middleware at `server.ts:312`.

**F2 — The re-identification threat this ADR is asked to model is currently
realised.** One unauthenticated review object carries, together:
`oxyUserId` (`reviewSerializer.ts:124`), `livedFrom` / `livedTo` /
`livedForMonths` (`:129-131`), `price` (`:127`), and `populatedAddress` including
`unit` (`:177`). Author, dates, rent and unit in one payload is exactly the
combination named in #347's threat list.

**F3 — `show_address_number` is honoured in the moderation snapshot and ignored
by the public API.** `propertySubject.ts:144` respects it; `propertySerializer.ts:273-274`
publishes the whole address *and* the flag as data.

**F4 — The error logger writes the entire request body and query string, in every
environment.** `middlewares/logging.ts:201-203`, mounted unconditionally at
`server.ts:315`. A failed `POST /api/evictions` therefore logs the **pre-rounding
exact coordinates** and all five organiser contact handles — defeating, in the
log, the protection `write.ts:107-108` provides in the database. A failed tenant
application logs `monthlyIncome`, a referee's `phone` and `email`, and a document
`url`. (`middlewares/errorHandler.ts:153-163` also echoes body and headers, but
only when `config.environment === 'development'`; that one is not a production
exposure.)

**F5 — The whole-row-read gate is documented and never wired.**
`protectedColumns.ts:55-59` describes `findImplicitWholeRowReads` from
`@oxyhq/db/assert` as "the scan that turns this into a gate". `git grep
findImplicitWholeRowReads` returns two hits, both inside comments; nothing
imports or calls it. Meanwhile `db/evictions/evictionRepository.ts` uses a bare
`.select()` on `eviction_cases` at lines 142, 158, 172, 185 and 248 — precisely
the shape the scan exists to catch — so the five protected contact columns are
loaded on every read and withheld only by the DTO layer.

**F6 — `settings.privacy.profileVisibility` is stored, written and emitted, and
never enforced.** It is set at `controllers/profile/profileWriteColumns.ts:411`
and emitted at `db/profiles/profileSerializer.ts:354`; no read path consults it.

**F7 — `reviews.verified` is never written.** It is emitted at
`db/reviews/reviewSerializer.ts:170` and the schema default is `false`
(`db/schema/reviews.ts:308`); no controller or repository assigns it. Today it is
a permanently-false bit occupying the name this ADR needs for a *level*.

**F8 — Eviction organiser contact unlocks for any authenticated user who taps
RSVP.** `toEvictionDTO.ts:154` treats `isAttending === true` as the unlock, and
`__tests__/integration/evictionBoard.test.ts:400` pins that behaviour
deliberately. Whether a self-service toggle is an adequate authorisation event is
a decision this ADR has to make rather than inherit (§7.3).

**F9 — Free text defeats structural precision.** `eviction_cases.location_label`
and `.description` are unconstrained `text` (`db/schema/evictions.ts:63-71`,
sanitised only for type at `controllers/eviction/shared.ts:160`) and are published
verbatim. A reporter who types a full street address there has published it
regardless of the coordinate rounding.

**F10 — A third party's contact becomes public the first time its holder's
counterparty saves a profile.** `profile_rental_history.landlord_contact_name/
phone/email` is disclosed on the unauthenticated `/api/public/profiles/*` route
when `settings.privacy.showContactInfo === true`
(`db/profiles/profileSerializer.ts:300`). The column is nullable with **no
database default** (`db/schema/profiles.ts:232`) and `profileRepository.ts:484-494`
deliberately leaves every settings column NULL on creation, so an untouched
profile does **not** disclose it — the strict `=== true` is doing real work.
But the edit form coalesces the flag to `true`
(`packages/frontend/hooks/profile/useProfileEditForm.ts:57,115`), so the first
save of any profile writes it on.

The disclosure is then a *third party's* phone number, published on the say-so of
somebody who is not that third party and who was shown a toggle labelled "Show
Contact Info" — which reads as being about their own contact details.
`profileSerializer.ts:123-144` documents why the flag is wired to this block at
all (the property screen dials it), so this is a product decision to revisit
deliberately, not an oversight to patch quietly. Stated precisely because the
tempting shorthand — "a landlord's phone is public by default" — is **not** true
of a stored row today, and an overstated finding is one somebody disproves and
then stops trusting the rest of the list.

---

## 2. Decision 1 — Four-tier data classification

Every column, every wire field and every derived value belongs to exactly one
tier. "Not classified" is not a state: a new column without a tier fails review.

### Tier P — Public

Publishable to an unauthenticated caller, indexable, cacheable, exportable.

- Country, region, city, district and neighbourhood, and their identifiers.
- Anything the advertiser deliberately published in a listing, at the precision
  they chose (§3): title, description, price, offering, photos, amenities.
- Aggregates over a sample large enough to satisfy the k-anonymity floor in §4.4.
- A review's *content* after the publication rules in §5 are applied.
- Provenance of external data: source, source URL, first-seen and last-seen
  timestamps, confidence.
- The **existence** of an eviction notice, its coarse location, its date, its
  status and its turnout count.

### Tier C — Context-restricted

Published, but only in a context that justifies it, at a precision the context
justifies, and never as a bulk export. A tier-C field is not a secret; it is a
field whose *aggregation* is the harm.

- Street name and building number.
- Coordinates at building precision.
- A review author's public or pseudonymous handle.
- The named relationship between a listing, a review and an agency.
- The organiser-facing detail of a community event: meeting point, what to bring.

### Tier R — Private (restricted)

Served only to a party with a named relationship to the record. Never public,
never in an aggregate that could be inverted, never in a log.

- Unit, floor, door, staircase and subunit **when they can identify a resident**
  (§3.4 defines when they can).
- Exact coordinates the advertiser did not publish.
- Complete contract content, payment schedules, deposits, transaction ids.
- Private contacts: a referee's phone, a former landlord's phone, an
  applicant's contacts.
- The content of a dispute that has not been published.
- A reporter's identity and contact on any report.
- A person's income.

### Tier X — Highly sensitive

Minimised, and preferably **never stored at all** (§6.2). Where storage is
unavoidable it is encrypted at rest with a key the application layer cannot read
in bulk, access is logged (§10), and retention is the shortest that makes the
feature work.

- Identity documents and proof-of-residence documents.
- Legal or medical information about an identified household.
- Anything that materially helps somebody locate a person who is being evicted,
  harassed or pursued.
- Access secrets for a dwelling: door codes, key-box combinations, alarm codes,
  Wi-Fi credentials.

### 2.1 Every sensitive column that exists today, classified

Enumerated by reading `packages/backend/db/schema/` in this checkout, table by
table (directory pathspec, never `dir/**/*.ts` — that form silently omits the
top-level files, which here is *all* of them). Positive controls for the sweep:
`eviction_cases.contact_phone` (`evictions.ts:129`), `lease_documents.url`
(`leases.ts:414`) and `profile_rental_history.landlord_contact_phone`
(`profiles.ts:420`) each appear below, so the enumeration found the shapes it was
built to find rather than reporting a comfortable emptiness.

| Column | File:line | Tier | Notes |
|---|---|---|---|
| `properties.accommodation_details_wifi_password` | `properties.ts:700` | **X** | Already protected |
| `profiles.personal_info_annual_income` | `profiles.ts:191` | **R** | Already protected |
| `leases.signatures_landlord_digital_signature` | `leases.ts:177` | **X** | Already protected |
| `leases.signatures_tenant_digital_signature` | `leases.ts:181` | **X** | Already protected |
| `eviction_cases.contact_phone / _email / _telegram / _whatsapp / _instructions` | `evictions.ts:129-133` | **R** | Already protected; unlock event is F8 |
| `addresses.street` | `addresses.ts:67` | C | Precision-laddered, not protected |
| `addresses.number`, `.block`, `.entrance` | `addresses.ts:69-72` | C | Precision-laddered |
| `addresses.floor`, `.unit`, `.subunit` | `addresses.ts:73-75` | **R** | Precision-laddered; **currently public — F1** |
| `addresses.longitude`, `.latitude` | `addresses.ts:115-116` | C at ≤ building, **R** at exact | **Currently exact and public — F1** |
| `addresses.po_box`, `.reference`, `.extras` | `addresses.ts:82-101` | **R** | Free-form; may carry anything |
| `reviews.unit_level_id` | `reviews.ts:222` | **R** | The internal unit binding; see §5.1 |
| `reviews.oxy_user_id` | `reviews.ts:307` | C | Author identity; §5.2 decides its form |
| `reviews.lived_from`, `.lived_to`, `.price` | `reviews.ts:241-245` | C | Individually innocuous, jointly re-identifying — §5.6 |
| `reviews.images` | `reviews.ts:275` | C | Interior photos; §5.7 |
| `review_reports.oxy_user_id`, `.details` | `reviews.ts:512-514` | **R** | Reporter identity |
| `eviction_cases.location_label`, `.description` | `evictions.ts:63-71` | C | Free text — **F9** |
| `eviction_cases.location_longitude`, `.latitude` | `evictions.ts:81-82` | C when `approximate`, **X** when `exact` | §7.1 |
| `eviction_case_attendees.oxy_user_id` | `evictions.ts:238` | **R** | Who said they would turn up — §7.4 |
| `eviction_reports.details`, `.contact_email` | `evictions.ts:306-307` | **R** | Reporter contact — **not protected today** |
| `listing_reports.contact_email`, `.details` | `reports.ts:69-70` | **R** | Reporter contact — **not protected today** |
| `moderation_reports.reporter_oxy_user_id`, `.details` | `moderation.ts:123,138` | **R** | Reporter identity |
| `tenant_applications.monthly_income` | `applications.ts:72` | **R** | `NOT NULL` |
| `tenant_application_references.phone`, `.email`, `.name` | `applications.ts:140-144` | **R** | Third-party PII, `NOT NULL` |
| `tenant_application_documents.url`, `.filename` | `applications.ts:164-165` | **X** | Residence/income evidence — §6 |
| `lease_documents.url`, `.name` | `leases.ts:413-414` | **X** | Contract documents |
| `lease_payment_schedule.transaction_id`, `.payment_method`, `.amount` | `leases.ts:356-364` | **R** | Payment data |
| `lease_inspection_findings.photos` | `leases.ts:482` | **R** | Interior photos of an occupied home |
| `lease_inspections.inspector`, `.notes` | `leases.ts:449-450` | **R** | Named third party |
| `leases.notes`, `.termination_notice_reason` | `leases.ts:184,191` | **R** | Free text about a tenancy ending |
| `profile_references.name`, `.phone`, `.email` | `profiles.ts:389-392` | **R** | Third-party PII |
| `profile_rental_history.address` | `profiles.ts:413` | **R** | Where a person lived |
| `profile_rental_history.landlord_contact_*` | `profiles.ts:419-421` | **R** | Third-party PII — **public once the flag is saved on, F10** |
| `profile_rental_history.monthly_rent`, `.reason_for_leaving` | `profiles.ts:416-417` | **R** | |
| `profile_roommate_history.location`, `.reason` | `profiles.ts:485-487` | **R** | **Not viewer-gated today** (`profileSerializer.ts:363`) |
| `profile_preferred_locations.city`, `.state`, `.radius` | `profiles.ts:467-469` | C | Where a person is looking |
| `profile_chat_messages.content` | `profiles.ts:519` | **R** | Owner-only today, correctly |
| `conversation_messages.content` | `conversations.ts:175` | **R** | |
| `conversation_message_attachments.url`, `.name` | `conversations.ts:206-207` | **R** | |
| `conversations.sharing_share_token` | `conversations.ts:60` | **X** | A bearer capability — §9.3 |
| `properties.external_contact_phone / _email / _whatsapp / _name / _agency_name` | `properties.ts:464-468` | P | An advertiser's *published* business contact, ingested from a portal — public by the portal's own act, not ours |
| `reservations.special_requests` | `bookings.ts:86` | **R** | |
| `viewing_requests.message`, `.scheduled_at` | `bookings.ts:151-152` | **R** | A named person at a named address at a named time |
| `images.urls_*` | `images.ts:67-70` | P or **R** | Follows the tier of the entity the image belongs to; a lease-inspection photo is not public because it is stored in the same table as a listing photo |

**On `addresses.floor/unit/subunit` specifically:** they are classified **R** but
they must **not** go into `PROTECTED_COLUMNS`. A protected column is one no
public path may ever read; these are columns a public path may read *at a
precision the owner chose*. Putting them in the registry would make the type
system refuse the legitimate owner-facing read as well. They belong to the
precision ladder (§3), enforced by a serializer that takes a precision argument
(§4.1). This distinction is the single most important thing in this section: the
registry and the ladder solve different problems and neither substitutes for the
other.

---

## 3. Decision 2 — The precision ladder

### 3.1 The levels

One ordered enumeration, defined once in `@homiio/shared-types` and used by every
layer:

| Level | Meaning | Coordinate treatment |
|---|---|---|
| `exact` | The dwelling, as stored | Full stored precision |
| `building` | The street number, no unit | Coordinates rounded to ~4 dp (≈ 11 m) |
| `street` | The street, no number | Snapped to the street centroid |
| `neighborhood` | The named neighbourhood | Neighbourhood centroid |
| `city` | The city | City centroid |
| `approximate_radius` | A disc of stated radius around a stated centre | Centre + radius, both published |
| `hidden` | Nothing spatial at all | No coordinate emitted |

The ladder is **totally ordered** from `exact` down to `hidden`. "Lower" always
means less precise. Every comparison in code is against this order, never against
a string.

`approximate_radius` sits below `neighborhood` deliberately: it publishes an
honest uncertainty rather than a plausible false point. A rounded coordinate
*looks* exact to every consumer, which is why the existing eviction rounding
(`shared.ts:131-134`) is a floor rather than the model — §7.1.

### 3.2 Public precision may be lower than internal precision, without duplicating the entity

**There is exactly one address row per physical place.** A place is never
duplicated to hold a blurred copy of itself, because two rows for one place drift
and the blurred one silently becomes the authority for something.

Instead:

- The row stores the finest precision Homiio legitimately holds, and records
  `stored_precision` — how precise the *source* actually was, which is not the
  same as how precise the columns can express.
- A separate `published_precision` records the maximum any public consumer may
  receive. It is per-record, and it is the *ceiling*, not the value.
- Every read path computes `min(published_precision, precision_allowed_for_this_viewer)`
  and serialises at that level.

The publication decision is therefore data on the record, and the viewer decision
is data about the request. Neither is a property of the serializer, which is why
§4.1 makes the serializer take both as arguments and refuse to guess.

### 3.3 Precision is applied on the way OUT, with one exception

Blurring on the way out keeps the fine value available for the operations that
genuinely need it: deduplication, canonical matching, distance search, and
correcting a wrong address later. A value blurred on the way in cannot be
un-blurred, and a "we rounded it, sorry" is not recoverable.

**The exception is when we never had a right to the fine value.** The eviction
board is that case and the existing code has it right: `controllers/eviction/write.ts:104-115`
rounds *before* the insert, so an `approximate` case's exact point is never in the
database at all. That rule generalises as: *if no Homiio feature needs the exact
value, do not store the exact value.* Reporting an eviction is a third party
describing somebody else's home; nothing downstream needs metre accuracy.

### 3.4 When a unit identifies a resident

`floor`/`unit`/`subunit` are tier **R** when they identify a resident, and the
test is not "is the building large". It is:

> A unit designator is identifying whenever the set of (building, unit) is
> smaller than the k-anonymity floor in §4.4 for the population that could be
> living there.

In practice: **always treat it as identifying.** A block with 200 flats still has
exactly one household in 3-2, and that is who a review is about. The exceptions
are a dwelling with no units at all (a detached house, where the building *is*
the unit and the owner published it themselves) and a unit the current occupant
published for themselves.

---

## 4. Decision 3 — Public serialisation rules

### 4.1 Serializers take a viewer and a precision; they never infer either

`db/profiles/profileSerializer.ts:32-35` already states the reason, and it is
right:

> whether a caller is the owner is a fact about the REQUEST, and a serializer
> that guessed it would be guessing on every call site at once.

Generalised into a rule with teeth:

1. Any serializer that can emit a tier-C, R or X field takes an explicit
   `audience` argument. There is no default value. A new call site must decide.
2. An address is emitted only through a function that takes a `precision`
   argument. `serializeAddressRow(row)` as it exists today
   (`db/addresses/addressSerializer.ts:121`) cannot satisfy this and must gain
   the parameter — F1's fix.
3. **An undisclosed field is ABSENT, never `null`.** Already the rule at
   `profileSerializer.ts:139-144`, for a reason worth restating: `null` means
   "the person did not record this", and a `null` returned to a viewer who may
   not see it is a lie that round-trips back as a deliberate erasure.
4. **Allowlists, never spreads.** Already the discipline in
   `reviewSerializer.ts:100-106` and `addressSerializer.ts:108-113`; it becomes a
   rule so the *next* table's serializer inherits it.

### 4.2 Two enforcement mechanisms, and they are not interchangeable

- **`PROTECTED_COLUMNS`** — for a column no public path may *ever* read. Excluded
  at the type level, so a serializer that touches one fails `tsc`. Correct for
  secrets: signatures, Wi-Fi passwords, share tokens, document URLs.
- **The precision ladder** — for a column a public path may read *at some
  precision*. Enforced by a serializer parameter and a negative test, because the
  type system cannot express "this string, but shorter".

Choosing the wrong one is the failure mode: putting `addresses.unit` in the
registry breaks the owner's own view, and leaving `lease_documents.url` to the
ladder means it is one forgotten argument from being public.

### 4.3 Wire the gate that already exists

`findImplicitWholeRowReads` from `@oxyhq/db/assert` must be invoked by a test
(F5). Both known offenders — `db/evictions/evictionRepository.ts` lines 142, 158,
172, 185, 248 — are converted to `publicColumns(evictionCases)` plus an explicit
named read for the one detail path that legitimately needs contact. A registry
whose gate is a sentence in a doc comment is a convention, and this repository's
own `protectedColumns.ts:42-44` says why that is not enough: *"a rule written only
in a comment is a rule nothing checks."*

### 4.4 Aggregates: the k-anonymity floor

An aggregate is tier P only if:

- it is computed over **at least 5 distinct source records**, from **at least 3
  distinct authors or households**; and
- it is not published alongside a filter set narrow enough to invert it (one
  building, one month, one price band → refuse); and
- it does not change by an amount that reveals a single contributor when a
  neighbouring query is subtracted.

Below the floor the response says *"not enough data to publish"*. It does not
publish a smaller number with a caveat, and it does not silently widen the area
to reach the floor — widening without saying so misattributes one
neighbourhood's rents to another, which `0004-local-explainable-pricing.md`
addresses from the accuracy side and this ADR forbids from the privacy side.

### 4.5 Nobody consents on behalf of somebody else

A recurring shape in this schema: person A stores person B's identifiers, and
whether B's data is published is controlled by A. Every instance is a defect of
the same kind.

- `profile_rental_history.landlord_contact_*` — A's former landlord's phone,
  gated on A's toggle (F10).
- `profile_references.phone` / `.email`, `tenant_application_references.phone` /
  `.email` — a referee's contact, supplied by the person naming them.
- `lease_inspections.inspector` — a named third party.
- An eviction case's affected household — §7.2 removes the possibility entirely,
  which is the model the others should converge on.

The rule: **a third party's identifiers are tier R and are disclosed only to a
party with a direct relationship to the record, never publicly, whatever flag the
storing user set.** Publication of a third party's contact requires that third
party's own act. Where a feature genuinely needs a stranger to reach them — the
"call the owner" button on `app/properties/[id]` — the right shape is a contact
the *owner themselves* published on their own listing
(`properties.external_contact_*` is exactly that), not a number their former
tenant typed into a history field.

### 4.6 Scope of the rules

The rules in §4 bind **every** egress: the JSON API, server-rendered web, the
mobile app, data exports, notification bodies and titles, email, webhooks,
outbound moderation snapshots, sitemaps, OpenGraph tags, and anything cached in
front of them. A notification is a publication: `services/notificationDispatchService.ts`
payloads carry `data` blobs, and a title reading *"Your viewing at Carrer X 42,
3-2 was approved"* is a disclosure to whatever renders the push.

---

## 5. Decision 4 — Reviews

### 5.1 A review may be bound to a unit internally and published at the building

The binding and the publication are two different facts and the schema already
separates them: `reviews.address_level` plus the four level ids
(`db/schema/reviews.ts:214-226`). The rule:

- A review is always stored against the finest address the author identified,
  including `unit_level_id`. That is what makes "reviews of this exact flat"
  possible for the author, and what lets a future correction re-target cleanly.
- A review is **published at the building level by default.** The unit is
  disclosed only when *both*: the author explicitly opted in, and the unit is not
  identifying under §3.4, or the author is the current occupant publishing about
  their own tenancy.
- Aggregates that are *about* a unit (unit-level averages) are subject to the
  §4.4 floor, which a single unit will almost never clear. The honest output is
  the building aggregate with the unit count stated.

### 5.2 Author identity — three forms, chosen by the author

| Form | What is published | What Homiio knows |
|---|---|---|
| `identified` | The author's Oxy handle and display name | Everything |
| `pseudonymous` | A stable per-author-per-building pseudonym | The link |
| `verified_anonymous_resident` | *"Verified resident"* and nothing else | The link, plus the verification signal |

`verified_anonymous_resident` is the default offered for any review that criticises
a landlord or agency, because that is the review whose author is at risk.

The pseudonym is stable **per author per building**, so a reader can tell "the
same person wrote both of these about this building" without being able to
correlate an author across buildings. A globally stable pseudonym would let an
owner join a person's reviews across every place they have lived, which is
de-anonymisation with extra steps.

`reviews.oxy_user_id` is `NOT NULL` (`db/schema/reviews.ts:307`) and stays that
way — the *link* must exist for correction, appeal and abuse handling. What
changes is that it is no longer serialised unconditionally (`reviewSerializer.ts:124`,
F2). Under `pseudonymous` and `verified_anonymous_resident` it is tier **R**.

### 5.3 Right of reply, and the asymmetry that makes it safe

An owner, host or agency named in a review may publish **one reply per review**,
extendable by editing their own reply.

The asymmetry is the whole design:

- A reply is a **separate record** with its own author. It never mutates the
  review.
- Reply and review are rendered together, attributed, and neither can hide the
  other.
- **The criticised party has no path — none — that edits or deletes the original
  content.** They may reply, they may file a factual-correction request (§5.4),
  and they may report (§5.5). Those are the three, and none of them is a delete
  button.
- Replying does not entitle the replier to the author's identity. A reply is
  addressed to the review, not to the person.

### 5.4 Corrections: three different things that are routinely conflated

| Kind | Who decides | Effect on the original |
|---|---|---|
| **Factual correction** | Objective evidence, checkable without judging the experience (the flat has 2 bedrooms not 3; the agency named was not the managing agent on that date) | The specific *fact* is annotated as corrected; the opinion is untouched; the correction and who requested it are visible |
| **Disagreement** | Nobody. It is not resolvable | Nothing. It becomes a reply (§5.3) |
| **Moderation** | The community process already in this repository | Status changes; content is never silently edited |

The moderation process is the existing one and it is **not** an admin panel:
per-review reports with automatic `moderation_status: under_review` at three or
more (`db/schema/reviews.ts:305`, `controllers/reviewController.ts:822-877`).
This ADR adds no privileged reviewer role, no queue and no moderator surface.
That constraint is not a limitation to be worked around — it is what stops the
correction mechanism becoming the deletion mechanism, because there is nobody a
determined landlord can lobby.

A factual-correction request that is really a disagreement is answered as a
reply. The discriminator: *could two honest people with the same evidence reach
different answers?* If yes, it is a disagreement.

### 5.5 Accusation, opinion and objective fact are displayed differently

The review form already separates these structurally, and the UI must stop
flattening them:

- **Objective, checkable facts** — rent paid, dates, deposit returned
  (`reviews.price`, `.lived_from`, `.lived_to`, `.deposit_returned`) — are
  rendered as data, and carry their verification level (§6.1).
- **Subjective ratings** — noise, light, temperature, cleanliness — are rendered
  as one person's rating with the sample size beside them.
- **Free-text opinion** (`reviews.opinion`, `.positive_comment`,
  `.negative_comment`) is rendered as attributed prose, never as a Homiio
  statement.
- **Accusations of conduct** — discrimination, retaliation, illegal deposit
  retention, harassment — are rendered as *"this resident reports"*, are never
  aggregated into a score, and are never presented as an established finding.

Homiio never converts an accusation into a number. A "landlord trustworthiness
score" built partly out of unadjudicated accusations launders an allegation into
a fact, and that is a defamation engine.

### 5.6 When a review can indirectly identify a person

A review is *indirectly identifying* when the joint publication of its fields
narrows the household to one. In practice the combination is: unit + tenancy
dates + rent. F2 records that this combination is published today.

The rules:

- Never publish unit, exact tenancy dates and exact rent together. Publishing any
  two requires the third to be coarsened.
- Tenancy dates are published as **month and year**, never as a day.
- Rent is published **banded** on a review whose address is at building precision
  or finer. The exact figure feeds §4.4-compliant aggregates.
- A review about a **shared** dwelling identifies housemates who did not consent.
  It is published at building precision with no unit, always.

A review that cannot be published without identifying its subject is offered to
the author with the identifying parts coarsened. It is not silently truncated, and
it is not refused: the author gets to decide whether the coarser version is still
worth publishing.

### 5.7 Private evidence attached to a review

An author may attach evidence (a photo of damp, a deposit-return email, a
contract page). Evidence and content are separate:

- Evidence is tier **R** at minimum, **X** if it carries a document or a third
  party's identifiers.
- Evidence is **never** served by a public read path, and no public DTO carries a
  key that could hold one.
- Evidence is retained **12 months** from upload, or until the review is deleted,
  whichever comes first. It is then deleted, and only the derived signal (§6.3)
  survives.
- Access is per §10, and every access is audited.
- A review remains publishable if its evidence has expired. Evidence supports a
  verification claim; it is not the claim.

### 5.8 Appeal

Every restriction Homiio applies to content is appealable by its author, and the
appeal route must exist without a privileged reviewer.

- **What is appealable:** a review entering `under_review` on reports, a case
  being marked `disputed`, a factual correction the author disputes, a
  publication rule that coarsened something the author believes was safe.
- **Who decides:** not a moderator. An appeal re-runs the *mechanical* decision
  with the author's added context — a report threshold recomputed after
  duplicate or bad-faith reports are discounted, a precision rule re-evaluated
  after the author removes the identifying element.
- **What the author is always told:** which rule fired, which field it applied
  to, and what would change the outcome. A restriction whose reason cannot be
  stated is a restriction that should not have been applied.
- **What an appeal never does:** disclose who reported. Reporter identity is
  tier R (§2.1) and stays that way — the alternative is a retaliation channel.
- **Timing:** an appeal on a restriction that is *hiding* content is answered
  before the restriction becomes permanent; content is not deleted while an
  appeal is open.

The genuinely hard cases — a review that is defamatory, a case that is a
fabrication — have no mechanical answer, and this ADR does not pretend
otherwise. What it refuses is inventing a privileged queue to resolve them,
because that queue becomes the deletion mechanism for every landlord who finds
it. #374 owns the workflow for the residue; its constraint is inherited from
here.

### 5.9 Immutability and history

Editing a published review produces a **new version**; versions are immutable and
the current one is what renders. This exists so a correction cannot be rewritten
into a different accusation, and so a reply that answers version 2 is not left
answering version 5. Deleting a review removes all versions from publication;
what is retained is in §11.

---

## 6. Decision 5 — Verification levels

### 6.1 The levels

Five levels, none of which names or reveals the document used. They are
independent signals, not a ladder — a review may carry several.

| Level | Meaning | How it is obtained |
|---|---|---|
| `account_verified` | The author holds a verified Oxy account | From the Oxy identity layer; no document reaches Homiio |
| `interaction_confirmed` | Homiio itself observed the interaction — an application, a viewing, a lease, a booking on this address | From Homiio's own records; no evidence needed |
| `residence_confirmed` | Independent evidence supported that the author lived there in the stated period | §6.2 |
| `corroborated_by_public_data` | A checkable claim matched an authoritative public source | Per-jurisdiction adapters (#370) |
| `independently_repeated` | ≥ 3 independent authors reported the same specific fact | Computed |

Two properties of the design:

1. **The level never names its evidence.** The wire says
   `residence_confirmed`, never *"utility bill"*, never *"passport"*, never a
   document type, an issuer, a date or a redacted filename. The document type is
   itself sensitive: *"verified by residence permit"* discloses immigration
   status.
2. `reviews.verified` — the current single boolean that nothing writes (F7) — is
   replaced by this set. A boolean cannot express which signal was obtained, and
   an unwritten boolean rendered as a checkmark would be a lie about a claim
   nobody checked.

### 6.2 Residence evidence: extract the signal, discard the document

The pipeline itself is out of scope for this ADR (#364 builds it), but the policy
it must implement is decided here, because building it first and deciding
afterwards is how a document store happens.

1. Evidence is uploaded over an authenticated, encrypted channel to a store that
   is **not** the public media bucket and has **no** public read path.
2. It is processed to extract exactly two facts: *does this support residence at
   this address*, and *does it support the stated period*. Nothing else is read
   out, nothing else is stored.
3. The extracted signal — level, address id, period, timestamp, method — is
   written to the claim.
4. **The document is deleted within 30 days of the signal being extracted, or
   within 7 days of the claim resolving, whichever is sooner.** Deletion is a
   scheduled job with the same wiring obligation `db/expiry.ts` already states
   for TTL sweeps: *"Registering a target is only half of the port… until that
   lands the table still grows forever."* A retention rule with no job is a
   promise.
5. Homiio never publishes, exports, or serves the document. There is no endpoint
   that returns one, including to its uploader — re-upload is the recovery path.
6. Failure to extract a signal deletes the document immediately. A rejected
   document is not kept "in case of appeal": the appeal is a re-submission.

### 6.3 Verification is not endorsement

Every surface rendering a verification level states, in the UI and in the API
docs, that:

> Homiio verified a *specific, narrow* fact. It has not verified that the content
> of this review is true, fair or complete.

`residence_confirmed` means we have reason to believe the author lived there. It
says nothing about whether the boiler was actually broken. Conflating the two
makes Homiio the publisher of every claim it decorates.

---

## 7. Decision 6 — Evictions

The board's purpose is to let neighbours turn up. Every rule below is the minimum
that serves that purpose, and nothing beyond it.

### 7.1 Approximate public coordinates by default

The current default is correct (`db/schema/evictions.ts:100-102`), and the
current rounding-on-write is correct (`controllers/eviction/write.ts:104-115`).
Two changes:

- **Replace the rounded pair with `approximate_radius`.** A coordinate rounded to
  3 dp is indistinguishable from an exact one to every consumer — it *looks*
  precise while being wrong by up to ~110 m, which is the worst of both: it does
  not protect against a determined searcher (the grid is recoverable) and it
  misleads an honest one. Publishing a centre and a stated radius is honest about
  the uncertainty and is what a map should render.
- **`exact` requires a reason, and it is never the default.** Publishing an exact
  eviction location is publishing where a specific household is about to be
  removed from. It is available only when the affected household itself asked for
  it (§7.3), and it is recorded as such.

**F9 must be closed at the same time.** Rounding a coordinate while publishing an
unconstrained `location_label` and `description` is theatre: the label is where a
reporter types "Carrer de X 42, 3r 2a". The label is validated to a
street-or-coarser form and the description is scanned for address-shaped and
contact-shaped strings before publication, with the reporter told what was
removed and why.

### 7.2 Protecting the affected household

The board is about an **event at a place**, not about a household. Therefore:

- The affected household's name, contact, nationality, immigration status,
  household composition, children, health and employment are **never** stored and
  never accepted. They are not tier-X fields on this table; they are fields the
  table does not have, which is stronger.
- The unit is never published. "Carrer X 42" is what a supporter needs; "3-2" is
  what a debt collector needs.
- A photo showing the household, or a door with a nameplate, is not publishable.
- Where a reporter is *not* the affected household — the common case — nothing
  identifying about that household may be published on their say-so at all.

### 7.3 Three audiences, three views

| Audience | Sees |
|---|---|
| **Public / anonymous** | Existence, title, sanitised description, `approximate_radius` location, date, status, timeline, turnout count |
| **Confirmed supporter** (RSVP'd, plus a friction step — §7.3.1) | The above, plus the meeting point and the organiser's contact |
| **Organiser** (the case author) | Everything they wrote, plus the turnout count. **Not** the attendee roster identities |
| **Affected household** (where they have identified themselves to the organiser) | May request `exact` publication, may request takedown, may request the case be archived |

The **exact** location is disclosed on one authorisation event only: the affected
household asking for it. Not on RSVP, not on organiser discretion.

#### 7.3.1 The RSVP unlock needs a second factor

F8 records the current behaviour: any authenticated user who taps attend receives
the organiser's phone, email, Telegram and WhatsApp. That is a one-tap contact
harvest, and the organiser is precisely the person a landlord's agent most wants
to reach — as `protectedColumns.ts:169-176` says outright, this is the one place
in the schema where a leak is a physical-safety problem.

The unlock therefore requires an RSVP **plus** at least one of: an account older
than a stated age, an `account_verified` signal, or a vouch from an existing
attendee. The organiser may raise the bar for their own case, and may revoke an
individual's access. The current tested behaviour
(`__tests__/integration/evictionBoard.test.ts:400`) changes deliberately, and the
test changes with it.

### 7.4 The attendee roster

Already a child table rather than a column, which is the stronger form
(`db/schema/evictions.ts:234-256`) and is already tested to never leak
(`evictionBoard.test.ts:340`). Confirmed as policy: **the roster is never
disclosed to anyone, including the organiser.** A list of people who turned up to
resist an eviction is a target list. The count is the only thing published; the
organiser coordinates through the case thread.

### 7.5 Expiry, archival and deletion

- **Live:** until the scheduled date passes.
- **Stale:** an `upcoming` case more than 24 h past its date already drops off the
  public board (`controllers/eviction/browse.ts:56,145`) and the owner is nudged
  once for an outcome. That behaviour is confirmed and kept.
- **Archived at 90 days** after the last status change: the case leaves search and
  the board, the contact block is **deleted** (not hidden), and the location
  drops to `neighborhood`. What remains is the anonymous fact that an eviction was
  scheduled in that neighbourhood on that date and what its outcome was — which
  is what makes the board useful as evidence of a pattern.
- **Deleted at 24 months**, except the anonymised outcome record, which is tier P
  and permanent.
- The organiser may delete their case at any time; the affected household may
  request deletion at any time and it is honoured without argument.
- An entry in `db/expiry.ts`'s registry, **and the cron wiring**, land in the same
  change. The module's own header explains why that is not optional.

### 7.6 False, stale and dangerous information

- **Stale:** handled by §7.5. Nothing "expires" into being wrong quietly.
- **False:** the existing report mechanism (`eviction_reports`, one open report
  per reporter per case — `db/schema/evictions.ts:317-319`). At a threshold the
  case is marked `disputed` and its location drops to `neighborhood` until the
  organiser responds. Marking it disputed does not delete it — an eviction
  notice reported by the evicting agency is the *expected* case.
- **Dangerous:** a case that names the household, publishes a unit, calls for
  confrontation with a named individual, or publishes a third party's contact is
  refused at write time and, if already published, immediately reduced to the
  public view with the offending fields cleared. This is a content rule applied
  by the write path and by report thresholds, **not** by a moderator.

---

## 8. Decision 7 — Logs, errors, analytics and support

### 8.1 What may never appear in a log line

Never, at any level, in any environment:

- A complete address, a street plus a number, or any unit designator.
- Coordinates at finer than 2 decimal places (~1.1 km) — the precedent
  `services/moderation/subjects/propertySubject.ts:86` already sets.
- Any phone, email, WhatsApp or Telegram handle.
- Any document URL, filename, share token, signature or access secret.
- Any review, opinion, note, message or free-text body.
- Any income, rent for an identified tenancy, payment or transaction id.

**Permitted:** opaque ids (address id, property id, review id, case id, request
id), city and region ids, tier-P enums, counts, durations, status codes, and
error class names.

City-centroid coordinates are **not** covered by the ban.
`services/cityCoordinateRepairService.ts:46-63` logs city latitude and longitude
and that is fine — a city centroid is public reference data, not a person's home.
The rule is about a *dwelling's* location. Saying so explicitly matters: a blanket
"no coordinates" rule gets one true exception, discovers it in review, and gets
weakened everywhere instead of stated precisely once.

### 8.2 Redaction is structural and central

**F4 is the priority fix in this whole ADR.** `middlewares/logging.ts:201-203`
logs `req.body`, `req.params` and `req.query` on every error, in every
environment. Consequences measured, not hypothesised:

- A failed `POST /api/evictions` logs the **pre-rounding exact coordinates** and
  all five organiser contact handles — the database protection at
  `write.ts:107-108` is real and the log walks around it.
- A failed `POST /api/reviews` logs the whole review before any publication rule
  runs.
- A failed tenant application logs `monthly_income`, a referee's `phone` and
  `email`, and a document `url`.

The fix is a single redaction function through which **every** log meta object
passes, applied inside the logger rather than at call sites:

1. Deny by key name: a configured set of key patterns (`*phone*`, `*email*`,
   `*password*`, `*token*`, `*signature*`, `*contact*`, `street`, `number`,
   `unit`, `floor`, `door`, `coordinates`, `latitude`, `longitude`, `url`,
   `income`, `body`, `opinion`, `description`, `notes`, `message`) → `'[redacted]'`.
2. Deny by value shape: anything matching an email, an international phone
   number, or a coordinate pair, wherever it appears, including inside a string.
3. **Depth and size caps**, so a nested blob cannot smuggle a value past the key
   check.
4. Redaction happens in `logger.info/warn/error` themselves. A call site cannot
   opt out; there is no `raw: true`.

Applied inside the logger rather than at the ~303 `logger.*` call sites, because
a rule enforced at call sites is a rule that holds until the next call site.

### 8.3 Errors leaving the process

No external error service is wired today (§1.1), so this is prospective and
therefore cheap:

- Any future Sentry/Datadog/equivalent integration sends **only** the redacted
  form of §8.2, and additionally strips request bodies, query strings and headers
  entirely.
- A stack trace is sent; the local variables that would accompany it are not.
- URL paths are sent with path parameters replaced by their route pattern
  (`/api/reviews/address/:addressId`), because an address id in a URL is a
  tier-C identifier and a free-text search query in a query string can be
  anything at all.
- `middlewares/errorHandler.ts:153-163` returns body and headers in the response
  when `config.environment === 'development'`. Development-only, so not a
  production exposure — but it is deleted anyway, because "it is only dev" is one
  misconfigured environment variable away from being false, and the developer can
  read their own request.

### 8.4 Analytics

There is no event pipeline today. When one is built (#350):

- Events carry **opaque ids only**. Never an address string, never coordinates.
- Location dimensions are `city_id`, `region_id`, `neighborhood_id` — never a
  point, never a bounding box narrow enough to be one.
- Distance is bucketed (`<1km`, `1-3km`, `3-10km`, `>10km`), never a figure.
- Price is banded on any event that also carries a location finer than city.
- No event carries a review body, a message, a search free-text string, or a
  contact.
- The §4.4 floor applies to every published analytic.

### 8.5 Support

- Support has **no privileged read path into private evidence.** This follows
  directly from the no-admin-surfaces rule, and it is the honest consequence: the
  cost is that some support requests cannot be answered by inspection. That cost
  is accepted.
- A user may share a redacted diagnostic bundle from their own device, generated
  client-side, showing them exactly what it contains before it is sent.
- Any operator access to the database is infrastructure-level, outside the
  application surface, and constrained by §6.2 — the documents that would hurt
  most are not there to be read.

---

## 9. Decision 8 — The `data × actor × action × precision × retention` matrix

Actors: **A** anonymous · **U** any signed-in user · **N** a user with a named
relationship to the record (party to the tenancy, the application, the
conversation; a confirmed supporter of a case) · **O** the record's owner or
subject · **S** the system (jobs, aggregation).

Precision is the §3 ladder. `—` means no access.

| Data | A | U | N | O | S | Retention |
|---|---|---|---|---|---|---|
| City / region / country | read `city` | read `city` | read `city` | read `city` | read | permanent |
| Neighbourhood | read | read | read | read | read | permanent |
| Listing street + number (published) | read `building` | read `building` | read `building` | read/write `exact` | read `exact` | while listed + 24 mo history |
| Listing unit / floor / door | — | — | — | read/write `exact` | read `exact` | as above |
| Listing coordinates | read `building` | read `building` | read `building` | read/write `exact` | read `exact` | as above |
| External listing provenance | read | read | read | read | read/write | while listed + 24 mo |
| Review content (published) | read | read | read | read/write | read | until author deletes |
| Review author identity | per §5.2 | per §5.2 | per §5.2 | read/write | read | with the review |
| Review unit binding | — | — | — | read | read | with the review |
| Review tenancy dates | read `month` | read `month` | read `month` | read exact | read exact | with the review |
| Review rent | read banded | read banded | read banded | read exact | read exact | with the review |
| Review private evidence | — | — | — | read/write | read | **12 mo**, then deleted |
| Owner / agency reply | read | read | read | read/write | read | with the review |
| Verification level | read | read | read | read | write | with the claim |
| Verification document | — | — | — | write only | read once | **≤ 30 d**, then deleted |
| Eviction: existence, date, status | read | read | read | read | read | live → 90 d archive → 24 mo |
| Eviction location | `approximate_radius` | `approximate_radius` | `approximate_radius` + meeting point | as published | `exact` if stored | as above; → `neighborhood` at archive |
| Eviction organiser contact | — | — | read (§7.3.1) | read/write | read | **deleted at archive (90 d)** |
| Eviction attendee roster | — | — | — | **—** | read (fan-out only) | with the case |
| Affected household identity | — | — | — | — | — | **never stored** |
| Lease terms, rent, deposit | — | — | read (party) | read/write | read | tenancy + 6 y (statutory) |
| Lease documents | — | — | read (party) | read/write | read | tenancy + 6 y |
| Digital signatures | — | — | — | — | read (render) | tenancy + 6 y |
| Payment schedule, transaction ids | — | — | read (party) | read/write | read | 6 y (fiscal) |
| Application income + documents | — | — | read (landlord of that property, while open) | read/write | read | **decision + 90 d**, then deleted |
| Application referee contacts | — | — | read (landlord, while open) | read/write | read | as above |
| Profile: bio, occupation, preferences | read | read | read | read/write | read | until deleted |
| Profile: income | — | — | — | read/write | read | until deleted |
| Profile: rental history (tenancy) | flag-gated (default off) | flag-gated | flag-gated | read/write | read | until deleted |
| Profile: landlord contacts | — (needs the contact-holder's own consent — **F10**) | — | — | read/write | read | until deleted |
| Profile: referee contacts | flag-gated (default off) | flag-gated | flag-gated | read/write | read | until deleted |
| Conversations + messages | — | — | — | read/write | read | until deleted |
| Conversation share token | — | — | — | — | read | 24 h, then cleared |
| Viewing request time + place | — | — | read (party) | read/write | read | event + 90 d |
| Reporter identity + contact | — | — | — | read (own) | read | report + 12 mo |
| Access audit log | — | — | — | read (own subject) | append | 24 mo |

Statutory retentions (contract and fiscal records) are the jurisdiction's, not
Homiio's, and the 6-year figure is a placeholder to be set per market by #370. It
is written here so the *shape* is right: some data outlives an account deletion
because the law says so, and that must be stated rather than discovered.

---

## 10. Decision 9 — Permission and audit model for private evidence

The hard constraint: **no admin panel, no moderator queue, no privileged
reviewer role** (Homiio's `AGENTS.md`, and #344's own success criteria). The
model must therefore work with no trusted human in the middle.

1. **Relationship-derived permission.** Access to a tier-R or tier-X record is
   granted by a *relationship recorded in the database* — party to the lease,
   landlord on an open application, subject of the record — computed
   server-side from the session, never from a client-supplied id. This is the
   pattern the repository already enforces for ownership
   (`utils/sessionUser.requireSessionOxyUserId`, and the repository-level
   `landlord_oxy_user_id` / `tenant_oxy_user_id` filters).
2. **Purpose-bound and time-bound.** A landlord may read an application's
   documents *while the application is open*, and that access ends when the
   application is decided. Permission is a function of state, not a grant that
   persists.
3. **No standing access.** There is no role, flag or column that confers access
   to another person's evidence in general. If a future feature needs one, it
   needs a new ADR, not a new boolean.
4. **Minimise before permitting.** §6.2's discard-the-document rule is the primary
   control. The strongest access control is not having the thing.
5. **Every access to a tier-X record is audited**, append-only, with actor,
   record, purpose, timestamp and the relationship that authorised it.
6. **The audit trail is readable by the SUBJECT of the data**, not by a
   supervisor. That is what makes it work without an admin surface: the person
   with the strongest interest in noticing an improper access is the person it
   was about.
7. **Automated access is audited identically.** A job that reads evidence writes
   an audit row naming the job. "The system did it" is an actor, not an
   exemption.

---

## 11. Decision 10 — Retention, deletion, export and correction

### 11.1 Account deletion vs legitimate community information

These conflict, and pretending otherwise produces either a useless right to
erasure or a memory hole every landlord can buy.

On account deletion:

- **Deleted:** profile, preferences, private messages, applications and their
  documents, saved searches and folders, referee and landlord contacts, rental
  history, roommate history, evidence, notifications, and the identity link
  behind any pseudonym.
- **Retained, irreversibly de-identified:** published reviews and eviction
  outcomes, re-attributed to *"a former resident"*, with tenancy dates coarsened
  to the year and the author link destroyed.
- **Retained as-is:** records the law requires (executed contracts, fiscal
  records) for their statutory period, and nothing else.

The author may choose, at deletion, to withdraw their reviews entirely. The
default is de-identified retention, because a review is information the community
relied on, and because "delete my account" being a way to erase criticism after
the fact is a mechanism that will be used exactly that way.

**Destroying the author link is irreversible and it destroys the appeal route
with it.** That is stated at the point of deletion, in the UI, in those words.

### 11.2 Export

A user may export everything Homiio holds about them, in a machine-readable form:
profile, reviews (all versions), replies, applications, leases, messages,
verification levels, and their own access audit trail.

The export is subject to the same rules as any other egress (§4.5). It does **not**
include another person's tier-R data merely because it sits on a shared record:
a lease export shows the counterparty's role and the terms, not their income or
documents. Verification *documents* are not exportable — §6.2 means they no
longer exist.

### 11.3 Correcting a canonical address

A canonical address is shared by listings, reviews, evictions and history, so a
correction is a graph operation, not a field edit. `0001-canonical-housing-graph.md`
owns the merge/split mechanics; this ADR owns the privacy half:

- Correcting an address must not *raise* the published precision of anything
  attached to it. If a correction turns a street-level address into a unit-level
  one, every attached record keeps its own `published_precision` ceiling.
- A merge must not join two records whose separation was the privacy protection —
  merging "3-2" into "the building" is fine; splitting "the building" into "3-2"
  republishes at a precision nobody consented to.
- A correction is recorded with who requested it and on what basis, and is
  visible on the address.

### 11.4 How a withdrawal or correction propagates

A deletion that only removes the row is not a deletion. Every withdrawal or
correction propagates, in this order, and the operation is not complete until all
five are done:

1. **The record** — deleted or superseded.
2. **Derivatives** — aggregates, price statistics, review counts, building
   summaries recomputed. A derivative computed from a withdrawn record is a copy
   of it.
3. **Caches** — server-side caches and CDN entries invalidated by key, never left
   to TTL. A TTL is a delay, not a deletion.
4. **Snapshots** — immutable price/listing history (#367) keeps the *fact* and
   drops the *attribution*; outbound moderation snapshots
   (`services/moderation/subjects/`) are re-sent with a withdrawal signal.
5. **Search indexes and sitemaps** — re-indexed, and de-listed upstream where the
   URL was published.

Backups are the honest exception: a withdrawal cannot rewrite an existing backup.
The rule is that a **restore must re-apply the withdrawal log**, which therefore
outlives the record it withdrew. A withdrawal log entry is tier-P metadata (an
id and a timestamp) and carries none of the withdrawn content.

---

## 12. Threat model

The six threats #347 names, each with the current state and the control.

### T1 — An owner tries to identify a reviewer

*Vector:* join the review's unit, tenancy dates and rent against their own
tenancy records; or correlate one pseudonym across buildings.

*Current state:* **succeeds trivially.** F2 — author id, dates, rent and unit are
in one unauthenticated response.

*Controls:* §5.2 (three identity forms; pseudonym stable per building only),
§5.6 (never publish unit + exact dates + exact rent together; dates to
month-year; rent banded), §5.3 (a reply grants no identity), §5.1 (building-level
publication by default).

*Residual:* an owner with one tenant in one building always knows. Nothing can
fix that, and the product must say so before the review is published rather than
imply a protection it cannot provide.

### T2 — Somebody hunts the exact unit of an eviction

*Vector:* read the coordinates, invert the rounding grid, read the free-text
label, or RSVP to unlock detail.

*Current state:* **partially defended.** Coordinates are rounded before storage,
which is real. But `location_label` and `description` are unconstrained free text
(F9) and RSVP is a one-tap unlock (F8).

*Controls:* §7.1 (`approximate_radius`, `exact` only on the household's request,
label and description sanitised), §7.2 (unit never published; household never
stored), §7.3.1 (RSVP plus a second factor), §7.4 (roster never disclosed).

### T3 — An employee or a service reads evidence without needing to

*Vector:* a support tool, a debugging session, a background job, a database
console.

*Current state:* no privileged application path exists — good. But F4 means the
evidence is in the logs, where everyone with log access already is.

*Controls:* §6.2 (the document is deleted, so there is nothing to read), §10
(relationship-derived, purpose-bound, time-bound, audited; audit readable by the
subject), §8.2 (structural log redaction), §8.5 (no privileged support read).

### T4 — Mass scraping of addresses and residents

*Vector:* enumerate `GET /api/reviews/address/:id` or `GET /api/properties/:id`
and harvest addresses, coordinates, units and author ids.

*Current state:* **succeeds.** F1 — both endpoints are unauthenticated and emit
unit-level addresses with exact coordinates. There is no per-endpoint rate limit
documented on the public router.

*Controls:* §4.1 (precision on every address serialisation), §5.1 (building-level
review publication), plus operational: rate limiting on public enumeration
endpoints, no sequential ids in public URLs, no bulk endpoint returning
unit-precision addresses, and `robots.txt` plus `noindex` on any page that would
be a resident directory. A precision ceiling is the durable control — rate
limiting only raises the cost.

### T5 — Re-identification by combining date, price and unit

*Vector:* as T1, plus joining across reviews, listing price history and eviction
dates for the same address.

*Current state:* **succeeds** (F2), and the joins are easy because everything
shares the canonical address id.

*Controls:* §5.6 (the two-of-three rule), §4.4 (k-anonymity floor on every
aggregate, and refusal rather than silent widening), §11.4 (derivatives
recomputed on withdrawal, so a deleted review does not survive inside an
aggregate).

*This is the threat most likely to be reintroduced accidentally*, because every
individual field looks harmless and the harm is in the join. It is the one that
needs the negative tests in §13 most.

### T6 — Leakage through logs and crash reports

*Vector:* an error path logs a request body; a crash report ships local state; a
log aggregator is queried by someone who would not be granted the data directly.

*Current state:* **succeeds** — F4, in every environment, on every error, for
every endpoint.

*Controls:* §8.1 (what may never be logged), §8.2 (redaction inside the logger,
no call-site opt-out), §8.3 (nothing but redacted data leaves the process), and
the negative test in §13 that fails the build when a request body reaches a log
line.

---

## 13. Negative tests

Every rule above needs a test that **fails when the rule is broken**. A test
asserting a field is present cannot tell a protected field from a forgotten one.
Each of these carries the two defences this repository already applies to
`__tests__/db/protectedColumns.test.ts`: a **vacuity floor** (so a broken
traversal cannot pass by finding nothing) and a **mutation check** (break the
protection, confirm the test reds and names the offending path).

1. **Public response snapshots.** For every public endpoint, assert the response
   contains no key from the tier-R/X set and no value matching an email, a phone
   or a fine coordinate. Vacuity floor: assert the response is non-trivially
   large and contains a known tier-P field. Mutation: add `unit` to the address
   serializer; the test must red and name the endpoint.
2. **An uploaded document never appears in any public response.** Seed an
   application with a document, then sweep every public endpoint for its URL,
   filename and id. Mutation: emit it from the application DTO.
3. **Log redaction.** Drive a failing request whose body carries a phone, an
   email, a coordinate pair and a document URL; assert the captured log output
   contains none of them, and contains the request id (the vacuity floor — a test
   against an empty log passes trivially). Mutation: remove the redaction
   function; the test must red on all four values.
4. **Eviction precision.** Assert a public eviction response carries no
   coordinate finer than the stated radius. **Two cases, both required:** one
   marked `approximate` and one marked `exact` — a fixture set containing only
   `approximate` cases cannot tell a working precision rule from a serializer
   that rounds everything unconditionally.
5. **Reply and correction authorisation.** A criticised party can create a reply;
   a criticised party **cannot** edit or delete the review; a third party can do
   neither. Assert the original content is byte-identical after a rejected
   attempt — a 403 with a mutated row is the failure that matters.
6. **Re-identification.** Publish a review with unit, exact dates and exact rent,
   then assert the public response never carries all three at full precision.
   Mutation: remove the coarsening; the test must name which pair survived.
7. **`findImplicitWholeRowReads` is wired** and reports zero, over a corpus with a
   floor on the number of files scanned. Mutation: add a bare `select()` on a
   protected table; the scan must report that file and line.
8. **Verification levels never name a document.** Assert no verification response
   field carries a document type, filename, issuer or MIME type, against a
   fixture where a document *was* used — a fixture with no document cannot
   distinguish "does not leak it" from "there was nothing to leak".
9. **Aggregate floor.** Assert an aggregate over 4 records refuses, and one over 5
   from 3 authors publishes. Both directions, or the test cannot tell a working
   floor from a broken aggregator.
10. **Withdrawal propagation.** Delete a review, then assert it is absent from the
    building aggregate, the cached response and the search index — not merely
    from its own endpoint.

---

## 14. Consequences, and the follow-up work this ADR creates

### 14.1 Accepted costs

- Reviews become less precise in public. A unit-level review published at the
  building is worth less to a reader and much safer for its author. That trade is
  made deliberately.
- Support cannot inspect private evidence, so some questions cannot be answered.
- Verification cannot be re-checked after the document is deleted; a disputed
  claim is re-verified by re-submission.
- The k-anonymity floor means thin markets show "not enough data" where a number
  would be more satisfying. A number computed from two flats is not a market
  rate anyway.
- Two enforcement mechanisms (registry and ladder) is more machinery than one.
  It is not reducible: the type system cannot express a precision.

### 14.2 Follow-up issues

Ordered by exposure. **F4 and F1 are live exposures in production code today**;
everything else is design work.

| # | Work | Evidence | Suggested home |
|---|---|---|---|
| 1 | Structural log redaction inside `logger.*`; stop logging `req.body`/`query` | F4 — `middlewares/logging.ts:201-203` | #350, or a standalone P0 |
| 2 | `serializeAddressRow` takes a precision; unit fields and exact coordinates stop being public | F1 — `db/addresses/addressSerializer.ts:143-156`, `routes/public.ts:75` | #361 / #362 |
| 3 | Review publication rules: building default, identity forms, dates to month, rent banded | F2 — `db/reviews/reviewSerializer.ts:124-177` | #365 |
| 4 | Wire `findImplicitWholeRowReads`; convert `evictionRepository`'s bare selects | F5 — `db/evictions/evictionRepository.ts:142,158,172,185,248` | #350 |
| 5 | Add the tier-X columns in §2.1 to `PROTECTED_COLUMNS` | `applications.ts:164`, `leases.ts:414`, `conversations.ts:60`, `evictions.ts:307`, `reports.ts:70` | #364 |
| 6 | Eviction `approximate_radius`, label/description sanitisation, RSVP second factor | F8, F9 — `toEvictionDTO.ts:154`, `evictions.ts:63-71` | #358 |
| 7 | Replace `reviews.verified` with the §6.1 level set | F7 — `db/schema/reviews.ts:308` | #364 |
| 8 | Enforce `profileVisibility`; stop a third party's contact riding on the subject's counterparty's toggle | F6, F10 — `profileSerializer.ts:300,354`, `useProfileEditForm.ts:57` | #372 |
| 9 | Honour `show_address_number` in the public property API | F3 — `propertySerializer.ts:273-274` | #362 |
| 10 | Eviction archival/deletion sweep, registered **and wired** | §7.5, `db/expiry.ts` | #358 |
| 11 | The §13 negative tests, with vacuity floors and mutation evidence | — | #350 |

### 14.3 Out of scope

Per #347: country-by-country legal advice; choosing a document-verification
vendor; building the document pipeline (#364). This ADR fixes the policy that
pipeline must implement, which is deliberately the opposite order from how it
would otherwise happen.
