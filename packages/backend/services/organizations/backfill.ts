import { agencySourceKey } from './sourceIdentity';
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
  agencySourceId: string | null;
  propertyIds: string[];
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
  /** Mandatory for agency mappings: every historical property must be covered by this reviewed source identity. */
  sourceIdentity?: { source: string; agencySourceId: string; propertyIds: string[] };
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
        source.exampleSourceUrl &&
        source.agencySourceId?.trim(),
    )
  ) {
    const keys = new Set(
      record.evidence.map((source) => {
        if (!source.agencySourceId) throw new Error('Stable source identity required');
        return agencySourceKey(source.source, source.agencySourceId);
      }),
    );
    if (keys.size === 1)
      return {
        action: 'import' as const,
        externalId: [...keys][0],
        reason: 'Every referenced listing proves the same stable provider advertiser identity',
      };
  }
  return {
    action: 'unresolved' as const,
    reason:
      'Missing stable advertiser ID, ambiguous or mixed source identity evidence; category/name alone cannot identify a company',
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
  const reviewedSources = new Map<string, string>();
  for (const mapping of input.reviewedMappings) {
    const record = input.records.find((row) => row.id === mapping.agencyId);
    if (!record || !mapping.evidenceReference.trim() || reviewedIds.has(mapping.agencyId))
      throw new Error('Invalid or duplicate reviewed agency mapping');
    if (record.oxyAccountId && record.oxyAccountId !== mapping.accountId)
      throw new Error('Reviewed mapping conflicts with canonical reference');
    if (input.role !== 'housing_support') {
      const source = mapping.sourceIdentity;
      const referencedIds = record.evidence.flatMap((entry) => entry.propertyIds).sort();
      const reviewedPropertyIds = source ? [...new Set(source.propertyIds)].sort() : [];
      if (
        !source?.agencySourceId.trim() ||
        !referencedIds.length ||
        JSON.stringify(referencedIds) !== JSON.stringify(reviewedPropertyIds) ||
        record.evidence.some(
          (entry) =>
            entry.source !== source.source ||
            (entry.agencySourceId && entry.agencySourceId.trim() !== source.agencySourceId.trim()),
        )
      ) {
        throw new Error(
          'Reviewed agency mapping must prove one source identity for every historical property; mixed groups remain unresolved',
        );
      }
    }
    if (mapping.sourceIdentity) {
      const key = agencySourceKey(
        mapping.sourceIdentity.source,
        mapping.sourceIdentity.agencySourceId,
      );
      if (reviewedSources.has(key) && reviewedSources.get(key) !== mapping.accountId)
        throw new Error('Conflicting reviewed source mappings');
      reviewedSources.set(key, mapping.accountId);
    }
    reviewedIds.add(mapping.agencyId);
  }
  if (reviewedIds.size && !input.reviewedDirectory)
    throw new Error('Reviewed links require an authorized staff SDK session');
  for (const mapping of input.reviewedMappings) {
    const record = input.records.find((row) => row.id === mapping.agencyId);
    if (!record || !input.reviewedDirectory) throw new Error('Missing reviewed agency');
    const source = mapping.sourceIdentity;
    if (input.role !== 'housing_support' && !source)
      throw new Error('Reviewed source identity required');
    const linked = await input.reviewedDirectory.importExternal({
      namespace: 'homiio',
      externalId:
        source && input.role !== 'housing_support'
          ? agencySourceKey(source.source, source.agencySourceId)
          : `support:${mapping.agencyId}`,
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
  const eligible = plan.decisions.filter(
    (record) => record.decision.action === 'import' && !reviewedIds.has(record.id),
  );
  const groups = new Map<string, typeof eligible>();
  for (const record of eligible) {
    if (record.decision.action !== 'import') throw new Error('Missing stable source identity');
    groups.set(record.decision.externalId, [
      ...(groups.get(record.decision.externalId) ?? []),
      record,
    ]);
  }
  const entries = [...groups.entries()];
  for (let offset = 0; offset < entries.length; offset += 100) {
    const chunk = entries.slice(offset, offset + 100);
    const imported = await input.directory.importBatch({
      namespace: 'homiio',
      items: chunk.map(([externalId, records]) => ({
        externalId,
        organization: { name: records[0].observedName, organizationType: 'business' },
        evidenceReference: `homiio:agency_identity_archives:${records[0].id}:property:${records[0].evidence[0].examplePropertyId}`,
      })),
    });
    const byKey = new Map(imported.items.map((item) => [item.externalId, item.accountId]));
    await input.save(
      chunk.flatMap(([key, records]) => {
        const accountId = byKey.get(key);
        if (!accountId) throw new Error(`Missing canonical mapping for source ${key}`);
        return records.map((record) => ({
          agencyId: record.id,
          accountId,
          status: 'linked' as const,
        }));
      }),
    );
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
