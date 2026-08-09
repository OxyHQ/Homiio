/**
 * The vocabulary CHECKs on the five fields that can hold arbitrary portal
 * strings today.
 *
 * The enum audit ranked these as the ENTIRE copy risk on `properties`, and the
 * reason is one line of code: `services/scraperService.ts:285` upserts external
 * listings with `updateOne`, which runs no validators and is passed no
 * `runValidators` option — and external listings are re-scraped on a TTL
 * refresh, so update is the steady-state path for all 17,644 rows in
 * production. What reaches it is portal-controlled, behind nothing but `??`:
 *
 *     type:            raw.type || 'apartment'
 *     currency:        raw.rent?.currency ?? 'EUR'
 *     furnishedStatus: raw.furnishedStatus ?? 'unfurnished'
 *     status:          raw.status ?? 'published'
 *
 * and the provider package's own currency chokepoint
 * (`parse/price.ts:normalizeCurrency`) accepts any non-empty string, so
 * `validateMonthlyRentAmount` never sees an allowlist either. The census found
 * zero undeclared values in production TODAY — by two independent methods, 45
 * of 45 enum paths in agreement — which means these CHECKs are safe to impose,
 * not that they are unnecessary. From the cutover on, the database is the thing
 * that says no.
 *
 * `source` is here for a different reason: it is a real closed vocabulary that
 * NO Mongoose enum declares, and it is half of the `(source, source_id)` dedup
 * key. Its two non-obvious members are what this file pins.
 */

import { eq, inArray } from 'drizzle-orm';
import { CHECK_VIOLATION, constraintNameOf, sqlStateOf } from '@oxyhq/db';
import { LISTING_CURRENCIES } from '@homiio/shared-types';
import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import { properties } from '../../db/schema';
import {
  createPropertyScaffold,
  dropPropertyScaffold,
  insertProperty,
  type PropertyOverrides,
  type PropertyScaffold,
} from './propertyFixtures';

/**
 * One vocabulary, a value inside it, a value a portal could plausibly send, and
 * the constraint that must refuse the second.
 *
 * The rejected values are not nonsense on purpose. `flat`, `active`,
 * `semi_furnished`, `CHF` and `zillow_uk` are all things a portal, a
 * half-finished rename or a new provider would really produce — `active` in
 * particular is a status this codebase USED to have and still filters on in
 * three dead queries.
 */
const VOCABULARIES = [
  {
    field: 'type',
    constraint: 'properties_type_check',
    accepted: { type: 'studio' } satisfies PropertyOverrides,
    rejected: { type: 'flat' },
  },
  {
    field: 'status',
    constraint: 'properties_status_check',
    accepted: { status: 'published' } satisfies PropertyOverrides,
    // `PropertyStatus` has no `active` member — a half-finished `active` →
    // `published` rename left three queries filtering on it, so it is exactly
    // the value a careless write would reintroduce.
    rejected: { status: 'active' },
  },
  {
    field: 'furnished_status',
    constraint: 'properties_furnished_status_check',
    accepted: { furnishedStatus: 'partially_furnished' } satisfies PropertyOverrides,
    rejected: { furnishedStatus: 'semi_furnished' },
  },
  {
    field: 'long_term_rent_currency',
    constraint: 'properties_long_term_rent_currency_check',
    accepted: {
      offerings: ['long_term_rent'],
      longTermRentMonthlyAmount: 900,
      // `RON` is one of the nine `LISTING_CURRENCIES` codes production has never
      // written. A CHECK built from the six OBSERVED codes would reject this,
      // and Romania is already a wired market — so this row is the one that
      // distinguishes "derived from the union" from "derived from the data".
      longTermRentCurrency: 'RON',
    } satisfies PropertyOverrides,
    rejected: {
      offerings: ['long_term_rent'],
      longTermRentMonthlyAmount: 900,
      longTermRentCurrency: 'CHF',
    },
  },
  {
    field: 'source',
    constraint: 'properties_source_check',
    accepted: { source: 'idealista' } satisfies PropertyOverrides,
    rejected: { source: 'zillow_uk' },
  },
] as const;

let db: Database;
let scaffold: PropertyScaffold;
const created: string[] = [];

/**
 * The `overrides` object is deliberately typed loosely at the call site because
 * half of these values are ones the TypeScript enum forbids — which is the
 * point: the question is what the DATABASE does with a value the type system
 * would have stopped, since `updateOne` and a raw backfill both bypass it.
 */
async function attempt(overrides: Record<string, unknown>): Promise<unknown> {
  try {
    const id = await insertProperty(db, scaffold, overrides as PropertyOverrides);
    created.push(id);
    return undefined;
  } catch (error) {
    return error;
  }
}

beforeAll(async () => {
  db = await connectPostgres();
  scaffold = await createPropertyScaffold(db, 'vocab');
});

afterEach(async () => {
  while (created.length > 0) {
    const id = created.pop();
    if (id) await db.delete(properties).where(eq(properties.id, id));
  }
});

afterAll(async () => {
  await dropPropertyScaffold(db, scaffold);
  await closePostgres();
});

describe('portal-writable vocabularies', () => {
  it.each(VOCABULARIES)('accepts a declared $field', async ({ accepted }) => {
    // The baseline for each pair. Without it, a CHECK that rejected EVERYTHING
    // would satisfy every rejection assertion below.
    expect(await attempt(accepted)).toBeUndefined();
  });

  it.each(VOCABULARIES)(
    'refuses an undeclared $field, naming $constraint',
    async ({ constraint, rejected }) => {
      const error = await attempt(rejected);

      expect(error).toBeDefined();
      expect(sqlStateOf(error)).toBe(CHECK_VIOLATION);
      expect(constraintNameOf(error)).toBe(constraint);
    },
  );
});

/**
 * The listing-currency vocabulary, on all THREE priced blocks.
 *
 * ## Why this is here and not in a Mongoose test
 *
 * This is the port of `__tests__/unit/propertyCurrencyEnum.test.ts`, which
 * asserted the same property against `PropertySchema`'s Mongoose enum by calling
 * `new Property({...}).validateSync()`. Listings are saved through
 * `controllers/property/` into POSTGRES, so that file was guarding a validator
 * no write in this service runs any more — it passed while proving nothing about
 * the store a rejected currency would actually be rejected by, and it was the
 * last reason a unit test imported the model barrel.
 *
 * The regression it guards is real and worth keeping: production ingest failed
 * on `sale.currency: PLN is not a valid enum value` (otodom) and
 * `longTermRent.currency: MXN is not a valid enum value` (mercadolibre_mx),
 * because the enum was narrower than the markets that were wired. Both the
 * Mongoose enum and the three CHECKs here are derived from the same
 * `LISTING_CURRENCIES` tuple, so the property survives the move intact — what
 * changes is which store is asked.
 *
 * ## Why all three blocks, when `VOCABULARIES` above already covers one
 *
 * That entry covers `long_term_rent_currency` only, and it is a single
 * accept/reject pair rather than a sweep. The two currency columns it does not
 * touch are exactly where a narrowing would go unnoticed — `sale_currency` is
 * the one PLN broke — and three CHECKs built from one tuple is three chances to
 * paste the wrong list.
 */
describe('the listing-currency vocabulary, on all three priced blocks', () => {
  /**
   * A priced block, and the minimum coherent row that exercises its currency.
   *
   * The price and the `offerings` entry are not decoration: each block carries a
   * `properties_<block>_check` equating "the offering is declared" with "the
   * price is non-null", and a `properties_<block>_block_check` refusing a
   * satellite column (the currency IS one) on a block with no price. A fixture
   * that set only the currency would be refused by those, and would pass a
   * rejection assertion for the wrong reason.
   */
  const PRICED_BLOCKS = [
    {
      block: 'long_term_rent',
      constraint: 'properties_long_term_rent_currency_check',
      priced: (currency: string) => ({
        offerings: ['long_term_rent'],
        longTermRentMonthlyAmount: 1200,
        longTermRentCurrency: currency,
      }),
    },
    {
      block: 'short_term_rent',
      constraint: 'properties_short_term_rent_currency_check',
      priced: (currency: string) => ({
        offerings: ['short_term_rent'],
        shortTermRentNightlyRate: 90,
        shortTermRentCurrency: currency,
      }),
    },
    {
      block: 'sale',
      constraint: 'properties_sale_currency_check',
      priced: (currency: string) => ({
        offerings: ['sale'],
        salePrice: 250_000,
        saleCurrency: currency,
      }),
    },
  ] as const;

  /**
   * Vacuity floor. A sweep over an empty or one-element tuple passes by
   * examining nothing, and `LISTING_CURRENCIES` is imported from another package
   * — so the number of codes is exactly the kind of thing that can shrink
   * without anyone here noticing. Deliberately below the current count so an
   * ordinary addition does not trip it, and far above zero.
   */
  it('sweeps a plausible number of currencies', () => {
    expect(LISTING_CURRENCIES.length).toBeGreaterThan(8);
  });

  it.each(PRICED_BLOCKS)('accepts every declared currency on $block', async ({ priced }) => {
    const refused: string[] = [];
    for (const currency of LISTING_CURRENCIES) {
      if ((await attempt(priced(currency))) !== undefined) refused.push(currency);
    }
    // Naming the codes rather than asserting a count: a CHECK missing one market
    // should say which market, because that is the whole content of the bug this
    // replaces.
    expect(refused).toEqual([]);
  });

  it.each(PRICED_BLOCKS)(
    'refuses an undeclared currency on $block, naming $constraint',
    async ({ constraint, priced }) => {
      // `ZZZ` is unassigned in ISO 4217 and will not become a market.
      const error = await attempt(priced('ZZZ'));

      expect(error).toBeDefined();
      expect(sqlStateOf(error)).toBe(CHECK_VIOLATION);
      // The block's OWN constraint. Without this the assertion would pass on any
      // CHECK violation, including the coherence ones the fixture is built to
      // satisfy — which is how a currency test comes to be measuring `offerings`.
      expect(constraintNameOf(error)).toBe(constraint);
    },
  );

  it('accepts the three expansion-market codes that failed ingest against the Mongo enum', async () => {
    // The named regression, kept as its own case so a future narrowing of
    // `LISTING_CURRENCIES` reports the incident rather than an anonymous code.
    expect(await attempt(PRICED_BLOCKS[2].priced('PLN'))).toBeUndefined();
    expect(await attempt(PRICED_BLOCKS[0].priced('MXN'))).toBeUndefined();
    expect(await attempt(PRICED_BLOCKS[0].priced('ARS'))).toBeUndefined();
  });
});

describe('properties.source', () => {
  it('accepts `internal`, which no production row carries yet', async () => {
    // The Mongoose DEFAULT, and therefore what EVERY user-created listing will
    // carry. The census observed zero of them only because production holds
    // zero user-created listings — `oxy_user_id` is absent on all 17,644 rows.
    // A CHECK built from the fifteen observed values would reject the first
    // property a user ever creates, which is the sharpest argument in this
    // whole file for deriving a vocabulary from the code union rather than the
    // data.
    expect(await attempt({ source: 'internal' })).toBeUndefined();
  });

  it('accepts `fixture`, which IS test data sitting in production', async () => {
    // Two rows carry it. Purging them is a separate decision taken with the
    // count in front of you; a CHECK without it kills the copy.
    expect(await attempt({ source: 'fixture' })).toBeUndefined();
  });

  it('defaults to `internal`', async () => {
    const id = await insertProperty(db, scaffold);
    created.push(id);
    const [row] = await db
      .select({ source: properties.source })
      .from(properties)
      .where(eq(properties.id, id));
    expect(row.source).toBe('internal');
  });
});

describe('the four SPARSE sub-objects', () => {
  // Production absence rates, measured: `moderation` 17,642 of 17,644 ·
  // `listingFlags` 9,594 · `externalContact` 5,174 · `priceEthics` 133. A
  // `NOT NULL` on any subfield of these is only safe with a DEFAULT the backfill
  // can fall through to, because the parent object mongoose would have
  // materialized was never written.
  it('inserts a listing that supplies NONE of the four, the way 17,642 rows will', async () => {
    // The single row that stands in for the whole copy. If any subfield of the
    // four ever gains a bare `NOT NULL`, this goes red at 23502 — which is
    // exactly what would otherwise happen mid-window, on 99.99% of the table.
    const id = await insertProperty(db, scaffold);
    created.push(id);

    const [row] = await db
      .select({
        moderationRestricted: properties.moderationRestricted,
        moderationRestrictedAt: properties.moderationRestrictedAt,
        priceEthicsFairnessScore: properties.priceEthicsFairnessScore,
        listingFlagsNoPets: properties.listingFlagsNoPets,
        externalContactPhone: properties.externalContactPhone,
      })
      .from(properties)
      .where(eq(properties.id, id));

    // `moderation_restricted` falls through to its DEFAULT — this is the
    // `MODERATION_ABSENT` resolution, and `false` is the answer the backfill
    // must produce for 17,642 rows.
    expect(row.moderationRestricted).toBe(false);
    // The other three stay NULL. Absent is absent.
    expect(row.moderationRestrictedAt).toBeNull();
    expect(row.priceEthicsFairnessScore).toBeNull();
    expect(row.externalContactPhone).toBeNull();
    // And the flags in particular stay NULL rather than `false`.
    expect(row.listingFlagsNoPets).toBeNull();
  });

  it('keeps listing flags THREE-state: true, false and never-ran', async () => {
    // The reason `listingFlags` must not copy `moderation`'s `DEFAULT false`.
    // `classifyListingContent` stores only the flags that FIRE, so NULL means
    // "the classifier never ran", which is a different claim from "it looked and
    // said no" — and 9,594 production rows are in the NULL state. A test that
    // only checked `true` and absent would pass against a `DEFAULT false` that
    // silently converts all 9,594 into negatives.
    const fired = await insertProperty(db, scaffold, { listingFlagsNoPets: true });
    const looked = await insertProperty(db, scaffold, { listingFlagsNoPets: false });
    const neverRan = await insertProperty(db, scaffold);
    created.push(fired, looked, neverRan);

    const rows = await db
      .select({ id: properties.id, noPets: properties.listingFlagsNoPets })
      .from(properties)
      .where(inArray(properties.id, [fired, looked, neverRan]));
    const byId = new Map(rows.map((row) => [row.id, row.noPets]));

    expect(byId.get(fired)).toBe(true);
    expect(byId.get(looked)).toBe(false);
    expect(byId.get(neverRan)).toBeNull();
  });
});

describe('source_url', () => {
  it('accepts an INTERNAL listing with no source_url', async () => {
    // The constraint that would have broken every user-created listing. All
    // 17,644 production rows carry a `source_url`, but every one of them is
    // EXTERNAL — and `sourceUrl` is absent from both `CREATABLE_PROPERTY_FIELDS`
    // and `EDITABLE_PROPERTY_FIELDS`, so a user-created listing can never have
    // one. A blanket NOT NULL derived from that measurement would be a
    // guaranteed 23502 on `POST /api/properties`.
    expect(await attempt({ source: 'internal', isExternal: false })).toBeUndefined();
  });

  it('refuses an EXTERNAL listing with no source_url', async () => {
    const error = await attempt({ source: 'idealista', isExternal: true });

    expect(error).toBeDefined();
    expect(sqlStateOf(error)).toBe(CHECK_VIOLATION);
    expect(constraintNameOf(error)).toBe('properties_external_source_url_check');
  });

  it('accepts an EXTERNAL listing that carries one', async () => {
    expect(
      await attempt({
        source: 'idealista',
        isExternal: true,
        sourceUrl: 'https://www.idealista.com/inmueble/1/',
      }),
    ).toBeUndefined();
  });

  it('allows two listings to SHARE a source_url', async () => {
    // Two habitaclia rows really do: `52795000011615` and `39875000001003` both
    // carry `https://www.habitaclia.com/alquiler-madrid.htm`, the Madrid
    // search-results page, because the parser fell back to the results href. A
    // UNIQUE here would reject them for a parser bug while their
    // `(source, source_id)` — the real dedup key — stays distinct.
    const shared = 'https://www.habitaclia.com/alquiler-madrid.htm';
    expect(
      await attempt({ source: 'habitaclia', isExternal: true, sourceId: '52795000011615', sourceUrl: shared }),
    ).toBeUndefined();
    expect(
      await attempt({ source: 'habitaclia', isExternal: true, sourceId: '39875000001003', sourceUrl: shared }),
    ).toBeUndefined();
  });
});

describe('amenities', () => {
  it('accepts the encoding-corrupted tokens production actually holds', async () => {
    // NOT a defence of the corruption — it is a real, user-visible search bug:
    // under GIN each mangled token is its own index entry, so a filter for
    // `calefacción` finds none of the 592 rows stored as `calefacci_xf3_n`.
    //
    // It is here because a containment CHECK on `amenities` — the obvious
    // symmetry with `offerings` — would reject ≥1,688 of the 36,983 production
    // elements mid-copy. Mongo declares no `enum` on this path at all, so there
    // is no vocabulary to check against either. This row is what fails if
    // somebody adds one from a UI dropdown.
    expect(
      await attempt({
        amenities: ['calefacci_xf3_n', '1_ba_xf1_o', 'cerca_de_transporte_p_xfa_blico'],
      }),
    ).toBeUndefined();
  });
});
