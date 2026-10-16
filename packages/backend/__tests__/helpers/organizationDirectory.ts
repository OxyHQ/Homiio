/** Real local references with a controlled external canonical directory for integration tests. */
import { uuidv7 } from '@oxy.so/db';
import type { Organization } from '@oxy.so/contracts';
import { oxyService } from '../../services/oxy';
import { findOrCreateAgencyReference } from '../../db/agencies/agencyWrites';
const companies = new Map<string, Organization>();
export function registerCompany(name: string, accountId = uuidv7()): Organization {
  const company: Organization = {
    accountId,
    name,
    username: null,
    organizationType: 'business',
    avatar: null,
    legalName: null,
    websiteUrl: null,
    countryCode: null,
    aliases: [],
    verifiedDomains: [],
    claimStatus: 'unclaimed',
    status: 'active',
    mergedIntoAccountId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  companies.set(accountId, company);
  jest.spyOn(oxyService.organizations, 'get').mockImplementation(async (id) => {
    const value = companies.get(id);
    if (!value) throw new Error('Organization not found');
    return value;
  });
  jest.spyOn(oxyService.organizations, 'batch').mockImplementation(async ({ ids }) => ({
    items: ids.flatMap((id) => {
      const value = companies.get(id);
      return value ? [{ requestedAccountId: id, organization: value }] : [];
    }),
    missingIds: ids.filter((id) => !companies.has(id)),
  }));
  jest.spyOn(oxyService.organizations, 'search').mockImplementation(async ({ query }) => ({
    items: [...companies.values()]
      .filter((value) => value.name.toLowerCase().includes((query ?? '').toLowerCase()))
      .slice(0, 10),
    nextCursor: null,
  }));
  return company;
}
export async function createAgencyFixture(name: string) {
  const company = registerCompany(name);
  return findOrCreateAgencyReference(company.accountId);
}
