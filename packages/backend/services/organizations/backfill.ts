import { createHash } from 'node:crypto';
import type { OxyServer } from '@oxy.so/core/server';

/** Audited parsers derive agency kind from an explicit advertiser category, not presence of a name. */
const DECLARED_AGENCY_PROVIDERS = new Set([
  'fotocasa',
  'otodom',
  'kleinanzeigen',
  'bienici',
  'immowelt',
  'storia',
]);
export interface AgencySourceEvidence {
  source: string;
  kind: string | null;
  count: number;
  examplePropertyId: string;
  exampleSourceUrl: string | null;
}
export interface AgencyMigrationRecord {
  id: string;
  oxyAccountId: string | null;
  identityStatus: 'unresolved' | 'linked' | 'not_organization';
  observedName: string;
  evidence: AgencySourceEvidence[];
}
export interface ReviewedAgencyMapping {
  agencyId: string;
  accountId: string;
  evidenceReference: string;
}

export function classifyAgency(record: AgencyMigrationRecord) {
  if (record.oxyAccountId)
    return { action: 'linked' as const, reason: 'Existing canonical reference' };
  if (
    record.evidence.length &&
    record.evidence.every((source) => source.source === 'openrent') &&
    record.observedName === 'OpenRent landlord'
  ) {
    return {
      action: 'not_organization' as const,
      reason: 'Provider generic landlord label; not a company',
    };
  }
  if (
    record.evidence.length &&
    record.evidence.every(
      (source) =>
        source.kind === 'agency' &&
        DECLARED_AGENCY_PROVIDERS.has(source.source) &&
        source.exampleSourceUrl,
    )
  ) {
    return {
      action: 'import' as const,
      reason: 'Consistent source-declared commercial advertiser category from audited parsers',
    };
  }
  return {
    action: 'unresolved' as const,
    reason: 'Missing, ambiguous, mixed or unaudited source identity evidence',
  };
}

export function planAgencyBackfill(
  records: AgencyMigrationRecord[],
  reviewedMappings: ReviewedAgencyMapping[] = [],
  role: 'housing_agency' | 'housing_support' = 'housing_agency',
) {
  const decisions = records
    .map((record) => ({
      ...record,
      decision:
        role === 'housing_agency'
          ? classifyAgency(record)
          : {
              action: record.oxyAccountId ? ('linked' as const) : ('unresolved' as const),
              reason: 'Support collectives require a reviewed canonical selection',
            },
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const mappings = [...reviewedMappings].sort((a, b) => a.agencyId.localeCompare(b.agencyId));
  const sha256 = createHash('sha256')
    .update(JSON.stringify({ role, decisions, reviewedMappings: mappings }))
    .digest('hex');
  return { sha256, role, decisions, reviewedMappings: mappings };
}

/** Each remote batch is atomic/idempotent; checkpoint local mappings after every successful batch. */
export async function applyAgencyBackfill(input: {
  records: AgencyMigrationRecord[];
  role?: 'housing_agency' | 'housing_support';
  reviewedMappings: ReviewedAgencyMapping[];
  expectedPlanSha256: string;
  directory: Pick<OxyServer['organizations'], 'importBatch'>;
  reviewedDirectory?: Pick<OxyServer['organizations'], 'importExternal'>;
  save: (
    items: {
      agencyId: string;
      accountId: string | null;
      status: AgencyMigrationRecord['identityStatus'];
    }[],
  ) => Promise<void>;
}) {
  const plan = planAgencyBackfill(input.records, input.reviewedMappings, input.role);
  if (plan.sha256 !== input.expectedPlanSha256)
    throw new Error('Agency migration plan changed; review a fresh dry-run');
  const reviewedIds = new Set<string>();
  for (const mapping of input.reviewedMappings) {
    const record = input.records.find((row) => row.id === mapping.agencyId);
    if (!record || !mapping.evidenceReference.trim() || reviewedIds.has(mapping.agencyId))
      throw new Error('Invalid or duplicate reviewed agency mapping');
    if (record.oxyAccountId && record.oxyAccountId !== mapping.accountId)
      throw new Error('Reviewed mapping conflicts with canonical reference');
    reviewedIds.add(mapping.agencyId);
  }
  if (reviewedIds.size && !input.reviewedDirectory)
    throw new Error('Reviewed links require an authorized staff SDK session');
  const eligible = plan.decisions.filter(
    (record) => record.decision.action === 'import' && !reviewedIds.has(record.id),
  );
  for (let offset = 0; offset < eligible.length; offset += 100) {
    const chunk = eligible.slice(offset, offset + 100);
    const imported = await input.directory.importBatch({
      namespace: 'homiio',
      items: chunk.map((record) => ({
        externalId: `legacy:${record.id}`,
        organization: { name: record.observedName, organizationType: 'business' },
        evidenceReference: `homiio:agency_identity_archives:${record.id}:property:${record.evidence[0].examplePropertyId}`,
      })),
    });
    const byKey = new Map(imported.items.map((item) => [item.externalId, item.accountId]));
    const mappings = chunk.map((record) => {
      const accountId = byKey.get(`legacy:${record.id}`);
      if (!accountId) throw new Error(`Missing canonical mapping for agency ${record.id}`);
      return { agencyId: record.id, accountId, status: 'linked' as const };
    });
    await input.save(mappings);
  }
  for (const mapping of input.reviewedMappings) {
    const record = input.records.find((row) => row.id === mapping.agencyId);
    if (!record || !input.reviewedDirectory) throw new Error('Missing reviewed agency');
    const linked = await input.reviewedDirectory.importExternal({
      namespace: 'homiio',
      externalId: `${input.role === 'housing_support' ? 'support' : 'legacy'}:${mapping.agencyId}`,
      accountId: mapping.accountId,
      organization: {
        name: record.observedName,
        organizationType: input.role === 'housing_support' ? 'community' : 'business',
      },
      evidenceReference: mapping.evidenceReference,
    });
    await input.save([
      { agencyId: mapping.agencyId, accountId: linked.accountId, status: 'linked' },
    ]);
  }
  const noncompanies = plan.decisions.filter(
    (record) => record.decision.action === 'not_organization' && !reviewedIds.has(record.id),
  );
  for (let offset = 0; offset < noncompanies.length; offset += 100)
    await input.save(
      noncompanies
        .slice(offset, offset + 100)
        .map((record) => ({ agencyId: record.id, accountId: null, status: 'not_organization' })),
    );
  return {
    imported: eligible.length,
    reviewed: reviewedIds.size,
    noncompanies: noncompanies.length,
    unresolved: plan.decisions.filter(
      (record) => record.decision.action === 'unresolved' && !reviewedIds.has(record.id),
    ).length,
  };
}
