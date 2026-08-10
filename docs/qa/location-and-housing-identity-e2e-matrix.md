# End-to-end matrix: location and housing identity

Companion to issue #350, under epic #344.

This document is deliberately unflattering. Most of the journeys the issue lists
cannot be automated today, because the features they exercise do not exist yet —
they land in #351 to #366. Writing them down as "automated" would be the exact
failure this whole issue exists to prevent: a check that reports success while
measuring nothing. Every row below therefore carries an honest status, and every
deferral names the issue that unblocks it.

What DOES exist today, and is executed on every pull request, is listed under
"What CI runs now".

---

## Status vocabulary

| Status | Meaning |
|---|---|
| **AUTOMATED-NOW** | A test in this repository executes it and fails when it breaks. Runs in CI. |
| **AUTOMATABLE-AFTER-#N** | The assertion exists or is trivially expressible; the feature or surface it needs lands in issue #N. |
| **MANUAL** | Needs a device capability, a third-party failure, or a human judgement that no harness here reproduces. |

A row marked AUTOMATABLE-AFTER is not a promise that somebody will write it. It
is a statement that the blocker is the feature, not the harness — the invariant
it would assert is already implemented and tested in
`packages/shared-types/src/observability/invariants.ts`.

---

## What CI runs now

Three suites, on every pull request, through the existing `ci.yml` jobs. No new
workflow was added; the tests live in the packages whose suites already run.

| Suite | File | Job |
|---|---|---|
| Redaction and the event schema | `packages/backend/__tests__/unit/observabilityRedaction.test.ts` | `backend` |
| Ingest, through the real Express app | `packages/backend/__tests__/unit/observabilityIngest.test.ts` | `backend` |
| The seven divergence invariants | `packages/backend/__tests__/unit/locationDivergenceInvariants.test.ts` | `backend` |
| Cross-package contract and pinned digests | `packages/frontend/__tests__/observabilityContract.test.ts` | `frontend` |

Both jobs carry a count floor (`.github/scripts/assert-test-floor.mjs`), so a
suite that stops running is a failure rather than a quieter green run.

### Running the full matrix locally

```bash
# Postgres is a hard prerequisite of the backend suite; it does not skip.
docker compose -f docker-compose.postgres.yml up -d

bun run --filter @homiio/shared-types build
bun run --filter @homiio/listing-providers build

bun x tsc --noEmit -p packages/backend/tsconfig.json
bun run --cwd packages/frontend typecheck

TEST_DATABASE_URL=postgres://homiio:homiio@127.0.0.1:5434/postgres \
  bun run --cwd packages/backend test -- --testPathPattern='(observability|locationDivergence)'
bun run --cwd packages/frontend test -- --testPathPattern='observabilityContract'
```

The MANUAL rows below have no command. They are run by a person against a real
build on the platform named, and their outcome is recorded on the pull request
that changes the surface in question.

---

## Group 1 — First open

| # | Journey | Web | iOS | Android | Notes |
|---|---|---|---|---|---|
| 1.1 | Location permission granted | MANUAL | MANUAL | MANUAL | The browser and OS prompts are outside the app. `location_permission_resolved` records the outcome once #353 emits it. |
| 1.2 | Permission denied | MANUAL | MANUAL | MANUAL | The important half: denial must yield a chosen scope, never a worldwide feed. The invariant is automated (`checkGeocoderFallbackScope`); the permission path is not. |
| 1.3 | Granted then revoked mid-session | MANUAL | MANUAL | MANUAL | iOS and Android revoke out of process and restart the app on some versions. No harness here reproduces it. |
| 1.4 | Coordinates unavailable despite a grant | AUTOMATABLE-AFTER-#353 | MANUAL | MANUAL | Web geolocation can be stubbed; the native fix cannot. `coordinatesAvailable` distinguishes it from a denial. |
| 1.5 | Returning user with a saved last city | AUTOMATABLE-AFTER-#352 | AUTOMATABLE-AFTER-#352 | AUTOMATABLE-AFTER-#352 | Needs the `LocationSelection` contract to persist and restore. |
| 1.6 | Returning user with several saved searches | AUTOMATABLE-AFTER-#356 | AUTOMATABLE-AFTER-#356 | AUTOMATABLE-AFTER-#356 | Saved areas and alerts. |

---

## Group 2 — Search and map

| # | Journey | Web | iOS | Android | Notes |
|---|---|---|---|---|---|
| 2.1 | Search Barcelona, confirm results are in Barcelona | AUTOMATABLE-AFTER-#355 | AUTOMATABLE-AFTER-#355 | AUTOMATABLE-AFTER-#355 | The assertion is `checkVisibleAreaMatchesQueriedArea`, automated now against the fixtures. |
| 2.2 | Move the map to Madrid and press "Search this area" | AUTOMATABLE-AFTER-#354 | AUTOMATABLE-AFTER-#354 | AUTOMATABLE-AFTER-#354 | `map_area_search_committed` carries `previousQueryId` and `priorScopeCleared` for exactly this. |
| 2.3 | Confirm no Barcelona parameter survives the move | **AUTOMATED-NOW** | **AUTOMATED-NOW** | **AUTOMATED-NOW** | Platform-independent: `checkQueryIdentityMatch` on two descriptors that differ only in a surviving `cityKey`. The bounds are identical, so a bounds-only check passes it. |
| 2.4 | Switch between list and map keeping one query | **AUTOMATED-NOW** | **AUTOMATED-NOW** | **AUTOMATED-NOW** | The digest is what makes "the same query" checkable. Wiring the two surfaces to produce it is #354. |
| 2.5 | Open a result, go back, keep position and query | AUTOMATABLE-AFTER-#355 | AUTOMATABLE-AFTER-#355 | AUTOMATABLE-AFTER-#355 | Needs the scroll-restoration behaviour that screen owns. |
| 2.6 | Geocoder timeout, 429, 500 and empty response | AUTOMATABLE-AFTER-#351 | AUTOMATABLE-AFTER-#351 | AUTOMATABLE-AFTER-#351 | Once the geocoder is behind Homiio's own gateway its failures can be injected. All four outcomes are already asserted against `checkGeocoderFallbackScope`. |
| 2.7 | Two cities with the same name | **AUTOMATED-NOW** | **AUTOMATED-NOW** | **AUTOMATED-NOW** | Barcelona ES against Barcelona VE; see the fixtures below. The end-to-end picker is #295. |
| 2.8 | Free text inside a specific area | **AUTOMATED-NOW** | **AUTOMATED-NOW** | **AUTOMATED-NOW** | The digest treats text and scope as separate dimensions; changing either changes the id. |
| 2.9 | Bounding box crossing the antimeridian | **AUTOMATED-NOW** | **AUTOMATED-NOW** | **AUTOMATED-NOW** | Both directions: identical boxes must match, complementary boxes must not. |
| 2.10 | Zero results with no worldwide fallback | **AUTOMATED-NOW** | **AUTOMATED-NOW** | **AUTOMATED-NOW** | `checkGeocoderFallbackScope` refuses a `global` fallback unconditionally, and an unscoped result after any non-`ok` geocoder outcome. |

---

## Group 3 — Addresses and housing

| # | Journey | Web | iOS | Android | Notes |
|---|---|---|---|---|---|
| 3.1 | Two units in one building | **AUTOMATED-NOW** | **AUTOMATED-NOW** | **AUTOMATED-NOW** | Asserted at the identity level: two units must not share a reference while the building reference is shared. The screen is #362. |
| 3.2 | Two buildings, same street, different numbers | AUTOMATABLE-AFTER-#360 | AUTOMATABLE-AFTER-#360 | AUTOMATABLE-AFTER-#360 | Needs canonical materialisation to have a key to compare. |
| 3.3 | Rural address, or one with no number | AUTOMATABLE-AFTER-#359 | AUTOMATABLE-AFTER-#359 | AUTOMATABLE-AFTER-#359 | `address_candidate_selected.precisionLevel` already carries `street` / `locality` / `area`. |
| 3.4 | External candidate never materialised | **AUTOMATED-NOW** | **AUTOMATED-NOW** | **AUTOMATED-NOW** | `checkListingHasHousingIdentity` must PERMIT this, which is the half a naive implementation gets wrong by requiring a link on every listing. |
| 3.5 | An address with no active listing | AUTOMATABLE-AFTER-#362 | AUTOMATABLE-AFTER-#362 | AUTOMATABLE-AFTER-#362 | The persistent profile independent of live listings. |
| 3.6 | Three external listings of one dwelling | **AUTOMATED-NOW** | **AUTOMATED-NOW** | **AUTOMATED-NOW** | Grouping and the median effect are both asserted. The grouping engine is #368. |
| 3.7 | Correction or merge without losing relations | AUTOMATABLE-AFTER-#360 | AUTOMATABLE-AFTER-#360 | AUTOMATABLE-AFTER-#360 | Merge and split workflows. |

---

## Group 4 — Reviews and privacy

| # | Journey | Web | iOS | Android | Notes |
|---|---|---|---|---|---|
| 4.1 | Review linked to a unit, published at building level | AUTOMATABLE-AFTER-#365 | AUTOMATABLE-AFTER-#365 | AUTOMATABLE-AFTER-#365 | The unit-versus-building distinction is fixture-backed today. |
| 4.2 | Residence document absent from every public response | AUTOMATABLE-AFTER-#364 | AUTOMATABLE-AFTER-#364 | AUTOMATABLE-AFTER-#364 | Private evidence does not exist yet. The event layer already refuses a document reference outright, which is asserted now. |
| 4.3 | Anonymous or pseudonymous authorship per policy | AUTOMATABLE-AFTER-#365 | AUTOMATABLE-AFTER-#365 | AUTOMATABLE-AFTER-#365 | |
| 4.4 | Right of reply without altering the original | AUTOMATABLE-AFTER-#365 | AUTOMATABLE-AFTER-#365 | AUTOMATABLE-AFTER-#365 | |
| 4.5 | Address and coordinates redacted to the expected level | **AUTOMATED-NOW** | **AUTOMATED-NOW** | **AUTOMATED-NOW** | `checkPublicPrecisionWithinPolicy`, including the float-noise case a "we rounded it" implementation misses. The policy itself is #347's. |
| 4.6 | Review-step abandonment measurable without identifying a person | **AUTOMATED-NOW** | **AUTOMATED-NOW** | **AUTOMATED-NOW** | `review_step_completed` and `review_abandoned` carry an opaque per-draft reference and a duration bucket, nothing else. The wizard is #363. |

---

## Group 5 — Evictions

| # | Journey | Web | iOS | Android | Notes |
|---|---|---|---|---|---|
| 5.1 | Local board by area | AUTOMATABLE-AFTER-#358 | AUTOMATABLE-AFTER-#358 | AUTOMATABLE-AFTER-#358 | |
| 5.2 | Public coordinate is approximate | **AUTOMATED-NOW** | **AUTOMATED-NOW** | **AUTOMATED-NOW** | Same mechanism as 4.5, and the reason it takes a policy argument rather than hard-coding one level. |
| 5.3 | Private contacts absent from the public listing | AUTOMATABLE-AFTER-#358 | AUTOMATABLE-AFTER-#358 | AUTOMATABLE-AFTER-#358 | The event layer refuses a contact today; the DTO allowlist is #358's. |
| 5.4 | Event updated, postponed and cancelled | AUTOMATABLE-AFTER-#358 | AUTOMATABLE-AFTER-#358 | AUTOMATABLE-AFTER-#358 | |
| 5.5 | Authorised access to more precise data | AUTOMATABLE-AFTER-#347 | AUTOMATABLE-AFTER-#347 | AUTOMATABLE-AFTER-#347 | Needs the publication ladder the ADR defines. |

---

## Discriminating fixtures

Defined in `packages/backend/__tests__/helpers/locationIdentityFixtures.ts`. The
rule that shaped every one: **a fixture on which a correct and an incorrect
implementation agree proves nothing**, however elaborate it looks. What a wrong
implementation produces is stated for each, here and in the fixture's own
comment.

| Fixture | What a WRONG implementation produces |
|---|---|
| **Barcelona, Catalonia (ES)** and **Barcelona, Anzoátegui (VE)** | A scope keyed on the NAME cannot tell them apart: the same query id, full area overlap, and a search for either answered with listings from both. 7 200 km and two hemispheres apart, so no tolerance can excuse it. |
| **Madrid (ES)**, 505 km from Barcelona | "Search this area" that moves the viewport without clearing the previous city filter answers a Madrid map with Barcelona listings. The two descriptors have IDENTICAL bounds, so a bounds-only check passes it — only the query id catches it. |
| **Antimeridian viewport** (179°E → −179°W) and its complement | `east - west` gives −358. The box then reads as empty (an identical pair looks divergent) or as the whole planet (every comparison passes — the dangerous direction). The complement shares not one square degree and must never match. |
| **Two units of one building**, review scores 2 and 5 | Keying identity on the ADDRESS collapses them into one profile showing 3.5, which describes neither home. The scores are far apart on purpose: two 4s would print the same number under both implementations. |
| **One flat, three portal listings** (1 200 / 1 250 / 1 290 EUR, different ids and photo counts) | Grouping on the LISTING id gives three groups of one instead of one group of three, `listing_duplicate_group_opened` never fires, and the price sample counts the flat three times. The prices are close so a merge is invisible in any single figure. |
| **EUR / USD / PLN / RON**, all quoted 1 200 | `(max − min) / min` reports a 0% spread. The real gap between 1 200 PLN and 1 200 USD is roughly fourfold. The correct answer is not a converted number but the ABSENCE of one — which is why `priceSpreadBucketPct` is optional in the schema. |
| **Price sample with the duplicate counted three times** | Eight listings give a median of 1 225; six dwellings give 1 125. A hundred euros in the number somebody is told is fair. It works only because the duplicate sits in the MIDDLE of the distribution — at either extreme both readings move together and the fixture proves nothing. |
| **Exact location** (41.38743, 2.1686) and its **public approximation** (41.39, 2.17) | Publishing the exact value puts a household's door on a public map. The two render identically at any zoom a person uses; only a decimal-place count tells them apart. |
| **Float-noise approximation** (41.39000000000001) | An implementation that trusts "we rounded it" instead of measuring the stored value publishes fourteen decimal places while believing it published two. |

---

## Divergence invariants

Implemented in `packages/shared-types/src/observability/invariants.ts`, each
returning `{ ok, code, safe }` where `safe` carries classifications, booleans and
small integers only. The suite runs every `safe` map through the same sensitive
value sweep the redaction layer uses, so a production divergence check cannot
log a coordinate or a place name.

| Invariant | Function | Status |
|---|---|---|
| One query identifier for list and map | `checkQueryIdentityMatch` | Real now |
| Visible area against queried area | `checkVisibleAreaMatchesQueriedArea` | Real now |
| Visible label against current selection | `checkVisibleLabelMatchesSelection` | Contract for #352 |
| A result for a superseded query id | `checkResultIsForCurrentQuery` | Real now |
| A fallback after a geocoder error | `checkGeocoderFallbackScope` | Real now |
| Published precision above policy | `checkPublicPrecisionWithinPolicy` | Real now; policy owned by #347 |
| A listing with no housing identity | `checkListingHasHousingIdentity` | Contract for #360 / #361 |

The three marked "contract" take a minimal structural interface declared beside
the function rather than importing a type that does not exist. They are called
by the suite with real fixtures today; what the later issue supplies is a
production caller, not the assertion.

---

## Sources of flakiness, and limitations

Stated because the acceptance criteria demand it, and because an undocumented
flake becomes a disabled test.

**In what runs today**

- **The backend suite requires a reachable Postgres and does not skip without
  one.** That is deliberate (`packages/backend/jest.globalSetup.ts`), and it
  means these tests cannot run in an environment without Docker even though none
  of them touches the database. The failure is loud, not silent.
- **Parallel jest workers share one Postgres server.** A file-level failure whose
  path is repeated in brackets while `Tests: 0 failed` is contention, not a
  regression. Re-run the file alone before believing it.
- **The pinned digests are pinned twice on purpose** — once in the backend suite,
  once in the frontend one. Changing the canonicalisation reds both, which is the
  intent: it must be a decision, not a side effect.
- **`jest-expo` runs on Node, not Hermes.** The frontend contract test proves the
  package resolves and the digest agrees under Babel; it does NOT prove the
  digest on a device. `deriveQueryId` avoids `BigInt` and
  `String.prototype.normalize` for that reason, but the guarantee is by
  construction and by review, not by measurement.

**In the matrix as a whole**

- **A geocoder failure cannot be injected until #351.** Until the geocoder is
  behind Homiio's own gateway, the four failure outcomes are asserted against the
  invariant rather than against a real provider.
- **Native permission prompts are out of process.** iOS and Android grant, deny
  and revoke outside the app, and revocation restarts it on some versions.
  Nothing here reproduces that; those rows stay MANUAL.
- **A map viewport is floating-point and device-dependent.** The area invariant
  therefore uses a tolerance (`DEFAULT_MIN_AREA_OVERLAP`, half the union) rather
  than equality, and the query id quantises coordinates to three decimals. A pair
  straddling a grid cell boundary DOES get two ids — quantisation, not a
  tolerance — which is why the geometric check works on real numbers instead.
- **Timing.** Latency and duration are bucketed, so a slow CI machine changes
  which bucket an event lands in. No assertion here depends on a bucket boundary
  for a measured duration; the tests bucket fixed numbers.

---

## What this issue deliberately did NOT build

- **No third-party analytics SDK.** The issue forbids one without an explicit
  privacy review. Measured before writing anything: `posthog`, `mixpanel`,
  `amplitude`, `@segment/` and `firebase/analytics` return zero matches across
  the tracked tree, and `@bitdrift/react-native` appears only as an Expo
  config-plugin entry with no JavaScript import anywhere. There was nothing to
  extend, so this is a first-party pipeline into Homiio's own backend.
- **No events table and no dashboards.** The sink is the structured logger, and
  retention is the log group's retention — one setting owned by `oxy-infra`. A
  table would make this the business-intelligence system the issue puts out of
  scope.
- **No frontend emitter wiring.** Eight of the thirteen events originate on a
  client, and not one of the surfaces that would emit them exists yet (#351 to
  #356, #363). A poster with no callers is the speculative framework this issue
  warns against. The shared emitter already runs in that environment — the
  frontend suite proves it resolves and behaves — and the ingest route is live,
  so wiring a transport is a small piece of whichever issue first has something
  to send.
- **No metrics computation.** The issue's minimum metric list (resolved-location
  ratio, permission ratio, geocoder latency by provider, zero-result rate,
  "search this area" usage, review-step abandonment, materialised candidates,
  duplicate groups, insufficient-data price evaluations, blocked or redacted
  privacy events) is all derivable from the vocabulary as specified. Deriving it
  is a query against the log, not code in this repository.
