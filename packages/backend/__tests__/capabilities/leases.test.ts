import { fakeOxyFiles } from '../helpers/fakeOxyFiles';
/**
 * Lease tools, through the wrapped handlers both MCP lanes call, against the
 * REAL Postgres.
 *
 * What each case pins:
 *  - a non-party is refused exactly as the route refuses them (403 on the lease
 *    routes, the route's historical answer; 404 on a document's bytes);
 *  - an edit applies ONLY the whitelisted fields — a smuggled `status` or
 *    `landlordOxyUserId` changes nothing;
 *  - the signing seat comes from the lease, never from input, and the
 *    counterparty is notified through `notificationDispatchService` only;
 *  - a base64 document is stored through the same private upload as the app's
 *    and reads back byte for byte to a party.
 */

import { eq } from 'drizzle-orm';
import { LeaseStatus, PropertyStatus } from '@homiio/shared-types';
import { appCapabilityCatalogSchema } from '@oxy.so/contracts';

import { LEASE_DOCUMENT_TOOL_MIME_TYPES, LEASE_TOOLS } from '../../capabilities/catalog/leases';
import { HOMIIO_CAPABILITY_CATALOG } from '../../capabilities/homiio.catalog';
import { LEASE_DOCUMENT_MIME_TYPES, readLeaseDocument } from '../../domain/leases';
import { getDb } from '../../db/postgres';
import { capabilityEffectReceipts, leaseDocuments, leases } from '../../db/schema';
import { notificationDispatchService } from '../../services/notificationDispatchService';
import { callTool } from '../helpers/capabilityHarness';
import { objectIdHex, resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

const LANDLORD = 'oxy-lease-landlord';
const TENANT = 'oxy-lease-tenant';
const STRANGER = 'oxy-lease-stranger';

let countrySequence = 0;

async function seedLease(status: string = LeaseStatus.DRAFT): Promise<string> {
  countrySequence += 1;
  const { propertyId } = await seedListingWithGeo({
    countryCode: `W${countrySequence}`,
    overrides: { status: PropertyStatus.PUBLISHED, oxyUserId: LANDLORD },
  });
  const [lease] = await getDb()
    .insert(leases)
    .values({
      id: objectIdHex(),
      propertyId,
      landlordOxyUserId: LANDLORD,
      tenantOxyUserId: TENANT,
      status: status as never,
      leaseTermsStartDate: new Date('2026-01-01T00:00:00.000Z'),
      leaseTermsEndDate: new Date('2027-01-01T00:00:00.000Z'),
      rentDetailsMonthlyRent: 950,
      rentDetailsCurrency: 'EUR',
    })
    .returning({ id: leases.id });
  return lease.id;
}

async function leaseRow(id: string) {
  const [row] = await getDb().select().from(leases).where(eq(leases.id, id));
  return row;
}

beforeEach(async () => {
  await getDb().delete(capabilityEffectReceipts);
  await getDb().delete(leases);
  await resetGeoTables();
});

afterAll(async () => {
  await getDb().delete(capabilityEffectReceipts);
  await getDb().delete(leases);
  await resetGeoTables();
});

afterEach(() => jest.restoreAllMocks());

describe('the catalogue entries', () => {
  it('parse as a catalogue and advertise exactly the domain MIME allowlist', () => {
    expect(() =>
      appCapabilityCatalogSchema.parse({
        ...HOMIIO_CAPABILITY_CATALOG,
        features: [],
        tools: LEASE_TOOLS,
      }),
    ).not.toThrow();
    expect([...LEASE_DOCUMENT_TOOL_MIME_TYPES].sort()).toEqual(
      [...LEASE_DOCUMENT_MIME_TYPES].sort(),
    );
    expect(LEASE_TOOLS.map((tool) => tool.name)).not.toContain('createLease');
  });
});

describe('reading', () => {
  it('lists my leases as either party and nothing for a stranger', async () => {
    const id = await seedLease();
    for (const who of [LANDLORD, TENANT]) {
      const listed = await callTool('listMyLeases', who);
      expect((listed.structuredContent.data as { id: string }[]).map((l) => l.id)).toEqual([id]);
      expect(listed.structuredContent.pagination).toMatchObject({ total: 1 });
    }
    expect((await callTool('listMyLeases', STRANGER)).structuredContent.data).toEqual([]);
  });

  it('reads one lease to a party and refuses a stranger with the route’s 403', async () => {
    const id = await seedLease();
    const read = await callTool('getLease', TENANT, { leaseId: id });
    expect((read.structuredContent.data as { id: string }).id).toBe(id);
    expect((await callTool('getLease', STRANGER, { leaseId: id })).error).toMatchObject({
      code: 'FORBIDDEN',
      status: 403,
    });
    expect((await callTool('getLease', TENANT, { leaseId: objectIdHex() })).error?.status).toBe(
      404,
    );
  });
});

describe('updateLease', () => {
  it('applies only whitelisted fields, for the landlord only', async () => {
    const id = await seedLease();
    const updated = await callTool('updateLease', LANDLORD, {
      leaseId: id,
      changes: {
        notes: 'Keys in the mailbox',
        status: LeaseStatus.ACTIVE,
        landlordOxyUserId: STRANGER,
      },
    });
    expect(updated.isError).toBe(false);
    const row = await leaseRow(id);
    expect(row.notes).toBe('Keys in the mailbox');
    expect(row.status).toBe(LeaseStatus.DRAFT);
    expect(row.landlordOxyUserId).toBe(LANDLORD);

    const byTenant = await callTool('updateLease', TENANT, {
      leaseId: id,
      changes: { notes: 'x' },
    });
    expect(byTenant.error?.status).toBe(403);
    expect((await leaseRow(id)).notes).toBe('Keys in the mailbox');
  });

  it('runs the route validation chain on the changes', async () => {
    const id = await seedLease();
    const result = await callTool('updateLease', LANDLORD, {
      leaseId: id,
      changes: { leaseTerms: { startDate: '2026-05-01', endDate: '2026-04-01' } },
    });
    expect(result.error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });
});

describe('signLease', () => {
  it('signs from the seat the account holds and notifies the counterparty via dispatch', async () => {
    const spy = jest.spyOn(notificationDispatchService, 'createForUser');
    const id = await seedLease(LeaseStatus.PENDING_SIGNATURES);
    const signed = await callTool('signLease', TENANT, { leaseId: id, acceptTerms: true });
    expect(signed.isError).toBe(false);
    expect(spy).toHaveBeenCalledWith(LANDLORD, expect.objectContaining({ type: 'contract' }));

    spy.mockClear();
    const refused = await callTool('signLease', STRANGER, { leaseId: id, acceptTerms: true });
    expect(refused.error?.status).toBe(403);
    expect(spy).not.toHaveBeenCalled();
  });

  it('refuses a signature bound to terms that are no longer current', async () => {
    const id = await seedLease(LeaseStatus.PENDING_SIGNATURES);
    const stale = await callTool('signLease', TENANT, {
      leaseId: id,
      acceptTerms: true,
      termsSha256: '0'.repeat(64),
    });
    expect(stale.error?.code).toBe('LEASE_TERMS_CHANGED');
  });
});

describe('lifecycle', () => {
  it('terminates as a party, once', async () => {
    const id = await seedLease(LeaseStatus.ACTIVE);
    expect((await callTool('terminateLease', STRANGER, { leaseId: id })).error?.status).toBe(403);
    const done = await callTool('terminateLease', TENANT, { leaseId: id, reason: 'Moving' });
    expect((done.structuredContent.data as { status: string }).status).toBe(LeaseStatus.TERMINATED);
    expect((await callTool('terminateLease', LANDLORD, { leaseId: id })).error?.code).toBe(
      'LEASE_ALREADY_TERMINATED',
    );
  });

  it('renews into a new draft as the landlord only', async () => {
    const id = await seedLease(LeaseStatus.ACTIVE);
    expect(
      (await callTool('renewLease', TENANT, { leaseId: id, newEndDate: '2028-01-01' })).error
        ?.status,
    ).toBe(403);
    const renewed = await callTool('renewLease', LANDLORD, {
      leaseId: id,
      newEndDate: '2028-01-01',
      monthlyRent: 990,
    });
    const renewal = renewed.structuredContent.data as { id: string; status: string };
    expect(renewal.id).not.toBe(id);
    expect(renewal.status).toBe(LeaseStatus.DRAFT);
    expect((await leaseRow(renewal.id)).rentDetailsMonthlyRent).toBe(990);
  });

  it('deletes a draft as the landlord and refuses an active lease', async () => {
    const draft = await seedLease();
    expect((await callTool('deleteLease', TENANT, { leaseId: draft })).error?.status).toBe(403);
    const deleted = await callTool('deleteLease', LANDLORD, { leaseId: draft });
    expect(deleted.structuredContent).toEqual({ data: null });
    expect(await leaseRow(draft)).toBeUndefined();

    const active = await seedLease(LeaseStatus.ACTIVE);
    expect((await callTool('deleteLease', LANDLORD, { leaseId: active })).error?.code).toBe(
      'LEASE_NOT_DELETABLE',
    );
  });
});

describe('documents', () => {
  it('stores a base64 PDF privately and reads it back byte for byte to a party only', async () => {
    const id = await seedLease();
    const pdf = Buffer.from('%PDF-1.7\nthe tenancy agreement', 'binary');
    const uploaded = await callTool('uploadLeaseDocument', TENANT, {
      leaseId: id,
      type: 'lease_agreement',
      name: 'Agreement',
      filename: 'agreement.pdf',
      mimeType: 'application/pdf',
      contentBase64: pdf.toString('base64'),
    });
    expect(uploaded.isError).toBe(false);
    expect(fakeOxyFiles.callsOf('withMcpDocumentRequester')).toContainEqual([
      {
        connectionToken: `fixture-oauth-${TENANT}`,
        tool: 'uploadLeaseDocument',
        accountId: TENANT,
      },
    ]);
    const document = uploaded.structuredContent.data as { id: string; url?: string };
    expect(document.url).toBeUndefined();

    const listed = await callTool('listLeaseDocuments', LANDLORD, { leaseId: id });
    expect((listed.structuredContent.data as { id: string }[]).map((d) => d.id)).toEqual([
      document.id,
    ]);
    const read = await readLeaseDocument(LANDLORD, id, document.id);
    expect(Buffer.from(read.base64, 'base64')).toEqual(pdf);
    expect((await callTool('listLeaseDocuments', STRANGER, { leaseId: id })).error?.status).toBe(
      403,
    );
  });

  it('stores nothing for a stranger', async () => {
    const id = await seedLease();
    const refused = await callTool('uploadLeaseDocument', STRANGER, {
      leaseId: id,
      filename: 'x.pdf',
      mimeType: 'application/pdf',
      contentBase64: Buffer.from('%PDF-1.7 x').toString('base64'),
    });
    expect(refused.error?.status).toBe(403);
    expect(
      await getDb().select().from(leaseDocuments).where(eq(leaseDocuments.leaseId, id)),
    ).toHaveLength(0);
  });
});

test('forwards an own execution ticket to Files without substituting the account owner', async () => {
  const leaseId = await seedLease();
  const result = await callTool(
    'uploadLeaseDocument',
    TENANT,
    {
      leaseId,
      filename: 'agreement.pdf',
      mimeType: 'application/pdf',
      contentBase64: Buffer.from('%PDF-1.7\nown task agreement').toString('base64'),
    },
    { lane: 'capability' },
  );
  expect(result.isError).toBe(false);
  expect(fakeOxyFiles.callsOf('withRequester')).toContainEqual([
    { capabilityTicket: `fixture-capability-${TENANT}`, accountId: TENANT },
  ]);
});
