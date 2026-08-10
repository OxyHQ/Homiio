/**
 * Tests for the shared area/distance formatter (`format/units`).
 *
 * The load-bearing property is that the LABEL follows the CONVERSION. Homiio
 * stores surface area in square metres, and two screens used to print
 * `{squareFootage} sq ft` against that same field — a 85 m² flat advertised as
 * 85 ft², an eighth of its real size. So every conversion case here asserts the
 * NUMBER changed as well as the unit word: a fixture that only checked the unit
 * word would pass against an implementation that relabels without converting,
 * which is precisely the bug.
 *
 * See `money.test.ts` for why these assert properties rather than whole strings.
 */
import { formatArea, formatAreaLabel, formatDistance } from '@homiio/shared-types';

describe('formatArea — the label always names the unit the number is in', () => {
  it('renders a stored square-metre value as m² under a metric preference', () => {
    const text = formatArea(85, 'sqm', 'es-ES', { preference: 'metric' });
    expect(text).toContain('85');
    expect(text).toContain('m²');
    expect(text).not.toContain('ft');
  });

  it('CONVERTS when asked for imperial — the number moves, not just the word', () => {
    const text = formatArea(85, 'sqm', 'en-US', { preference: 'imperial' });
    // 85 m² = 914.93 ft². A relabel-without-convert would print "85 ft²".
    expect(text).toContain('915');
    expect(text).not.toContain('85 ');
    expect(text).toContain('ft²');
    expect(text).not.toContain('m²');
  });

  it('converts the other way for a value stored in square feet', () => {
    const text = formatArea(915, 'sqft', 'es-ES', { preference: 'metric' });
    expect(text).toContain('85');
    expect(text).toContain('m²');
    expect(text).not.toContain('915');
  });

  it('is a no-op when the stored unit already matches the preference', () => {
    expect(formatArea(915, 'sqft', 'en-US', { preference: 'imperial' })).toContain('915');
  });

  it('resolves `auto` from the locale REGION, never from the stored value', () => {
    expect(formatArea(85, 'sqm', 'en-US', { preference: 'auto' })).toContain('ft²');
    expect(formatArea(85, 'sqm', 'es-ES', { preference: 'auto' })).toContain('m²');
    expect(formatArea(85, 'sqm', 'ro-RO', { preference: 'auto' })).toContain('m²');
    // No region subtag at all: metric, the conservative default.
    expect(formatArea(85, 'sqm', 'es', { preference: 'auto' })).toContain('m²');
    // en-GB signs roads in miles but sells flats in m²; `auto` picks one system
    // for both, so it stays metric and an imperial surface asks explicitly.
    expect(formatArea(85, 'sqm', 'en-GB', { preference: 'auto' })).toContain('m²');
    // A script subtag must not be mistaken for the region.
    expect(formatArea(85, 'sqm', 'sr-Latn-RS', { preference: 'auto' })).toContain('m²');
  });

  it('defaults to `auto` when no preference is given', () => {
    expect(formatArea(85, 'sqm', 'en-US')).toBe(formatArea(85, 'sqm', 'en-US', { preference: 'auto' }));
  });

  it('groups the number in the locale, so a large floor plate reads correctly', () => {
    expect(formatArea(12345, 'sqm', 'en-US', { preference: 'metric' })).toContain('12,345');
    expect(formatArea(12345, 'sqm', 'es-ES', { preference: 'metric' })).toContain('12.345');
  });

  it('coerces a non-finite value to zero rather than rendering NaN', () => {
    // The separator is a NO-BREAK space (U+00A0) so an area never wraps between
    // its number and its unit; spelled out here because the two are visually
    // identical in a diff and a plain space would silently pass a wrong build.
    expect(formatArea(Number.NaN, 'sqm', 'en-US', { preference: 'metric' })).toBe('0\u00a0m²');
  });
});

describe('formatAreaLabel — the accessibility form', () => {
  it('spells the unit out instead of leaving a screen reader with "m two"', () => {
    const text = formatAreaLabel(85, 'sqm', 'en-US', { preference: 'metric' });
    expect(text).toBe('85 square metres');
    expect(text).not.toContain('m²');
  });

  it('names the CONVERTED unit, matching the converted number', () => {
    const text = formatAreaLabel(85, 'sqm', 'en-US', { preference: 'imperial' });
    expect(text).toContain('915');
    expect(text).toContain('square feet');
    expect(text).not.toContain('square metres');
  });

  it('takes the wording from the caller, so it can be translated', () => {
    const text = formatAreaLabel(85, 'sqm', 'es-ES', {
      preference: 'metric',
      labels: {
        sqm: { short: 'm²', spoken: 'metros cuadrados' },
        sqft: { short: 'ft²', spoken: 'pies cuadrados' },
      },
    });
    expect(text).toBe('85 metros cuadrados');
  });
});

describe('formatDistance — metres in, locale-appropriate units out', () => {
  it('keeps a short metric distance in whole metres', () => {
    const text = formatDistance(600, 'es-ES', { preference: 'metric' });
    expect(text).toContain('600');
    expect(text).toMatch(/\bm\b/);
    expect(text).not.toContain('km');
  });

  it('switches to kilometres with one decimal past a kilometre', () => {
    const text = formatDistance(2400, 'es-ES', { preference: 'metric' });
    expect(text).toContain('2,4');
    expect(text).toContain('km');
  });

  it('CONVERTS to feet for a short imperial distance', () => {
    const text = formatDistance(600, 'en-US', { preference: 'imperial' });
    // 600 m = 1968.5 ft. Printing "600 ft" would be the relabel bug again.
    expect(text).toContain('1,969');
    expect(text).toContain('ft');
    expect(text).not.toContain('600');
  });

  it('CONVERTS to miles past a mile', () => {
    const text = formatDistance(2400, 'en-US', { preference: 'imperial' });
    expect(text).toContain('1.5');
    expect(text).toMatch(/mi/);
  });

  it('resolves `auto` from the locale region', () => {
    expect(formatDistance(2400, 'en-US')).toMatch(/mi/);
    expect(formatDistance(2400, 'es-ES')).toContain('km');
  });

  it('renders the long form for an accessibility label', () => {
    expect(formatDistance(2400, 'en-US', { preference: 'metric', unitDisplay: 'long' })).toContain(
      'kilometers',
    );
  });

  it('clamps a negative or non-finite distance to zero', () => {
    expect(formatDistance(-500, 'en-US', { preference: 'metric' })).toContain('0');
    expect(formatDistance(Number.NaN, 'en-US', { preference: 'metric' })).toContain('0');
  });

  it('does not throw on a malformed locale tag', () => {
    expect(() => formatDistance(2400, 'not a locale')).not.toThrow();
  });
});
