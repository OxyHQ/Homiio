/**
 * Portugal listing providers — Idealista.pt fixture → parse → normalize (no network).
 */

import {
  IdealistaPtProvider,
  isIdealistaPtChallenge,
  idealistaPtSourceIdFromUrl,
  parseIdealistaPtDetail,
  parseIdealistaPtSearch,
  parseIdealistaPtGeoreach,
  isIdealistaPtGeoreachChallenge,
  IDEALISTA_PT_FIXTURE_DETAIL_HTML,
  IDEALISTA_PT_FIXTURE_SEARCH_HTML,
  IDEALISTA_PT_FIXTURE_GEOREACH_JSON,
  IDEALISTA_PT_FIXTURE_GEOREACH_CHALLENGE,
  IDEALISTA_PT_FIXTURE_CONTACT_JSON,
  parseIdealistaPtContactInfo,
} from '@homiio/listing-providers';
import { OfferingType } from '@homiio/shared-types';

describe('IdealistaPtProvider', () => {
  const provider = new IdealistaPtProvider();

  it('normalizes a rent detail page with PT address', () => {
    const payload = parseIdealistaPtDetail(
      IDEALISTA_PT_FIXTURE_DETAIL_HTML,
      'https://www.idealista.pt/imovel/76543210/',
    );
    const listing = provider.normalize({
      ref: { provider: 'idealista_pt', sourceId: payload.sourceId, url: payload.url },
      payload,
    });
    expect(listing.source).toBe('idealista_pt');
    expect(listing.sourceId).toBe('76543210');
    expect(listing.address.countryCode).toBe('PT');
    expect(listing.address.city).toBe('Lisboa');
    expect(listing.offerings).toEqual([OfferingType.LONG_TERM_RENT]);
    expect(listing.longTermRent?.monthlyAmount).toBe(1450);
  });

  it('parses georeach JSON and search HTML', () => {
    expect(parseIdealistaPtGeoreach(IDEALISTA_PT_FIXTURE_GEOREACH_JSON).map((r) => r.sourceId).sort()).toEqual([
      '76543210',
      '76543211',
      '76543212',
    ]);
    expect(isIdealistaPtGeoreachChallenge(IDEALISTA_PT_FIXTURE_GEOREACH_CHALLENGE)).toBe(true);
    expect(parseIdealistaPtSearch(IDEALISTA_PT_FIXTURE_SEARCH_HTML).map((r) => r.sourceId).sort()).toEqual([
      '76543210',
      '76543211',
      '76543212',
    ]);
    expect(idealistaPtSourceIdFromUrl('https://www.idealista.pt/imovel/76543210/')).toBe('76543210');
    expect(isIdealistaPtChallenge('tiny')).toBe(true);
  });

  it('parses contact info JSON', () => {
    const contact = parseIdealistaPtContactInfo(IDEALISTA_PT_FIXTURE_CONTACT_JSON);
    expect(contact?.agencyName).toBe('Agência Lisboa Centro');
    expect(contact?.phone).toBeTruthy();
  });

  it('declares PT market', () => {
    expect(provider.id).toBe('idealista_pt');
    expect(provider.markets).toEqual(['PT']);
  });
});
