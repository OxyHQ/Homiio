/**
 * Application tools, through the wrapped handlers both MCP lanes call,
 * against the REAL Postgres.
 *
 * What each case pins:
 *  - the effective account is the ONLY authority: a stranger is refused exactly
 *    as the route refuses them (403 on read/decide — the route's historical
 *    answer — and 404 on a document verification, whose ownership is in the
 *    repository's WHERE);
 *  - an external listing never takes an application: the tool answers
 *    `external_listing` with the advertiser's page and writes nothing;
 *  - a base64 document goes through the same private upload as the app's
 *    multipart one, and its landlord can then read it;
 *  - a key replays the stored receipt (one row) and refuses different input;
 *  - a lease is created only from an APPROVED application.
 */

import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { appCapabilityCatalogSchema } from '@oxy.so/contracts';

import {
  APPLICATION_TOOLS,
  APPLICATION_DOCUMENT_MIME_TYPES,
} from '../../capabilities/catalog/applications';
import { HOMIIO_CAPABILITY_CATALOG } from '../../capabilities/homiio.catalog';
import { ALLOWED_DOCUMENT_MIME_TYPES, readApplicationDocument } from '../../domain/applications';
import { getDb } from '../../db/postgres';
import {
  capabilityEffectReceipts,
  leases,
  tenantApplicationDocuments,
  tenantApplications,
} from '../../db/schema';
import config from '../../config';
import { callTool } from '../helpers/capabilityHarness';
import { fakeOxyFiles } from '../helpers/fakeOxyFiles';
import { resetGeoTables, seedListingWithGeo } from '../helpers/postgresGeoFixtures';

const LANDLORD = 'oxy-cap-landlord';
const APPLICANT = 'oxy-cap-applicant';
const STRANGER = 'oxy-cap-stranger';

let geoChainCounter = 0;
function nextCountryCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const index = geoChainCounter++;
  return `Q${alphabet[index % 26]}`;
}

async function seedRental(): Promise<string> {
  const { propertyId } = await seedListingWithGeo({
    countryCode: nextCountryCode(),
    overrides: {
      oxyUserId: LANDLORD,
      status: 'published',
      isExternal: false,
      offerings: ['long_term_rent'],
      longTermRentMonthlyAmount: 1200,
      longTermRentCurrency: 'EUR',
    },
  });
  return propertyId;
}

function applicationInput(propertyId: string, overrides: Record<string, unknown> = {}) {
  return {
    propertyId,
    moveInDate: '2026-12-01T00:00:00.000Z',
    leaseTermMonths: 12,
    monthlyIncome: 3800,
    employmentStatus: 'employed',
    referenceContacts: [
      { name: 'Ada Ref', relationship: 'employer', phone: '+34600000000', email: 'ada@x.test' },
    ],
    ...overrides,
  };
}

async function submit(propertyId: string, applicant = APPLICANT): Promise<string> {
  const result = await callTool('submitApplication', applicant, applicationInput(propertyId));
  expect(result.isError).toBe(false);
  return (result.structuredContent.data as { id: string }).id;
}

beforeEach(async () => {
  await getDb().delete(capabilityEffectReceipts);
  await getDb().delete(leases);
  await getDb().delete(tenantApplications);
  await resetGeoTables();
});

afterAll(async () => {
  await getDb().delete(capabilityEffectReceipts);
  await getDb().delete(leases);
  await getDb().delete(tenantApplications);
  await resetGeoTables();
});

describe('the catalogue entries', () => {
  it('parse as a catalogue and advertise exactly the domain MIME allowlist', () => {
    expect(() =>
      appCapabilityCatalogSchema.parse({
        ...HOMIIO_CAPABILITY_CATALOG,
        features: [],
        tools: APPLICATION_TOOLS,
      }),
    ).not.toThrow();
    expect([...APPLICATION_DOCUMENT_MIME_TYPES].sort()).toEqual(
      [...ALLOWED_DOCUMENT_MIME_TYPES].sort(),
    );
  });
});

describe('submitApplication', () => {
  it('submits as the effective account, with the route body minus the envelope', async () => {
    const propertyId = await seedRental();
    const result = await callTool('submitApplication', APPLICANT, applicationInput(propertyId));
    expect(result.isError).toBe(false);
    expect(Object.keys(result.structuredContent)).toEqual(['data']);
    const data = result.structuredContent.data as { id: string; status: string };
    expect(data.status).toBe('submitted');
    const [row] = await getDb()
      .select()
      .from(tenantApplications)
      .where(eq(tenantApplications.id, data.id));
    expect(row.applicantOxyUserId).toBe(APPLICANT);
    expect(row.landlordOxyUserId).toBe(LANDLORD);
  });

  it('stores a base64 document through the private upload, readable by the landlord', async () => {
    const propertyId = await seedRental();
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#ffffff' },
    })
      .png()
      .toBuffer();
    const result = await callTool(
      'submitApplication',
      APPLICANT,
      applicationInput(propertyId, {
        documents: [
          {
            type: 'income',
            filename: 'payslip.png',
            mimeType: 'image/png',
            contentBase64: png.toString('base64'),
          },
        ],
      }),
    );
    expect(result.isError).toBe(false);
    const id = (result.structuredContent.data as { id: string }).id;
    const [document] = await getDb()
      .select()
      .from(tenantApplicationDocuments)
      .where(eq(tenantApplicationDocuments.applicationId, id));
    expect(document.type).toBe('income');
    const read = await readApplicationDocument(LANDLORD, id, document.id);
    expect(read.base64.length).toBeGreaterThan(0);
    await expect(readApplicationDocument(STRANGER, id, document.id)).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('stores it in the applicant’s Oxy account when stage 4c is switched on', async () => {
    const propertyId = await seedRental();
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#000000' },
    })
      .png()
      .toBuffer();
    config.oxyFiles.privateDocumentsEnabled = true;
    try {
      const result = await callTool(
        'submitApplication',
        APPLICANT,
        applicationInput(propertyId, {
          documents: [
            {
              type: 'income',
              filename: 'payslip.png',
              mimeType: 'image/png',
              contentBase64: png.toString('base64'),
            },
          ],
        }),
      );
      expect(result.isError).toBe(false);
      const id = (result.structuredContent.data as { id: string }).id;
      const [document] = await getDb()
        .select()
        .from(tenantApplicationDocuments)
        .where(eq(tenantApplicationDocuments.applicationId, id));
      expect(document.url).toMatch(/^oxy:/);
      expect(fakeOxyFiles.files.get(document.url.slice(4))).toMatchObject({
        ownerUserId: APPLICANT,
        visibility: 'private',
      });
      const read = await readApplicationDocument(LANDLORD, id, document.id);
      expect(read.base64.length).toBeGreaterThan(0);
      await expect(readApplicationDocument(STRANGER, id, document.id)).rejects.toMatchObject({
        statusCode: 404,
      });
    } finally {
      config.oxyFiles.privateDocumentsEnabled = false;
    }
  });

  it('refuses a document type outside the allowlist before anything is stored', async () => {
    const propertyId = await seedRental();
    const result = await callTool(
      'submitApplication',
      APPLICANT,
      applicationInput(propertyId, {
        documents: [
          {
            type: 'id',
            filename: 'x.exe',
            mimeType: 'application/x-msdownload',
            contentBase64: 'QQ==',
          },
        ],
      }),
    );
    expect(result.error?.code).toBe('INVALID_FILE_TYPE');
    expect(await getDb().select().from(tenantApplications)).toHaveLength(0);
  });

  it('answers external_listing for an external listing and writes nothing', async () => {
    const { propertyId } = await seedListingWithGeo({
      countryCode: nextCountryCode(),
      overrides: {
        oxyUserId: LANDLORD,
        isExternal: true,
        source: 'idealista',
        sourceUrl: 'https://advertiser.test/listing/9',
      },
    });
    const result = await callTool('submitApplication', APPLICANT, applicationInput(propertyId));
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toEqual({
      status: 'external_listing',
      sourceUrl: 'https://advertiser.test/listing/9',
    });
    expect(await getDb().select().from(tenantApplications)).toHaveLength(0);
  });

  it('runs the route validation chain (leaseTermMonths must be positive)', async () => {
    const propertyId = await seedRental();
    const result = await callTool(
      'submitApplication',
      APPLICANT,
      applicationInput(propertyId, { leaseTermMonths: 0 }),
    );
    expect(result.error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('replays the stored receipt for the same key and refuses the key with new input', async () => {
    const propertyId = await seedRental();
    const first = await callTool('submitApplication', APPLICANT, applicationInput(propertyId), {
      idempotencyKey: 'apply-once-1',
      lane: 'capability',
    });
    const again = await callTool('submitApplication', APPLICANT, applicationInput(propertyId), {
      idempotencyKey: 'apply-once-1',
      lane: 'capability',
    });
    expect(again.isError).toBe(false);
    expect(again.structuredContent).toEqual(first.structuredContent);
    expect(await getDb().select().from(tenantApplications)).toHaveLength(1);

    const reused = await callTool(
      'submitApplication',
      APPLICANT,
      applicationInput(propertyId, { monthlyIncome: 1 }),
      { idempotencyKey: 'apply-once-1' },
    );
    expect(reused.error?.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });
});

describe('reading applications', () => {
  it('lists mine as applicant and, with asLandlord, the ones sent to me', async () => {
    const id = await submit(await seedRental());
    const mine = await callTool('listMyApplications', APPLICANT);
    expect((mine.structuredContent.data as { id: string }[]).map((a) => a.id)).toEqual([id]);
    expect(mine.structuredContent.pagination).toMatchObject({ total: 1, page: 1 });

    const asLandlord = await callTool('listMyApplications', LANDLORD, { asLandlord: true });
    expect((asLandlord.structuredContent.data as { id: string }[]).map((a) => a.id)).toEqual([id]);
    const strangers = await callTool('listMyApplications', STRANGER, { asLandlord: true });
    expect(strangers.structuredContent.data).toEqual([]);
  });

  it('refuses a stranger with the route’s 403', async () => {
    const id = await submit(await seedRental());
    expect((await callTool('getApplication', LANDLORD, { applicationId: id })).isError).toBe(false);
    const refused = await callTool('getApplication', STRANGER, { applicationId: id });
    expect(refused.error).toMatchObject({ code: 'FORBIDDEN', status: 403 });
  });
});

describe('deciding', () => {
  it('lets the landlord accept and refuses the applicant the same move', async () => {
    const id = await submit(await seedRental());
    const byApplicant = await callTool('acceptApplication', APPLICANT, { applicationId: id });
    expect(byApplicant.error?.status).toBe(403);
    const byStranger = await callTool('acceptApplication', STRANGER, { applicationId: id });
    expect(byStranger.error?.status).toBe(403);

    const accepted = await callTool('acceptApplication', LANDLORD, { applicationId: id });
    expect((accepted.structuredContent.data as { status: string }).status).toBe('approved');
  });

  it('lets the applicant withdraw and the landlord review then reject', async () => {
    const withdrawnId = await submit(await seedRental());
    const withdrawn = await callTool('withdrawApplication', APPLICANT, {
      applicationId: withdrawnId,
    });
    expect((withdrawn.structuredContent.data as { status: string }).status).toBe('withdrawn');
    expect(
      (await callTool('withdrawApplication', LANDLORD, { applicationId: withdrawnId })).error
        ?.status,
    ).toBe(403);

    const id = await submit(await seedRental());
    const reviewing = await callTool('startReviewingApplication', LANDLORD, { applicationId: id });
    expect((reviewing.structuredContent.data as { status: string }).status).toBe('reviewing');
    const rejected = await callTool('rejectApplication', LANDLORD, {
      applicationId: id,
      notes: 'Income too low',
    });
    expect((rejected.structuredContent.data as { status: string }).status).toBe('rejected');
  });

  it('verifies a document only for its landlord; anybody else gets not-found', async () => {
    const propertyId = await seedRental();
    const result = await callTool(
      'submitApplication',
      APPLICANT,
      applicationInput(propertyId, {
        documents: [
          {
            type: 'id',
            filename: 'id.png',
            mimeType: 'image/png',
            contentBase64: (
              await sharp({ create: { width: 2, height: 2, channels: 3, background: '#000' } })
                .png()
                .toBuffer()
            ).toString('base64'),
          },
        ],
      }),
    );
    const id = (result.structuredContent.data as { id: string }).id;
    const [document] = await getDb()
      .select()
      .from(tenantApplicationDocuments)
      .where(eq(tenantApplicationDocuments.applicationId, id));

    for (const who of [STRANGER, APPLICANT]) {
      const refused = await callTool('verifyApplicationDocument', who, {
        applicationId: id,
        documentId: document.id,
        status: 'verified',
      });
      expect(refused.error).toMatchObject({ code: 'NOT_FOUND', status: 404 });
    }
    const noReason = await callTool('verifyApplicationDocument', LANDLORD, {
      applicationId: id,
      documentId: document.id,
      status: 'rejected',
    });
    expect(noReason.error?.code).toBe('VALIDATION_ERROR');
    const verified = await callTool('verifyApplicationDocument', LANDLORD, {
      applicationId: id,
      documentId: document.id,
      status: 'verified',
    });
    expect(verified.isError).toBe(false);
  });
});

describe('createLeaseFromApplication', () => {
  it('creates a draft lease only from an approved application, as its landlord', async () => {
    const id = await submit(await seedRental());
    const early = await callTool('createLeaseFromApplication', LANDLORD, { applicationId: id });
    expect(early.error?.code).toBe('INVALID_STATE');

    await callTool('acceptApplication', LANDLORD, { applicationId: id });
    expect(
      (await callTool('createLeaseFromApplication', APPLICANT, { applicationId: id })).error
        ?.status,
    ).toBe(403);

    const created = await callTool('createLeaseFromApplication', LANDLORD, { applicationId: id });
    expect(created.isError).toBe(false);
    const lease = created.structuredContent.data as { id: string; status: string };
    expect(lease.status).toBe('draft');
    const [row] = await getDb().select().from(leases).where(eq(leases.id, lease.id));
    expect(row.landlordOxyUserId).toBe(LANDLORD);
    expect(row.tenantOxyUserId).toBe(APPLICANT);
    expect(row.rentDetailsMonthlyRent).toBe(1200);
  });
});
