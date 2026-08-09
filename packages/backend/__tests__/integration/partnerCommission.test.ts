/**
 * Partner earn close-deal loop (no Stripe Connect).
 *
 * Exercises the full manual referral-commission path end to end against the
 * real controllers against a REAL Postgres:
 *
 *   join (partner)  →  create a property carrying the partner's referralCode
 *                   →  the property owner marks it transacted
 *                   →  exactly one approved Commission + gamification points.
 *
 * Also asserts idempotency (re-marking never doubles the commission or points)
 * and that a non-sourced listing closes with no commission at all.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import {
  COMMISSION_CONFIG,
  POINTS_CONFIG,
  OfferingType,
  PropertyStatus,
  PropertyType,
  commissionAmount,
} from '@homiio/shared-types';

import { createProperty } from '../../controllers/property/create';
import { markPropertyTransacted } from '../../controllers/property/transact';
import { eq } from 'drizzle-orm';

import { createAddress } from '../helpers/factories';
import { getDb } from '../../db/postgres';
import { commissions as commissionsTable, partners, properties } from '../../db/schema';
import { findPropertyById } from '../../db/properties/propertyReads';
import { resetGeoTables, resetPartnerTables } from '../helpers/postgresGeoFixtures';

import partnerController from '../../controllers/partnerController';
import roomController from '../../controllers/roomController';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import { assertFound } from '../helpers/assertFound';

/** The partner row behind a referral code. */
async function partnerByCode(referralCode: string) {
  const [row] = await getDb()
    .select()
    .from(partners)
    .where(eq(partners.referralCode, referralCode))
    .limit(1);
  return row ?? null;
}

/** Every commission booked against a listing. */
async function commissionsFor(propertyId: string) {
  return getDb()
    .select()
    .from(commissionsTable)
    .where(eq(commissionsTable.propertyId, propertyId));
}

/** Fake-auth app that injects `req.user.id` / `req.userId` for one Oxy user. */
function buildApp(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
  // Production mounts every one of these handlers behind `routes()`, whose
  // first middleware is the wire-id serializer. Without it here the suite
  // would assert a body shape the API no longer serves.
  app.use(serializeWireIds);

  app.use((req, _res, next) => {
    const authed = req as unknown as { user: { id: string }; userId: string };
    authed.user = { id: oxyUserId };
    authed.userId = oxyUserId;
    next();
  });
  app.post('/partners/join', (req, res, next) => partnerController.join(req, res, next));
  app.post('/properties', createProperty);
  app.post('/properties/:propertyId/mark-transacted', markPropertyTransacted);
  app.put('/rooms/:id', (req, res, next) => roomController.updateRoom(req, res, next));
  app.use(errorHandler);
  return app;
}

/** A valid long-term-rent create body, optionally attributing a referral code. */
async function rentCreateBody(referralCode?: string) {
  const address = await createAddress();
  return {
    type: PropertyType.APARTMENT,
    bedrooms: 2,
    bathrooms: 1,
    offerings: [OfferingType.LONG_TERM_RENT],
    longTermRent: { monthlyAmount: 1200, currency: 'EUR' },
    addressId: address.id,
    ...(referralCode ? { referralCode } : {}),
  };
}

// Postgres persists for the whole jest worker, where the in-memory Mongo this
// suite used to run against was wiped between tests. Every case here joins as
// the SAME Oxy user, so without this reset the second one meets the first's
// partner row — and its points assertion fails by exactly one award, which
// reads as a broken idempotency guard rather than as leftover state.
beforeEach(async () => {
  // Partners FIRST: both of `commissions`' references are ON DELETE RESTRICT,
  // so a booked commission makes the listing delete inside `resetGeoTables`
  // raise.
  await resetPartnerTables();
  await resetGeoTables();
});

describe('partner earn close-deal loop', () => {
  it('join → create with referralCode → mark-transacted creates one commission + points', async () => {
    // A partner joins and receives a referral code.
    const partnerApp = buildApp('oxy-partner');
    const joinRes = await request(partnerApp).post('/partners/join');
    expect(joinRes.status).toBe(201);
    const referralCode: string = joinRes.body.data.partner.referralCode;
    expect(referralCode).toBeTruthy();

    // A different user (the property owner) lists a home using that code.
    const ownerApp = buildApp('oxy-owner');
    const createRes = await request(ownerApp)
      .post('/properties')
      .send(await rentCreateBody(referralCode));
    expect(createRes.status).toBe(201);
    const propertyId: string = createRes.body.data.id;

    // The listing is attributed to the sourcing partner.
    const partner = await partnerByCode(referralCode);
    assertFound(partner, 'partner');
    const sourced = await findPropertyById(propertyId);
    assertFound(sourced, 'sourced');
    // The attribution is a real FOREIGN KEY to `partners.id` now, so a listing
    // could not carry an id no partner row holds even if the lookup were wrong.
    expect(sourced.property.sourcedByPartnerId).toBe(partner.id);
    expect(sourced.property.sourcedByReferralCode).toBe(referralCode);

    // The owner closes the deal (status inferred from offerings → rented).
    const markRes = await request(ownerApp)
      .post(`/properties/${propertyId}/mark-transacted`)
      .send({});
    expect(markRes.status).toBe(200);
    expect(markRes.body.data.property.status).toBe(PropertyStatus.RENTED);

    // Exactly one approved commission, priced off the 3%-of-first-month rule.
    const expectedAmount = commissionAmount('rent', 1200);
    expect(markRes.body.data.commission).not.toBeNull();
    expect(markRes.body.data.commission.amount).toBe(expectedAmount);
    expect(markRes.body.data.commission.currency).toBe(COMMISSION_CONFIG.currency);
    expect(markRes.body.data.commission.status).toBe('approved');
    expect(markRes.body.data.commission.basis.offering).toBe('rent');

    const commissions = await commissionsFor(propertyId);
    expect(commissions).toHaveLength(1);

    // Points: the flat per-deal base (a €36 payout earns no per-1,000 bonus).
    const [reloadedPartner] = await getDb()
      .select()
      .from(partners)
      .where(eq(partners.id, partner.id))
      .limit(1);
    assertFound(reloadedPartner, 'reloadedPartner');
    expect(reloadedPartner.points).toBe(POINTS_CONFIG.perClosedDeal);
  });

  it('is idempotent — re-marking never doubles the commission or the points', async () => {
    const partnerApp = buildApp('oxy-partner');
    const joinRes = await request(partnerApp).post('/partners/join');
    const referralCode: string = joinRes.body.data.partner.referralCode;

    const ownerApp = buildApp('oxy-owner');
    const createRes = await request(ownerApp)
      .post('/properties')
      .send(await rentCreateBody(referralCode));
    const propertyId: string = createRes.body.data.id;

    const first = await request(ownerApp)
      .post(`/properties/${propertyId}/mark-transacted`)
      .send({});
    expect(first.status).toBe(200);
    const firstCommissionId = first.body.data.commission.id;

    // Close it a second time — must return the SAME commission, no new doc, no
    // extra points.
    const second = await request(ownerApp)
      .post(`/properties/${propertyId}/mark-transacted`)
      .send({});
    expect(second.status).toBe(200);
    const secondCommissionId = second.body.data.commission.id;
    expect(String(secondCommissionId)).toBe(String(firstCommissionId));

    const commissions = await commissionsFor(propertyId);
    expect(commissions).toHaveLength(1);

    const partner = await partnerByCode(referralCode);
    assertFound(partner, 'partner');
    expect(partner.points).toBe(POINTS_CONFIG.perClosedDeal);
  });

  it('closes a non-sourced listing with no commission', async () => {
    const ownerApp = buildApp('oxy-owner');
    const createRes = await request(ownerApp)
      .post('/properties')
      .send(await rentCreateBody());
    const propertyId: string = createRes.body.data.id;

    const markRes = await request(ownerApp)
      .post(`/properties/${propertyId}/mark-transacted`)
      .send({});
    expect(markRes.status).toBe(200);
    expect(markRes.body.data.property.status).toBe(PropertyStatus.RENTED);
    expect(markRes.body.data.commission).toBeNull();

    const commissions = await commissionsFor(propertyId);
    expect(commissions).toHaveLength(0);
  });

  it('room parity: closing a sourced room via updateRoom fires the commission trigger', async () => {
    // A partner joins; the owner lists a home and a room within it, both
    // attributed to the partner (rooms are Properties, so they close deals the
    // same way — updateRoom mirrors updateProperty).
    const partnerApp = buildApp('oxy-partner');
    const joinRes = await request(partnerApp).post('/partners/join');
    const referralCode: string = joinRes.body.data.partner.referralCode;
    const partner = await partnerByCode(referralCode);
    assertFound(partner, 'partner');

    const address = await createAddress();
    const [parent] = await getDb()
      .insert(properties)
      .values({
        oxyUserId: 'oxy-owner',
        addressId: address.id,
        type: PropertyType.APARTMENT,
        bedrooms: 3,
        bathrooms: 1,
        offerings: [OfferingType.LONG_TERM_RENT],
        longTermRentMonthlyAmount: 2000,
        longTermRentCurrency: 'EUR',
        status: PropertyStatus.PUBLISHED,
      })
      .returning({ id: properties.id });
    // Seed a room directly with the partner attribution (the room create flow
    // never accepts a referral code, but the trigger must still fire if a room
    // is sourced).
    const [room] = await getDb()
      .insert(properties)
      .values({
        oxyUserId: 'oxy-owner',
        addressId: address.id,
        parentPropertyId: parent.id,
        type: PropertyType.ROOM,
        offerings: [OfferingType.LONG_TERM_RENT],
        longTermRentMonthlyAmount: 800,
        longTermRentCurrency: 'EUR',
        status: PropertyStatus.PUBLISHED,
        sourcedByPartnerId: partner.id,
        sourcedByReferralCode: referralCode,
      })
      .returning({ id: properties.id });

    const ownerApp = buildApp('oxy-owner');
    const res = await request(ownerApp)
      .put(`/rooms/${room.id}`)
      .send({ status: PropertyStatus.RENTED });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(PropertyStatus.RENTED);

    const commissions = await commissionsFor(room.id);
    expect(commissions).toHaveLength(1);
    expect(commissions[0].amount).toBe(commissionAmount('rent', 800));
  });

  it('rejects a non-owner closing someone else’s listing with 403', async () => {
    const partnerApp = buildApp('oxy-partner');
    const joinRes = await request(partnerApp).post('/partners/join');
    const referralCode: string = joinRes.body.data.partner.referralCode;

    const ownerApp = buildApp('oxy-owner');
    const createRes = await request(ownerApp)
      .post('/properties')
      .send(await rentCreateBody(referralCode));
    const propertyId: string = createRes.body.data.id;

    // A different, unrelated user cannot close the owner's deal.
    const intruderApp = buildApp('oxy-intruder');
    const markRes = await request(intruderApp)
      .post(`/properties/${propertyId}/mark-transacted`)
      .send({});
    expect(markRes.status).toBe(403);
    expect(markRes.body.error.code).toBe('FORBIDDEN');

    const commissions = await commissionsFor(propertyId);
    expect(commissions).toHaveLength(0);
  });
});
