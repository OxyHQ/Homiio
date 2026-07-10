import { parseBluegroundDetail, parseBluegroundSearch } from '@homiio/listing-providers/src/providers/blueground/parse';

const SEARCH_HTML = `
  <a href="https://www.theblueground.com/p/furnished-apartments/mad-1490341p">A</a>
  <a href="https://www.theblueground.com/p/furnished-apartments/mad-1461670p">B</a>
`;

const DETAIL_HTML = `
  <meta property="og:title" content="Calle de San Bartolomé - Apartment for Rent in Chueca Justicia, Madrid | Blueground">
  <meta property="og:description" content="Rent a fully furnished apartment in Chueca Justicia, Madrid.">
  <meta property="og:url" content="https://www.theblueground.com/p/furnished-apartments/mad-1490341p">
  "amount":3473,"currency":"EUR","bedrooms":1,"bathrooms":1,"cityCode":"MAD"
  https://photos2.theblueground.com/736/sample/living-room.jpg
  https://photos2.theblueground.com/736/sample/bedroom.jpg
`;

describe('Blueground parse', () => {
  it('extracts property refs from a city search page', () => {
    const refs = parseBluegroundSearch(SEARCH_HTML);
    expect(refs).toHaveLength(2);
    expect(refs[0]?.sourceId).toBe('mad-1490341p');
  });

  it('parses a property detail page into a raw listing', () => {
    const ref = { provider: 'blueground' as const, sourceId: 'mad-1490341p', url: 'https://x' };
    const listing = parseBluegroundDetail(DETAIL_HTML, ref);
    expect(listing.monthlyRent).toEqual({ amount: 3473, currency: 'EUR' });
    expect(listing.address.city).toBe('Madrid');
    expect(listing.photos.length).toBeGreaterThan(0);
  });
});
