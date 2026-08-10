/**
 * The two batch listing reads, against a REAL Postgres (#290).
 *
 * Both endpoints filtered `status = 'active'` — a value outside
 * `PropertyStatus` and unstorable under `properties_status_check` — so both
 * returned an empty page for every request ever made. The fix is a status set
 * per endpoint, and the whole risk of it is what the new sets let THROUGH.
 *
 * So the fixture is built to make a wrong filter fail, which a tidier one would
 * not:
 *
 *  - **Every status in the vocabulary is seeded, not just the interesting
 *    ones.** A fixture where every listing is `published` cannot tell the new
 *    filter from no filter at all — both return the same rows — and cannot tell
 *    it from the old broken one either, since "everything" and "nothing" are
 *    indistinguishable when the set has one member and you assert on a count.
 *    Each case therefore asserts the exact ID SET, so the two failure
 *    directions (too few, too many) are separately visible.
 *  - **`archived` is seeded TWICE, in its two real shapes.** A user deletion
 *    (`softDeleteProperty`) sets `status = 'archived'` AND stamps `deleted_at`;
 *    an expired portal listing (`expireExternalProperty`) sets the status and
 *    leaves `deleted_at` NULL. Only the second distinguishes the status clause
 *    from the `deleted_at` clause, so without it `statusVisibleToNonOwner`
 *    could be deleted entirely and this suite would stay green.
 *  - **A moderation-restricted listing is `published`**, so it is excluded by
 *    the moderation clause alone and by nothing else. Neither endpoint had that
 *    clause before this change, and `by-ids` is an UNAUTHENTICATED route.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { OfferingType, PropertyStatus, PropertyType } from '@homiio/shared-types';

import { getPropertiesByIds, getPropertiesByOwner } from '../../controllers/property/batch';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import {
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedProperty,
} from '../helpers/postgresGeoFixtures';

const OWNER = 'oxy-owner-290';
/** A second owner, so `by-owner` is proven to SCOPE rather than merely to filter. */
const OTHER_OWNER = 'oxy-other-290';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(serializeWireIds);
  app.get('/properties/by-ids', getPropertiesByIds);
  app.get('/properties/owner/:oxyUserId', getPropertiesByOwner);
  app.use(errorHandler);
  return app;
}

/** Every listing in this suite differs from its siblings ONLY in what is overridden. */
async function seedListing(
  addressId: string,
  overrides: Parameters<typeof seedProperty>[0]['overrides'],
): Promise<string> {
  return seedProperty({
    addressId,
    overrides: {
      oxyUserId: OWNER,
      type: PropertyType.APARTMENT,
      availabilityIsAvailable: true,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRentMonthlyAmount: 1000,
      longTermRentCurrency: 'EUR',
      ...overrides,
    },
  });
}

/** One listing per interesting state, all on one address and one owner. */
async function seedEveryState() {
  const chain = await seedGeoChain({ cityName: 'Barcelona', countryCode: 'ES-batch' });
  const addressId = await seedAddress({
    chain,
    street: 'Carrer de Mallorca',
    longitude: 2.1734,
    latitude: 41.3851,
  });

  return {
    // Visible to a non-owner who holds the id.
    published: await seedListing(addressId, { status: PropertyStatus.PUBLISHED }),
    reserved: await seedListing(addressId, { status: PropertyStatus.RESERVED }),
    rented: await seedListing(addressId, { status: PropertyStatus.RENTED }),
    sold: await seedListing(addressId, { status: PropertyStatus.SOLD }),
    inactive: await seedListing(addressId, { status: PropertyStatus.INACTIVE }),

    // Hidden from everybody but the owner.
    draft: await seedListing(addressId, { status: PropertyStatus.DRAFT }),
    /** The `expireExternalProperty` shape: archived, `deleted_at` still NULL. */
    expired: await seedListing(addressId, { status: PropertyStatus.ARCHIVED }),
    /** The `softDeleteProperty` shape: archived AND stamped. */
    softDeleted: await seedListing(addressId, {
      status: PropertyStatus.ARCHIVED,
      deletedAt: new Date(),
    }),
    /**
     * Stamped `deleted_at` while still `published` — the shape that makes the
     * `deleted_at` clause disagree with the status clause.
     *
     * No writer produces it today (`softDeleteProperty` always sets both), which
     * is exactly why it has to be seeded: without it `notDeleted()` could be
     * deleted from either endpoint and every assertion here would stay green,
     * so the clause would be untested rather than merely redundant. `deleted_at`
     * is the canonical soft-delete test and the status coupling is one writer's
     * implementation detail; this fixture is what keeps the two independent.
     */
    deletedButPublished: await seedListing(addressId, {
      status: PropertyStatus.PUBLISHED,
      deletedAt: new Date(),
    }),
    /** Published, and excluded by the moderation clause alone. */
    restricted: await seedListing(addressId, {
      status: PropertyStatus.PUBLISHED,
      moderationRestricted: true,
    }),

    /** Published and healthy, but somebody else's — only `by-owner` should care. */
    otherOwner: await seedListing(addressId, {
      status: PropertyStatus.PUBLISHED,
      oxyUserId: OTHER_OWNER,
    }),
  };
}

type Seeded = Awaited<ReturnType<typeof seedEveryState>>;

/** Ask for EVERY seeded listing, so what comes back is decided only by the filter. */
function allIds(seeded: Seeded): string[] {
  return Object.values(seeded);
}

describe('batch listing reads (Postgres)', () => {
  beforeEach(async () => {
    await resetGeoTables();
  });

  describe('GET /properties/by-ids — hydration of ids the caller already holds', () => {
    it('returns every status except draft and archived, and never a restricted listing', async () => {
      const seeded = await seedEveryState();

      const res = await request(buildApp()).get(
        `/properties/by-ids?ids=${allIds(seeded).join(',')}`,
      );

      expect(res.status).toBe(200);
      const returned = new Set<string>(res.body.data.map((entry: { id: string }) => entry.id));

      // The INCLUDED half. Asserted one status at a time rather than as a count,
      // so a filter that drops exactly one of them names which.
      expect(returned.has(seeded.published)).toBe(true);
      expect(returned.has(seeded.reserved)).toBe(true);
      expect(returned.has(seeded.rented)).toBe(true);
      expect(returned.has(seeded.sold)).toBe(true);
      expect(returned.has(seeded.inactive)).toBe(true);
      // Not scoped to an owner: this endpoint hydrates ids, whoever owns them.
      expect(returned.has(seeded.otherOwner)).toBe(true);

      // The EXCLUDED half — the half that fails in the direction nobody notices.
      expect(returned.has(seeded.draft)).toBe(false);
      expect(returned.has(seeded.expired)).toBe(false);
      expect(returned.has(seeded.softDeleted)).toBe(false);
      expect(returned.has(seeded.deletedButPublished)).toBe(false);
      expect(returned.has(seeded.restricted)).toBe(false);

      // And the exact set, so a filter that lets something ELSE through — a
      // status added to the vocabulary later, say — is not silently tolerated.
      expect(returned).toEqual(
        new Set([
          seeded.published,
          seeded.reserved,
          seeded.rented,
          seeded.sold,
          seeded.inactive,
          seeded.otherOwner,
        ]),
      );
    });

    it('hydrates a rented listing on its own, which is the saved-list case', async () => {
      const seeded = await seedEveryState();

      // Asked for by itself, because the set assertion above would still pass if
      // `rented` only ever arrived alongside a `published` sibling.
      const res = await request(buildApp()).get(`/properties/by-ids?ids=${seeded.rented}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe(seeded.rented);
      expect(res.body.data[0].status).toBe(PropertyStatus.RENTED);
    });

    it('returns an empty page for a draft asked for by id, rather than 404ing', async () => {
      const seeded = await seedEveryState();

      const res = await request(buildApp()).get(`/properties/by-ids?ids=${seeded.draft}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe('GET /properties/owner/:oxyUserId — discovery of somebody else’s listings', () => {
    it('returns only published listings, not the reserved/rented/sold ones by-ids shows', async () => {
      const seeded = await seedEveryState();

      const res = await request(buildApp()).get(`/properties/owner/${OWNER}?limit=50`);

      expect(res.status).toBe(200);
      const returned = new Set<string>(res.body.data.map((entry: { id: string }) => entry.id));

      // Exactly one of this owner's ten listings qualifies. Stated as the full
      // set because "somebody else's listings" is the whole subject: a count
      // alone could be satisfied by the WRONG single listing.
      expect(returned).toEqual(new Set([seeded.published]));

      // Named individually too, because this is the endpoint where each
      // exclusion is a separate product decision rather than one clause.
      expect(returned.has(seeded.draft)).toBe(false);
      expect(returned.has(seeded.reserved)).toBe(false);
      expect(returned.has(seeded.rented)).toBe(false);
      expect(returned.has(seeded.sold)).toBe(false);
      expect(returned.has(seeded.inactive)).toBe(false);
      expect(returned.has(seeded.expired)).toBe(false);
      expect(returned.has(seeded.softDeleted)).toBe(false);
      expect(returned.has(seeded.deletedButPublished)).toBe(false);
      expect(returned.has(seeded.restricted)).toBe(false);
      // Scoping, not just filtering: another owner's published listing is out.
      expect(returned.has(seeded.otherOwner)).toBe(false);

      // The pagination envelope counts the same filtered set, not the table.
      expect(res.body.pagination.total).toBe(1);
    });

    it('scopes to the owner named in the path', async () => {
      const seeded = await seedEveryState();

      const res = await request(buildApp()).get(`/properties/owner/${OTHER_OWNER}?limit=50`);

      expect(res.status).toBe(200);
      expect(res.body.data.map((entry: { id: string }) => entry.id)).toEqual([seeded.otherOwner]);
    });

    it('honours ?exclude, which is how a detail page drops the listing being viewed', async () => {
      const seeded = await seedEveryState();

      const res = await request(buildApp()).get(
        `/properties/owner/${OWNER}?limit=50&exclude=${seeded.published}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
    });
  });
});
