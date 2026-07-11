import {
  BluegroundPartnerListingError,
  parseBluegroundDetail,
  parseBluegroundSearch,
  readBluegroundAmenities,
  readBluegroundLowestRent,
} from '@homiio/listing-providers';

const SEARCH_HTML = `
  <a href="https://www.theblueground.com/p/furnished-apartments/mad-1490341p">A</a>
  <a href="https://www.theblueground.com/p/furnished-apartments/mad-1461670p">B</a>
`;

/**
 * Mirrors the real Blueground detail markup: the `"amenities"` object is keyed
 * by category (`apartment`/`building`/`important`/`main`/`struckthrough*`), each
 * entry carrying a language-independent camelCase `key`. `struckthrough*`
 * categories list amenities the unit does NOT have (elevator here is available,
 * but parking + doorman are struck through) and `main.floor` carries the floor.
 */
const AMENITIES_JSON =
  '"amenities":{' +
  '"apartment":[' +
  '{"key":"airConditioning","caption":"amenities.all.airConditioning","iconUrl":"AirConditioning.svg"},' +
  '{"key":"laundryRoomUnit","price":{"charged":false},"caption":"amenities.all.laundryRoomUnit","iconUrl":"WashingMachine.svg"},' +
  '{"key":"balcony","caption":"amenities.all.balcony","iconUrl":"Balcony.svg"},' +
  '{"key":"coffeeMachine","caption":"amenities.all.coffeeMachine","iconUrl":"Coffee.svg"}' +
  '],' +
  '"blueground":[],' +
  '"building":[{"key":"elevatorInTheBuilding","caption":"amenities.all.elevatorInTheBuilding","iconUrl":"Elevator.svg"}],' +
  '"important":[{"key":"airConditioning","caption":"amenities.all.airConditioning","iconUrl":"AirConditioning.svg"}],' +
  '"main":[' +
  '{"key":"bedrooms","value":"1","caption":"amenities.all.bedrooms","iconUrl":"QueenBed.svg"},' +
  '{"key":"bathrooms","value":"1","caption":"amenities.all.bathrooms","iconUrl":"Bathtub.svg"},' +
  '{"key":"floor","value":"2","caption":"amenities.all.floor","iconUrl":"Floor.svg"}' +
  '],' +
  '"struckthroughApartment":[{"key":"bathtub","caption":"amenities.all.bathtub","iconUrl":"Bathtub.svg"}],' +
  '"struckthroughBuilding":[' +
  '{"key":"parkingSpace","caption":"amenities.all.parkingSpace","iconUrl":"Parking.svg"},' +
  '{"key":"doorman","caption":"amenities.all.doorman","iconUrl":"Doorman.svg"}' +
  ']}';

const FIRST_PARTY_DETAIL_HTML = `
  <meta property="og:title" content="Calle de San Bartolomé - Apartment for Rent in Chueca Justicia, Madrid | Blueground">
  <meta property="og:description" content="Rent a fully furnished apartment in Chueca Justicia, Madrid.">
  <meta property="og:url" content="https://www.theblueground.com/p/furnished-apartments/mad-1490341p">
  "amount":99999,"currency":"USD"
  "businessModel":"CORE","cityCode":"MAD","bedrooms":1,"bathrooms":1
  ${AMENITIES_JSON}
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

  it('extracts available amenities as canonical slugs, excluding struck-through ones', () => {
    const { amenities, floor } = readBluegroundAmenities(FIRST_PARTY_DETAIL_HTML);
    // Available apartment/building amenities, canonicalized onto the shared fixed
    // vocabulary (`washerUnit`→washing_machine); non-canonical `coffeeMachine` is
    // dropped rather than stored as a bespoke slug.
    expect(amenities.sort()).toEqual(
      ['air_conditioning', 'balcony', 'elevator', 'washing_machine'].sort(),
    );
    // Struck-through amenities (parking, doorman, bathtub) must NOT appear.
    expect(amenities).not.toContain('parking');
    expect(amenities).not.toContain('doorman');
    expect(amenities).not.toContain('bathtub');
    // `main` structured facts (bedrooms/bathrooms/floor) are not amenities.
    expect(amenities).not.toContain('bedrooms');
    expect(amenities).not.toContain('floor');
    expect(floor).toBe(2);
  });

  it('carries amenities + floor through parseBluegroundDetail', () => {
    const ref = { provider: 'blueground' as const, sourceId: 'mad-1490341p', url: 'https://x' };
    const listing = parseBluegroundDetail(FIRST_PARTY_DETAIL_HTML, ref);
    expect(listing.floor).toBe(2);
    expect(listing.amenities).toContain('elevator');
    expect(listing.amenities).toContain('washing_machine');
    expect(listing.amenities).not.toContain('parking');
  });

  it('degrades to empty amenities when no amenities object is present', () => {
    const html = '<meta property="og:title" content="x"> "lowestRent":{"amount":3473,"currency":"EUR"}';
    expect(readBluegroundAmenities(html)).toEqual({ amenities: [] });
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
