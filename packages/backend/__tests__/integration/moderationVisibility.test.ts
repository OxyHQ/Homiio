/**
 * A restricted listing is out of public view — everywhere, and by the right
 * mechanism.
 *
 * This is the half of enforcement that decides whether "restrict" means
 * anything. Mention restricts a post by moving `status`, which does not transfer
 * here: Homiio's public list defaults to `status: { $ne: 'draft' }` and honours a
 * client-supplied `status`, and `status` is in both property field allowlists —
 * so a "restricted" status would stay visible in listings AND be clearable by
 * the very owner whose listing a jury restricted. Hence a server-only flag, and
 * hence these tests.
 */

import express, { type Express } from 'express';
import request from 'supertest';
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
import { createAddress, models } from '../helpers/factories';

import { errorHandler } from '../../middlewares/errorHandler';
const { Property } = models;

function buildApp(oxyUserId?: string): Express {
  const app = express();
  app.use(express.json());
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

async function listing(overrides: Record<string, unknown> = {}): Promise<{ _id: unknown }> {
  const address = await createAddress();
  return Property.create({
    oxyUserId: 'oxy-landlord',
    addressId: address._id,
    type: PropertyType.APARTMENT,
    bedrooms: 1,
    bathrooms: 1,
    offerings: [OfferingType.LONG_TERM_RENT],
    longTermRent: { monthlyAmount: 1000, currency: 'EUR' },
    status: PropertyStatus.PUBLISHED,
    ...overrides,
  });
}

describe('restricted listings and public reads', () => {
  it('drops a restricted listing from the public feed', async () => {
    const visible = await listing();
    await listing({ moderation: { restricted: true } });

    const res = await request(buildApp()).get('/properties');

    expect(res.status).toBe(200);
    const ids = (res.body.data as { _id: string }[]).map((item) => String(item._id));
    expect(ids).toEqual([String(visible._id)]);
  });

  /**
   * The predicate has a trap in it. `Property.moderation` is a new subdocument,
   * so every listing written before it existed has no `moderation` key at all —
   * and `{ 'moderation.restricted': false }` matches a stored `false` but NOT a
   * missing field. Written that way this would have hidden the entire existing
   * catalogue on deploy, and it would have looked like a database problem.
   */
  it('keeps listings that predate the moderation field', async () => {
    const legacy = await listing();
    // Exactly what a pre-existing document looks like: no `moderation` key.
    await Property.updateOne({ _id: legacy._id }, { $unset: { moderation: '' } });
    expect((await Property.findById(legacy._id).lean())?.moderation).toBeUndefined();

    const res = await request(buildApp()).get('/properties');
    expect((res.body.data as { _id: string }[]).map((item) => String(item._id))).toEqual([
      String(legacy._id),
    ]);
  });

  /**
   * `ownerOxyUserId` on the public feed is a QUERY PARAMETER, not the session.
   * Scoping a feed to somebody else's id must not reveal what a jury withheld.
   */
  it('hides a restricted listing even when the feed is scoped to its owner', async () => {
    await listing({ moderation: { restricted: true } });
    const res = await request(buildApp()).get('/properties?oxyUserId=oxy-landlord');
    expect(res.body.data).toHaveLength(0);
  });

  it('404s a restricted listing for everyone but its owner', async () => {
    const restricted = await listing({ moderation: { restricted: true } });

    const stranger = await request(buildApp('oxy-stranger')).get(
      `/properties/${restricted._id}`,
    );
    expect(stranger.status).toBe(404);

    const anonymous = await request(buildApp()).get(`/properties/${restricted._id}`);
    expect(anonymous.status).toBe(404);

    // The owner keeps their own view: a listing that vanished with no
    // explanation is worse than one its owner can see and appeal.
    const owner = await request(buildApp('oxy-landlord')).get(`/properties/${restricted._id}`);
    expect(owner.status).toBe(200);
  });

  it('excludes restricted listings from search, whatever status the caller asks for', () => {
    const { filter } = buildSearchPlan({ status: 'published' });
    expect(filter['moderation.restricted']).toEqual({ $ne: true });

    // Even a caller naming the status explicitly cannot reach them.
    const { filter: restrictedAttempt } = buildSearchPlan({ status: 'restricted' });
    expect(restrictedAttempt['moderation.restricted']).toEqual({ $ne: true });
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
