/**
 * The address tools, through the wrapped handlers both MCP lanes call.
 *
 * What matters here is that a tool is the ROUTE for the same person: the same
 * published precision (ADR 0003 — `building` for a stranger, escalated only for
 * a recorded relation), the same write authorization (a non-related caller
 * gets not-found from `updateAddress`), and the same refusal of identity
 * fields, which may only be PROPOSED.
 */

import { eq } from 'drizzle-orm';
import { uuidv7 } from '@oxy.so/db';

import { getDb } from '../../db/postgres';
import { addresses } from '../../db/schema';
import { callTool } from '../helpers/capabilityHarness';
import {
  seedAddress,
  seedGeoChain,
  seedProperty,
  type GeoChain,
} from '../helpers/postgresGeoFixtures';

const OWNER = `oxy-addr-owner-${uuidv7().slice(-6)}`;
const STRANGER = `oxy-addr-stranger-${uuidv7().slice(-6)}`;

let chain: GeoChain;
let addressId: string;

beforeAll(async () => {
  chain = await seedGeoChain({ countryCode: `Q${uuidv7().slice(-1).toUpperCase()}` });
});

beforeEach(async () => {
  addressId = await seedAddress({
    chain,
    street: `Carrer Capability ${uuidv7().slice(-8)}`,
    number: '7',
    floor: '3',
  });
  // The owner's listing at the place is the recorded relation updateAddress needs.
  await seedProperty({ addressId, overrides: { oxyUserId: OWNER, status: 'published' } });
});

describe('getAddress', () => {
  it('serves a stranger building precision — no floor', async () => {
    const result = await callTool('getAddress', STRANGER, { addressId });
    expect(result.isError).toBe(false);
    const address = result.structuredContent.address as Record<string, unknown>;
    expect(address.street).toBeDefined();
    expect(address.floor).toBeUndefined();
  });

  it('answers not-found for an address that does not exist', async () => {
    const result = await callTool('getAddress', STRANGER, { addressId: 'no-such-address' });
    expect(result.error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});

describe('searchAddresses / findNearbyAddresses', () => {
  it('finds the place by street, at building precision', async () => {
    const [row] = await getDb().select().from(addresses).where(eq(addresses.id, addressId));
    const result = await callTool('searchAddresses', STRANGER, { query: row.street ?? '' });
    expect(result.isError).toBe(false);
    const found = result.structuredContent.addresses as Array<Record<string, unknown>>;
    expect(found.some((entry) => entry.street === row.street)).toBe(true);
    expect(found.every((entry) => entry.floor === undefined)).toBe(true);
  });

  it('finds addresses near a point', async () => {
    const result = await callTool('findNearbyAddresses', STRANGER, {
      lat: 41.38,
      lng: 2.17,
      radius: 500,
    });
    expect(result.isError).toBe(false);
    expect(Array.isArray(result.structuredContent.addresses)).toBe(true);
  });
});

describe('createAddress', () => {
  it('resolves a described place and answers its id at building precision', async () => {
    const result = await callTool('createAddress', STRANGER, {
      address: {
        street: `Carrer Resolt ${uuidv7().slice(-8)}`,
        number: '12',
        city: `Ciutat ${uuidv7().slice(-6)}`,
        state: 'Catalonia',
        country: 'Spain',
        countryCode: 'ES',
        postal_code: '08013',
        coordinates: { type: 'Point', coordinates: [2.17, 41.39] },
      },
    });
    expect(result.isError).toBe(false);
    const address = result.structuredContent.address as Record<string, unknown>;
    expect(typeof address.id).toBe('string');
  });

  it('refuses a place without coordinates, as the route does', async () => {
    const result = await callTool('createAddress', STRANGER, {
      address: { street: 'Somewhere', city: 'Nowhere', country: 'Spain' },
    });
    expect(result.error).toMatchObject({ status: 400 });
  });
});

describe('updateAddress', () => {
  it('lets a caller with a recorded relation correct an attribute', async () => {
    const result = await callTool('updateAddress', OWNER, { addressId, reference: 'Back door' });
    expect(result.isError).toBe(false);
    const [row] = await getDb().select().from(addresses).where(eq(addresses.id, addressId));
    expect(row.reference).toBe('Back door');
  });

  it('answers a caller with no relation not-found, and writes nothing', async () => {
    const result = await callTool('updateAddress', STRANGER, { addressId, reference: 'Hijacked' });
    expect(result.error).toMatchObject({ status: 404 });
    const [row] = await getDb().select().from(addresses).where(eq(addresses.id, addressId));
    expect(row.reference).not.toBe('Hijacked');
  });
});

describe('address corrections', () => {
  it('proposes, lists and withdraws a correction; somebody else cannot withdraw it', async () => {
    const proposed = await callTool('proposeAddressCorrection', STRANGER, {
      addressId,
      reason: 'The door says 9, not 7',
      number: '9',
    });
    expect(proposed.isError).toBe(false);
    const proposalId = (proposed.structuredContent.proposal as { id: string }).id;

    const listed = await callTool('listAddressCorrections', OWNER, { addressId });
    expect(
      (listed.structuredContent.proposals as Array<{ id: string }>).map((entry) => entry.id),
    ).toContain(proposalId);

    const foreign = await callTool('withdrawAddressCorrection', OWNER, { addressId, proposalId });
    expect(foreign.error).toMatchObject({ status: 404 });

    const withdrawn = await callTool('withdrawAddressCorrection', STRANGER, {
      addressId,
      proposalId,
    });
    expect(withdrawn.isError).toBe(false);
  });

  it('refuses a proposal without a reason, naming the rule', async () => {
    const result = await callTool('proposeAddressCorrection', STRANGER, {
      addressId,
      reason: ' ',
      number: '9',
    });
    expect(result.error?.status).toBe(400);
    expect(result.error?.message).toContain('A correction must say why');
  });
});
