/** Oxy is the only source of organization identity. Agency rows represent housing references. */
import type { Organization } from '@oxy.so/contracts';
import type { AgencySummary } from '@homiio/shared-types';
import { AppError } from '../../middlewares/errorHandler';
import { oxyService } from '../oxy';
import { findAgenciesByIds } from '../../db/agencies/agencyReads';

export async function getAgencySummaries(
  ids: readonly string[],
): Promise<Map<string, AgencySummary>> {
  const rows = [];
  const unique = [...new Set(ids)];
  for (let offset = 0; offset < unique.length; offset += 100) {
    rows.push(...(await findAgenciesByIds(unique.slice(offset, offset + 100))));
  }
  const accountIds = [
    ...new Set(
      rows.flatMap((row) =>
        row.identityStatus === 'linked' && row.oxyAccountId ? [row.oxyAccountId] : [],
      ),
    ),
  ];
  const companies = new Map<string, Organization>();
  for (let offset = 0; offset < accountIds.length; offset += 100) {
    const result = await oxyService.organizations.batch({
      ids: accountIds.slice(offset, offset + 100),
    });
    for (const item of result.items) companies.set(item.requestedAccountId, item.organization);
  }
  const output = new Map<string, AgencySummary>();
  for (const row of rows) {
    const company = row.oxyAccountId ? companies.get(row.oxyAccountId) : undefined;
    if (!company || company.status === 'suppressed') continue;
    output.set(row.id, {
      id: row.id,
      oxyAccountId: company.accountId,
      name: company.name,
      slug: row.slug,
    });
  }
  return output;
}

/** A selection is checked outside database transactions; arbitrary/private/suppressed accounts cannot be linked. */
export async function resolveOrganizationSelection(value: unknown): Promise<string | undefined> {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !value.trim())
    throw new AppError(
      'Select an organization from the directory',
      400,
      'ORGANIZATION_SELECTION_REQUIRED',
    );
  const result = await oxyService.organizations.batch({ ids: [value] });
  const company = result.items.find((item) => item.requestedAccountId === value)?.organization;
  if (company?.status !== 'active')
    throw new AppError('The selected organization is unavailable', 400, 'ORGANIZATION_UNAVAILABLE');
  return company.accountId;
}
