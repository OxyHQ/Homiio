/**
 * Tests for the shared money formatter (`@homiio/shared-types` `format/money`).
 *
 * They live in the FRONTEND suite because that is the job in CI that needs no
 * database; `shared-types` has no runner of its own.
 *
 * Jest loads the package's SOURCE, not its `dist/` — verified, not assumed, by
 * mutating `src/format/percentage.ts` without rebuilding and watching this suite
 * go red. That matters for mutation testing: no rebuild step is needed here, and
 * a mutation applied to `dist/` would measure nothing at all. (The frontend's
 * `tsc` resolves `src` too, via a `paths` mapping; only a Node consumer such as
 * the backend at runtime reads `dist`.)
 *
 * WHY THE ASSERTIONS LOOK LIKE THIS. `Intl`'s exact output moves with the
 * engine's ICU version (the space before `€` is U+00A0, `es-ES` does not group
 * four-digit numbers, `pl-PL`'s group separator has changed shape across ICU
 * releases). Pinning whole strings would make this suite fail on an engine
 * upgrade that broke nothing. So each case asserts the PROPERTIES that decide
 * whether the implementation is right, all of which are stable:
 *
 *   - which currency marker is present (and that no other one is),
 *   - which side of the amount it sits on,
 *   - which character separates the decimals,
 *   - that the digits are the ones passed in, unconverted.
 *
 * Every fixture is chosen so the two implementations this issue exists to
 * separate — a hardcoded `€${amount}` and a locale-less `toLocaleString()` —
 * produce a VISIBLY different string. A case using `en-US` with `EUR` would
 * agree with `€${amount}` and prove nothing, so the `es-ES` cases carry the
 * symbol-position and decimal-separator load.
 */
import {
  DEFAULT_PRICE_UNIT_LABELS,
  PriceUnit,
  formatDeposit,
  formatMoney,
  formatMoneyRange,
  formatPrice,
  formatPriceLabel,
  isSupportedCurrencyCode,
  priceFrequencyFromPriceUnit,
  type PriceDescriptor,
  type PriceUnitLabels,
} from '@homiio/shared-types';

/** Every currency marker the fixtures below use, for "no OTHER currency" checks. */
const MARKERS = ['€', '$', 'zł', 'RON', 'lei'];

/** Assert `text` carries `expected` and none of the other markers. */
function expectOnlyMarker(text: string, expected: string): void {
  expect(text).toContain(expected);
  for (const marker of MARKERS) {
    if (marker === expected) continue;
    // `US$` contains `$`, so a `$` check would false-positive on `es-ES`/USD.
    if (expected.includes(marker)) continue;
    expect(text).not.toContain(marker);
  }
}

describe('formatMoney — locale decides the shape, the entity decides the currency', () => {
  it('puts the euro sign AFTER the amount in es-ES and uses a comma decimal', () => {
    const text = formatMoney(1234.56, 'EUR', 'es-ES', { minimumFractionDigits: 2 });
    // The two properties a hardcoded `€${amount}` gets wrong, both at once.
    expect(text.trim().endsWith('€')).toBe(true);
    expect(text.startsWith('€')).toBe(false);
    expect(text).toMatch(/1234,56/);
    expect(text).not.toMatch(/1234\.56/);
  });

  it('puts the dollar sign BEFORE the amount in en-US and groups with commas', () => {
    const text = formatMoney(1234567.89, 'USD', 'en-US', { minimumFractionDigits: 2 });
    expect(text.startsWith('$')).toBe(true);
    expect(text).toContain('1,234,567.89');
  });

  it('renders RON for a Romanian listing, with no euro sign anywhere', () => {
    const text = formatMoney(1234.56, 'RON', 'ro-RO', { minimumFractionDigits: 2 });
    expect(text).toMatch(/RON|lei/);
    expect(text).not.toContain('€');
    expect(text).toMatch(/1\.234,56/);
  });

  it('renders złoty for a Polish listing, with no euro sign anywhere', () => {
    const text = formatMoney(1234.56, 'PLN', 'pl-PL', { minimumFractionDigits: 2 });
    expect(text).toMatch(/zł|PLN/);
    expect(text).not.toContain('€');
    expect(text).toMatch(/1234,56/);
  });

  it('never infers the currency from the locale — the entity wins', () => {
    // Same locale, same amount, two currencies: the marker must follow the
    // CURRENCY. This is the marker bug (`€` on every listing) stated as a test.
    //
    // The złoty case allows `PLN` as well as `zł` because which one appears is
    // an ICU DATA question, not a correctness one: Spanish has no localized
    // symbol for the złoty, so `es-ES` renders the code while `pl-PL` renders
    // the symbol. Both are right; neither is a euro sign, which is the point.
    const polishInSpanish = formatMoney(1700, 'PLN', 'es-ES');
    expect(polishInSpanish).toMatch(/zł|PLN/);
    expect(polishInSpanish).not.toContain('€');
    expectOnlyMarker(formatMoney(1700, 'EUR', 'es-ES'), '€');
    // And the reverse: an English reader looking at a Spanish listing still
    // sees euros, not dollars.
    expectOnlyMarker(formatMoney(1700, 'EUR', 'en-US'), '€');
  });

  it('never converts — the digits that go in are the digits that come out', () => {
    // 1000 PLN is roughly 230 EUR. A formatter consulting an exchange rate would
    // print something near 230; this must print 1000 whatever the locale.
    expect(formatMoney(1000, 'PLN', 'es-ES')).toContain('1000');
    expect(formatMoney(1000, 'PLN', 'en-US')).toContain('1,000');
  });

  it('renders zero as a real price, not an empty string', () => {
    const text = formatMoney(0, 'EUR', 'es-ES');
    expect(text).toContain('0');
    expect(text).toContain('€');
  });

  it('renders a negative amount with a sign and the right digits', () => {
    const text = formatMoney(-250, 'USD', 'en-US');
    expect(text).toContain('250');
    expect(text).toMatch(/[-−]/);
  });

  it('drops trailing zero decimals by default and keeps real ones', () => {
    expect(formatMoney(1700, 'EUR', 'en-US')).toBe('€1,700');
    expect(formatMoney(1700.5, 'EUR', 'en-US')).toBe('€1,700.5');
  });

  it('coerces a non-finite amount to zero rather than rendering NaN', () => {
    expect(formatMoney(Number.NaN, 'EUR', 'en-US')).toBe('€0');
    expect(formatMoney(Number.POSITIVE_INFINITY, 'EUR', 'en-US')).toBe('€0');
  });
});

describe('formatMoney — unsupported currency codes', () => {
  it('classifies FAIR as unsupported: it is a REAL listing currency, not a hypothetical', () => {
    // `LISTING_CURRENCIES` contains `FAIR` (FairCoin), four characters, so
    // `Intl` throws a RangeError on it. This path is reached by real data.
    expect(isSupportedCurrencyCode('FAIR')).toBe(false);
    expect(isSupportedCurrencyCode('EUR')).toBe(true);
    expect(isSupportedCurrencyCode('eur')).toBe(true);
    expect(isSupportedCurrencyCode('')).toBe(false);
    expect(isSupportedCurrencyCode('E')).toBe(false);
  });

  it('falls back to the grouped amount beside the raw code, and never throws', () => {
    const text = formatMoney(1234567, 'FAIR', 'en-US');
    expect(text).toContain('1,234,567');
    expect(text).toContain('FAIR');
    // No symbol is invented for a currency nobody can name.
    expect(text).not.toContain('€');
    expect(text).not.toContain('$');
  });

  it('keeps the locale separators in the fallback path too', () => {
    expect(formatMoney(1234567, 'FAIR', 'es-ES')).toContain('1.234.567');
  });

  it('does not throw on a malformed locale tag', () => {
    expect(() => formatMoney(1700, 'EUR', 'not a locale')).not.toThrow();
    expect(formatMoney(1700, 'EUR', 'not a locale')).toContain('1');
  });

  it('accepts a lowercase or padded code', () => {
    expectOnlyMarker(formatMoney(1700, ' eur ', 'en-US'), '€');
  });
});

describe('formatPrice — the frequency comes from the priced block, never the screen', () => {
  const monthly: PriceDescriptor = { amount: 1700, currency: 'EUR', unit: 'month' };
  const nightly: PriceDescriptor = { amount: 110, currency: 'EUR', unit: 'night' };
  const sale: PriceDescriptor = { amount: 350000, currency: 'EUR', unit: 'sale' };

  it('suffixes a monthly rent with its unit', () => {
    expect(formatPrice(monthly, 'en-US')).toBe('€1,700 / month');
  });

  it('suffixes a nightly rate with its own unit, not the monthly one', () => {
    expect(formatPrice(nightly, 'en-US')).toBe('€110 / night');
  });

  it('leaves an asking price with no per-unit suffix', () => {
    const text = formatPrice(sale, 'en-US');
    expect(text).toBe('€350,000');
    expect(text).not.toContain('/');
  });

  it('leaves a booking total unsuffixed', () => {
    const total: PriceDescriptor = {
      amount: 640,
      currency: 'EUR',
      unit: 'total',
      includesMandatoryFees: true,
    };
    expect(formatPrice(total, 'en-US')).toBe('€640');
  });

  it('takes the unit wording from the caller, so it can be translated', () => {
    const spanish: PriceUnitLabels = {
      ...DEFAULT_PRICE_UNIT_LABELS,
      month: { short: 'mes', spoken: 'al mes' },
    };
    const text = formatPrice(monthly, 'es-ES', { unitLabels: spanish });
    expect(text).toContain('mes');
    expect(text).not.toContain('month');
    expect(text.trim().endsWith('mes')).toBe(true);
  });

  it('maps every stored PriceUnit onto a display frequency', () => {
    // Exhaustive on purpose: a new PriceUnit member must fail to compile in
    // `priceFrequencyFromPriceUnit` rather than fall through to a default.
    expect(Object.values(PriceUnit).map(priceFrequencyFromPriceUnit).sort()).toEqual(
      ['day', 'month', 'night', 'week', 'year'],
    );
  });
});

describe('formatPriceLabel — the accessibility form', () => {
  it('spells the currency and the frequency out instead of using glyphs', () => {
    const text = formatPriceLabel({ amount: 1700, currency: 'EUR', unit: 'month' }, 'en-US');
    expect(text).toContain('euros');
    expect(text).toContain('per month');
    expect(text).not.toContain('€');
    expect(text).not.toContain('/');
  });

  it('spells the currency in the reader language', () => {
    const text = formatPriceLabel({ amount: 1700, currency: 'EUR', unit: 'sale' }, 'es-ES');
    expect(text).toContain('euros');
    expect(text).not.toContain('€');
  });

  it('omits the frequency for a sale, which is not charged "per" anything', () => {
    const text = formatPriceLabel({ amount: 350000, currency: 'EUR', unit: 'sale' }, 'en-US');
    expect(text.trim()).toBe(text);
    expect(text).not.toContain('per');
  });
});

describe('formatMoneyRange', () => {
  it('joins both ends in the same currency', () => {
    const text = formatMoneyRange(500, 1200, 'EUR', 'en-US');
    expect(text).toBe('€500–€1,200');
  });

  it('returns only the end that is present, leaving the preposition to i18n', () => {
    expect(formatMoneyRange(null, 1200, 'EUR', 'en-US')).toBe('€1,200');
    expect(formatMoneyRange(500, undefined, 'EUR', 'en-US')).toBe('€500');
  });

  it('returns an empty string when neither end is a usable number', () => {
    expect(formatMoneyRange(null, null, 'EUR', 'en-US')).toBe('');
    expect(formatMoneyRange(Number.NaN, undefined, 'EUR', 'en-US')).toBe('');
  });

  it('follows the locale on both ends, not just the first', () => {
    const text = formatMoneyRange(500, 1200, 'EUR', 'es-ES');
    expect(text.startsWith('€')).toBe(false);
    expect(text.trim().endsWith('€')).toBe(true);
  });
});

describe('formatDeposit', () => {
  it('renders whole units — a deposit with cents reads as a data error', () => {
    expect(formatDeposit(1700, 'EUR', 'en-US')).toBe('€1,700');
    expect(formatDeposit(1700.4, 'EUR', 'en-US')).toBe('€1,700');
  });

  it('follows the listing currency like every other amount', () => {
    expectOnlyMarker(formatDeposit(2000, 'PLN', 'pl-PL'), 'zł');
  });
});
