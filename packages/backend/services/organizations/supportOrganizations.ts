import type { Organization } from '@oxy.so/contracts';
import { oxyService } from '../oxy';
import { resolveOrganizationSelection } from './directory';
import {
  findOrCreateSupportOrganizationReference,
  listSupportOrganizationReferences,
  type EvictionOrganizationRow,
} from '../../db/evictions/evictionRepository';

/** The same Oxy account may have a housing agency role and an independent organizing-collective role. */
export async function resolveSupportOrganization(accountId: string) {
  const canonicalId = await resolveOrganizationSelection(accountId);
  if (!canonicalId) return undefined;
  const reference = await findOrCreateSupportOrganizationReference(canonicalId);
  return (await listOrganizationsByIds([reference.id])).get(reference.id);
}
export async function listOrganizationsByIds(
  ids: readonly string[],
): Promise<ReadonlyMap<string, EvictionOrganizationRow & { name: string; oxyAccountId: string }>> {
  const unique = [...new Set(ids)];
  const rows: EvictionOrganizationRow[] = [];
  for (let offset = 0; offset < unique.length; offset += 100)
    rows.push(...(await listSupportOrganizationReferences(unique.slice(offset, offset + 100))));
  const accounts = [
    ...new Set(
      rows.flatMap((row) =>
        row.identityStatus === 'linked' && row.oxyAccountId ? [row.oxyAccountId] : [],
      ),
    ),
  ];
  const companies = new Map<string, Organization>();
  for (let offset = 0; offset < accounts.length; offset += 100) {
    const result = await oxyService.organizations.batch({
      ids: accounts.slice(offset, offset + 100),
    });
    for (const item of result.items) companies.set(item.requestedAccountId, item.organization);
  }
  const output = new Map<
    string,
    EvictionOrganizationRow & { name: string; oxyAccountId: string }
  >();
  for (const row of rows) {
    const identity = row.oxyAccountId ? companies.get(row.oxyAccountId) : undefined;
    if (identity && identity.status !== 'suppressed')
      output.set(row.id, { ...row, name: identity.name, oxyAccountId: identity.accountId });
  }
  return output;
}
