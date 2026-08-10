# ADR 0004 — Local, explainable, versioned pricing assessments

- **Status:** Proposed
- **Date:** 2026-08-10
- **Issue:** [#348](https://github.com/OxyHQ/Homiio/issues/348) (epic [#344](https://github.com/OxyHQ/Homiio/issues/344), gate A)
- **Implementation:** #369 (engine + retirement), #367 (price history), #368 (cross-portal grouping), #370 (public-data adapters)
- **Related ADRs:** `0001-canonical-housing-graph.md`, `0002-location-and-search-contract.md`,
  `0003-privacy-verification-publication.md`

Every structural claim below was re-derived from this checkout at `c4d73a43`. Numbers
attributed to production carry the census that produced them and its date; where no
measurement exists, the gap is stated as a gap rather than filled with a plausible figure.

---

## 1. Context — what the code actually does today

Homiio publishes a single boolean "Fair price" badge, a 0–100 `fairnessScore`, a red
"Not a fair price" banner, a `fairPrice=true` search filter and a `sortBy=fairness`
ordering. All five are fed by two independent halves that are then combined:

**Half A — a hard-coded rent model** (`packages/shared-types/src/ethicalPricing.ts`).
`calculateEthicalRent` multiplies a per-square-foot base rate by a city multiplier,
bedroom/bathroom/size/quality/floor factors, then adds flat amenity amounts and takes
±15 % around the result as the "ethical range".

**Half B — a local market comparison** (`packages/backend/services/areaPriceComparison.ts`).
Aggregates comparable listings within a 2 km radius, falling back to the whole city, and
classifies the subject's distance from the sample **mean** into four verdicts.

`packages/backend/services/priceEthicsService.ts` combines them into
`PropertyPriceEthics` (`isFairPrice`, `fairnessScore`, `withinEthical`, `marketVerdict`,
`percentDiffFromAvg`, `ethicalSuggested`, `ethicalMax`, `scoredAt`), persists it into eight
columns on `properties`, and every consumer in §9 reads from there.

### 1.1 Verifying the issue's premises

Issue #348 states the current calculation "mixes assumptions that are not universal:
dollars, square feet, US cities and fixed utility costs". Each was checked against the
code. Three are confirmed and sharper than stated; the fourth is confirmed in a narrow
sense and understated in a more important one.

#### Premise "dollars" — **CONFIRMED**, and it reaches the UI in every locale

`ethicalPricing.ts` has no currency parameter at all. Every constant is a bare number
(`AMENITY_VALUES.wifi = 30`, `ADDITIONAL_AMENITY_VALUES.furnished = 100`,
`basePrice = 800` for a room at `ethicalPricing.ts:201`) and every `reasoning` string is
formatted with a literal `$` (`ethicalPricing.ts:202`, `:207`, `:212`–`:318`,
`:370`). The dead amenity metadata in `packages/frontend/constants/amenities.tsx:16`
names the unit outright: `maxFairValue?: number; // Maximum ethical value add in USD`.

The dollar reaches the screen. All four locale bundles carry the same untranslated string
with a hard `$`:

| key | en.json | es.json | ca-ES.json | it.json |
|---|---|---|---|---|
| `property.suggestedRent` | `Suggested: ${{amount}}/month` | identical | identical | identical |
| `property.maxEthicalRent` | `Max Ethical: ${{amount}}/month` | identical | identical | identical |

Rendered by `packages/frontend/components/property/create/EthicalPricingRecommendation.tsx:89-94`
to a landlord creating a listing — including a landlord in Barcelona, Rome or Barcelona's
Catalan locale.

There is a second, separate currency defect the issue does not mention, and it is the
worse of the two: **Half B never filters comparables by currency.**
`buildBaseComparableFilter` (`areaPriceComparison.ts:154-165`) constrains offering, status,
availability, bedrooms and a positive price — and nothing else. `resolvePriceBasis`
resolves the subject's currency (`:369-400`) and `buildTargetContext` carries it
(`:423`), but no aggregate uses it: `aggregatePriceStats` (`:208-241`) averages the raw
price column across whatever is in scope. This is reachable, not theoretical — Argentine
and Ecuadorian portals publish ARS and USD side by side in one city
(`packages/listing-providers/src/providers/ar/argenprop/fixtures.ts:12` ARS 380 000 beside
`:34` USD 320 000; the same in `ar/zonaprop/fixtures.ts:12,30`;
`providers/ec/plusvalia/fixtures.ts:8` USD in an otherwise mixed market;
`providers/blueground/fixtures.ts:72,106` EUR beside USD). Two listings a block apart in
Buenos Aires are averaged as if 450 000 ARS and 1 800 USD were the same quantity.

#### Premise "square feet" — **CONFIRMED**, and the stored column is ambiguous

Half A treats the area column as square feet: `BASE_PRICES_PER_SQFT`
(`ethicalPricing.ts:51-66`), `basePrice = property.squareFootage * basePricePerSqft`
(`:205`), and `SIZE_EFFICIENCY_ADJUSTMENTS` keyed at 200/400/…/2000 (`:153-162`), which
are square-foot dwelling sizes.

But the column it reads, `properties.square_footage`
(`packages/backend/db/schema/properties.ts:547`), is **not consistently square feet**.
Most ingest paths convert to square metres and say so:

- `packages/listing-providers/src/providers/gb/openrent/parse.ts:14` —
  `/** Square feet → square metres (the app stores squareFootage in m²). */`
- `providers/gb/rightmove/parse.ts:20,235-263` — prefers a native `sqm` entry and converts
  `sqft` only when no metric one exists.
- ~35 provider modules assign `result.squareFootage = listing.squareMeters` verbatim
  (`providers/idealista/index.ts:598`, `providers/de/immobilienscout24/index.ts:264`,
  `providers/it/immobiliare/index.ts:330`, and so on).

Two paths do the opposite and store **square feet** in the same column:

- `providers/ca/realtorCa/parse.ts:73-79,143` — `parseSqft` extracts a `sq ft` number and
  assigns it unconverted; consumed at `providers/ca/realtorCa/index.ts:327`.
- `packages/listing-providers/src/parse/jsonLd.ts:372-375,411` — `readUsFloorSize` reads
  `floorSize` and **discards `unitCode` entirely**, even though the US fixtures declare it
  (`providers/us/apartmentsCom/fixtures.ts:56` and `providers/us/zillow/fixtures.ts:57`
  both emit `unitCode: 'FTK'`, the UN/CEFACT code for square foot). Consumed at
  `providers/us/apartmentsCom/index.ts:219` and `providers/us/zillow/index.ts:248`.
  `providers/us/realtorCom/index.ts:282` and `providers/us/hotpads/index.ts:237` likewise
  assign a `sqft`/`minSqft` field directly.

So one column carries two units with no discriminator, and the contradiction is visible in
the product: the create wizard labels the field **"Square Footage"** (hard-coded English,
not even a translation key — `components/property/create/BasicInfoStep.tsx:93`), while
every display string says m² (`en.json` `listing.sale.pricePerSqm = 'Price per m²'`,
`property.areaInsights.perSqm = '{{price}}/m² vs area {{areaPrice}}/m²'`;
`services/telegramService.ts:329` appends a hard-coded `m²`). `buildPricePerSqm`
(`areaPriceComparison.ts:336-346`) and `offeringRules.ts:57-60`
(`sale.pricePerSqm = price / squareFootage`) both divide by that column and label the
result per square metre regardless.

#### Premise "US cities" — **CONFIRMED**

`LOCATION_MULTIPLIERS` (`ethicalPricing.ts:73-93`) is 17 US cities plus
`default: 1.0`. Lookup is city, then region, then default (`:193-196`). Barcelona,
Bucharest, Warsaw, Rome, Buenos Aires and every other non-US market resolves to `1.0`,
i.e. to the Houston/Phoenix/Orlando price level. `Washington` is present as a key and is
matched by both the city and the region lookup, which is its own latent ambiguity.

#### Premise "fixed utility costs" — **CONFIRMED, but the real problem is absence**

The literal claim holds: `ADDITIONAL_AMENITY_VALUES.utilities_included = 80`
(`ethicalPricing.ts:112`) adds a flat +$80 when utilities are included, with a comparable
flat +$100 for furnished and +$25 for "near transport".

The larger fact is that **total cost is not modelled at all**. The schema carries every
component — `longTermRentDeposit`, `longTermRentApplicationFee`, `longTermRentLateFee`,
`longTermRentUtilities`, `shortTermRentCleaningFee`, `shortTermRentServiceFee`,
`shortTermRentTaxesPercent`, `shortTermRentDeposit`, `petFee`,
`listingFlagsAgencyFeePayable` (`db/schema/properties.ts:487,554,602,629-643`) — and a
grep of `priceEthicsService.ts`, `areaPriceComparison.ts` and `ethicalPricing.ts` for
`deposit|applicationFee|lateFee|cleaningFee|serviceFee|taxesPercent|petFee|agencyFee`
returns **zero matches**. A listing advertising €900/month with a €2 700 deposit and a
non-refundable agency fee scores identically to one at €900 with neither.

### 1.2 What the current model actually outputs

The scenarios below were **executed** against `packages/shared-types/src/ethicalPricing.ts`
at `c4d73a43` (`bun` running `validateEthicalPricing`), not derived by hand:

| scenario | proposed | `suggestedRent` | `maxRent` | `withinEthical` |
|---|---|---|---|---|
| Barcelona, 2-bed 70 m², lift + furnished | 1 450 | 276 | **317** | **false** |
| the same flat with area typed as 753 ft² | 1 450 | 1 320 | 1 518 | **true** |
| Bucharest, 2-bed 65 m² | 3 200 (RON) | 122 | **140** | **false** |
| Warsaw, 2-bed 60 m² | 4 500 (PLN) | 112 | **129** | **false** |
| Buenos Aires, 2-bed 70 m² | 450 000 (ARS) | 131 | **151** | **false** |
| Austin TX, 2-bed 900 ft² | 1 800 (USD) | 1 789 | 2 057 | **true** |

Three things follow, and each is a decision driver rather than a bug report:

1. **Every correctly-entered European listing fails.** `withinEthical === false` makes
   `computeIsFairPrice` return `false` (`priceEthicsService.ts:76`), which is exactly what
   `app/properties/[id]/index.tsx:151` gates the red banner on. A Barcelona landlord is
   told "This price exceeds Homiio's ethical maximum (€317/month)".
2. **The area unit alone flips the verdict.** Rows 1 and 2 are the same dwelling.
3. **The model is calibrated for one market family.** Only the Austin row lands near its
   input, because that is the market the constants describe.

### 1.3 Four further behaviours that decide the design

**(a) "No data" currently renders as "average", not as "unknown".**
`buildComparison(null, thisPrice)` (`areaPriceComparison.ts:268-279`) returns
`min = max = avg = median = thisPrice`, `percentDiffFromAvg: 0`, `verdict: 'average'` —
a listing with zero comparables is reported as exactly typical. `buildEmptyInsights`
(`controllers/property/areaInsights.ts:75-94`) serves that shape.

**(b) An unassessable external listing is actively labelled unfair.**
`computeIsFairPrice` for `isExternal` returns `hasMarketData && verdict !== 'above_average'`
(`priceEthicsService.ts:72-74`) — with no comparables that is `false`, which the detail
page turns into the red banner whose generic line reads *"This listing does not meet
Homiio's fair-price criteria"* (`PriceEthicsBanner.tsx:56-58`, `en.json`
`property.priceEthics.banner.generic`). The behaviour is deliberate and pinned by a test:
`__tests__/unit/priceEthicsService.test.ts:183` — *"rejects external listings without
market comparables"*. **Absence of Homiio data is presented to the user as a finding about
the landlord.**

**(c) The minimum sample applies to one rung only.** `MIN_RADIUS_SAMPLE = 5`
(`areaPriceComparison.ts:45`) gates the radius; the city fallback has no minimum at all
(`:530-538`) — a single comparable in the whole city produces a verdict, and `sampleSize`
is never surfaced next to `isFairPrice`.

**(d) The score is a mean, not a percentile.** `percentDiffFromAvg` is computed off
`stats.avg` (`:282`), which one outlier moves. The exact median is already computed
(`percentile_cont(0.5)`, `:221`) and is used only for display.

**(e) `ethicalMax` is FX-converted as if it were the listing's currency.**
`app/properties/[id]/index.tsx:152-156` picks the listing's currency and
`PriceEthicsBanner.tsx:39` passes the USD-model number through
`convertAndFormat(ethicalMax, currency)`, which converts *from* that currency
(`hooks/useCurrency.ts:63-70` → `utils/currency.ts:191-202`, live frankfurter.app rates).
A dollar-derived number is relabelled EUR and then converted again.

### 1.4 What we do and do not know about production data

- **`priceEthics` was present on 133 of 17 644 listings** at the pre-migration census
  recorded in `packages/backend/db/schema/properties.ts:55`, taken against production on
  **2026-08-06** (`db/MIGRATION-CONTRACT.md:340`). Re-verify before acting on it; a
  row count is exactly the kind of fact that stops being true quietly.
- **The listing distribution by currency is NOT measured.** Nothing in this checkout can
  answer it: fixtures are illustrative, not sampled, and there is no seed corpus with a
  market mix. `LISTING_CURRENCIES` (`packages/shared-types/src/currency.ts:33-49`) admits
  15 codes, and the provider registry writes at least EUR, USD, GBP, CAD, PLN, MXN, ARS,
  RON, COP, CLP, PEN, BRL, AUD and AED. **Gap recorded 2026-08-10:** #369 must open with a
  `SELECT currency, count(*)` per priced offering against production before any jurisdiction
  is registered as supported, because the minimum-sample thresholds in §6 cannot be
  calibrated without it.

---

## 2. Decision

Replace the universal "ethical price" score with **local, versioned, explainable pricing
assessments**, published only for jurisdictions explicitly registered as supported, and
never collapsed into a single moral grade.

The eight mandatory principles of #348 are adopted as binding decisions:

**D1 — There is no single global truth of "ethical price".**
No code path may produce a price verdict from parameters that are not scoped to a named
jurisdiction. Concretely: **no default parameter entry may exist**. The failure shape being
retired is `LOCATION_MULTIPLIERS.default = 1.0` (`ethicalPricing.ts:92`) — a fallback that
silently answers for markets nobody calibrated. Parameter lookup is by exact jurisdiction
key; a miss is an error in the engine and `insufficient` at the API, never a substitution.

**D2 — Nothing is published without jurisdiction, currency, area unit, date and methodology.**
These five are required, non-nullable fields of `PricingAssessment`. A DTO that omits any
one of them is invalid and must not be serialized. Monetary values inside an assessment
carry the assessment's `currency`; area values carry its `areaUnit`. No value is ever
emitted as a bare number.

**D3 — A comparison must show its sample, its sources and its confidence.**
`sampleSize`, `observationCount`, `sources[]` and `confidence` are required. A UI surface
that renders a band or a percentile must render, or make reachable in one interaction, the
sample size, the area the sample was drawn from, the observation window and the date.
Rendering a verdict without them is a defect.

**D4 — "Insufficient data" is a valid, visible result.**
`confidence: 'insufficient'` is a first-class outcome with machine-readable
`insufficientReasons[]`. It is shown, not hidden, and it is never rendered as "average",
"typical" or "not fair". This directly retires §1.3(a) and §1.3(b).

**D5 — Price, total cost and advertiser conduct are distinct dimensions.**
Four dimensions are assessed and stored separately (§5). **No aggregate grade combining
them may be computed, stored, exposed on any DTO, or used for ranking** without a later,
explicit, written product decision recorded as a successor ADR.

**D6 — The methodology is versioned and reproducible.**
Every assessment carries `methodologyVersion` and an `inputDigest`. Same inputs + same
version ⇒ byte-identical output, and that is a required test. Assessment rows are
immutable; recomputation inserts a new row and marks the previous `supersededAt`.

**D7 — Official data and market data are identified separately.**
Each source is tagged `observationKind` (`advertised` | `transacted` | `official_index`).
Statistics over different kinds are computed and reported **separately and never blended**.
An official index may be used only where the jurisdiction capability names it and its
licence permits derived works.

**D8 — A methodology change never silently rewrites historical assessments.**
Superseded assessments remain addressable and keep their original `calculatedAt` and
`methodologyVersion`. Any surface showing a historical value must show the version and date
it was computed under, and must not present it as current.

---

## 3. The assessment contract

Lives in `@homiio/shared-types` (`src/pricing.ts`, new). It **preserves** every element
#348 requires — versioning, jurisdiction, sources, sample size, confidence, explanation —
and deviates in four places, each noted with its reason.

```ts
export type PricingOffering = 'long_term_rent' | 'short_term_rent' | 'sale';
export type PricingSubjectType = 'listing' | 'unit' | 'building' | 'area';
export type AreaUnit = 'sqm' | 'sqft';
export type PricingConfidence = 'insufficient' | 'low' | 'medium' | 'high';

/**
 * `none` is a DEVIATION from the reference shape: an assessment that never
 * sampled anything (unsupported jurisdiction) must not claim a basis it did not
 * use. `hybrid` means market and official statistics were BOTH computed and are
 * BOTH reported — never that they were averaged together (D7).
 */
export type PricingBasis =
  | 'none' | 'radius' | 'neighborhood' | 'city' | 'official_index' | 'hybrid';

export type PricingObservationKind = 'advertised' | 'transacted' | 'official_index';

export type PricingInsufficientReason =
  | 'jurisdiction_not_supported'
  | 'offering_not_supported'
  | 'sample_below_minimum'
  | 'no_price'
  | 'no_area'
  | 'no_location'
  | 'currency_mismatch'
  | 'observations_too_old'
  | 'source_unavailable';

/**
 * DEVIATION from `sourceIds: string[]`: a bare id cannot answer "is this
 * official?" or "does its licence permit this?", which D7 requires at the point
 * of publication. `id` is preserved as a member.
 */
export interface PricingSourceRef {
  id: string;
  kind: PricingObservationKind;
  /** Provider id for ingested data, publisher name for an official dataset. */
  publisher: string;
  datasetId?: string;
  /** Licence identifier or URL. Required for `official_index`. */
  licence?: string;
  /** Whether the licence permits publishing derived statistics. */
  licenceAllowsDerived?: boolean;
  /** The period the source data covers, ISO 8601 interval. */
  period?: string;
  retrievedAt: string;
}

export interface PricingMoney { amount: number; currency: string; }
export interface PricingArea { value: number; unit: AreaUnit; }

export interface PricingAssessment {
  id: string;
  subjectType: PricingSubjectType;
  subjectId: string;

  /** `<jurisdiction>-<offering>@<YYYY>.<MM>.<n>`, e.g. `ES-long_term_rent@2026.08.1`. */
  methodologyVersion: string;

  /** ISO 3166-1 alpha-2, optionally with a subdivision: `ES`, `ES-CT`, `US-NY`. */
  jurisdiction: string;
  /** ISO 4217. The currency of EVERY monetary field on this object. */
  currency: string;
  /** The unit of EVERY area field on this object. */
  areaUnit: AreaUnit;
  offering: PricingOffering;

  basis: PricingBasis;
  /** Radius actually used when `basis === 'radius'`. */
  radiusMeters?: number;
  /** Neighborhood-granularity label only — never a street. See ADR 0003. */
  areaLabel?: string;

  /** DISTINCT canonical units in the sample. */
  sampleSize: number;
  /** Raw observations before duplicate collapsing. `>= sampleSize` always. */
  observationCount: number;
  /** Observations dropped by the outlier rule. */
  outliersRemoved: number;
  /** ISO 8601 interval the observations fall in. */
  observationWindow?: string;

  sources: PricingSourceRef[];

  median?: PricingMoney;
  p25?: PricingMoney;
  p75?: PricingMoney;
  /** The subject's rank in the sample, 0–100. */
  percentile?: number;
  /** Subject vs `median`, as a percentage. Positive = more expensive. */
  percentDifference?: number;

  subjectPricePerArea?: PricingMoney;
  medianPricePerArea?: PricingMoney;

  /** Present only when the total-cost dimension was computable. See §5.2. */
  totalMonthlyCost?: TotalCostAssessment;

  confidence: PricingConfidence;
  insufficientReasons?: PricingInsufficientReason[];

  calculatedAt: string;
  validUntil?: string;
  supersededAt?: string | null;

  /** sha256 over the canonicalised inputs + parameter set. Reproducibility (D6). */
  inputDigest: string;

  explanation: PricingExplanationItem[];
}
```

### 3.1 The explanation item

```ts
export type PricingExplanationKind = 'input' | 'method' | 'result' | 'limitation';

export type PricingExplanationValue =
  | { type: 'money'; amount: number; currency: string }
  | { type: 'area'; value: number; unit: AreaUnit }
  | { type: 'count'; value: number }
  | { type: 'percent'; value: number }
  | { type: 'date'; iso: string }
  | { type: 'interval'; iso: string }
  | { type: 'text'; value: string };

export interface PricingExplanationItem {
  /** Stable machine key, e.g. `comparables.sample`, `limitation.utilities_excluded`. */
  code: string;
  kind: PricingExplanationKind;
  severity: 'info' | 'caution';
  /** i18n key the CLIENT renders. The server never formats a sentence. */
  messageKey: string;
  values: Record<string, PricingExplanationValue>;
}
```

**DEVIATION and its reason.** The reference shape leaves `PricingExplanationItem`
unspecified; the obvious implementation is the one that exists today —
`PricingRecommendation.reasoning: string[]` (`ethicalPricing.ts:38`), server-formatted
English with a hard `$`. That shape cannot be translated into `es-ES`, `ca-ES` or `it-IT`,
cannot be re-rendered in the viewer's display currency, and cannot be asserted on in a
test except by string matching. A key-plus-typed-values item can be rendered as human
language in any locale, and each value carries its own unit so no renderer has to guess.

An assessment's explanation must contain at minimum: one `input` item for the subject's
price and area, one `method` item naming the basis and the sample, one `result` item, and
one `limitation` item for every capped-confidence reason. `insufficient` assessments carry
`method` and `limitation` items only — no `result`.

**Privacy.** Explanation values may not carry a comparable's street address, exact
coordinates, or advertiser identity. Area labels are neighborhood granularity at the
finest. See `0003-privacy-verification-publication.md`.

---

## 4. Jurisdiction capability registry

```ts
export interface PricingJurisdictionCapability {
  jurisdiction: string;
  offerings: PricingOffering[];
  supported: boolean;
  methodologyVersion?: string;
  sourceCoverage: string[];
  limitations: string[];

  /** ADDED — D2 requires these to be declared, not inferred from a listing. */
  currency: string;
  areaUnit: AreaUnit;
  radiusLadderMeters: number[];
  minimumSample: Record<PricingOffering, { low: number; medium: number; high: number }>;
  maxObservationAgeDays: Record<PricingOffering, number>;
  officialSources: PricingSourceRef[];
  /** When the thresholds above were last calibrated against real data. */
  calibratedAt: string;
}
```

Rules:

1. **The registry is the only authority.** An assessment is published only when a
   capability entry exists for the jurisdiction, `supported === true`, and the offering is
   in `offerings`. Otherwise the API returns `confidence: 'insufficient'` with
   `jurisdiction_not_supported` or `offering_not_supported` and no statistics at all.
2. **No default entry, no inheritance, no nearest-neighbour.** A missing key is a miss.
   Reusing another country's parameters is the specific failure this registry exists to
   make impossible.
3. **A jurisdiction is registered only with calibration evidence** — the currency
   distribution, the observation counts per rung, and the sample sizes the thresholds were
   fitted to, recorded in the PR that adds the entry, with `calibratedAt` set.
4. **The registry ships empty.** Every market is `supported: false` at cutover. This is
   deliberate: it makes the retirement in §8 safe by construction, because there is no
   jurisdiction for which a badge could be shown.
5. **A subdivision entry overrides its country entry** for lookup (`ES-CT` before `ES`),
   which is how a market with genuinely different regional dynamics is expressed. Lookup
   still requires an exact match at one of the two levels; there is no third fallback.

---

## 5. Four dimensions, assessed separately

The API exposes an envelope with four independent slots. Any slot may be `null`; a `null`
slot means "not assessed", which the UI renders as such and never as a neutral score.

```ts
export interface HousingAssessment {
  subjectType: PricingSubjectType;
  subjectId: string;
  price: PricingAssessment | null;
  totalCost: TotalCostAssessment | null;
  conduct: ConductAssessment | null;
  experience: ExperienceAssessment | null;
  /**
   * INTENTIONALLY ABSENT: there is no `overall`, `grade` or `score` field.
   * Adding one requires a successor ADR (D5).
   */
}
```

### 5.1 Price comparison

Price versus comparables; price per area unit; local percentile; historical evolution
(from #367's immutable snapshots, once they exist); difference against an official index
where one is registered. This is `PricingAssessment` as defined in §3.

### 5.2 Total cost

```ts
export interface TotalCostAssessment {
  currency: string;
  methodologyVersion: string;
  jurisdiction: string;
  calculatedAt: string;

  /** Rent or the principal recurring charge. */
  base: PricingMoney;
  /** Recurring charges other than the base: community fees, parking, pet fee. */
  recurring: TotalCostComponent[];
  /** One-off charges: agency fee, application fee, cleaning. */
  oneOff: TotalCostComponent[];
  /** Refundable amounts held, NOT a cost. Reported separately, never summed in. */
  refundableUpfront: TotalCostComponent[];

  utilities: 'included' | 'excluded' | 'partial' | 'unknown';

  /** base + recurring + (one-off amortised over `amortisationMonths`). */
  normalisedMonthly?: PricingMoney;
  amortisationMonths?: number;

  /**
   * `complete` only when every component the jurisdiction's checklist names is
   * present. `partial` and `unknown` are shown as such — never rounded up.
   */
  completeness: 'complete' | 'partial' | 'unknown';
  explanation: PricingExplanationItem[];
}

export interface TotalCostComponent {
  code: string;                 // 'agency_fee', 'community_fee', 'deposit', …
  amount: PricingMoney;
  /** Amount and provenance: was it advertised, or derived from a jurisdiction rule? */
  provenance: 'advertised' | 'jurisdiction_rule' | 'user_reported';
  refundable: boolean;
}
```

Binding rules:

- **A deposit is never a cost.** It is a refundable amount held; it belongs in
  `refundableUpfront` and never in `normalisedMonthly`. It is nevertheless shown, because a
  three-month deposit is a real barrier to access.
- **One-offs are amortised over the contract's own minimum term when known**, else over 12
  months, and **both** the one-off amount and its amortised share are shown.
- **Utilities are never estimated.** Where they are excluded, that is reported as excluded
  and unquantified; a synthetic utility figure is exactly the assumption this ADR retires.
- **Total cost is never compared across listings unless `completeness === 'complete'` for
  both.** A listing that discloses its agency fee must not look more expensive than one
  that hides it.

### 5.3 Conditions and transparency

Assesses the *listing*, not the price: whether the cost breakdown is complete or partial,
whether a contract is available, whether address and advertiser are verified (ADR 0003),
frequency of price changes (#367), disagreement between portals for the same canonical
unit (#368), and relevant clauses or restrictions. Facts and counts only — no derived
adjective, and no inference about intent from a single observation.

### 5.4 Historical experience

Deposit return, repair response, maintenance problems, verified reviews, right of reply.
Sourced from Homiio's own review and eviction records under the existing community rules.
**This dimension is never merged into the price dimension**: a landlord who returns
deposits promptly does not make an expensive flat cheap, and an expensive flat does not
make a landlord a bad one.

---

## 6. Comparables policy

### 6.1 Minimum filters — all mandatory

A listing is a comparable for a subject only if **every one** of these holds:

1. Same `offering`. Monthly, nightly and sale are never pooled.
2. **Same jurisdiction** as the assessment. A nearer listing across a border is excluded.
3. **Same currency** as the subject. No FX conversion inside a sample, ever (§6.6).
4. Same canonical area unit after normalisation at ingest (§6.5).
5. `status = 'published'`, available, not soft-deleted.
6. Bedrooms within ±1, **except** that a studio (0 bedrooms) compares only to studios.
7. Property type in the same family: {apartment, studio, room, coliving, roommates} /
   {house} / {everything else, which is not comparable to anything}.
8. Furnishing class matches exactly: `furnished` ↔ `furnished`, `unfurnished` ↔
   `unfurnished`. `partially_furnished` and `not_specified` form their own classes and
   compare only to themselves — they are never pooled into either.
9. Area within ±30 % of the subject when both have a positive area. When the subject has no
   area, area statistics are suppressed and the price-level comparison caps at `low`.
10. Not the subject, and not a known duplicate of it (§6.4).
11. Observed within `maxObservationAgeDays` for that offering (§6.3).

### 6.2 Radius ladder and fallback

Default ladder, overridable per jurisdiction: **1 000 m → 2 000 m → 5 000 m → neighborhood
→ city**. The engine takes the **first** rung whose distinct-unit count meets the
`medium` minimum, and records that rung as `basis`. If no rung meets even the `low`
minimum, the result is `insufficient`.

- The city rung caps `confidence` at `medium`. A city-wide sample answers a different
  question from a 1 km one and must not claim the same authority.
- There is **no country rung and no global rung.** Falling back past the city is the shape
  that produces a worldwide average, which is D1's failure mode.

### 6.3 Maximum observation age

Defaults, per offering, overridable per jurisdiction:

| offering | max age | note |
|---|---|---|
| `long_term_rent` | 90 days | |
| `short_term_rent` | 60 days | plus a mandatory seasonality `limitation` item; nightly prices move with season and a 60-day window does not remove that |
| `sale` (advertised) | 180 days | |
| `sale` (transacted) | source-defined | the source's own published period is carried in `PricingSourceRef.period` |

### 6.4 Duplicate suppression

The same physical unit advertised on three portals must count **once**.

- **Now:** the sample is collapsed at query time using the existing conservative fingerprint
  (`packages/backend/services/ingestion/dedupeFingerprint.ts`: same type + city + offering +
  identical price and currency + bedrooms > 0 + area > 0 + description Jaccard ≥ 0.95,
  `MIN_DESCRIPTION_JACCARD` at `:48`), applied as a **clique** cover exactly as
  `scripts/dedupeExternalListings.ts:102-108` already does — never single-linkage, which
  chains A–B–C through pairs that are not mutually duplicates.
- **Target:** once `0001-canonical-housing-graph.md` and #368 land, at most one observation
  per **canonical unit** per offering per window enters a sample, which makes the property
  structural rather than heuristic.
- **The counts are separate and both are published.** `observationCount` is the raw count,
  `sampleSize` is the distinct-unit count, and `sampleSize` is what every threshold is
  measured against. When `observationCount > sampleSize` the explanation must say so.
  A build in which they are always equal is a build in which duplicate suppression is not
  running, and that is a required test.
- Duplicate suppression for the *sample* must not depend on the archival script having been
  run. That script removes duplicates from the *catalogue*; the sample must be correct even
  on a catalogue that has never been swept.

### 6.5 Currency and area-unit conversion

- **An assessment is computed and stored in exactly one currency** — the subject's — and one
  area unit, the jurisdiction's canonical unit. `currency` and `areaUnit` are fields of the
  assessment, not properties of the renderer.
- **No FX conversion is applied inside a statistic.** A median, a percentile, a percentage
  difference and a price-per-area are computed over one currency only. Display-time FX
  (`hooks/useCurrency.ts`) may convert a *displayed amount* and must never be applied to an
  amount that was derived from a mixed sample — which is why the sample cannot be mixed.
- **Area is normalised at ingest, not at read.** A provider must emit both a value and its
  unit; the ingest boundary converts to the jurisdiction's canonical unit and persists the
  unit alongside. The specific defects this closes are `parse/jsonLd.ts:372-375` discarding
  `unitCode`, and `providers/ca/realtorCa/parse.ts:143` storing square feet in a column the
  rest of the system reads as square metres. Renaming the column away from `squareFootage`
  is part of #369; a column named for one unit and holding another is a trap regardless of
  what any comment says.
- **A listing whose area unit cannot be established has no area.** It contributes to price
  statistics and not to per-area statistics.

### 6.6 Outliers

- Trim to the IQR fence — outside `[Q1 − 1.5·IQR, Q3 + 1.5·IQR]` — computed **after**
  duplicate suppression, plus a jurisdiction plausibility band where one is registered.
- The **subject is never a member of its own sample** and is never trimmed.
- `outliersRemoved` is reported. If more than 20 % of observations are trimmed, confidence
  is capped at `low` and a `limitation` item is emitted: a sample that noisy is a statement
  about the data, not about the listing.
- **The headline statistic is the median, not the mean.** The current
  `percentDiffFromAvg` (`areaPriceComparison.ts:282`) is a mean-relative figure that one
  mispriced listing moves; `percentile_cont` is already computed and is what survives.

### 6.7 Offers versus real transactions

- `observationKind` is carried per source and never mixed into one statistic (D7).
- **Advertised-only samples cap at `medium`** and must carry a `limitation` item stating
  that the figures are asking prices.
- A `transacted` or `official_index` statistic may reach `high`, if the source's own sample
  and period support it.
- Where both exist, `basis: 'hybrid'` means both were computed and both are reported side
  by side. It never means they were averaged.

### 6.8 Short-term rent: stay length is part of the question

A per-night headline price is not comparable across listings with different cleaning fees
and minimum stays. Therefore:

- A short-term assessment declares a `stayNights` and reports an **effective nightly cost**
  at that stay length: `(nightly × nights + cleaningFee + serviceFee) × (1 + taxes) / nights`.
- Default `stayNights` is the subject's `minNights`, else 3.
- The comparable sample is evaluated at the **same** `stayNights`, and only comparables
  whose fee fields are present take part. If fewer than the minimum have them, the
  effective-nightly comparison is `insufficient` while the headline-nightly comparison may
  still stand — two sub-results, separately labelled, never one blended number.

### 6.9 Minimum sample sizes

Defaults, per offering, distinct units, overridable per jurisdiction and **required to be
recalibrated before a jurisdiction is marked supported**:

| offering | `low` | `medium` | `high` |
|---|---|---|---|
| `long_term_rent` | 8 | 15 | 30 |
| `sale` | 12 | 25 | 50 |
| `short_term_rent` | 20 | 40 | 80 |

Below `low` → `insufficient`. The city rung caps at `medium` (§6.2); advertised-only
samples cap at `medium` (§6.7); heavy trimming caps at `low` (§6.6); a missing subject area
caps the price-level result at `low` (§6.1.9). Caps compose — the lowest applies.

### 6.10 Official indices and licensing

An official source may be used only when **all** hold: the jurisdiction capability lists it
in `officialSources`; `licence` is recorded; `licenceAllowsDerived === true`; and the
`period` it covers is carried onto every assessment that cites it. An official figure is
reported as its own comparison line with its publisher and period named — a user must be
able to see that "the official index says X for this area in Q2 2026" is a different claim
from "the listings we can see ask Y today". #370 owns the adapter framework.

---

## 7. Worked examples

All four are illustrative of the *methodology*; the sample sizes and medians are worked
examples, not measurements of production. The §1.2 table is the measured part of this
document.

### 7.1 Long-term rent — supported jurisdiction, `high` confidence

**Subject:** Barcelona (ES-CT), 2-bed, 70 m², €1 450/month, deposit €2 900, community fee
€45/month, agency fee one month + 21 % VAT, utilities excluded, 12-month term.

Sampling: 1 000 m rung → 47 observations → duplicate suppression → 41 distinct units →
IQR trim removes 3 → **38**. 38 ≥ 30 ⇒ `high`; the rung met the `medium` minimum so the
ladder stops at 1 000 m.

```
basis                 radius (1 000 m)      currency  EUR      areaUnit  sqm
observationCount      47                    sampleSize 38      outliersRemoved 3
observationWindow     2026-05-12/2026-08-10
median                €1 380 / month        p25 €1 190   p75 €1 610
subject               €1 450 / month        percentile 62      percentDifference +5.1 %
subjectPricePerArea   €20.71 /m²            medianPricePerArea €19.70 /m²
confidence            high
methodologyVersion    ES-CT-long_term_rent@2026.08.1
```

Total cost:

```
base                   €1 450 / month
recurring              community_fee €45 / month            (advertised)
oneOff                 agency_fee €1 754.50                  (advertised, 1 month + 21 % VAT)
refundableUpfront      deposit €2 900                        (advertised, refundable)
amortisationMonths     12
normalisedMonthly      €1 641.21 / month
utilities              excluded
completeness           partial          ← utilities excluded and unquantified
```

Rendered: *"€1 450/month is about 5 % above the median asking price for similar 2-bedroom
homes within 1 km — €1 380/month, from 38 homes advertised in the last 90 days
(assessed 10 Aug 2026)."* Plus: *"Including the community fee and the agency fee spread
over a 12-month contract, the monthly cost is about €1 641. Utilities are excluded and are
not included in this figure. A refundable deposit of €2 900 is required up front."*

### 7.2 Short-term rent — `medium` confidence, two sub-results

**Subject:** Rome (IT), 1-bed, €120/night, `minNights` 4, cleaning fee €60, taxes 10 %.

Headline nightly: 1 000 m rung → 71 observations → 63 distinct → trim 5 → **58**.
58 ≥ 40 ⇒ `medium` (below the `high` floor of 80). Median €108/night; subject +11.1 %;
percentile 71. A seasonality `limitation` item is mandatory.

Effective nightly at `stayNights = 4`:
`(120 × 4 + 60) × 1.10 / 4 = €148.50/night`. Only 22 of the 58 comparables carry the fee
fields — below the `low` floor of 20? No: 22 ≥ 20, so this sub-result stands at `low`,
with a `limitation` item recording that 36 of 58 comparables could not be evaluated at the
same stay length. Median effective nightly across those 22: €131.25; subject +13.1 %.

Both are reported. Neither is presented as *the* answer, and the headline number is never
silently replaced by the effective one.

### 7.3 Sale — advertised only, capped at `medium`

**Subject:** Valencia (ES-VC), 3-bed, 88 m², €285 000.

1 000 m rung → 9 distinct, below the `low` floor of 12 ⇒ ladder continues. 2 000 m rung →
41 observations → 36 distinct → trim 2 → **34**. 34 ≥ 25 ⇒ `medium`; capped at `medium`
anyway because every observation is `advertised`.

```
basis                 radius (2 000 m)      currency  EUR      areaUnit sqm
sampleSize            34                    observationCount 41  outliersRemoved 2
medianPricePerArea    €2 980 /m²            subjectPricePerArea €3 238 /m²
percentDifference     +8.7 %                percentile 68
confidence            medium
limitation            'These are asking prices, not recorded sale prices.'
limitation            'No official transaction index is registered for this area.'
```

`ES` has no `officialSources` entry at the time of writing, so `sources` contains only
Homiio-ingested advertised observations and the second limitation item is required. When
#370 registers one, the same subject gains an `official_index` line and `basis: 'hybrid'` —
reported beside the market figure, not merged into it.

### 7.4 Insufficient data — two distinct shapes

**(a) Jurisdiction not supported.** Cluj-Napoca (RO), 2-bed, RON 3 200/month. `RO` has no
capability entry with `supported: true`. The engine refuses **before sampling**:

```
basis  none    sampleSize 0    observationCount 0    confidence insufficient
insufficientReasons  ['jurisdiction_not_supported']
explanation  [ method: 'pricing.method.jurisdiction_unsupported',
               limitation: 'pricing.limitation.no_local_methodology' ]
```

UI: *"Homiio does not yet have a pricing methodology for Romania, so we are not comparing
this price."* No band, no percentile, no badge, and **no substitute figure from another
country's parameters**. This is the case §1.2 currently answers with a €140 "ethical
maximum".

**(b) Supported jurisdiction, sample too small.** A village in ES-CT, 2-bed, €650/month.
All five rungs exhausted: 1 km → 2, 2 km → 3, 5 km → 4, neighborhood → 4, city → 6.
6 < 8 ⇒ `insufficient`.

```
basis  city    sampleSize 6    observationCount 6    confidence insufficient
insufficientReasons  ['sample_below_minimum']
subjectPricePerArea  €9.29 /m²      ← a FACT about the subject, published
median               (absent)       ← a claim about the area, withheld
```

UI: *"Not enough local data to compare this price — we can see 6 similar homes in this
municipality, and we need at least 8. This home asks €9.29/m²."* The subject's own arithmetic
is honest and is shown; the comparison is not invented.

---

## 8. UI rules

### 8.1 Badges

- **The "Fair price" badge is deleted, not relabelled.** `listing.badge.fairPrice`
  (`en.json`) and its render site (`components/PropertyCard.tsx:312,348-353`) go with it.
- **The "Not a fair price" banner is deleted.** `PriceEthicsBanner.tsx` and the whole
  `property.priceEthics.banner.*` key group go with it. Its `generic` line is the exact
  statement D4 forbids: an absence of data rendered as a judgement of the listing.
- A **neutral, factual chip** may be shown in its place, and only when
  `confidence >= 'medium'`: *"Typical for this area"*, *"Above typical (p85)"*,
  *"Below typical (p18)"*. Bands off the **percentile**: `<25 below_typical`,
  `25–75 typical`, `>75–90 above_typical`, `>90 well_above_typical`.
- **No moral vocabulary on any pricing surface** — not "fair", "ethical", "abusive",
  "speculative", "justified". The chip describes the local distribution. The word "ethical"
  survives only in Homiio's own product copy (`packages/frontend/public/manifest.json:2,4`),
  which is a claim about the platform, not about a landlord.
- The chip is tappable and opens the explanation sheet, which renders every
  `PricingExplanationItem` and the sample, area, window and date (D3).
- `insufficient` renders a **visible** neutral line, never a hidden section (D4).

### 8.2 Filters

- `fairPrice` is removed as a filter (`SearchFiltersBottomSheet.tsx:104-107`,
  `QuickFiltersWidget.tsx:88-90`).
- Its replacement is a `priceBand` multi-select, offered **only** when every jurisdiction in
  the current search scope is supported for the current offering. When the scope spans
  markets with mixed support, the control is unavailable with a one-line reason — it is not
  offered and silently under-applied. The search's jurisdiction scope comes from the
  `LocationSelection` contract in `0002-location-and-search-contract.md`.
- Listings with `insufficient` confidence are **excluded** from every band bucket. They are
  never swept into "typical", which is what §1.3(a) does today.

### 8.3 Sorting

- `sortBy=fairness` is removed (`searchQueryBuilder.ts:108,516-518`, `list.ts:84`,
  `components/search/types.ts:54`, `en.json` `search.sort.fairness = 'Best value'`).
  It orders on a 0–100 number whose baseline 50 means "we know nothing"
  (`priceEthicsService.ts:26,42`), across mixed currencies and mixed methodologies.
- Its replacement is `pricePercentile` (asc/desc), offered **only** when the result set is
  a single jurisdiction, a single offering and a single currency, and every result carries
  an assessment at `confidence >= 'medium'`. Otherwise the option is not offered.
- `nullsLast` is not an acceptable answer for unassessed listings: placing them last still
  implies a ranking. Either the sort is unavailable, or unassessed listings are rendered in
  a visually separate group with their own heading.

### 8.4 The landlord-facing recommendation

`components/property/create/EthicalPricingRecommendation.tsx` tells a landlord what to
charge. On the measured numbers in §1.2 it tells a Barcelona landlord that a €1 450 flat has
an ethical maximum of €317, and it does so above a warning that their price *"exceeds the
ethical maximum"*.

**Decision: delete the recommendation. Do not port it.** Homiio does not tell a landlord
what to charge; a price recommendation is a different product with different obligations. In
its place the create flow shows the same neutral local comparison a renter sees — *"Similar
2-bedroom homes within 1 km ask a median of €1 380/month (38 homes, last 90 days)"* — with
no suggested figure, no maximum and no verdict, and only in a supported jurisdiction.

**This removes a visible feature and therefore needs explicit product sign-off.** It is
recorded here as a decision rather than left to the implementation PR so that the sign-off
happens before, not after, someone has built the replacement.

---

## 9. Inventory of current consumers of the score

Measured on this checkout at `c4d73a43`, 2026-08-10.

**Method.** `git ls-files`-backed `git grep -nE` over the whole repo (never a
`dir/**/*.ts` pathspec, which silently skips a directory's top-level files) for
`ethic|Ethic|ETHIC|fairPrice|fair_price|fairness|priceScore|price_score|areaPrice|area_price|pricePerSq|price_per_sq|sqft|sqm|squareFootage|square_footage`,
excluding `drizzle/meta` snapshots, `locales/` and `bun.lock`. **763 hits across 148
files.** Every file was then assigned to a category; the eleven that could not be assigned
are listed in §9.2 and explained individually. Positive control: the sweep returns the two
files known a priori to hold the engine (`shared-types/src/ethicalPricing.ts`,
`services/priceEthicsService.ts`) with 15 and 49 hits.

### 9.1 Attributed consumers

**A — the rent model (2 files).** Deleted whole by #369.

| location | what |
|---|---|
| `packages/shared-types/src/ethicalPricing.ts:51-378` | `calculateEthicalRent`, `validateEthicalPricing`, `EthicalPricingCharacteristics`, `PricingRecommendation`, and all nine constant tables |
| `packages/shared-types/src/index.ts:66` | `export * from './ethicalPricing'` |
| `packages/frontend/utils/ethicalPricing.ts:5-8` | frontend re-export shim |

**B — the scoring service (2 files).**

| location | what |
|---|---|
| `packages/backend/services/priceEthicsService.ts:26-31` | `FAIRNESS_*` constants (base 50, ±30/20/10/20/−25) |
| `…:37-64` | `computeFairnessScore` |
| `…:66-83` | `computeIsFairPrice` — `:72-74` is the external-listing branch of §1.3(b) |
| `…:113-152` | `buildEthicalPricingInput`; `:118` restricts the model to `LONG_TERM_RENT` |
| `…:154-193` | `computePriceEthics` |
| `…:195-213` | `scoreAndPersistProperty` |
| `…:216-223` | `schedulePriceEthicsScore` (fire-and-forget) |
| `packages/backend/services/areaPriceComparison.ts:43-52` | `RADIUS_KM = 2`, `MIN_RADIUS_SAMPLE = 5`, verdict thresholds |
| `…:154-165` | `buildBaseComparableFilter` — **no currency, no age, no furnishing, no type, no dedupe** |
| `…:208-241` | `aggregatePriceStats` |
| `…:261-266` | `classifyVerdict` |
| `…:268-292` | `buildComparison` — `:269-279` is the "no data ⇒ average" branch |
| `…:336-346` | `buildPricePerSqm` — divides by the ambiguous area column |
| `…:507-547` | `computeMarketVerdictForProperty` — `:530-538` is the un-floored city fallback |

**C — persistence (5 files).**

| location | what |
|---|---|
| `packages/backend/db/schema/properties.ts:764-771` | the eight `price_ethics_*` columns |
| `…:911-912` | `properties_price_ethics_is_fair_idx`, `properties_price_ethics_score_idx` |
| `…:1003-1006` | `properties_market_verdict_check` |
| `…:55` | the census line: block present on **133 of 17 644** rows (production, 2026-08-06) |
| `packages/backend/db/properties/propertySerializer.ts:368-377` | emits the `priceEthics` block via `blockIfAny` |
| `packages/backend/db/properties/propertyWrites.ts:318-328` | `toPropertyColumns` mapping |
| `…:691-706` | `setPropertyPriceEthics` |
| `packages/backend/db/properties/propertyFilters.ts:118` | documents `price_ethics_is_fair_price` as three-state |
| `packages/backend/drizzle/0002_property.sql` | the columns' creating migration (11 hits) |

**D — write-path triggers (4 files).** Every one calls `schedulePriceEthicsScore`.

`controllers/property/create.ts:12,187` · `controllers/property/updateDelete.ts:6,85` ·
`services/scraperService.ts:4,295,300` · `services/ingestion/IngestionService.ts:56,219`

**E — HTTP surface (5 files).**

| location | what |
|---|---|
| `controllers/property/searchQueryBuilder.ts:108,114,120` | `SORT_FAIRNESS` |
| `…:340-341,418-419,486` | the `fairPrice` filter → `price_ethics_is_fair_price = true` |
| `…:516-518` | `ORDER BY price_ethics_fairness_score` via `nullsLast` |
| `controllers/property/commonFilters.ts:133` | the same `fairPrice` filter on the list feeds |
| `controllers/property/list.ts:84` | `'fairness'` in the accepted sort set |
| `…:436-443` | home-feed personalization: **+30** for `isFairPrice`, **−20** for `withinEthical === false` or `marketVerdict === 'above_average'` |
| `…:489` | the personalization row type |
| `controllers/property/areaInsights.ts:75-94` | `buildEmptyInsights` — the `'average'` empty shape |
| `…:101-177` | `GET /api/properties/:propertyId/area-insights` |
| `routes/public.ts:63` | the route registration (public, no auth) |

**F — wire contract (4 files).**

`packages/shared-types/src/property.ts:283` (`Property.priceEthics`), `:529-544`
(`PropertyPriceEthics`), `:551-558` (`AreaPriceVerdict`, `AreaInsightsBasis`), `:561-624`
(`AreaPriceComparison`, `AreaPriceDistribution`, `AreaPricePerSqm`,
`AreaNeighborhoodVsCity`, `PropertyAreaInsights`) · `packages/shared-types/src/index.ts:66` ·
`packages/shared-types/src/currency.ts:33-49` (`LISTING_CURRENCIES`, 15 codes; `:11` names `FAIR` as existing
"for the ethical-pricing exchange flow") · `packages/shared-types/src/listing.ts:192` (`NormalizedListing.squareFootage`)

**G — frontend consumers (27 files; the load-bearing ones).**

| location | what |
|---|---|
| `components/PropertyCard.tsx:312,348-353` | the "Fair price" badge |
| `components/property/PriceEthicsBanner.tsx` (whole file) | the "Not a fair price" banner; `:39` FX-converts `ethicalMax`; `:56-58` the generic line |
| `app/properties/[id]/index.tsx:89,151-156,865-871` | banner gating on `isFairPrice === false` and the currency it is labelled with |
| `components/property/create/EthicalPricingRecommendation.tsx:8-10,42-66,89-94` | the landlord recommendation |
| `components/property/create/LongTermPricingStep.tsx:5,58` | mounts it |
| `components/property/create/index.ts:14` · `components/property/create/styles.ts:332-370` | barrel + styles |
| `components/SearchFiltersBottomSheet.tsx:38-39,104-107` | the "Fair price only" toggle |
| `components/widgets/QuickFiltersWidget.tsx:46,63,88-90,103-117` | the "Fair price" quick filter |
| `components/search/types.ts:54,95-96` | `SearchSortBy` includes `'fairness'`; `SearchQuery.fairPrice` |
| `components/search/SearchResultsView.tsx:128,145,328-329,352` | wiring, active-filter count, reset |
| `components/search/SortControl.tsx:39-42` | the `fairness` sort option |
| `store/searchQueryStore.ts:37` | `fairPrice` in the default query |
| `hooks/usePropertySearch.ts:14-15,130-131` | serializes `fairPrice=true` |
| `components/widgets/FeaturedPropertiesWidget.tsx:74-75` | orders the widget by `isFairPrice` |
| `components/property/PriceRangeSection.tsx` | renders `area-insights` (survives, re-contracted) |
| `components/property/SimilarHomesSection.tsx:21,33` | comparables carousel (survives) |
| `hooks/usePropertyQueries.ts:148-155` | `useAreaInsights`, query key `['areaInsights', propertyId]` |
| `services/propertyService.ts:372-385` | `getAreaInsights` |
| `hooks/useCurrency.ts:63-70` + `utils/currency.ts:191-202` | display FX (frankfurter.app) |
| `locales/{en,es,ca-ES,it}.json` | 13 keys: `search.filters.fairPrice`, `search.widgets.quickFilters.fairPrice`, `search.sort.fairness`, `listing.badge.fairPrice`, `property.ethicalPricing*`, `property.suggestedRent`, `property.maxEthicalRent`, `property.priceEthics.banner.*` |
| `constants/amenities.tsx` | 129 hits — `ethicalNotes`, `ethicalNotesKey`, `maxFairValue`, `ethicalPriority`. **All four are declared and read nowhere**; verified by a repo-wide grep that returns no reader outside the declaring file. Dead metadata; delete with the rest. |

**H — ops scripts (4 files).**

`scripts/backfillPriceEthics.ts:17,67` (+ `scripts/backfillPriceEthicsBatching.ts`) ·
`packages/backend/package.json:27` (`backfill:price-ethics`) ·
`scripts/dedupeExternalListings.ts` (survives; feeds §6.4) ·
`scripts/cleanup-absurd-external-prices.ts` (survives; a crude outlier sweep that §6.6
supersedes for *assessment* purposes but not for catalogue hygiene)

**I — tests (24 files).** `__tests__/unit/priceEthicsService.test.ts` (22 hits; `:183` pins
§1.3(b)) · `__tests__/integration/priceEthicsScoring.test.ts` (14) ·
`__tests__/unit/searchQueryBuilder.test.ts` (12) ·
`__tests__/unit/backfillPriceEthicsBatching.test.ts` ·
`__tests__/db/propertyVocabularies.test.ts` ·
`packages/frontend/__tests__/buildSearchParams.test.ts` · plus 18 provider suites whose
hits are area parsing, not scoring.

**J — docs (5 files).** `docs/index.mdx`, `docs/listings.mdx`,
`packages/frontend/README.md`, `packages/backend/db/MIGRATION-CONTRACT.md`, `AGENTS.md`.
Each states live behaviour that #369 makes false; comment and doc prose is where a wrong
statement persists indefinitely, so they are part of the retirement, not a follow-up.
`AGENTS.md` and `docs/architecture.mdx` are owned by #349 and are not edited here.

**K — ingest area/price parsing (55 files in `packages/listing-providers`).** Not consumers
of the score; they are the **inputs** to it, and they are where the area-unit ambiguity of
§1.1 originates. The two that must change in #369 are
`src/parse/jsonLd.ts:372-375,411` (discards `unitCode`) and
`src/providers/ca/realtorCa/parse.ts:73-79,143` (stores square feet unconverted). The
remaining ~53 already emit square metres and only need to start declaring the unit
explicitly.

**Sindi — measured NIL.** `git grep -iE 'fairPrice|priceEthics|fairness|ethical'` across
`packages/backend/routes/ai.ts`, the AI controllers and services, and the Sindi frontend
surfaces returns **zero matches**. There is no AI controller or service that reads the
score, and no prompt template mentions it. So #348's question *"what happens to any Sindi
ranking that uses the current score"* has the answer: **none exists**, and none must be
added before a supported jurisdiction exists.

**Sanity floor.** The three surfaces that must appear in any correct inventory — the badge
render site, the `fairPrice` SQL predicate and the `fairness` `ORDER BY` — are present at
`PropertyCard.tsx:349`, `searchQueryBuilder.ts:419` and `searchQueryBuilder.ts:517`. An
inventory missing any of these is broken, not clean.

### 9.2 Residual — hits the sweep could not attribute, each explained

Eleven files matched the sweep and are **not** consumers of the assessment. They are listed
because an inventory that only reports what it could classify cannot tell "there is nothing
else" from "I stopped looking".

| file:line | why it matched | verdict |
|---|---|---|
| `controllers/property/editableFields.ts:9,26` | `squareFootage` is a creatable/editable field; the comment names `sale.pricePerSqm` as server-derived and therefore not editable | **input**, not a consumer. Keeps its entry; gains a unit field in #369 |
| `controllers/property/offeringRules.ts:11,36,40,57-60,69,96` | derives `sale.pricePerSqm = price / squareFootage` on create/update | **a second per-area computation**, independent of the score, inheriting the same unit ambiguity. Must be fixed with §6.5 even though it survives the score's retirement |
| `controllers/roomController.ts:77` | selects `properties.squareFootage` for room rows | plain projection |
| `db/schema/geo.ts:145` | a historical table naming `services/areaPriceComparison` among the modules that used `$near` | prose about a migration that is finished |
| `middlewares/validation.ts:94` | `body('squareFootage').isFloat({ min: 0 })` | unit-agnostic input validation. Should gain a unit field alongside (#369) |
| `packages/backend/package.json:27` | the `backfill:price-ethics` npm script | **ops surface — removed with the script** |
| `services/ingestion/dedupeFingerprint.ts` (7 hits) | `squareFootage` is a fingerprint dimension | **not a score consumer, and load-bearing for §6.4** — it becomes part of the comparables policy rather than being retired |
| `services/ingestion/queues.ts:138` | the word "fairness" in a round-robin scheduling comment | **false positive of the term.** Nothing to do with price |
| `services/telegramService.ts:44,329` | renders `squareFootage` with a hard-coded `m²` suffix | **a real hard-coded unit assumption**, in a broadcast surface, independent of the score. Fix with §6.5 |
| `packages/frontend/public/manifest.json:2,4` | PWA copy: *"Homiio - Ethical Housing Platform"*, *"…transparent rentals, fair agreements…"* | **product copy about the platform**, not a verdict about a listing. Survives (§8.1) |
| `modules/homiio-widgets/android/.../ListingsModel.kt:94` | the Android home-screen widget reads a `squareFootage` JSON field | consumer of the area value, not of the score. Must follow the unit change |

Two of the eleven are findings the categorised inventory would have hidden:
`offeringRules.ts` computes a *second* price-per-area that nobody would think to look for
under a "price ethics" heading, and `telegramService.ts` hard-codes `m²` on a surface no
frontend audit covers.

---

## 10. Retirement plan

### Phase 0 — stop publishing, before anything is built

Nothing in §9 needs to be deleted for the harm to stop. **Stop emitting the block.**

- Remove `priceEthics` from `db/properties/propertySerializer.ts:368-377`.
- Every frontend read already degrades to the correct behaviour on an absent block, which
  makes this a genuinely safe switch rather than one that merely looks safe:
  `PropertyCard.tsx:312` is `Boolean(property.priceEthics?.isFairPrice)` → `false` → no
  badge; `app/properties/[id]/index.tsx:151` is `=== false` → `undefined` is not `false` →
  no banner; `FeaturedPropertiesWidget.tsx:74-75` compares `0` to `0` → no reordering.
  This was checked read by read, not assumed.
- `fairPrice=true` and `sortBy=fairness` are **accepted and ignored**, and the list response
  carries `warnings: [{ code: 'filter_retired', filter: 'fairPrice' }]`. Silently returning
  an unfiltered list would be worse than either erroring or ignoring, because an unfiltered
  list of results reads to the user as "all of these are fair". Rejecting outright would
  break already-shipped app builds. The frontend controls are removed in the same release,
  so the warning exists for old clients only.
- **`saved_searches.filters` is opaque jsonb stored "exactly as the client sent them"**
  (`db/schema/saved.ts:114-124`), so a saved search can carry `fairPrice: true` forever. Its
  execution path must drop the retired key, surface the same `filter_retired` warning on the
  saved-search detail screen, **and** the alert sweep must not notify on a set that silently
  changed shape — a saved search whose meaning changed is re-confirmed with the user before
  its next alert fires.
- Stop calling `schedulePriceEthicsScore` from the four write paths (§9 D) so no new value
  is written.

### Phase 1 — retain history without presenting it as current

- Copy every non-null `price_ethics_*` row into `retired_price_ethics`
  (`property_id`, the eight values, `methodology_version = 'legacy-us-ethical@0'`,
  `retired_at`). At the 2026-08-06 census that was **133 of 17 644 rows**; re-measure at
  migration time, because that is a fact with a date on it.
- Then drop the eight columns, `properties_price_ethics_is_fair_idx`,
  `properties_price_ethics_score_idx` and `properties_market_verdict_check` in a `post`-phase
  migration.
- `retired_price_ethics` is **never served on a public DTO**. It exists so D8 is answerable
  — "what did Homiio say about this listing on that date, under which methodology" — and for
  #367's price history to record that a statement was made and withdrawn.
- Delete: `shared-types/src/ethicalPricing.ts`, `frontend/utils/ethicalPricing.ts`,
  `services/priceEthicsService.ts`, `scripts/backfillPriceEthics.ts` + its batching module,
  `package.json:27`, `components/property/PriceEthicsBanner.tsx`,
  `components/property/create/EthicalPricingRecommendation.tsx`, the dead
  `ethicalNotes`/`maxFairValue`/`ethicalPriority` metadata in `constants/amenities.tsx`, and
  the 13 locale keys in all four bundles. Clean cuts: no `@deprecated` markers, no aliases.

### Phase 2 — build the engine (#369) against an empty registry

- `services/areaPriceComparison.ts` is **not deleted**. Its aggregate machinery is sound and
  already Postgres-native; it is re-contracted: `buildBaseComparableFilter` gains the §6.1
  predicates, the ladder replaces the single radius, `percentile_cont` replaces the mean as
  the headline, and duplicate suppression is applied before any statistic.
- `PropertyAreaInsights` and `GET /api/properties/:id/area-insights` survive as the *facts*
  endpoint (distribution, comparables, neighborhood contrast) and gain
  `confidence`/`sampleSize`/`observationCount`/`jurisdiction`/`areaUnit`. Its
  `buildEmptyInsights` "average" shape (`areaInsights.ts:75-94`) becomes an explicit
  `insufficient` shape.
- Every market ships `supported: false` and is enabled one PR at a time with calibration
  evidence.

### Recomputation, caching and invalidation

- **Assessments are immutable.** A source change, a threshold change or a methodology
  version bump **inserts** a new row and sets `superseded_at` on the previous one. Nothing
  is ever updated in place (D6, D8).
- Recomputation is triggered by: a write to the subject listing; a source's data changing
  for the subject's area; a methodology version becoming active for the jurisdiction; or
  `valid_until` passing. Recomputation is queued and idempotent per
  `(subject, offering, methodology_version, input_digest)` — an identical digest produces no
  new row, which is how "same inputs, same version ⇒ same output" is enforced in production
  rather than only in a test.
- Client caches: React Query keys `['areaInsights', propertyId]` and the property list keys
  are invalidated when a new assessment supersedes one the client may hold. The assessment's
  `calculatedAt` is the cache discriminator; a client must never render a stale assessment
  as current, and the explanation sheet always shows the date it was computed.
- Server caches keyed on a sample must be keyed on `input_digest`, not on the subject id —
  otherwise a comparable changing silently leaves a stale statistic in place.

---

## 11. Tests required of the implementation

Mapped from #348, plus the fixture discipline this repo already requires: a fixture must sit
on **both** sides of the distinction the check exists to make, or the check cannot fail.

1. **Mixed currencies.** A sample containing two currencies must be refused, not averaged.
   The fixture must contain a genuinely different currency in the same city — the ARS/USD
   pair from `providers/ar/argenprop/fixtures.ts` is the real-world shape.
2. **Mixed area units.** The same dwelling expressed as 70 m² and as 753 ft² must produce
   the *same* assessment after normalisation. A test where every fixture is already in the
   canonical unit cannot distinguish a working conversion from no conversion at all.
3. **One home on three portals counts once.** `observationCount = 3`, `sampleSize = 1`. A
   build where the two are always equal is a build with duplicate suppression switched off,
   and the test must assert the *inequality*, not just the final number.
4. **Sample below the minimum ⇒ `insufficient`**, with `sample_below_minimum`, no `median`,
   no band, and the subject's own price-per-area still present.
5. **Unsupported jurisdiction ⇒ `insufficient`** with `basis: 'none'` and `sampleSize: 0`,
   asserted to be reached *before* any query runs. Mutation test: add a `default` entry to
   the registry and the test must go red — that is the §D1 failure mode, and the guard is
   worthless if it does not detect it.
6. **Extreme outlier.** One €95 000/month listing among 40 normal ones must not move the
   median, must be counted in `outliersRemoved`, and must not be silently dropped from
   `observationCount`.
7. **Methodology change preserves history.** Recompute under `@2026.09.1`; the
   `@2026.08.1` row must still be readable, unchanged, with its original `calculatedAt`, and
   `superseded_at` set. Mutation test: make the recomputation an `UPDATE` and the test must
   go red.
8. **Reproducibility.** Same inputs + same version ⇒ identical `inputDigest` and identical
   output. Changing one comparable's price must change the digest.
9. **Monthly and nightly never share a column.** A city with both must produce two
   assessments with disjoint samples, asserted on the sample membership and not only on the
   headline figures.
10. **Explanation snapshot per locale.** The rendered explanation in `en-US`, `es-ES`,
    `ca-ES` and `it-IT` must contain no untranslated key, and **no `$` for a EUR
    assessment** — the specific regression measured in §1.1.
11. **Total cost.** A listing with a deposit must not have that deposit in
    `normalisedMonthly`; a listing with an undisclosed agency fee must be `partial`, not
    `complete`; and two listings must not be compared on total cost unless both are
    `complete`.
12. **Retirement gate.** After #369, a repo-wide scan must find no `priceEthics`,
    `fairnessScore`, `isFairPrice`, `fairPrice` or `sortBy=fairness` outside
    `retired_price_ethics` and the migration that creates it. Give it a vacuity floor (a
    minimum scanned-file count) and mutation-test it by reintroducing one symbol, or an
    empty result reads identically to a pass.

---

## 12. Consequences

**Accepted.**

- Homiio publishes **less**. At cutover it publishes no price verdict anywhere, because no
  jurisdiction is registered. That is the correct state: the current alternative publishes a
  verdict everywhere and is wrong in every market it was not calibrated for.
- A visible feature (the "Fair price" badge, its filter, its sort, the landlord
  recommendation) is removed before its replacement exists.
- Per-jurisdiction calibration is ongoing work, not a one-off. A market without data stays
  a market without a verdict.
- Four dimensions with no aggregate is harder to render than one badge. That is the point:
  the single badge is what made "this landlord is unfair" a conclusion the product drew from
  a square-footage constant.

**Improved.**

- No user is told their correctly-priced home is unethical because Homiio has no data for
  their country.
- Every published figure carries the sample, area, window, source, currency, unit and date
  needed to check it.
- The methodology is auditable and reproducible, and a change to it is visible rather than
  retroactive.

**Risks.**

- The comparables policy is only as good as duplicate suppression. Until #368 and ADR 0001
  land, §6.4 rests on a heuristic fingerprint, and its `observationCount` vs `sampleSize`
  disagreement is the only signal that it is working. Treat that signal as load-bearing.
- The minimum sample thresholds in §6.9 are defaults, **not measurements**. They must be
  recalibrated per market against the currency and density distribution that §1.4 records as
  unmeasured as of 2026-08-10.

---

## 13. Out of scope

- Choosing every public index in every country (#370 owns the adapter framework; each index
  is its own decision with its own licence review).
- Building a single global moral score. D5 forbids it, and a successor ADR is the only way
  to revisit it.
- Personal financial advice. An assessment describes a local distribution; it does not tell
  anyone what to pay, what to charge, or whether to sign.
- Editing `AGENTS.md` or `docs/architecture.mdx` — owned by #349.
