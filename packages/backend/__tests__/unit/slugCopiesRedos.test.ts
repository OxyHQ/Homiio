/**
 * The last four copies of the slug snippet (ReDoS batch 4).
 *
 * `slug.ts` exists so this is written once, and says so. It had been copied
 * **eight** times: three GB providers (removed in batch 3) and these four —
 * `us/portals`, `us/zillow`, `us/apartmentsCom`, `ca/realtorCa`. Every copy
 * carried the same `/^-+|-+$/g`, which is what a duplicated snippet does: it
 * duplicates the defect too, and then each copy gets its own CodeQL alert.
 *
 * Replacing a URL builder is only safe if the URLs do not move, so that is what
 * this file checks — against the configured market rather than a few examples.
 * A search URL that quietly changes shape is a provider that quietly stops
 * finding homes.
 */

import { citySlug } from '@homiio/listing-providers';
import { cityToResourceSlug } from '@homiio/listing-providers/providers/us/portals';

/** The snippet all four had copied, kept as the oracle. */
function legacyCitySlug(city: string): string {
  return city
    .toLowerCase()
    .replace(/,/g, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The realtor.ca variant, which had no comma strip. */
function legacyAddressSlug(addressText: string): string {
  return addressText
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `City, ST` entries from the configured US market. */
const US_CITIES = [
  'New York, NY', 'Los Angeles, CA', 'Chicago, IL', 'Houston, TX', 'Phoenix, AZ',
  'Philadelphia, PA', 'San Antonio, TX', 'San Diego, CA', 'Dallas, TX', 'San Jose, CA',
  'Austin, TX', 'Jacksonville, FL', 'Fort Worth, TX', 'Columbus, OH', 'Charlotte, NC',
  'San Francisco, CA', 'Indianapolis, IN', 'Seattle, WA', 'Denver, CO', 'Washington, DC',
  'Boston, MA', 'El Paso, TX', 'Nashville, TN', 'Oklahoma City, OK', 'Las Vegas, NV',
  'St. Petersburg, FL', 'Winston-Salem, NC', 'North Las Vegas, NV', 'St. Louis, MO',
];

describe('the copied US slug snippet', () => {
  it('produces the same slug as citySlug for every configured city', () => {
    for (const city of US_CITIES) {
      expect(citySlug(city)).toBe(legacyCitySlug(city));
    }
  });

  it('did not need its comma strip', () => {
    // `.replace(/,/g, '')` ran before `[^a-z0-9]+`, which already collapses a
    // comma and the space after it into ONE separator. Removing it is why the
    // shared helper can stand in unchanged.
    expect(citySlug('Austin, TX')).toBe('austin-tx');
    expect(citySlug('Washington, DC')).toBe('washington-dc');
    expect(citySlug('Winston-Salem, NC')).toBe('winston-salem-nc');
  });

  it('keeps the HotPads resource slug intact end to end', () => {
    expect(cityToResourceSlug('Austin, TX')).toBe('austin-tx');
    expect(cityToResourceSlug('New York, NY')).toBe('new-york-ny');
  });
});

describe('the realtor.ca address slug', () => {
  it('fixes a diacritic the copy mangled', () => {
    // The one place output MOVES, and it moves toward correct. The copy turned
    // Montréal into `montr-al` because `[^a-z0-9]+` ate the accented letter;
    // the shared helper strips diacritics first. The slug is cosmetic in
    // `/real-estate/{id}/{slug}` — the id carries identity — so this changes a
    // human-readable fragment from wrong to right.
    expect(legacyAddressSlug('123 Rue Sainte-Catherine, Montréal')).toBe(
      '123-rue-sainte-catherine-montr-al',
    );
    expect(citySlug('123 Rue Sainte-Catherine, Montréal')).toBe(
      '123-rue-sainte-catherine-montreal',
    );
  });

  it('leaves an unaccented address exactly where it was', () => {
    for (const address of ['500 King St W, Toronto', '1 Yonge Street, Toronto']) {
      expect(citySlug(address)).toBe(legacyAddressSlug(address));
    }
  });
});
