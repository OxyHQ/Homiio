/**
 * The `_id` → `id` wire contract, asserted on the real router.
 *
 * `@homiio/shared-types` names a document's identity `id` and nothing else, so
 * every consumer now reads `id`. Mongo still stores `_id`, and
 * `middlewares/wireIds.ts` is the one place that difference is resolved.
 *
 * This file exists because a typecheck cannot see any of it. The frontend
 * compiles against the DTOs; the backend hands `res.json` a Mongoose document or
 * a `.lean()` object, neither of which is typed as a DTO, so `tsc` is green
 * whether the body carries `id`, `_id`, or both. Only a real request can tell
 * those three apart.
 *
 * The NEGATIVE half of every assertion is the load-bearing one. Checking that
 * `id` is present passes just as happily on the old dual-spelling body that also
 * shipped `_id` — which is exactly the state this cut replaced — so each case
 * asserts the absence too.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import mongoose from 'mongoose';

import publicRoutes from '../../routes/public';
import { errorHandler } from '../../middlewares/errorHandler';
import { renameWireIds } from '../../middlewares/wireIds';
import { Address, City, Country, Property, Region } from '../../models';
import { OfferingType, PropertyStatus, PropertyType } from '@homiio/shared-types';

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  // The wiring production uses: `publicRoutes()` mounted at `/api`, exactly as
  // server.ts does it, so the serializer under test is reached the same way.
  app.use('/api', publicRoutes());
  app.use(errorHandler);
  return app;
}

describe('renameWireIds', () => {
  it('moves `_id` to `id` and drops it', () => {
    expect(renameWireIds({ _id: 'abc', name: 'x' })).toEqual({ name: 'x', id: 'abc' });
  });

  it('renames inside nested objects and arrays', () => {
    const out = renameWireIds({
      data: [{ _id: '1', address: { _id: '2' } }, { _id: '3' }],
    }) as { data: Array<Record<string, unknown>> };

    expect(out.data[0].id).toBe('1');
    expect(out.data[0]).not.toHaveProperty('_id');
    expect((out.data[0].address as Record<string, unknown>).id).toBe('2');
    expect((out.data[0].address as Record<string, unknown>)).not.toHaveProperty('_id');
    expect(out.data[1].id).toBe('3');
  });

  it('keeps an `id` that was already set and still drops `_id`', () => {
    // A DTO mapper or a schema `toJSON` that set `id` made the more specific
    // decision; overwriting it would silently undo, for example, toLeaseDTO.
    expect(renameWireIds({ _id: 'raw', id: 'chosen' })).toEqual({ id: 'chosen' });
  });

  it('stringifies an ObjectId rather than emitting it as an object', () => {
    const oid = new mongoose.Types.ObjectId();
    const out = renameWireIds({ _id: oid }) as { id: unknown };

    expect(out.id).toBe(oid.toString());
    expect(typeof out.id).toBe('string');
  });

  it('leaves a Date alone', () => {
    const when = new Date('2026-08-09T00:00:00.000Z');
    expect((renameWireIds({ createdAt: when }) as { createdAt: Date }).createdAt).toEqual(when);
  });

  it('reduces a Mongoose document through its own toJSON first', async () => {
    const country = await Country.create({ code: 'PT', name: 'Portugal', currency: 'EUR' });
    const out = renameWireIds(country) as Record<string, unknown>;

    expect(out).not.toHaveProperty('_id');
    expect(out.id).toBe(country._id.toString());
    expect(out.name).toBe('Portugal');
    // The document itself is untouched — it is not this function's to edit, and
    // the same object may be a cache entry or be saved after the response.
    expect(country._id).toBeDefined();
  });

  it('passes primitives and null through', () => {
    expect(renameWireIds(null)).toBeNull();
    expect(renameWireIds('x')).toBe('x');
    expect(renameWireIds(3)).toBe(3);
  });
});

describe('the wire contract, over a real request', () => {
  const app = buildApp();

  /** Seed a published property in a city, and return the ids Mongo assigned. */
  async function seedCityProperty(): Promise<{ cityId: string; propertyId: string }> {
    const country = await Country.create({ code: 'ES', name: 'Spain', currency: 'EUR' });
    const region = await Region.create({ countryId: country._id, name: 'Catalonia' });
    const city = await City.create({
      countryId: country._id,
      regionId: region._id,
      name: 'Barcelona',
      currency: 'EUR',
    });
    const address = await Address.create({
      countryId: country._id,
      regionId: region._id,
      cityId: city._id,
      countryCode: 'ES',
      street: 'Carrer de Mallorca',
      postal_code: '08013',
      coordinates: { type: 'Point', coordinates: [2.1734, 41.3851] },
    });
    const property = await Property.create({
      addressId: address._id,
      type: PropertyType.APARTMENT,
      bedrooms: 2,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 1800, currency: 'EUR' },
      status: PropertyStatus.PUBLISHED,
      isExternal: true,
      source: 'fixture',
      sourceId: 'wire-id-contract-1',
      sourceUrl: 'https://fixtures.homiio.com/wire-id-contract',
      images: [],
    });

    return { cityId: city._id.toString(), propertyId: property._id.toString() };
  }

  it('serializes a `.lean()` read as `id`, never `_id`, including nested documents', async () => {
    const { cityId, propertyId } = await seedCityProperty();

    const res = await request(app).get(`/api/cities/${cityId}/properties?limit=8`).expect(200);

    const [property] = res.body.data.properties;
    expect(property.id).toBe(propertyId);
    expect(property).not.toHaveProperty('_id');
    // The nested address arrives from `.populate()` inside the same lean result;
    // a serializer that only renamed the top level would leave this one behind.
    expect(property.address).toBeDefined();
    expect(property.address).not.toHaveProperty('_id');
    // And the city on the same body, which is a Mongoose DOCUMENT rather than a
    // lean object — the other of the two paths that reach `res.json`.
    expect(res.body.data.city.id).toBe(cityId);
    expect(res.body.data.city).not.toHaveProperty('_id');
  });

  it('leaves no `_id` anywhere in the body, at any depth', async () => {
    const { cityId } = await seedCityProperty();

    const res = await request(app).get(`/api/cities/${cityId}/properties?limit=8`).expect(200);

    // A whole-body scan rather than named fields: the point of a chokepoint is
    // that nothing gets past it, and a per-field assertion only covers the
    // fields somebody remembered.
    expect(JSON.stringify(res.body)).not.toContain('"_id"');
  });
});
