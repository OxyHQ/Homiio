import type { NormalizedListing } from '@homiio/shared-types';
import { oxyService } from '../oxy';
import { findOrCreateAgencyReference } from '../../db/agencies/agencyWrites';

/** Source labels stay observations. Only a provider-declared company with a stable company key can be imported. */
export async function resolveListingAgency(
  listing: NormalizedListing,
): Promise<string | undefined> {
  const contact = listing.contact;
  if (contact?.kind !== 'agency' || !contact.agencyName?.trim() || !contact.agencySourceId?.trim())
    return undefined;
  const externalId = `provider:${listing.source}:${contact.agencySourceId}`;
  const result = await oxyService.organizations.importBatch({
    namespace: 'homiio',
    items: [
      {
        externalId,
        organization: { name: contact.agencyName.trim(), organizationType: 'business' },
        evidenceReference: listing.sourceUrl,
      },
    ],
  });
  const linked = result.items.find((item) => item.externalId === externalId);
  if (!linked) throw new Error('Organization import returned no source mapping');
  return (await findOrCreateAgencyReference(linked.accountId)).id;
}
