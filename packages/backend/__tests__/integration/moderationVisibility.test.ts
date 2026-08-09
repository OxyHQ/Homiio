/**
 * A restricted listing is out of public view — everywhere, and by the right
 * mechanism.
 *
 * This is the half of enforcement that decides whether "restrict" means
 * anything. Mention restricts a post by moving `status`, which does not transfer
 * here: Homiio's public list defaults to `status <> 'draft'` and honours a
 * client-supplied `status`, and `status` is in both property field allowlists —
 * so a "restricted" status would stay visible in listings AND be clearable by
 * the very owner whose listing a jury restricted. Hence a server-only flag, and
 * hence these tests.
 *
 * ## The listings are seeded in POSTGRES now, and one test changed meaning
 *
 * The catalogue read path reads Postgres, so a suite asserting what these
 * endpoints RETURN has to seed there. One test could not survive that move
 * intact and is rewritten rather than deleted: "keeps listings that predate the
 * moderation field" existed because `Property.moderation` was a late subdocument
 * absent on 17,642 of 17,644 rows, which made `{ 'moderation.restricted': false }`
 * a filter that would have hidden the entire catalogue on deploy. In Postgres
 * `moderation_restricted` is `NOT NULL DEFAULT false`, so ABSENCE IS NOT
 * REPRESENTABLE and that trap cannot recur — the schema closed it, not the
 * query. What is still worth pinning is the other half: a listing at the column
 * default really is visible, so the default is `false` and not `true`.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { and } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  PropertyStatus,
  PropertyType,
  OfferingType,
} from '@homiio/shared-types';

import { getProperties } from '../../controllers/property/list';
import { getPropertyById } from '../../controllers/property/retrieve';
import { buildSearchPlan } from '../../controllers/property/searchQueryBuilder';
import {
  CREATABLE_PROPERTY_FIELDS,
  EDITABLE_PROPERTY_FIELDS,
} from '../../controllers/property/editableFields';
import { DATABASE_CASING } from '../../db/casing';
import { getDb } from '../../db/postgres';
import { properties } from '../../db/schema';
import {
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedProperty,
} from '../helpers/postgresGeoFixtures';

import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';

const dialect = new PgDialect({ casing: DATABASE_CASING });

/** Distinguishes the geo chains one test seeds; reset per test by the truncate. */
let nextChain = 0;

function buildApp(oxyUserId?: string): Express {
  const app = express();
  app.use(express.json());
  // Production mounts every one of these handlers behind `routes()`, whose
  // first middleware is the wire-id serializer. Without it here the suite
  // would assert a body shape the API no longer serves.
  app.use(serializeWireIds);

  app.use((req, _res, next) => {
    if (oxyUserId) {
      const authed = req as unknown as { user: { id: string }; userId: string };
      authed.user = { id: oxyUserId };
      authed.userId = oxyUserId;
    }
    next();
  });
  app.get('/properties', getProperties);
  app.get('/properties/:propertyId', getPropertyById);
  app.use(errorHandler);
  return app;
}

/** A published listing owned by `oxy-landlord`, in its own city. */
async function listing(
  overrides: Partial<typeof properties.$inferInsert> = {},
): Promise<string> {
  // A unique country code per listing: `countries_code_key` is UNIQUE and these
  // tests seed two listings each.
  const chain = await seedGeoChain({ countryCode: `ES-${nextChain++}` });
  const addressId = await seedAddress({ chain });
  return seedProperty({
    addressId,
    overrides: {
      oxyUserId: 'oxy-landlord',
      type: PropertyType.APARTMENT,
      bedrooms: 1,
      bathrooms: 1,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRentMonthlyAmount: 1000,
      longTermRentCurrency: 'EUR',
      status: PropertyStatus.PUBLISHED,
      availabilityIsAvailable: true,
      ...overrides,
    },
  });
}

describe('restricted listings and public reads', () => {
  beforeEach(async () => {
    await resetGeoTables();
  });

  it('drops a restricted listing from the public feed', async () => {
    const visible = await listing();
    await listing({ moderationRestricted: true });

    const res = await request(buildApp()).get('/properties');

    expect(res.status).toBe(200);
    const ids = (res.body.data as { id: string }[]).map((item) => String(item.id));
    expect(ids).toEqual([visible]);
  });

  /**
   * The successor to "keeps listings that predate the moderation field" — see
   * the module doc. A listing nobody has moderated sits at the column DEFAULT,
   * and this is what fails if that default is ever flipped to `true`, which
   * would hide the whole catalogue exactly as the old Mongo trap would have.
   */
  it('keeps a listing that has never been moderated, i.e. at the column default', async () => {
    const untouched = await listing();

    // Vacuity floor: the row really is at the default rather than explicitly
    // set to `false` by the fixture, which is what makes this about the DEFAULT.
    const [stored] = await getDb()
      .select({ restricted: properties.moderationRestricted })
      .from(properties);
    expect(stored.restricted).toBe(false);

    const res = await request(buildApp()).get('/properties');
    expect((res.body.data as { id: string }[]).map((item) => String(item.id))).toEqual([untouched]);
  });

  /**
   * `ownerOxyUserId` on the public feed is a QUERY PARAMETER, not the session.
   * Scoping a feed to somebody else's id must not reveal what a jury withheld.
   */
  it('hides a restricted listing even when the feed is scoped to its owner', async () => {
    await listing({ moderationRestricted: true });
    const res = await request(buildApp()).get('/properties?oxyUserId=oxy-landlord');
    expect(res.body.data).toHaveLength(0);
  });

  it('404s a restricted listing for everyone but its owner', async () => {
    const restricted = await listing({ moderationRestricted: true });

    const stranger = await request(buildApp('oxy-stranger')).get(`/properties/${restricted}`);
    expect(stranger.status).toBe(404);

    const anonymous = await request(buildApp()).get(`/properties/${restricted}`);
    expect(anonymous.status).toBe(404);

    // The owner keeps their own view: a listing that vanished with no
    // explanation is worse than one its owner can see and appeal.
    const owner = await request(buildApp('oxy-landlord')).get(`/properties/${restricted}`);
    expect(owner.status).toBe(200);
  });

  it('excludes restricted listings from search, whatever status the caller asks for', () => {
    const render = (query: Record<string, string>): string => {
      const { conditions } = buildSearchPlan(query);
      const combined = and(...conditions);
      if (!combined) throw new Error('buildSearchPlan produced no conditions at all');
      return dialect.sqlToQuery(combined).sql;
    };

    expect(render({ status: 'published' })).toContain('"properties"."moderation_restricted" =');
    // Even a caller naming the status explicitly cannot reach them. (`restricted`
    // is not a member of the status vocabulary and the CHECK would refuse to
    // store it — the point is that the clause is applied regardless.)
    expect(render({ status: 'restricted' })).toContain('"properties"."moderation_restricted" =');
  });

  /**
   * The reason this is a separate field rather than a `status` value. If
   * `moderation` were writable, the owner of a restricted listing could clear
   * the restriction with an ordinary update — enforcement that the enforced
   * party can undo is not enforcement.
   */
  it('is absent from every property field allowlist', () => {
    for (const allowlist of [CREATABLE_PROPERTY_FIELDS, EDITABLE_PROPERTY_FIELDS]) {
      expect(allowlist).not.toContain('moderation');
      expect(allowlist.filter((field) => field.startsWith('moderation'))).toEqual([]);
    }
    // Vacuity floor: a renamed or emptied allowlist must not make the above pass
    // by having nothing in it.
    expect(CREATABLE_PROPERTY_FIELDS.length).toBeGreaterThan(10);
    expect(EDITABLE_PROPERTY_FIELDS.length).toBeGreaterThan(10);
  });
});
