import {
  BluegroundPartnerListingError,
  parseBluegroundDetail,
  parseBluegroundSearch,
  readBluegroundLowestRent,
} from '@homiio/listing-providers';

const SEARCH_HTML = `
  <a href="https://www.theblueground.com/p/furnished-apartments/mad-1490341p">A</a>
  <a href="https://www.theblueground.com/p/furnished-apartments/mad-1461670p">B</a>
`;

const FIRST_PARTY_DETAIL_HTML = `
  <meta property="og:title" content="Calle de San Bartolomé - Apartment for Rent in Chueca Justicia, Madrid | Blueground">
  <meta property="og:description" content="Rent a fully furnished apartment in Chueca Justicia, Madrid.">
  <meta property="og:url" content="https://www.theblueground.com/p/furnished-apartments/mad-1490341p">
  "amount":99999,"currency":"USD"
  "businessModel":"CORE","cityCode":"MAD","bedrooms":1,"bathrooms":1
  "lowestRent":{"amount":3473,"currency":"EUR"}
  https://photos2.theblueground.com/736/sample/living-room.jpg
  https://photos2.theblueground.com/736/sample/bedroom.jpg
`;

const PARTNER_DETAIL_HTML = `
  <meta property="og:title" content="Carrer de Simó Oller - Apartment for Rent in Gothic Quarter, Barcelona | Blueground">
  <meta property="og:url" content="https://www.theblueground.com/p/furnished-apartments/bcn-1549599p">
  "businessModel":"PARTNERS_NETWORK","partnerSlug":"outsite1","source":"partner_network"
  "cityCode":"BCN","bedrooms":1,"bathrooms":1
  "lowestRent":{"amount":11628,"currency":"EUR"}
  https://photos2.theblueground.com/736/partner-network/outsite1/sample.jpg
`;

describe('Blueground parse', () => {
  it('extracts property refs from a city search page', () => {
    const refs = parseBluegroundSearch(SEARCH_HTML);
    expect(refs).toHaveLength(2);
    expect(refs[0]?.sourceId).toBe('mad-1490341p');
  });

  it('parses first-party detail using explicit lowestRent, not the first amount', () => {
    const ref = { provider: 'blueground' as const, sourceId: 'mad-1490341p', url: 'https://x' };
    const listing = parseBluegroundDetail(FIRST_PARTY_DETAIL_HTML, ref);
    expect(listing.monthlyRent).toEqual({ amount: 3473, currency: 'EUR' });
    expect(listing.address.city).toBe('Madrid');
    expect(listing.photos.length).toBeGreaterThan(0);
    expect(readBluegroundLowestRent(FIRST_PARTY_DETAIL_HTML)).toEqual({
      amount: 3473,
      currency: 'EUR',
    });
  });

  it('skips PARTNERS_NETWORK listings instead of publishing lowestRent as monthly', () => {
    const ref = {
      provider: 'blueground' as const,
      sourceId: 'bcn-1549599p',
      url: 'https://www.theblueground.com/p/furnished-apartments/bcn-1549599p',
    };
    expect(() => parseBluegroundDetail(PARTNER_DETAIL_HTML, ref)).toThrow(BluegroundPartnerListingError);
    try {
      parseBluegroundDetail(PARTNER_DETAIL_HTML, ref);
    } catch (error) {
      expect(error).toBeInstanceOf(BluegroundPartnerListingError);
      if (error instanceof BluegroundPartnerListingError) {
        expect(error.sourceId).toBe('bcn-1549599p');
        expect(error.reason).toMatch(/outsite1|unreliable lowestRent/);
      }
    }
  });
});
