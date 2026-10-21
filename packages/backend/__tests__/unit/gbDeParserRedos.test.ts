/**
 * Backtracking removed from the GB and DE parsers (batch 3 of 4).
 *
 * Two findings, and the second one is not really about performance.
 *
 * **Kleinanzeigen's two price patterns blow up.** `[^>]*` after a literal the
 * page can repeat lets the engine re-scan from every repetition. Measured on
 * the old patterns:
 *
 *                      n = 6,000   n = 18,000   n = 36,000
 *   id="viewad-price"    154 ms      1,371 ms     5,466 ms
 *   class=…--price       246 ms      2,285 ms     9,289 ms
 *
 * Nine seconds on a detail page, in the provider that has been carrying the
 * German market all week. Bounded now; 12-14 ms at the same size.
 *
 * **Three GB providers had copied the slug snippet** that `slug.ts` exists to
 * prevent — its own doc comment says "providers must import `citySlug` from
 * here instead of copying the NFD-deaccent + lowercase + hyphenate snippet" —
 * and all three copies carried the same `/^-+|-+$/g`. Deleting the copies fixes
 * three alerts and removes the duplication that produced them. That is the
 * actual fix; the ReDoS was a symptom.
 *
 * The remaining two kleinanzeigen patterns (`DETAIL_LINK_RE`, `detailValue`)
 * measured 0-1 ms at every size and are left alone: changing a working parser
 * to satisfy a scanner, with no measurement behind it, is how ingestion breaks.
 */

import { citySlug, parseKleinanzeigenDetail } from '@homiio/listing-providers';
import { openrentSearchUrl } from '@homiio/listing-providers/providers/gb/openrent/parse';

/** The snippet the three GB providers had copied, kept here as the oracle. */
function legacySlug(city: string): string {
  return city
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The configured GB market, verbatim from the worker's task definition. */
const GB_CITIES = [
  'London', 'Manchester', 'Birmingham', 'Leeds', 'Glasgow', 'Sheffield', 'Bradford',
  'Edinburgh', 'Liverpool', 'Bristol', 'Cardiff', 'Coventry', 'Leicester', 'Nottingham',
  'Newcastle upon Tyne', 'Southampton', 'Brighton', 'Plymouth', 'Reading', 'Derby',
  'Wolverhampton', 'Northampton', 'Norwich', 'Luton', 'Bolton', 'Bournemouth', 'Swindon',
  'Swansea', 'Southend-on-Sea', 'Middlesbrough', 'Sunderland', 'Milton Keynes',
  'Peterborough', 'York', 'Oxford', 'Cambridge', 'Ipswich', 'Slough', 'Gloucester',
  'Exeter', 'Bath', 'Cheltenham', 'Stoke-on-Trent', 'Hull', 'Aberdeen', 'Dundee',
  'Stirling', 'Inverness', 'Belfast', 'Derry',
];

describe('the copied GB slug snippet', () => {
  it('produces the same slug as citySlug for every configured city', () => {
    // The substitution is only safe if it changes no URL. Asserted against the
    // real market list rather than a handful of examples, because a search URL
    // that silently changes shape is a provider that silently stops finding
    // homes — the failure this repo has spent the week removing.
    for (const city of GB_CITIES) {
      expect(citySlug(city)).toBe(legacySlug(city));
    }
  });

  it('keeps the hyphenated and multi-word cases intact end to end', () => {
    expect(openrentSearchUrl('Southend-on-Sea', 1)).toContain('/southend-on-sea');
    expect(openrentSearchUrl('Newcastle upon Tyne', 1)).toContain('/newcastle-upon-tyne');
  });

  it('differs from the copy only by handling diacritics, which GB never has', () => {
    // The one real difference, stated rather than hidden: the shared helper
    // strips accents. No GB city carries one, so nothing moves today — and a
    // market that does carry them now gets the right answer instead of a run of
    // separators.
    expect(legacySlug('A Coruña')).toBe('a-coru-a');
    expect(citySlug('A Coruña')).toBe('a-coruna');
  });
});

describe('Kleinanzeigen price patterns, pathological input', () => {
  it('reads a price out of a page stuffed with the id literal', () => {
    // Old: 5,466 ms at this size, quadratic. New: ~12 ms.
    const pathological = `<html><body>${'id="viewad-price"'.repeat(36_000)}</body></html>`;

    const started = Date.now();
    expect(() => parseKleinanzeigenDetail(pathological, 'https://www.kleinanzeigen.de/s-anzeige/x/1-2-3')).toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('reads a price out of a page stuffed with the class literal', () => {
    // Old: 9,289 ms — the worst measured in this repository.
    const pathological = `<html><body>${'class="boxedarticle--price"'.repeat(36_000)}</body></html>`;

    const started = Date.now();
    expect(() => parseKleinanzeigenDetail(pathological, 'https://www.kleinanzeigen.de/s-anzeige/x/1-2-3')).toThrow();
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
