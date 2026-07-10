/**
 * Partner earn close-deal loop (no Stripe Connect).
 *
 * Exercises the full manual referral-commission path end to end against the
 * real controllers + models on the in-memory Mongo:
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
import { createAddress, models } from '../helpers/factories';

const partnerController = require('../../controllers/partnerController');
const roomController = require('../../controllers/roomController');
const { errorHandler } = require('../../middlewares/errorHandler');
const { Partner, Commission, Property } = models;

/** Fake-auth app that injects `req.user.id` / `req.userId` for one Oxy user. */
function buildApp(oxyUserId: string): Express {
  const app = express();
  app.use(express.json());
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
    addressId: address._id,
    ...(referralCode ? { referralCode } : {}),
  };
}

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
    const propertyId: string = createRes.body.data.id ?? createRes.body.data._id;

    // The listing is attributed to the sourcing partner.
    const partner = await Partner.findOne({ referralCode });
    const sourced = await Property.findById(propertyId);
    expect(String(sourced.sourcedByPartner)).toBe(String(partner._id));
    expect(sourced.sourcedByReferralCode).toBe(referralCode);

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

    const commissions = await Commission.find({ propertyId });
    expect(commissions).toHaveLength(1);

    // Points: the flat per-deal base (a €36 payout earns no per-1,000 bonus).
    const reloadedPartner = await Partner.findById(partner._id);
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
    const propertyId: string = createRes.body.data.id ?? createRes.body.data._id;

    const first = await request(ownerApp)
      .post(`/properties/${propertyId}/mark-transacted`)
      .send({});
    expect(first.status).toBe(200);
    const firstCommissionId = first.body.data.commission.id ?? first.body.data.commission._id;

    // Close it a second time — must return the SAME commission, no new doc, no
    // extra points.
    const second = await request(ownerApp)
      .post(`/properties/${propertyId}/mark-transacted`)
      .send({});
    expect(second.status).toBe(200);
    const secondCommissionId = second.body.data.commission.id ?? second.body.data.commission._id;
    expect(String(secondCommissionId)).toBe(String(firstCommissionId));

    const commissions = await Commission.find({ propertyId });
    expect(commissions).toHaveLength(1);

    const partner = await Partner.findOne({ referralCode });
    expect(partner.points).toBe(POINTS_CONFIG.perClosedDeal);
  });

  it('closes a non-sourced listing with no commission', async () => {
    const ownerApp = buildApp('oxy-owner');
    const createRes = await request(ownerApp)
      .post('/properties')
      .send(await rentCreateBody());
    const propertyId: string = createRes.body.data.id ?? createRes.body.data._id;

    const markRes = await request(ownerApp)
      .post(`/properties/${propertyId}/mark-transacted`)
      .send({});
    expect(markRes.status).toBe(200);
    expect(markRes.body.data.property.status).toBe(PropertyStatus.RENTED);
    expect(markRes.body.data.commission).toBeNull();

    const commissions = await Commission.find({ propertyId });
    expect(commissions).toHaveLength(0);
  });

  it('room parity: closing a sourced room via updateRoom fires the commission trigger', async () => {
    // A partner joins; the owner lists a home and a room within it, both
    // attributed to the partner (rooms are Properties, so they close deals the
    // same way — updateRoom mirrors updateProperty).
    const partnerApp = buildApp('oxy-partner');
    const joinRes = await request(partnerApp).post('/partners/join');
    const referralCode: string = joinRes.body.data.partner.referralCode;
    const partner = await Partner.findOne({ referralCode });

    const address = await createAddress();
    const parent = await Property.create({
      oxyUserId: 'oxy-owner',
      addressId: address._id,
      type: PropertyType.APARTMENT,
      bedrooms: 3,
      bathrooms: 1,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 2000, currency: 'EUR' },
      status: PropertyStatus.PUBLISHED,
    });
    // Seed a room directly with the partner attribution (the room create flow
    // never accepts a referral code, but the trigger must still fire if a room
    // is sourced).
    const room = await Property.create({
      oxyUserId: 'oxy-owner',
      addressId: address._id,
      parentPropertyId: parent._id,
      type: PropertyType.ROOM,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 800, currency: 'EUR' },
      status: PropertyStatus.PUBLISHED,
      sourcedByPartner: partner._id,
      sourcedByReferralCode: referralCode,
    });

    const ownerApp = buildApp('oxy-owner');
    const res = await request(ownerApp)
      .put(`/rooms/${room._id}`)
      .send({ status: PropertyStatus.RENTED });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(PropertyStatus.RENTED);

    const commissions = await Commission.find({ propertyId: room._id });
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
    const propertyId: string = createRes.body.data.id ?? createRes.body.data._id;

    // A different, unrelated user cannot close the owner's deal.
    const intruderApp = buildApp('oxy-intruder');
    const markRes = await request(intruderApp)
      .post(`/properties/${propertyId}/mark-transacted`)
      .send({});
    expect(markRes.status).toBe(403);
    expect(markRes.body.error.code).toBe('FORBIDDEN');

    const commissions = await Commission.find({ propertyId });
    expect(commissions).toHaveLength(0);
  });
});
