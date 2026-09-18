/**
 * Who may change a canonical address, against a REAL Postgres and the REAL
 * router — ADR 0001 §2.1.2 (a place is the permanent identity of a dwelling),
 * §2.1.7 (a duplicate is recorded, never discarded), §8.1 (a key-field
 * correction is a merge PROPOSAL) and ADR 0003 §10.1 (permission is a
 * relationship recorded in the database).
 *
 * ## The hole this pins shut
 *
 * `PUT /api/addresses/:id` and `DELETE /api/addresses/:id` issued
 * `where id = :id` and nothing else. They are mounted on the authenticated
 * router, so the only thing they required was *a* session — any signed-in caller
 * in the world could rewrite the street, number, floor and door of a dwelling
 * that listings, leases, reviews and eviction cases all point at, or delete the
 * row outright. Re-keying a place is not a field edit: it silently changes which
 * dwelling every attached record is about.
 *
 * ## Why every case below is needed
 *
 *  - **Both directions.** A stranger must be refused AND the two recorded
 *    relations must still work. A handler that refused everybody would pass the
 *    negative half on its own, and the shape of this fix — a predicate inside
 *    the UPDATE — fails exactly that way when the correlated reference is
 *    unqualified (`db/casing.ts`: it renders bare, matches nothing, raises
 *    nothing).
 *  - **404 and not 403.** A 403 confirms to an enumerator that a guessed id
 *    names a real dwelling. Asserted as a status, and asserted alongside the row
 *    being byte-identical afterwards — a 403 with a mutated row is the failure
 *    that matters (ADR 0003 §13.5).
 *  - **The dependents survive.** The deletion route is gone; the assertion is
 *    that the listing, lease, review and eviction attached to the place are all
 *    still resolvable afterwards, which is what "never orphaned" means.
 *  - **A relation that must NOT unlock**: an expired lease. Permission is a
 *    function of state, never a grant that persists (ADR 0003 §10.2).
 */

import express, { type Express, type RequestHandler } from 'express';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';

import addressRoutes from '../../routes/addresses';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { getDb } from '../../db/postgres';
import { insertReview } from '../../db/reviews/reviewWrites';
import { computeAddressIdentityKey, deriveAddressLevel } from '../../services/addressIdentity';
import { addressMergeProposals, addresses, leases, properties, reviews } from '../../db/schema';
import {
  resetGeoTables,
  seedGeoChain,
  seedProperty,
  type GeoChain,
} from '../helpers/postgresGeoFixtures';

/** Owns the listing that advertises the flat. */
const OWNER = 'oxy-write-owner';
/** Lives there today, on an `active` lease. */
const TENANT = 'oxy-write-tenant';
/** Lived there once, on a lease that has ended. */
const FORMER_TENANT = 'oxy-write-former-tenant';
/** Wrote the review about the flat — a self-service act, and not a relation. */
const AUTHOR = 'oxy-write-author';
/** Signed in, and nothing else. This is the caller the old handler served. */
const STRANGER = 'oxy-write-stranger';

const STREET = 'Carrer de la Autoritzacio';
const NUMBER = '42';
const POSTAL_CODE = '08012';

function withSession(oxyUserId: string | undefined): RequestHandler {
  return (req, _res, next) => {
    if (oxyUserId) {
      const authed = req as unknown as { user: { id: string }; userId: string };
      authed.user = { id: oxyUserId };
      authed.userId = oxyUserId;
    }
    next();
  };
}

/** The address router, exactly as `routes/index.ts` mounts it behind the session. */
function addressApp(oxyUserId?: string): Express {
  const app = express();
  app.use(express.json());
  app.use(serializeWireIds);
  app.use(withSession(oxyUserId));
  app.use('/api/addresses', addressRoutes);
  app.use(errorHandler);
  return app;
}

interface Seeded {
  chain: GeoChain;
  buildingId: string;
  unitId: string;
  listingId: string;
  reviewId: string;
}

async function seed(): Promise<Seeded> {
  const chain = await seedGeoChain({ cityName: `Autoritzacio ${Date.now()}`, countryCode: 'ES' });
  const db = getDb();

  const [building] = await db
    .insert(addresses)
    .values({
      countryId: chain.countryId,
      regionId: chain.regionId,
      cityId: chain.cityId,
      countryCode: 'ES',
      street: STREET,
      postalCode: POSTAL_CODE,
      number: NUMBER,
      longitude: 2.1568,
      latitude: 41.4031,
    })
    .returning({ id: addresses.id });

  const [unit] = await db
    .insert(addresses)
    .values({
      countryId: chain.countryId,
      regionId: chain.regionId,
      cityId: chain.cityId,
      countryCode: 'ES',
      street: STREET,
      postalCode: POSTAL_CODE,
      number: NUMBER,
      floor: '3r',
      unit: '2a',
      longitude: 2.1568,
      latitude: 41.4031,
      parentAddressId: building.id,
    })
    .returning({ id: addresses.id });

  const listingId = await seedProperty({
    addressId: unit.id,
    overrides: { oxyUserId: OWNER, title: 'Corner flat' },
  });
  const formerListingId = await seedProperty({
    addressId: unit.id,
    overrides: { oxyUserId: OWNER, title: 'The same flat, years ago' },
  });

  await db.insert(leases).values([
    {
      propertyId: listingId,
      landlordOxyUserId: OWNER,
      tenantOxyUserId: TENANT,
      leaseTermsStartDate: new Date('2025-01-01T00:00:00.000Z'),
      leaseTermsEndDate: new Date('2027-01-01T00:00:00.000Z'),
      rentDetailsMonthlyRent: 1000,
      status: 'active',
    },
    {
      propertyId: formerListingId,
      landlordOxyUserId: OWNER,
      tenantOxyUserId: FORMER_TENANT,
      leaseTermsStartDate: new Date('2019-01-01T00:00:00.000Z'),
      leaseTermsEndDate: new Date('2021-01-01T00:00:00.000Z'),
      rentDetailsMonthlyRent: 900,
      status: 'expired',
    },
  ]);

  const review = await insertReview(db, {
    addressId: unit.id,
    addressLevel: 'UNIT',
    streetLevelId: building.id,
    buildingLevelId: building.id,
    unitLevelId: unit.id,
    oxyUserId: AUTHOR,
    title: 'Two winters in this flat',
    price: 1000,
    currency: 'EUR',
    livedFrom: new Date('2023-01-15T00:00:00.000Z'),
    livedTo: new Date('2024-02-15T00:00:00.000Z'),
    rating: 4,
    recommendation: true,
    opinion: 'Lived here a while — a reasonable opinion string.',
  });

  return {
    chain,
    buildingId: building.id,
    unitId: unit.id,
    listingId,
    reviewId: review.id,
  };
}

/** The identity of a place, read straight off the row. */
async function identityOf(addressId: string) {
  const [row] = await getDb()
    .select({
      street: addresses.street,
      number: addresses.number,
      buildingName: addresses.buildingName,
      block: addresses.block,
      entrance: addresses.entrance,
      floor: addresses.floor,
      unit: addresses.unit,
      subunit: addresses.subunit,
      district: addresses.district,
      poBox: addresses.poBox,
      reference: addresses.reference,
    })
    .from(addresses)
    .where(eq(addresses.id, addressId));
  return row;
}

let seeded: Seeded;

beforeEach(async () => {
  await resetGeoTables();
  seeded = await seed();
});

describe('PUT /api/addresses/:id — a caller with no recorded relation to the place', () => {
  it('cannot correct it, and the row is byte-identical afterwards', async () => {
    const before = await identityOf(seeded.unitId);

    await request(addressApp(STRANGER))
      .put(`/api/addresses/${seeded.unitId}`)
      // 404 rather than 403: a 403 tells an enumerator the id is real.
      .send({ district: 'Eixample', po_box: 'PO-1', reference: 'REF-1' })
      .expect(404);

    expect(await identityOf(seeded.unitId)).toEqual(before);
  });

  it('cannot correct it while signed out either', async () => {
    const before = await identityOf(seeded.unitId);
    await request(addressApp())
      .put(`/api/addresses/${seeded.unitId}`)
      .send({ district: 'Eixample' })
      .expect(401);
    expect(await identityOf(seeded.unitId)).toEqual(before);
  });

  it('is refused on an EXPIRED lease — permission is a function of state', async () => {
    const before = await identityOf(seeded.unitId);
    await request(addressApp(FORMER_TENANT))
      .put(`/api/addresses/${seeded.unitId}`)
      .send({ district: 'Eixample' })
      .expect(404);
    expect(await identityOf(seeded.unitId)).toEqual(before);
  });

  it('is refused for the REVIEW AUTHOR — filing a review is a self-service act', async () => {
    const before = await identityOf(seeded.unitId);
    await request(addressApp(AUTHOR))
      .put(`/api/addresses/${seeded.unitId}`)
      .send({ district: 'Eixample' })
      .expect(404);
    expect(await identityOf(seeded.unitId)).toEqual(before);
  });
});

describe('PUT /api/addresses/:id — a caller who IS related', () => {
  it('corrects the non-identity attributes, for the listing owner', async () => {
    await request(addressApp(OWNER))
      .put(`/api/addresses/${seeded.unitId}`)
      .send({ district: 'Gràcia', po_box: 'PO-88', reference: 'REF-9' })
      .expect(200);

    const row = await identityOf(seeded.unitId);
    expect(row.district).toBe('Gràcia');
    expect(row.poBox).toBe('PO-88');
    expect(row.reference).toBe('REF-9');
  });

  it('corrects them for a party to an ACTIVE lease', async () => {
    await request(addressApp(TENANT))
      .put(`/api/addresses/${seeded.unitId}`)
      .send({ district: 'Gràcia' })
      .expect(200);
    expect((await identityOf(seeded.unitId)).district).toBe('Gràcia');
  });

  it('still refuses to write an IDENTITY field, and names the endpoint that takes it', async () => {
    // The whole point of the split: the relation buys an attribute correction,
    // never a re-key. Refused rather than silently dropped, because a 200 with
    // the address unchanged is a client showing a correction that never
    // happened.
    const before = await identityOf(seeded.unitId);
    const res = await request(addressApp(OWNER))
      .put(`/api/addresses/${seeded.unitId}`)
      .send({ number: '43', floor: '4t', district: 'Gràcia' })
      .expect(400);

    expect(String(res.body.message)).toContain('/corrections');
    // Not even the attribute half of a mixed body lands.
    expect(await identityOf(seeded.unitId)).toEqual(before);
  });
});

describe('DELETE /api/addresses/:id — not a thing anybody may do', () => {
  it('is not a route, for the owner, a tenant or a stranger', async () => {
    for (const caller of [OWNER, TENANT, STRANGER, undefined]) {
      await request(addressApp(caller)).delete(`/api/addresses/${seeded.unitId}`).expect(404);
    }
  });

  it('leaves every dependent record resolvable — nothing is orphaned', async () => {
    await request(addressApp(OWNER)).delete(`/api/addresses/${seeded.unitId}`).expect(404);

    const db = getDb();
    // The floor of the assertion: each of these is non-empty BECAUSE the place
    // still exists. A test that only counted `addresses` rows would pass against
    // a delete that cascaded.
    expect(
      await db.select({ id: addresses.id }).from(addresses).where(eq(addresses.id, seeded.unitId)),
    ).toHaveLength(1);
    expect(
      await db
        .select({ id: properties.id })
        .from(properties)
        .where(eq(properties.addressId, seeded.unitId)),
    ).toHaveLength(2);
    expect(
      await db.select({ id: reviews.id }).from(reviews).where(eq(reviews.addressId, seeded.unitId)),
    ).toHaveLength(1);
    expect(
      await db
        .select({ id: leases.id })
        .from(leases)
        .innerJoin(properties, eq(properties.id, leases.propertyId))
        .where(eq(properties.addressId, seeded.unitId)),
    ).toHaveLength(2);
  });
});

describe('POST /api/addresses/:id/corrections — a key-field correction is a proposal', () => {
  it('records a proposal from any signed-in caller, and changes nothing', async () => {
    const before = await identityOf(seeded.buildingId);

    const res = await request(addressApp(STRANGER))
      .post(`/api/addresses/${seeded.buildingId}/corrections`)
      .send({ number: '44', reason: 'The plaque on the door says 44' })
      .expect(201);

    expect(res.body.proposal.proposedNumber).toBe('44');
    expect(res.body.proposal.status).toBe('open');
    // A proposal APPLIES nothing. That is what makes it safe to open to the
    // community (ADR 0001 §8.1) and is the assertion that would fail if somebody
    // "helpfully" wired the proposal into an update.
    expect(await identityOf(seeded.buildingId)).toEqual(before);
  });

  it('names the row that already carries the corrected identity, when one does', async () => {
    // The place the correction would merge INTO. The matcher writes
    // `identity_key`, so a row that carries the corrected key is the target —
    // and resolving it server-side is what stops a caller naming one.
    const db = getDb();
    const [target] = await db
      .insert(addresses)
      .values({
        countryId: seeded.chain.countryId,
        regionId: seeded.chain.regionId,
        cityId: seeded.chain.cityId,
        countryCode: 'ES',
        street: STREET,
        postalCode: POSTAL_CODE,
        number: '44',
        longitude: 2.1568,
        latitude: 41.4031,
      })
      .returning({ id: addresses.id });

    // The key the matcher would have written for that row.
    const fields = {
      street: STREET,
      postalCode: POSTAL_CODE,
      cityId: seeded.chain.cityId,
      countryCode: 'ES',
      number: '44',
    };
    await db
      .update(addresses)
      .set({ identityKey: computeAddressIdentityKey(fields, deriveAddressLevel(fields)) })
      .where(eq(addresses.id, target.id));

    const res = await request(addressApp(STRANGER))
      .post(`/api/addresses/${seeded.buildingId}/corrections`)
      .send({ number: '44', reason: 'Same building as the one next door' })
      .expect(201);

    expect(res.body.proposal.mergesIntoAddressId).toBe(target.id);
  });

  it('refuses a correction that changes nothing', async () => {
    await request(addressApp(STRANGER))
      .post(`/api/addresses/${seeded.buildingId}/corrections`)
      .send({ number: NUMBER, reason: 'No change at all' })
      .expect(400);
  });

  it('refuses a proposal with no reason, and one that clears the street', async () => {
    await request(addressApp(STRANGER))
      .post(`/api/addresses/${seeded.buildingId}/corrections`)
      .send({ number: '44' })
      .expect(400);
    await request(addressApp(STRANGER))
      .post(`/api/addresses/${seeded.buildingId}/corrections`)
      .send({ street: null, reason: 'Wipe it' })
      .expect(400);
  });

  it('requires a session', async () => {
    await request(addressApp())
      .post(`/api/addresses/${seeded.buildingId}/corrections`)
      .send({ number: '44', reason: 'Anonymous' })
      .expect(401);
  });
});

describe('GET /api/addresses/:id/corrections — visible, at the reader’s own precision', () => {
  it('withholds the dwelling labels from a caller with no relation, and the proposer’s id from everybody else', async () => {
    await request(addressApp(TENANT))
      .post(`/api/addresses/${seeded.unitId}/corrections`)
      .send({ floor: '4t', reason: 'We are on the fourth, not the third' })
      .expect(201);

    const stranger = await request(addressApp(STRANGER))
      .get(`/api/addresses/${seeded.unitId}/corrections`)
      .expect(200);
    const [seenByStranger] = stranger.body.proposals;
    // A proposal is a second route to `floor`/`unit`/`subunit`; the precision
    // rule has to cover it too or it is a rule with a door in it.
    expect(seenByStranger).not.toHaveProperty('proposedFloor');
    expect(seenByStranger).not.toHaveProperty('proposedUnit');
    // Reporter identity is tier R (ADR 0003 §2.1) — naming who filed a
    // correction against a landlord's building is a retaliation channel.
    expect(seenByStranger).not.toHaveProperty('proposedByOxyUserId');
    expect(seenByStranger.proposedByViewer).toBe(false);
    // The vacuity floor: the proposal really is in the body.
    expect(seenByStranger.reason).toContain('fourth');

    const proposer = await request(addressApp(TENANT))
      .get(`/api/addresses/${seeded.unitId}/corrections`)
      .expect(200);
    const [seenByProposer] = proposer.body.proposals;
    expect(seenByProposer.proposedFloor).toBe('4t');
    expect(seenByProposer.proposedByOxyUserId).toBe(TENANT);
    expect(seenByProposer.proposedByViewer).toBe(true);
  });
});

describe('DELETE /api/addresses/:id/corrections/:proposalId', () => {
  it('withdraws your own, and 404s on somebody else’s', async () => {
    const created = await request(addressApp(STRANGER))
      .post(`/api/addresses/${seeded.buildingId}/corrections`)
      .send({ number: '44', reason: 'The plaque says 44' })
      .expect(201);
    const proposalId = created.body.proposal.id;

    await request(addressApp(AUTHOR))
      .delete(`/api/addresses/${seeded.buildingId}/corrections/${proposalId}`)
      .expect(404);
    // Still open — a 404 that had mutated the row would be the failure.
    const [stillOpen] = await getDb()
      .select({ status: addressMergeProposals.status })
      .from(addressMergeProposals)
      .where(eq(addressMergeProposals.id, proposalId));
    expect(stillOpen.status).toBe('open');

    await request(addressApp(STRANGER))
      .delete(`/api/addresses/${seeded.buildingId}/corrections/${proposalId}`)
      .expect(200);

    const [withdrawn] = await getDb()
      .select({ status: addressMergeProposals.status, at: addressMergeProposals.withdrawnAt })
      .from(addressMergeProposals)
      .where(eq(addressMergeProposals.id, proposalId));
    expect(withdrawn.status).toBe('withdrawn');
    expect(withdrawn.at).toBeInstanceOf(Date);

    const open = await getDb()
      .select({ id: addressMergeProposals.id })
      .from(addressMergeProposals)
      .where(
        and(
          eq(addressMergeProposals.fromAddressId, seeded.buildingId),
          eq(addressMergeProposals.status, 'open'),
        ),
      );
    expect(open).toHaveLength(0);
  });
});
