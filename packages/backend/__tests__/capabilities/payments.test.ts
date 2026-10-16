/**
 * Rent payment tools — the lease LEDGER — through the wrapped handlers both
 * MCP lanes call, against the REAL Postgres.
 *
 * What each case pins:
 *  - every tool that records money is a finance tool: internal lane only,
 *    Idempotency-Key required, a limit key on each amount;
 *  - a finance tool without a key does nothing;
 *  - the capability key IS the ledger key: a retry is the same movement (one
 *    row, one notification), and a key reused with another amount is refused;
 *  - a declaration moves no balance until the landlord confirms;
 *  - a non-party is refused as the route refuses them (404 on the ledger, 403
 *    on the obligation schedule), and the counterpart is notified only through
 *    `notificationDispatchService`.
 */

import { eq } from 'drizzle-orm';
import { LeaseStatus, PropertyStatus } from '@homiio/shared-types';
import { appCapabilityCatalogSchema } from '@oxy.so/contracts';

import { PAYMENT_TOOLS } from '../../capabilities/catalog/payments';
import { HOMIIO_CAPABILITY_CATALOG } from '../../capabilities/homiio.catalog';
import { ledgerIdempotencyKey } from '../../domain/payments';
import { getDb } from '../../db/postgres';
import {
  capabilityEffectReceipts,
  leasePaymentMovements,
  leasePaymentSchedule,
  leases,
} from '../../db/schema';
import { notificationDispatchService } from '../../services/notificationDispatchService';
import { callTool } from '../helpers/capabilityHarness';
import { objectIdHex, resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

const LANDLORD = 'oxy-pay-landlord';
const TENANT = 'oxy-pay-tenant';
const STRANGER = 'oxy-pay-stranger';

let countrySequence = 0;

interface Fixture {
  leaseId: string;
  obligationId: string;
}

async function seedLeaseWithObligation(): Promise<Fixture> {
  countrySequence += 1;
  const { propertyId } = await seedListingWithGeo({
    countryCode: `P${countrySequence}`,
    overrides: { status: PropertyStatus.PUBLISHED, oxyUserId: LANDLORD },
  });
  const [lease] = await getDb()
    .insert(leases)
    .values({
      id: objectIdHex(),
      propertyId,
      landlordOxyUserId: LANDLORD,
      tenantOxyUserId: TENANT,
      status: LeaseStatus.ACTIVE,
      leaseTermsStartDate: new Date('2026-01-01T00:00:00.000Z'),
      leaseTermsEndDate: new Date('2027-01-01T00:00:00.000Z'),
      rentDetailsMonthlyRent: 900,
      rentDetailsCurrency: 'EUR',
    })
    .returning({ id: leases.id });
  const [obligation] = await getDb()
    .insert(leasePaymentSchedule)
    .values({
      leaseId: lease.id,
      dueDate: new Date('2026-02-01T00:00:00.000Z'),
      amount: 900,
      type: 'rent',
    })
    .returning({ id: leasePaymentSchedule.id });
  return { leaseId: lease.id, obligationId: obligation.id };
}

const movementsOf = (leaseId: string) =>
  getDb().select().from(leasePaymentMovements).where(eq(leasePaymentMovements.leaseId, leaseId));

async function outstanding(fixture: Fixture): Promise<number> {
  const ledger = await callTool('getLeaseLedger', TENANT, { leaseId: fixture.leaseId });
  const data = ledger.structuredContent.data as {
    obligations: { obligationId: string; outstandingAmount: number }[];
  };
  const summary = data.obligations.find((o) => o.obligationId === fixture.obligationId);
  if (!summary) throw new Error('obligation missing from the ledger');
  return summary.outstandingAmount;
}

async function declared(fixture: Fixture, amount = 400, key = 'declare-key-0001') {
  const result = await callTool(
    'declareRentPayment',
    TENANT,
    { leaseId: fixture.leaseId, obligationId: fixture.obligationId, amount },
    { idempotencyKey: key, lane: 'capability' },
  );
  expect(result.isError).toBe(false);
  return (result.structuredContent.data as { id: string }).id;
}

beforeEach(async () => {
  await getDb().delete(capabilityEffectReceipts);
  await getDb().delete(leasePaymentMovements);
  await getDb().delete(leases);
  await resetGeoTables();
});

afterAll(async () => {
  await getDb().delete(capabilityEffectReceipts);
  await getDb().delete(leasePaymentMovements);
  await getDb().delete(leases);
  await resetGeoTables();
});

afterEach(() => jest.restoreAllMocks());

describe('the catalogue entries', () => {
  const MONEY_TOOLS = [
    'createLeasePaymentObligation',
    'declareRentPayment',
    'confirmRentPayment',
    'rejectRentPayment',
    'refundRentPayment',
  ];

  it('parse as a catalogue', () => {
    expect(() =>
      appCapabilityCatalogSchema.parse({
        ...HOMIIO_CAPABILITY_CATALOG,
        features: [],
        tools: PAYMENT_TOOLS,
      }),
    ).not.toThrow();
  });

  it('make every money tool finance, internal only, key required, amount-limited', () => {
    for (const name of MONEY_TOOLS) {
      const tool = PAYMENT_TOOLS.find((entry) => entry.name === name);
      if (!tool) throw new Error(`missing tool ${name}`);
      expect(tool).toMatchObject({
        capabilityPackage: 'finance',
        effect: 'financial',
        idempotency: 'required',
        exposure: ['internal'],
      });
      const properties = (tool.inputSchema as { properties: Record<string, unknown> }).properties;
      if ('amount' in properties) {
        expect(tool.limitKeys).toEqual([{ key: 'amount', kind: 'maximum_number' }]);
        expect((tool.inputSchema as { required: string[] }).required).toContain('amount');
      }
    }
  });
});

describe('ledgerIdempotencyKey', () => {
  it('keeps a ledger-shaped key and hashes any other into the ledger shape', () => {
    expect(ledgerIdempotencyKey('declare-key-0001')).toBe('declare-key-0001');
    const hashed = ledgerIdempotencyKey('run:42/step:7 — a coordinator key');
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
    expect(ledgerIdempotencyKey('run:42/step:7 — a coordinator key')).toBe(hashed);
  });
});

describe('declareRentPayment', () => {
  it('does nothing without an Idempotency-Key', async () => {
    const fixture = await seedLeaseWithObligation();
    const result = await callTool('declareRentPayment', TENANT, {
      leaseId: fixture.leaseId,
      obligationId: fixture.obligationId,
      amount: 100,
    });
    expect(result.error?.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(await movementsOf(fixture.leaseId)).toHaveLength(0);
  });

  it('records a pending declaration that moves no balance, and notifies the landlord once', async () => {
    const spy = jest.spyOn(notificationDispatchService, 'createForUser');
    const fixture = await seedLeaseWithObligation();
    const input = { leaseId: fixture.leaseId, obligationId: fixture.obligationId, amount: 400 };

    const first = await callTool('declareRentPayment', TENANT, input, {
      idempotencyKey: 'a coordinator key that is not ledger-shaped',
    });
    expect((first.structuredContent.data as { state: string }).state).toBe('pending');
    expect(await outstanding(fixture)).toBe(900);

    const retry = await callTool('declareRentPayment', TENANT, input, {
      idempotencyKey: 'a coordinator key that is not ledger-shaped',
    });
    expect(retry.structuredContent).toEqual(first.structuredContent);
    expect(await movementsOf(fixture.leaseId)).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(
      LANDLORD,
      expect.objectContaining({ type: 'lease_payment_declared' }),
    );

    const reused = await callTool(
      'declareRentPayment',
      TENANT,
      { ...input, amount: 401 },
      { idempotencyKey: 'a coordinator key that is not ledger-shaped' },
    );
    expect(reused.error?.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await movementsOf(fixture.leaseId)).toHaveLength(1);
  });

  it('is the same ledger write even when the capability receipt is gone', async () => {
    const fixture = await seedLeaseWithObligation();
    const first = await declared(fixture, 300, 'same-ledger-key');
    await getDb().delete(capabilityEffectReceipts);
    const second = await declared(fixture, 300, 'same-ledger-key');
    expect(second).toBe(first);
    expect(await movementsOf(fixture.leaseId)).toHaveLength(1);
  });

  it('refuses the landlord, a stranger, and an amount above what is outstanding', async () => {
    const fixture = await seedLeaseWithObligation();
    const input = { leaseId: fixture.leaseId, obligationId: fixture.obligationId, amount: 100 };
    const byLandlord = await callTool('declareRentPayment', LANDLORD, input, {
      idempotencyKey: 'landlord-key-1',
    });
    expect(byLandlord.error?.status).toBe(403);
    const byStranger = await callTool('declareRentPayment', STRANGER, input, {
      idempotencyKey: 'stranger-key-1',
    });
    expect(byStranger.error).toMatchObject({ code: 'LEASE_NOT_FOUND', status: 404 });
    const tooMuch = await callTool(
      'declareRentPayment',
      TENANT,
      { ...input, amount: 901 },
      { idempotencyKey: 'too-much-key-1' },
    );
    expect(tooMuch.error?.code).toBe('AMOUNT_EXCEEDS_OUTSTANDING');
    expect(await movementsOf(fixture.leaseId)).toHaveLength(0);
  });
});

describe('the landlord’s side', () => {
  it('confirms (the balance moves), refuses the tenant, and refunds at most the payment', async () => {
    const fixture = await seedLeaseWithObligation();
    const movementId = await declared(fixture, 400);

    const byTenant = await callTool(
      'confirmRentPayment',
      TENANT,
      { leaseId: fixture.leaseId, movementId },
      { idempotencyKey: 'confirm-tenant-1' },
    );
    expect(byTenant.error?.status).toBe(403);

    const spy = jest.spyOn(notificationDispatchService, 'createForUser');
    const confirmed = await callTool(
      'confirmRentPayment',
      LANDLORD,
      { leaseId: fixture.leaseId, movementId },
      { idempotencyKey: 'confirm-landlord-1' },
    );
    expect((confirmed.structuredContent.data as { state: string }).state).toBe('succeeded');
    expect(await outstanding(fixture)).toBe(500);
    expect(spy).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ type: 'lease_payment_confirmed' }),
    );

    const tooMuch = await callTool(
      'refundRentPayment',
      LANDLORD,
      { leaseId: fixture.leaseId, movementId, amount: 401 },
      { idempotencyKey: 'refund-too-much' },
    );
    expect(tooMuch.error?.code).toBe('AMOUNT_EXCEEDS_PAYMENT');
    const refund = await callTool(
      'refundRentPayment',
      LANDLORD,
      { leaseId: fixture.leaseId, movementId, amount: 100 },
      { idempotencyKey: 'refund-ok-0001' },
    );
    expect((refund.structuredContent.data as { direction: string }).direction).toBe('refund');
    expect(await outstanding(fixture)).toBe(600);
  });

  it('rejects a declaration only with a reason', async () => {
    const fixture = await seedLeaseWithObligation();
    const movementId = await declared(fixture, 200);
    const result = await callTool(
      'rejectRentPayment',
      LANDLORD,
      { leaseId: fixture.leaseId, movementId, reason: 'Nothing arrived' },
      { idempotencyKey: 'reject-key-0001' },
    );
    expect((result.structuredContent.data as { state: string }).state).toBe('failed');
  });

  it('adds an obligation as the landlord only', async () => {
    const fixture = await seedLeaseWithObligation();
    const input = { leaseId: fixture.leaseId, dueDate: '2026-03-01', amount: 900, type: 'rent' };
    const byTenant = await callTool('createLeasePaymentObligation', TENANT, input, {
      idempotencyKey: 'obligation-tenant',
    });
    expect(byTenant.error?.status).toBe(403);
    const created = await callTool('createLeasePaymentObligation', LANDLORD, input, {
      idempotencyKey: 'obligation-landlord',
    });
    expect((created.structuredContent.data as { amount: number }).amount).toBe(900);
    expect(
      await getDb()
        .select()
        .from(leasePaymentSchedule)
        .where(eq(leasePaymentSchedule.leaseId, fixture.leaseId)),
    ).toHaveLength(2);
  });
});

describe('reading', () => {
  it('lists my obligations across leases with their leaseId, and none for a stranger', async () => {
    const fixture = await seedLeaseWithObligation();
    const mine = await callTool('listMyPayments', TENANT);
    expect(mine.structuredContent.data).toEqual([
      expect.objectContaining({ id: fixture.obligationId, leaseId: fixture.leaseId, amount: 900 }),
    ]);
    expect(mine.structuredContent.pagination).toMatchObject({ total: 1 });
    expect((await callTool('listMyPayments', STRANGER)).structuredContent.data).toEqual([]);
  });

  it('refuses a stranger as each route does: 403 on the schedule, 404 on the ledger', async () => {
    const fixture = await seedLeaseWithObligation();
    expect(
      (
        (await callTool('listLeasePayments', LANDLORD, { leaseId: fixture.leaseId }))
          .structuredContent.data as unknown[]
      ).length,
    ).toBe(1);
    expect(
      (await callTool('listLeasePayments', STRANGER, { leaseId: fixture.leaseId })).error?.status,
    ).toBe(403);
    expect(
      (await callTool('getLeaseLedger', STRANGER, { leaseId: fixture.leaseId })).error?.status,
    ).toBe(404);
  });
});
