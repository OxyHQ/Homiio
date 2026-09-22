/**
 * Seven small field extractors, each quadratic, each for a slightly different
 * reason — which is why they are here together.
 *
 * Measured before the change (32,000-character inputs):
 *
 *     realtorCa  /([\d,.]+)\s*sq\s*ft/i       3623ms
 *     blueground /in\s+(.+)$/i                 752ms
 *     onthemarket /<[^>]+>/g                   471ms
 *     is24       /^(\d{5})\s+(.+)$/            266ms
 *     kleinanzeigen /\s*m²/i                   251ms
 *     propertyTitle /,?\s*\d+.*$/              248ms
 *     blueground /\s*\|\s*Blueground.*$/i      245ms
 *
 * Every one is `js/polynomial-redos`, and every one reads text a remote portal
 * supplied.
 *
 * ## The reasons differ, and guessing wrong produces a fix that fixes nothing
 *
 * Three were an unanchored leading `\s*`: retried at every index, walking the
 * whitespace run each time. Those are deleted outright — a `.trim()` or a
 * numeric parse downstream already did what they were for, so removal is
 * exactly equivalent.
 *
 * One was an unbounded `[\d,.]+` backtracking a character at a time; a bound
 * fixes it, and a square footage is not 32 characters.
 *
 * One was `[^>]+` running past a `<` with no `>` after it.
 *
 * TWO NEEDED REWRITING, AND ONE OF THEM TAUGHT THE LESSON. `/in\s+(.+)$/i`
 * looks like `\s+` and `.+` fighting over spaces, so the obvious fix is to
 * bound the gap. **It was measured: 752ms before, 778ms after.** The cost is
 * `.+$` scanning to the end of the line at every `in` in the string. The same
 * is true of `removePropertyNumber`, which is also a privacy function and so
 * could not take an approximation either.
 *
 * Both rewrites are pinned against their original regex on 800,000 and 900,000
 * random strings respectively, over `\r`, U+2028, U+2029 and non-breaking
 * space. Both first drafts FAILED that comparison — one on 75,582 cases, the
 * other on 3,069 — so the number is not decoration.
 */

import { removePropertyNumber } from '@homiio/shared-types';
import { parseOgTitle } from '@homiio/listing-providers/providers/blueground/parse';

/** The regex `removePropertyNumber` replaced, kept as the oracle. */
function legacyRemovePropertyNumber(street: string): string {
  if (!street) return '';
  return street.replace(/,?\s*\d+.*$/, '').trim();
}

const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

describe('removePropertyNumber keeps the building number out of a title', () => {
  it('still strips the number on the addresses it exists for', () => {
    expect(removePropertyNumber('Calle de Vicente Blasco Ibáñez, 6')).toBe(
      'Calle de Vicente Blasco Ibáñez',
    );
    expect(removePropertyNumber('Carrer de Mallorca 401')).toBe('Carrer de Mallorca');
    expect(removePropertyNumber('C/ Aragó 12-14')).toBe('C/ Aragó');
  });

  it('leaves a street with no number alone', () => {
    expect(removePropertyNumber('Gran Via')).toBe('Gran Via');
    expect(removePropertyNumber('')).toBe('');
    expect(removePropertyNumber('   ')).toBe('');
  });

  it('agrees with the regex it replaced, including where that regex does NOT match', () => {
    // `.` does not match a line terminator and `$` has no `m` flag, so the
    // digits must lie on the LAST line — `"0\n"` keeps its digit. A rewrite
    // that ignores this looks correct on every realistic address and is wrong.
    for (const street of [
      '0\n', 'Calle 6\n', '12345\r', `Gran Via 3${LINE_SEPARATOR}`,
      `Rambla${PARAGRAPH_SEPARATOR}7`, 'Calle\n 6', 'a1b2', '1\n2',
      'Calle, 6', 'Passeig de Gràcia,  128 bis', 'Baker Street 221B',
    ]) {
      expect(removePropertyNumber(street)).toBe(legacyRemovePropertyNumber(street));
    }
  });

  it('finishes on a street that is mostly whitespace', () => {
    // The old pattern took 248ms at 16k and about a second at 32k.
    const street = 'Carrer de Mallorca' + ' '.repeat(64_000) + '401';

    const started = Date.now();
    const result = removePropertyNumber(street);

    expect(result).toBe('Carrer de Mallorca');
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe('the Blueground title parser', () => {
  it('reads street, neighborhood and city out of a real title', () => {
    expect(
      parseOgTitle('Carrer de Girona 82 - Furnished apartment in Eixample, Barcelona | Blueground'),
    ).toEqual({
      street: 'Carrer de Girona 82',
      neighborhood: 'Eixample',
      city: 'Barcelona',
    });
  });

  it('falls back to a city alone when the title names one place', () => {
    expect(parseOgTitle('Loft - Apartment in Barcelona | Blueground')).toEqual({
      street: 'Loft',
      city: 'Barcelona',
    });
  });

  it('keeps the street when there is nothing after the dash', () => {
    expect(parseOgTitle('Carrer de Girona 82')).toEqual({ street: 'Carrer de Girona 82' });
    expect(parseOgTitle(undefined)).toEqual({});
  });

  it('strips the Blueground suffix with or without spacing around the pipe', () => {
    // The leading `\s*` was deleted from `/\s*\|\s*Blueground.*$/i` because the
    // `.trim()` that follows already removed what it ate. These pin that.
    for (const suffix of [' | Blueground', '|Blueground', '   |   Blueground rentals']) {
      expect(parseOgTitle(`Street - Apartment in Barcelona${suffix}`).city).toBe('Barcelona');
    }
  });

  it('finishes on an "in"-heavy title, and agrees with the old regex on it', () => {
    // `'in '.repeat(32_000)` took 752ms through the old regex, and bounding the
    // whitespace gap took 778ms — the bound was never the problem. The rewrite
    // does it in 2ms, so this budget is red against both earlier versions.
    //
    // The expected VALUE is taken from the old regex rather than written out,
    // because the leftmost `in` is the one at the start of the padding, so the
    // capture is the whole run. That is what the original did too, and a
    // hand-written expectation here would assert the padding away.
    const padded = 'Street - ' + 'in '.repeat(32_000) + 'Barcelona | Blueground';
    const locationPart = padded.split(' - ')[1].replace(/\|\s*Blueground.*$/i, '').trim();
    const legacyCapture = locationPart.match(/in\s+(.+)$/i)?.[1] ?? '';
    const legacyParts = legacyCapture.split(',').map((part) => part.trim()).filter(Boolean);

    const started = Date.now();
    const parsed = parseOgTitle(padded);
    const elapsed = Date.now() - started;

    expect(parsed.city).toBe(legacyParts[legacyParts.length - 1]);
    expect(elapsed).toBeLessThan(300);
  });

  it('finishes on a pipe-heavy title, which the old suffix strip walked', () => {
    const padded = 'Street - Apartment in Barcelona' + ' '.repeat(64_000) + '| Blueground';

    const started = Date.now();
    parseOgTitle(padded);

    expect(Date.now() - started).toBeLessThan(300);
  });
});
