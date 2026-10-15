import type { NormalizedListing } from '@homiio/shared-types';
import { resolveListingAgency } from '../../../services/organizations/ingestion';
import { oxyService } from '../../../services/oxy';
import * as references from '../../../db/agencies/agencyWrites';
import { buildContact, mergeContact, contactFromUnknown } from '@homiio/listing-providers/contact';

const listing = (contact: NormalizedListing['contact']) =>
  ({
    source: 'fotocasa',
    sourceId: 'listing-1',
    sourceUrl: 'https://source.example/listing-1',
    contact,
  }) as NormalizedListing;
afterEach(() => jest.restoreAllMocks());
it('keeps a name-only contact as an observation, never creating a global company', async () => {
  const batch = jest.spyOn(oxyService.organizations, 'importBatch');
  expect(
    await resolveListingAgency(listing({ agencyName: 'OpenRent landlord', kind: 'private' })),
  ).toBeUndefined();
  expect(
    await resolveListingAgency(listing({ agencyName: 'Company label', kind: 'agency' })),
  ).toBeUndefined();
  expect(batch).not.toHaveBeenCalled();
});
it('links only the refreshed listing via a stable provider key and source provenance', async () => {
  const batch = jest.spyOn(oxyService.organizations, 'importBatch').mockResolvedValue({
    items: [
      { externalId: 'provider:fotocasa:company-42', accountId: 'oxy-company', created: true },
    ],
  });
  const reference = jest.spyOn(references, 'findOrCreateAgencyReference').mockResolvedValue({
    id: 'housing-reference',
    slug: 'housing-reference',
    oxyAccountId: 'oxy-company',
    identityStatus: 'linked',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  expect(
    await resolveListingAgency(
      listing({ agencyName: 'Company label', agencySourceId: 'company-42', kind: 'agency' }),
    ),
  ).toBe('housing-reference');
  expect(batch).toHaveBeenCalledWith({
    namespace: 'homiio',
    items: [
      {
        externalId: 'provider:fotocasa:company-42',
        organization: { name: 'Company label', organizationType: 'business' },
        evidenceReference: 'https://source.example/listing-1',
      },
    ],
  });
  expect(reference).toHaveBeenCalledWith('oxy-company');
});
it('keeps provider keys with their own contact observation, not a later replacement label', () => {
  const original = buildContact({
    agencyName: 'First company',
    agencySourceId: 'first',
    kind: 'agency',
  });
  expect(
    mergeContact(original, buildContact({ agencyName: 'Other company', kind: 'agency' }))
      ?.agencySourceId,
  ).toBeUndefined();
  expect(
    contactFromUnknown({ type: 'agency', agencyName: 'A company', agencyId: 'stable-company-id' })
      ?.agencySourceId,
  ).toBe('stable-company-id');
});
