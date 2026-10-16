/**
 * The maintenance tools, through the wrapped catalogue handlers and the REAL
 * Postgres. Each tool calls `domain/maintenance.ts` as the effective account:
 * a party to the lease sees and acts, anybody else gets the route's 404, and
 * every refusal re-reads the table so "404 and wrote anyway" cannot pass.
 */

import { eq } from 'drizzle-orm';
import { LeaseStatus, PropertyStatus } from '@homiio/shared-types';
import { catalogToolSchema } from '@oxy.so/contracts';

import { MAINTENANCE_TOOLS } from '../../capabilities/catalog/maintenance';
import { getDb } from '../../db/postgres';
import {
  capabilityEffectReceipts,
  leaseCoTenants,
  leases,
  maintenanceRequestComments,
  maintenanceRequests,
} from '../../db/schema';
import { notificationDispatchService } from '../../services/notificationDispatchService';
import { callTool } from '../helpers/capabilityHarness';
import { objectIdHex, resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

const LANDLORD = 'cap-landlord';
const TENANT = 'cap-tenant';
const CO_TENANT = 'cap-co-tenant';
const STRANGER = 'cap-stranger';

async function seedLease(): Promise<{ leaseId: string; propertyId: string }> {
  const { propertyId } = await seedListingWithGeo({
    countryCode: `C${Math.floor(Math.random() * 90 + 10)}`,
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
    })
    .returning({ id: leases.id });
  await getDb()
    .insert(leaseCoTenants)
    .values({ leaseId: lease.id, oxyUserId: CO_TENANT, role: 'secondary', status: 'signed' });
  return { leaseId: lease.id, propertyId };
}

const NEW_REQUEST = {
  category: 'plumbing',
  urgency: 'high',
  title: 'Kitchen tap will not stop running',
  description: 'It has run since Tuesday and the sink is staining.',
};

async function report(leaseId: string, as = TENANT): Promise<string> {
  const result = await callTool('createMaintenanceRequest', as, { leaseId, ...NEW_REQUEST });
  expect(result.isError).toBe(false);
  return (result.structuredContent.data as { id: string }).id;
}

const rowOf = async (id: string) => {
  const [row] = await getDb()
    .select()
    .from(maintenanceRequests)
    .where(eq(maintenanceRequests.id, id))
    .limit(1);
  return row;
};

beforeEach(async () => {
  await getDb().delete(capabilityEffectReceipts);
  await getDb().delete(maintenanceRequests);
  await resetGeoTables();
});

afterEach(() => jest.restoreAllMocks());

describe('the maintenance catalogue entries', () => {
  it('are valid catalogue tools on the homiio account root', () => {
    for (const tool of MAINTENANCE_TOOLS) {
      expect(() => catalogToolSchema.parse(tool)).not.toThrow();
      expect(tool.resourceTypes).toEqual(['homiio_account']);
    }
  });
});

describe('createMaintenanceRequest', () => {
  it('a tenant reports a repair on their lease; the property comes from the lease and the landlord is told through the dispatcher', async () => {
    const dispatch = jest.spyOn(notificationDispatchService, 'createForUser');
    const { leaseId, propertyId } = await seedLease();

    const id = await report(leaseId);

    const row = await rowOf(id);
    expect(row).toMatchObject({ leaseId, propertyId, reportedByOxyUserId: TENANT, status: 'open' });
    expect(dispatch).toHaveBeenCalledWith(
      LANDLORD,
      expect.objectContaining({ type: 'maintenance_reported' }),
    );
  });

  it('a stranger gets not-found and nothing is written', async () => {
    const { leaseId } = await seedLease();
    const result = await callTool('createMaintenanceRequest', STRANGER, {
      leaseId,
      ...NEW_REQUEST,
    });
    expect(result.error).toMatchObject({ status: 404, code: 'NOT_FOUND' });
    expect(await getDb().select().from(maintenanceRequests)).toHaveLength(0);
  });

  it('a landlord is refused as the route refuses them (403), and nothing is written', async () => {
    const { leaseId } = await seedLease();
    const result = await callTool('createMaintenanceRequest', LANDLORD, {
      leaseId,
      ...NEW_REQUEST,
    });
    expect(result.error).toMatchObject({ status: 403, code: 'FORBIDDEN' });
    expect(await getDb().select().from(maintenanceRequests)).toHaveLength(0);
  });

  it('replays the stored receipt for the same idempotency key: one request, one answer', async () => {
    const { leaseId } = await seedLease();
    const input = { leaseId, ...NEW_REQUEST };
    const first = await callTool('createMaintenanceRequest', TENANT, input, {
      idempotencyKey: 'maint-key-1',
      lane: 'capability',
    });
    const second = await callTool('createMaintenanceRequest', TENANT, input, {
      idempotencyKey: 'maint-key-1',
      lane: 'capability',
    });
    expect(second.structuredContent).toEqual(first.structuredContent);
    expect(await getDb().select().from(maintenanceRequests)).toHaveLength(1);

    const reused = await callTool(
      'createMaintenanceRequest',
      TENANT,
      { ...input, title: 'Something else entirely' },
      { idempotencyKey: 'maint-key-1', lane: 'capability' },
    );
    expect(reused.error).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
    expect(await getDb().select().from(maintenanceRequests)).toHaveLength(1);
  });
});

describe('reading requests', () => {
  it('lists the parties’ requests with the route’s pagination block, and nobody else’s', async () => {
    const { leaseId } = await seedLease();
    const id = await report(leaseId);

    const asLandlord = await callTool('listMyMaintenanceRequests', LANDLORD, {});
    // The landlord's role on the lease decides what they are offered.
    expect(asLandlord.structuredContent.data).toEqual([
      expect.objectContaining({ id, availableTransitions: ['acknowledged', 'declined'] }),
    ]);
    expect(asLandlord.structuredContent.pagination).toMatchObject({ page: 1, total: 1 });

    const asStranger = await callTool('listMyMaintenanceRequests', STRANGER, {});
    expect(asStranger.structuredContent.data).toEqual([]);
  });

  it('getMaintenanceRequest answers a party and 404s a stranger', async () => {
    const { leaseId } = await seedLease();
    const id = await report(leaseId);

    const coTenant = await callTool('getMaintenanceRequest', CO_TENANT, { requestId: id });
    expect(coTenant.isError).toBe(false);
    expect(coTenant.structuredContent.data).toMatchObject({ id });

    const stranger = await callTool('getMaintenanceRequest', STRANGER, { requestId: id });
    expect(stranger.error).toMatchObject({ status: 404 });
  });
});

describe('acting on a request', () => {
  it('the landlord moves it along; an illegal move is 409 and a stranger is 404 with no change', async () => {
    const { leaseId } = await seedLease();
    const id = await report(leaseId);

    const acknowledged = await callTool('transitionMaintenanceRequest', LANDLORD, {
      requestId: id,
      status: 'acknowledged',
    });
    expect(acknowledged.isError).toBe(false);
    expect((await rowOf(id)).status).toBe('acknowledged');

    const illegal = await callTool('transitionMaintenanceRequest', LANDLORD, {
      requestId: id,
      status: 'open',
    });
    expect(illegal.error).toMatchObject({ status: 409, code: 'MAINTENANCE_TRANSITION_ILLEGAL' });

    const stranger = await callTool('transitionMaintenanceRequest', STRANGER, {
      requestId: id,
      status: 'resolved',
    });
    expect(stranger.error).toMatchObject({ status: 404 });
    expect((await rowOf(id)).status).toBe('acknowledged');
  });

  it('comments notify the other party through the dispatcher; a stranger’s comment is 404 and not stored', async () => {
    const { leaseId } = await seedLease();
    const id = await report(leaseId);
    const dispatch = jest.spyOn(notificationDispatchService, 'createForUser');

    const comment = await callTool('commentOnMaintenanceRequest', LANDLORD, {
      requestId: id,
      body: 'A plumber comes Thursday.',
    });
    expect(comment.isError).toBe(false);
    expect(dispatch).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ type: 'maintenance_comment' }),
    );

    const stranger = await callTool('commentOnMaintenanceRequest', STRANGER, {
      requestId: id,
      body: 'Hello',
    });
    expect(stranger.error).toMatchObject({ status: 404 });
    const comments = await getDb()
      .select()
      .from(maintenanceRequestComments)
      .where(eq(maintenanceRequestComments.requestId, id));
    expect(comments).toHaveLength(1);
  });
});
