/**
 * The four offering-coherence CHECKs, asserted against REAL ROWS.
 *
 * This is the invariant `models/schemas/offeringValidation.ts` states and that
 * Mongo enforced on ONE of its write paths. `save()` ran the path validator on
 * `offerings`; `findOneAndUpdate` made the same validator skip itself (its
 * `isPropertyDocument` guard returns true only for a document `this`, because a
 * Query cannot see sibling blocks); and `services/scraperService.ts:285` — the
 * steady-state path for every one of the 17,644 external listings in production
 * — reaches the collection through `updateOne` with no `runValidators` at all.
 *
 * So the point of this file is not "the constraint exists". It is that each
 * violation is REFUSED and that the refusal NAMES THE OFFERING. A single
 * combined constraint would report the same name for all four and tell a reader
 * nothing, which is why there are four.
 *
 * Both directions of each biconditional are exercised, because they catch
 * different bugs and one direction passing says nothing about the other:
 *
 *  - an offering declared with no price — a listing advertising a price it does
 *    not have;
 *  - a price with no offering declared — a price nothing can find.
 */

import { eq } from 'drizzle-orm';
import { CHECK_VIOLATION, constraintNameOf, sqlStateOf } from '@oxyhq/db';
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
 * The four offerings, each with the column that must be present exactly when it
 * is declared, the constraint that says so, and a value for that column.
 *
 * A table rather than four copy-pasted blocks so that adding a fifth offering
 * cannot land with three of the six assertions written and the rest forgotten.
 */
const OFFERINGS = [
  {
    offering: 'long_term_rent',
    constraint: 'properties_offering_long_term_rent_check',
    blockConstraint: 'properties_long_term_rent_block_check',
    priced: { longTermRentMonthlyAmount: 1200 } satisfies PropertyOverrides,
    /** A satellite column of the same block — present with no discriminator. */
    satellite: { longTermRentDeposit: 2400 } satisfies PropertyOverrides,
  },
  {
    offering: 'short_term_rent',
    constraint: 'properties_offering_short_term_rent_check',
    blockConstraint: 'properties_short_term_rent_block_check',
    priced: { shortTermRentNightlyRate: 90 } satisfies PropertyOverrides,
    satellite: { shortTermRentCleaningFee: 40 } satisfies PropertyOverrides,
  },
  {
    offering: 'sale',
    constraint: 'properties_offering_sale_check',
    blockConstraint: 'properties_sale_block_check',
    priced: { salePrice: 350_000 } satisfies PropertyOverrides,
    satellite: { saleCurrency: 'EUR' } satisfies PropertyOverrides,
  },
  {
    offering: 'exchange',
    constraint: 'properties_offering_exchange_check',
    blockConstraint: 'properties_exchange_block_check',
    priced: { exchangeMode: 'swap' } satisfies PropertyOverrides,
    satellite: { exchangeWelcomeNote: 'Come and stay' } satisfies PropertyOverrides,
  },
] as const;

let db: Database;
let scaffold: PropertyScaffold;
const created: string[] = [];

/** Insert and remember, so `afterEach` can clear the table for the next case. */
async function insert(overrides: PropertyOverrides): Promise<string> {
  const id = await insertProperty(db, scaffold, overrides);
  created.push(id);
  return id;
}

/** The error a rejected insert threw, or `undefined` if it was accepted. */
async function rejection(overrides: PropertyOverrides): Promise<unknown> {
  try {
    await insert(overrides);
    return undefined;
  } catch (error) {
    return error;
  }
}

beforeAll(async () => {
  db = await connectPostgres();
  scaffold = await createPropertyScaffold(db, 'offerings');
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

describe('offering coherence', () => {
  it('accepts a listing with no offerings and no priced blocks', async () => {
    // The baseline every case below varies ONE thing from. Without it, a
    // rejection could mean the constraint fired or that the fixture was never
    // insertable at all — and those read identically.
    const id = await insert({});
    const rows = await db.select({ id: properties.id }).from(properties).where(eq(properties.id, id));
    expect(rows).toHaveLength(1);
  });

  it.each(OFFERINGS)(
    'accepts $offering declared together with its price',
    async ({ offering, priced }) => {
      const id = await insert({ offerings: [offering], ...priced });
      const [row] = await db
        .select({ offerings: properties.offerings })
        .from(properties)
        .where(eq(properties.id, id));
      expect(row.offerings).toEqual([offering]);
    },
  );

  it.each(OFFERINGS)(
    'refuses $offering declared WITHOUT its price, naming $constraint',
    async ({ offering, constraint }) => {
      const error = await rejection({ offerings: [offering] });

      expect(error).toBeDefined();
      expect(sqlStateOf(error)).toBe(CHECK_VIOLATION);
      // The assertion that makes four constraints worth having instead of one.
      expect(constraintNameOf(error)).toBe(constraint);
    },
  );

  it.each(OFFERINGS)(
    'refuses the price for $offering with the offering UNDECLARED, naming $constraint',
    async ({ constraint, priced }) => {
      // The other direction. A constraint written `implies` rather than `=`
      // would accept this, and every assertion above would still pass.
      const error = await rejection({ offerings: [], ...priced });

      expect(error).toBeDefined();
      expect(sqlStateOf(error)).toBe(CHECK_VIOLATION);
      expect(constraintNameOf(error)).toBe(constraint);
    },
  );

  it('accepts a listing carrying two offerings, each with its own price', async () => {
    // A property CAN be offered several ways at once — a flat let monthly and
    // by the night. A constraint written as "exactly one offering" would pass
    // every case above and break this.
    const id = await insert({
      offerings: ['long_term_rent', 'short_term_rent'],
      longTermRentMonthlyAmount: 1200,
      shortTermRentNightlyRate: 90,
    });
    const [row] = await db
      .select({ offerings: properties.offerings })
      .from(properties)
      .where(eq(properties.id, id));
    expect(row.offerings).toEqual(['long_term_rent', 'short_term_rent']);
  });

  it('refuses a listing whose SECOND offering is missing its price', async () => {
    const error = await rejection({
      offerings: ['long_term_rent', 'sale'],
      longTermRentMonthlyAmount: 1200,
    });

    expect(sqlStateOf(error)).toBe(CHECK_VIOLATION);
    expect(constraintNameOf(error)).toBe('properties_offering_sale_check');
  });
});

describe('block integrity', () => {
  // `offeringValidation.ts` states the invariant over BLOCK PRESENCE; the four
  // coherence CHECKs above state it over PRICE NULL-NESS. These four close the
  // gap between the two readings — the case where a block is populated but
  // carries no price and no offering, which Mongo rejects and a coherence CHECK
  // alone accepts because all it sees is `false = false`.
  it.each(OFFERINGS)(
    'refuses a $offering satellite column with no discriminator, naming $blockConstraint',
    async ({ blockConstraint, satellite }) => {
      const error = await rejection({ offerings: [], ...satellite });

      expect(error).toBeDefined();
      expect(sqlStateOf(error)).toBe(CHECK_VIOLATION);
      expect(constraintNameOf(error)).toBe(blockConstraint);
    },
  );

  it.each(OFFERINGS)(
    'accepts a $offering satellite column ALONGSIDE its discriminator',
    async ({ offering, priced, satellite }) => {
      // The other side, and the one that makes the rejection above a finding
      // rather than a blanket ban on the satellite columns.
      const id = await insert({ offerings: [offering], ...priced, ...satellite });
      const rows = await db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.id, id));
      expect(rows).toHaveLength(1);
    },
  );
});

describe('offerings vocabulary', () => {
  it('refuses an offering value outside the four', async () => {
    const error = await rejection({
      // A portal value leaking through `scraperService`'s `??` chain is exactly
      // how an undeclared value would arrive, and `updateOne` runs no
      // validators — so this is the constraint that was never enforced on the
      // path that writes every external listing.
      offerings: ['rent_to_own'],
    });

    expect(sqlStateOf(error)).toBe(CHECK_VIOLATION);
    // The containment CHECK fires before any coherence one: an unknown value is
    // not a member of any of the four biconditionals.
    expect(constraintNameOf(error)).toBe('properties_offerings_check');
  });

  it('accepts an empty offerings array', async () => {
    // Containment (`<@`) is trivially satisfied by the empty array, and that is
    // correct: emptiness is the four coherence CHECKs' business, not this one's.
    // Asserting it keeps anyone from "tightening" the containment CHECK into
    // something that also demands non-emptiness and quietly breaks a draft.
    const id = await insert({ offerings: [] });
    const [row] = await db
      .select({ offerings: properties.offerings })
      .from(properties)
      .where(eq(properties.id, id));
    expect(row.offerings).toEqual([]);
  });
});
