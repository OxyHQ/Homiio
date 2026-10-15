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
