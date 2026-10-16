import { applyAgencyBackfill, planAgencyBackfill } from '../../services/organizations/backfill';
import { resolveListingAgency } from '../../services/organizations/ingestion';
import { uuidv7 } from '@oxy.so/db';
import { inArray } from 'drizzle-orm';
import { connectPostgres, closePostgres, getDb } from '../../db/postgres';
import { findOrCreateSupportOrganizationReference } from '../../db/evictions/evictionRepository';
import { listOrganizationsByIds } from '../../services/organizations/supportOrganizations';
import { agencies, evictionOrganizations } from '../../db/schema';
import { oxyService } from '../../services/oxy';
import { getAgencySummaries } from '../../services/organizations/directory';
import { registerCompany } from '../helpers/organizationDirectory';

const ids = Array.from({ length: 202 }, () => uuidv7());
beforeAll(async () => {
  await connectPostgres();
});
afterAll(async () => {
  await getDb().delete(agencies).where(inArray(agencies.id, ids));
  await closePostgres();
});
afterEach(() => jest.restoreAllMocks());
it('hydrates globally deduplicated companies in bounded batches and withholds unresolved observations', async () => {
  const companies = Array.from({ length: 201 }, (_, i) => registerCompany(`Agency ${i}`));
  await getDb()
    .insert(agencies)
    .values(
      ids.map((id, i) => ({
        id,
        slug: id,
        oxyAccountId: i === 201 ? companies[0].accountId : companies[i].accountId,
        identityStatus: 'linked' as const,
      })),
    );
  const batch = jest.spyOn(oxyService.organizations, 'batch');
  const result = await getAgencySummaries([...ids, ids[0]]);
  expect(result.size).toBe(202);
  expect(batch.mock.calls.map(([input]) => input.ids.length)).toEqual([100, 100, 1]);
  await getDb()
    .update(agencies)
    .set({ oxyAccountId: null, identityStatus: 'unresolved' })
    .where(inArray(agencies.id, [ids[0]]));
  expect((await getAgencySummaries([ids[0]])).size).toBe(0);
});
it('resolves canonical redirects, suppresses missing/hidden identities and propagates outages', async () => {
  const company = registerCompany('Renamed centrally');
  const [row] = await getDb()
    .select()
    .from(agencies)
    .where(inArray(agencies.id, [ids[1]]));
  if (!row?.oxyAccountId) throw new Error('Missing test reference');
  const batch = jest.spyOn(oxyService.organizations, 'batch').mockResolvedValue({
    items: [{ requestedAccountId: row.oxyAccountId, organization: company }],
    missingIds: [],
  });
  expect((await getAgencySummaries([row.id])).get(row.id)).toMatchObject({
    name: 'Renamed centrally',
    oxyAccountId: company.accountId,
  });
  batch.mockResolvedValueOnce({
    items: [
      { requestedAccountId: row.oxyAccountId, organization: { ...company, status: 'suppressed' } },
    ],
    missingIds: [],
  });
  expect((await getAgencySummaries([row.id])).size).toBe(0);
  batch.mockResolvedValueOnce({ items: [], missingIds: [row.oxyAccountId] });
  expect((await getAgencySummaries([row.id])).size).toBe(0);
  batch.mockRejectedValueOnce(new Error('directory unavailable'));
  await expect(getAgencySummaries([row.id])).rejects.toThrow('unavailable');
});

it('keeps housing agency and support roles distinct while sharing the same canonical identity', async () => {
  const company = registerCompany('Shared canonical organization');
  const support = await findOrCreateSupportOrganizationReference(company.accountId);
  try {
    const result = await listOrganizationsByIds([support.id, support.id]);
    expect(result.get(support.id)).toMatchObject({
      id: support.id,
      oxyAccountId: company.accountId,
      name: company.name,
      verifiedAt: null,
    });
    await getDb()
      .update(evictionOrganizations)
      .set({ oxyAccountId: null, identityStatus: 'unresolved' })
      .where(inArray(evictionOrganizations.id, [support.id]));
    expect((await listOrganizationsByIds([support.id])).size).toBe(0);
  } finally {
    await getDb()
      .delete(evictionOrganizations)
      .where(inArray(evictionOrganizations.id, [support.id]));
  }
});

it('backfill and refresh reuse the same source mapping and historical agency reference', async () => {
  const company = registerCompany('Stable advertiser');
  const agencyId = uuidv7();
  await getDb()
    .insert(agencies)
    .values({ id: agencyId, slug: agencyId, identityStatus: 'unresolved' });
  const record = {
    id: agencyId,
    observedName: 'Former source label',
    oxyAccountId: null,
    identityStatus: 'unresolved' as const,
    evidence: [
      {
        source: 'fotocasa',
        kind: 'agency',
        count: 1,
        agencySourceId: 'company-42',
        propertyIds: ['property-42'],
        examplePropertyId: 'property-42',
        exampleSourceUrl: 'https://source.example/property-42',
      },
    ],
  };
  const keys = new Set<string>();
  const batch = jest
    .spyOn(oxyService.organizations, 'importBatch')
    .mockImplementation(async ({ items }) => ({
      items: items.map((item) => {
        const created = !keys.has(item.externalId);
        keys.add(item.externalId);
        return { externalId: item.externalId, accountId: company.accountId, created };
      }),
    }));
  try {
    await applyAgencyBackfill({
      records: [record],
      reviewedMappings: [],
      expectedPlanSha256: planAgencyBackfill([record]).sha256,
      directory: oxyService.organizations,
      save: async (items) => {
        for (const item of items)
          await getDb()
            .update(agencies)
            .set({ oxyAccountId: item.accountId, identityStatus: item.status })
            .where(inArray(agencies.id, [item.agencyId]));
      },
    });
    const linked = await resolveListingAgency({
      source: 'fotocasa',
      sourceId: 'property-42',
      sourceUrl: 'https://source.example/property-42',
      contact: { kind: 'agency', agencyName: 'Renamed source label', agencySourceId: 'company-42' },
    } as import('@homiio/shared-types').NormalizedListing);
    expect(linked).toBe(agencyId);
    expect([...keys]).toEqual(['provider:fotocasa:company-42']);
    expect(batch).toHaveBeenCalledTimes(2);
  } finally {
    await getDb()
      .delete(agencies)
      .where(inArray(agencies.id, [agencyId]));
  }
});

it('leaves a mixed legacy name group unresolved when a listing refresh identifies one advertiser', async () => {
  const legacyId = uuidv7();
  await getDb()
    .insert(agencies)
    .values({ id: legacyId, slug: legacyId, identityStatus: 'unresolved' });
  const record = {
    id: legacyId,
    observedName: 'Same normalized label',
    oxyAccountId: null,
    identityStatus: 'unresolved' as const,
    evidence: ['one', 'two'].map((id) => ({
      source: 'fotocasa',
      kind: 'agency',
      count: 1,
      agencySourceId: id,
      propertyIds: [id],
      examplePropertyId: id,
      exampleSourceUrl: `https://source.example/${id}`,
    })),
  };
  const company = registerCompany('One real advertiser');
  const batch = jest.spyOn(oxyService.organizations, 'importBatch').mockResolvedValue({
    items: [{ externalId: 'provider:fotocasa:one', accountId: company.accountId, created: true }],
  });
  const save = jest.fn();
  let refreshedId: string | undefined;
  try {
    await applyAgencyBackfill({
      records: [record],
      reviewedMappings: [],
      expectedPlanSha256: planAgencyBackfill([record]).sha256,
      directory: oxyService.organizations,
      save,
    });
    expect(batch).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    refreshedId = await resolveListingAgency({
      source: 'fotocasa',
      sourceId: 'one',
      sourceUrl: 'https://source.example/one',
      contact: { kind: 'agency', agencyName: record.observedName, agencySourceId: 'one' },
    } as import('@homiio/shared-types').NormalizedListing);
    expect(refreshedId).not.toBe(legacyId);
    const [legacy] = await getDb()
      .select()
      .from(agencies)
      .where(inArray(agencies.id, [legacyId]));
    expect(legacy).toMatchObject({ oxyAccountId: null, identityStatus: 'unresolved' });
  } finally {
    await getDb()
      .delete(agencies)
      .where(inArray(agencies.id, [legacyId, ...(refreshedId ? [refreshedId] : [])]));
  }
});
