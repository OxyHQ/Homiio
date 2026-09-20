/**
 * Backtracking removed from the parsing helpers every provider shares.
 *
 * CodeQL flags four shared spots as `js/polynomial-redos`. They all parse
 * markup fetched from third-party portals, which is the input you least want a
 * pattern to degrade on.
 *
 * **WHAT WAS ACTUALLY MEASURED, because only one of them blew up.** With
 * `'<meta '.repeat(n)`:
 *
 *     n = 16,000 ->   384 ms
 *     n = 32,000 -> 1,567 ms
 *     n = 48,000 -> 3,525 ms
 *
 * Quadratic, and that is the only one of the four a pathological input could be
 * built for. The `<br>`, WhatsApp-href, email and slug-trim patterns are
 * genuinely ambiguous and were rewritten too — the replacements are simpler and
 * cost nothing — but no input made them misbehave, so there is **no timing test
 * for them**. A timing assertion that cannot fail is a gate that cannot tell
 * success from failure, which is the failure mode this codebase has spent the
 * week removing.
 *
 * What the rest of this file guards is therefore BEHAVIOUR: the rewrites must
 * parse exactly what the patterns parsed.
 */

import {
  citySlug,
  extractMetaProperties,
  normalizeEmail,
} from '@homiio/listing-providers';

describe('extractMetaProperties', () => {
  it('stays linear on a document stuffed with <meta tags', () => {
    // THE SIZE IS CHOSEN SO THIS GATE CAN FAIL. The old pattern takes 3,525 ms
    // here, measured; the rewrite takes 0-1 ms. A one-second budget sits 3.5x
    // under the broken implementation and ~1000x above the working one, so it
    // goes red on a regression without flaking on a slow CI box.
    //
    // 16,000 would NOT have worked: the old pattern completes it in 384 ms and
    // would have passed this assertion while quadratic.
    const pathological = '<meta '.repeat(48_000);

    const started = Date.now();
    expect(extractMetaProperties(pathological).size).toBe(0);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it('reads a tag whatever order its attributes come in', () => {
    // HTML fixes no attribute order, which is why there used to be a second,
    // mirrored pattern for `content` before `property`. Parsing attributes
    // instead of matching them positionally removes the need for the copy — and
    // the risk of the two drifting.
    const forward = extractMetaProperties('<meta property="og:title" content="Piso">');
    const reversed = extractMetaProperties('<meta content="Piso" property="og:title">');

    expect(forward.get('og:title')).toBe('Piso');
    expect(reversed.get('og:title')).toBe('Piso');
  });

  it('accepts name= as well as property=, and single quotes', () => {
    expect(extractMetaProperties("<meta name='description' content='Casa'>").get('description')).toBe(
      'Casa',
    );
  });

  it('keeps the first value when a key repeats', () => {
    const meta = extractMetaProperties(
      '<meta property="og:title" content="first"><meta property="og:title" content="second">',
    );
    expect(meta.get('og:title')).toBe('first');
  });

  it('does not treat <metadata> as <meta>', () => {
    // The literal scan has to check what follows the tag name; `indexOf('<meta')`
    // alone would match the longer element and read its attributes as a meta's.
    expect(extractMetaProperties('<metadata property="og:title" content="x">').size).toBe(0);
  });

  it('ignores a tag with no content, and an unterminated one', () => {
    expect(extractMetaProperties('<meta property="og:title">').size).toBe(0);
    expect(extractMetaProperties('<meta property="og:title" content="x"').size).toBe(0);
  });

  it('finds the last tag when an earlier one is malformed', () => {
    const meta = extractMetaProperties('<meta ><meta property="og:url" content="https://x.test">');
    expect(meta.get('og:url')).toBe('https://x.test');
  });
});

describe('citySlug', () => {
  it('still slugs the way every provider depends on', () => {
    expect(citySlug('Ciudad de México')).toBe('ciudad-de-mexico');
    expect(citySlug('  L’Hospitalet de Llobregat  ')).toBe('l-hospitalet-de-llobregat');
    expect(citySlug('A Coruña', '_')).toBe('a_coruna');
  });

  it('trims separators at both ends without leaving one behind', () => {
    // The index walk replaces `/^-+|-+$/g`. Same result, no backtracking.
    expect(citySlug('---Madrid---')).toBe('madrid');
    expect(citySlug('!!!', '-')).toBe('');
    expect(citySlug('___Bilbao___', '_')).toBe('bilbao');
  });
});

describe('normalizeEmail', () => {
  it('accepts and rejects exactly what the pattern did', () => {
    expect(normalizeEmail(' agente@inmobiliaria.es ')).toBe('agente@inmobiliaria.es');
    expect(normalizeEmail('a.b+c@sub.domain.co.uk')).toBe('a.b+c@sub.domain.co.uk');

    for (const invalid of [
      undefined,
      '',
      'no-at-sign',
      '@domain.es',
      'local@',
      'local@domain', // no dot in the domain
      'local@domain.', // nothing after the dot
      'two@at@signs.es',
      'has space@domain.es',
      'local@dom ain.es',
    ]) {
      expect(normalizeEmail(invalid)).toBeUndefined();
    }
  });
});
