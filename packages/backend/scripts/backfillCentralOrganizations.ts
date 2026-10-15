/** Dry-run first; source-bound imports and resumable per-batch checkpoints. Never matches company names. */
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { OxyServer } from '@oxy.so/core/server';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { connectPostgres, closePostgres } from '../db/postgres';
import {
  agencies,
  agencyIdentityArchives,
  properties,
  evictionOrganizations,
  evictionOrganizationIdentityArchives,
} from '../db/schema';
import { oxyService } from '../services/oxy';
import {
  applyAgencyBackfill,
  planAgencyBackfill,
  type AgencySourceEvidence,
} from '../services/organizations/backfill';

async function main() {
  const { values } = parseArgs({
    options: {
      'target-database': { type: 'string' },
      'plan-sha256': { type: 'string' },
      'plan-output': { type: 'string' },
      'reviewed-mappings': { type: 'string' },
      role: { type: 'string', default: 'housing_agency' },
      apply: { type: 'boolean', default: false },
    },
  });
  const role = z.enum(['housing_agency', 'housing_support']).parse(values.role);
  const configuredUrl = process.env.DATABASE_URL;
  if (
    !configuredUrl ||
    !values['target-database'] ||
    decodeURIComponent(new URL(configuredUrl).pathname.slice(1)) !== values['target-database']
  )
    throw new Error('DATABASE_URL must match explicit --target-database');
  const reviewedMappings = values['reviewed-mappings']
    ? z
        .array(
          z
            .object({
              agencyId: z.string().min(1),
              accountId: z.string().min(1),
              evidenceReference: z.string().trim().min(1),
              sourceIdentity: z
                .object({
                  source: z.string().min(1),
                  agencySourceId: z.string().trim().min(1),
                  propertyIds: z.array(z.string().min(1)).min(1),
                })
                .strict()
                .optional(),
            })
            .strict(),
        )
        .parse(JSON.parse(await readFile(values['reviewed-mappings'], 'utf8')))
    : [];
  const db = await connectPostgres();
  try {
    const records = await db.transaction(async (tx) => {
      await tx.execute(sql`set transaction isolation level repeatable read read only`);
      const [connected] = await tx.execute<{ name: string }>(
        sql`select current_database() as name`,
      );
      if (connected?.name !== values['target-database']) throw new Error('Unexpected database');
      if (role === 'housing_support')
        return (
          await tx
            .select({
              id: evictionOrganizations.id,
              oxyAccountId: evictionOrganizations.oxyAccountId,
              identityStatus: evictionOrganizations.identityStatus,
              observedName: evictionOrganizationIdentityArchives.observedName,
            })
            .from(evictionOrganizations)
            .innerJoin(
              evictionOrganizationIdentityArchives,
              eq(evictionOrganizations.id, evictionOrganizationIdentityArchives.organizationId),
            )
            .orderBy(evictionOrganizations.id)
        ).map((row) => ({ ...row, evidence: [] as AgencySourceEvidence[] }));
      const references = await tx
        .select({
          id: agencies.id,
          oxyAccountId: agencies.oxyAccountId,
          identityStatus: agencies.identityStatus,
          observedName: agencyIdentityArchives.observedName,
        })
        .from(agencies)
        .innerJoin(agencyIdentityArchives, eq(agencies.id, agencyIdentityArchives.agencyId))
        .orderBy(agencies.id);
      const evidence = await tx
        .select({
          agencyId: properties.agencyId,
          source: properties.source,
          kind: properties.externalContactKind,
          count: sql<number>`count(*)::int`,
          agencySourceId: properties.externalContactAgencySourceId,
          propertyIds: sql<string[]>`array_agg(${properties.id} order by ${properties.id})`,
          examplePropertyId: sql<string>`min(${properties.id})`,
          exampleSourceUrl: sql<string | null>`min(${properties.sourceUrl})`,
        })
        .from(properties)
        .where(sql`${properties.agencyId} is not null`)
        .groupBy(
          properties.agencyId,
          properties.source,
          properties.externalContactKind,
          properties.externalContactAgencySourceId,
        )
        .orderBy(
          properties.agencyId,
          properties.source,
          properties.externalContactKind,
          properties.externalContactAgencySourceId,
        );
      const byAgency = new Map<string, AgencySourceEvidence[]>();
      for (const row of evidence)
        if (row.agencyId) byAgency.set(row.agencyId, [...(byAgency.get(row.agencyId) ?? []), row]);
      return references.map((row) => ({ ...row, evidence: byAgency.get(row.id) ?? [] }));
    });
    const plan = planAgencyBackfill(records, reviewedMappings, role);
    if (values['plan-output'])
      await writeFile(
        values['plan-output'],
        JSON.stringify({ database: values['target-database'], ...plan }, null, 2),
        { mode: 0o600, flag: 'wx' },
      );
    console.log(
      JSON.stringify({
        mode: values.apply ? 'apply' : 'dry-run',
        database: values['target-database'],
        sha256: plan.sha256,
        total: records.length,
        counts: plan.decisions.reduce<Record<string, number>>((counts, row) => {
          counts[row.decision.action] = (counts[row.decision.action] ?? 0) + 1;
          return counts;
        }, {}),
        reviewed: reviewedMappings.length,
      }),
    );
    if (!values.apply) return;
    if (!values['plan-sha256']) throw new Error('Apply requires the reviewed --plan-sha256');
    const staff = process.env.OXY_ADMIN_ACCESS_TOKEN
      ? new OxyServer({ baseURL: process.env.OXY_API_URL || 'https://api.oxy.so' })
      : undefined;
    if (staff && process.env.OXY_ADMIN_ACCESS_TOKEN)
      staff.http.setTokens(process.env.OXY_ADMIN_ACCESS_TOKEN);
    const outcome = await applyAgencyBackfill({
      records,
      role,
      reviewedMappings,
      expectedPlanSha256: values['plan-sha256'],
      directory: oxyService.organizations,
      reviewedDirectory: staff?.organizations,
      save: async (items) =>
        db.transaction(async (tx) => {
          for (const item of items) {
            const table = role === 'housing_support' ? evictionOrganizations : agencies;
            const [updated] = await tx
              .update(table)
              .set({ oxyAccountId: item.accountId, identityStatus: item.status })
              .where(
                and(
                  eq(table.id, item.agencyId),
                  item.accountId
                    ? or(isNull(table.oxyAccountId), eq(table.oxyAccountId, item.accountId))
                    : isNull(table.oxyAccountId),
                ),
              )
              .returning({ id: table.id });
            if (!updated)
              throw new Error(`Agency mapping changed for ${item.agencyId}; batch rolled back`);
          }
        }),
    });
    console.log(JSON.stringify({ database: values['target-database'], ...outcome }));
  } finally {
    await closePostgres();
  }
}
void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Agency migration failed');
  process.exitCode = 1;
});
