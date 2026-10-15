import {
  applyAgencyBackfill,
  classifyAgency,
  planAgencyBackfill,
  type AgencyMigrationRecord,
} from '../../../services/organizations/backfill';

const record = (
  id: string,
  source = 'otodom',
  kind: string | null = 'agency',
): AgencyMigrationRecord => ({
  id,
  observedName: 'Same displayed company',
  oxyAccountId: null,
  identityStatus: 'unresolved',
  evidence: [
    {
      source,
      kind,
      count: 1,
      examplePropertyId: `property-${id}`,
      exampleSourceUrl: `https://source.example/${id}`,
    },
  ],
});

describe('agency source classification', () => {
  it('requires an audited actual advertiser category and keeps missing/mixed evidence unresolved', () => {
    expect(classifyAgency(record('a')).action).toBe('import');
    expect(classifyAgency(record('a', 'rightmove')).action).toBe('unresolved');
    expect(classifyAgency(record('a', 'otodom', null)).action).toBe('unresolved');
    expect(classifyAgency({ ...record('a'), evidence: [] }).action).toBe('unresolved');
    expect(
      classifyAgency({
        ...record('a'),
        evidence: [...record('a').evidence, ...record('b', 'otodom', 'private').evidence],
      }).action,
    ).toBe('unresolved');
    expect(
      classifyAgency({ ...record('a', 'openrent', 'private'), observedName: 'OpenRent landlord' })
        .action,
    ).toBe('not_organization');
  });
  it('batches100, keeps equal names separate and checkpoints each completed batch', async () => {
    const records = Array.from({ length: 205 }, (_, i) => record(String(i).padStart(3, '0')));
    const importBatch = jest.fn(async ({ items }: { items: { externalId: string }[] }) => ({
      items: items.map((item) => ({ ...item, accountId: `oxy-${item.externalId}`, created: true })),
    }));
    const save = jest.fn(async () => undefined);
    const result = await applyAgencyBackfill({
      records,
      reviewedMappings: [],
      expectedPlanSha256: planAgencyBackfill(records).sha256,
      directory: { importBatch },
      save,
    });
    expect(importBatch.mock.calls.map(([input]) => input.items.length)).toEqual([100, 100, 5]);
    expect(save).toHaveBeenCalledTimes(3);
    expect(result.imported).toBe(205);
    expect(
      new Set(
        importBatch.mock.calls.flatMap(([input]) => input.items.map((item) => item.externalId)),
      ).size,
    ).toBe(205);
  });
  it('refuses a changed plan before network or local writes', async () => {
    const importBatch = jest.fn();
    const save = jest.fn();
    await expect(
      applyAgencyBackfill({
        records: [record('a')],
        reviewedMappings: [],
        expectedPlanSha256: 'stale',
        directory: { importBatch },
        save,
      }),
    ).rejects.toThrow('plan changed');
    expect(importBatch).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
  it('can retry remote success after a failed checkpoint without creating a second source identity', async () => {
    const records = [record('a')];
    const mapped = new Map<string, string>();
    const importBatch = jest.fn(async ({ items }: { items: { externalId: string }[] }) => ({
      items: items.map((item) => {
        const created = !mapped.has(item.externalId);
        mapped.set(item.externalId, `oxy-${item.externalId}`);
        return { externalId: item.externalId, accountId: `oxy-${item.externalId}`, created };
      }),
    }));
    const save = jest
      .fn()
      .mockRejectedValueOnce(new Error('checkpoint'))
      .mockResolvedValue(undefined);
    const input = {
      records,
      reviewedMappings: [],
      expectedPlanSha256: planAgencyBackfill(records).sha256,
      directory: { importBatch },
      save,
    };
    await expect(applyAgencyBackfill(input)).rejects.toThrow('checkpoint');
    await expect(applyAgencyBackfill(input)).resolves.toMatchObject({ imported: 1 });
    expect(mapped.size).toBe(1);
  });
});

it('keeps support collectives unresolved until an evidence-backed staff link without claiming the account', async () => {
  const records = [{ ...record('collective'), evidence: [] }];
  const reviewedMappings = [
    {
      agencyId: 'collective',
      accountId: 'canonical-community',
      evidenceReference: 'review:public-source:1',
    },
  ];
  const importBatch = jest.fn();
  const importExternal = jest
    .fn()
    .mockResolvedValue({ accountId: 'canonical-community', created: false });
  const save = jest.fn();
  expect(planAgencyBackfill(records, [], 'housing_support').decisions[0].decision.action).toBe(
    'unresolved',
  );
  await applyAgencyBackfill({
    records,
    reviewedMappings,
    role: 'housing_support',
    expectedPlanSha256: planAgencyBackfill(records, reviewedMappings, 'housing_support').sha256,
    directory: { importBatch },
    reviewedDirectory: { importExternal },
    save,
  });
  expect(importBatch).not.toHaveBeenCalled();
  expect(importExternal).toHaveBeenCalledWith({
    namespace: 'homiio',
    externalId: 'support:collective',
    accountId: 'canonical-community',
    organization: { name: 'Same displayed company', organizationType: 'community' },
    evidenceReference: 'review:public-source:1',
  });
  expect(save).toHaveBeenCalledWith([
    { agencyId: 'collective', accountId: 'canonical-community', status: 'linked' },
  ]);
});
